import os
import re
import json
import asyncio
from decimal import Decimal
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
import sys
import logging
import time

from core.config import LM_STUDIO_URL, MAX_CONCURRENT_QUERIES
from core.queue_manager import queue_manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)

from services.document import extract_and_process_document
from services.llm_client import generate_response_stream
from services.nli import score_faithfulness_async as nli_score_faithfulness_async
from services.ambiguity import detect_ambiguity, enrich_query_with_clarification
from sentence_transformers import SentenceTransformer

# Load environment variables
load_dotenv()

# Custom JSON encoder: handles types that psycopg2 returns but stdlib json
# cannot serialise out of the box (Decimal, RealDictRow, numpy scalars, etc.)
class LegalJSONEncoder(json.JSONEncoder):
    """Serialise psycopg2 / numpy types that the standard encoder rejects."""
    def default(self, obj):
        # Decimal (e.g. rrf_score computed in SQL)
        if isinstance(obj, Decimal):
            return float(obj)
        # psycopg2 RealDictRow — behaves like a dict already
        try:
            from psycopg2.extras import RealDictRow
            if isinstance(obj, RealDictRow):
                return dict(obj)
        except ImportError:
            pass
        # numpy scalar types
        try:
            import numpy as np
            if isinstance(obj, (np.integer,)):
                return int(obj)
            if isinstance(obj, (np.floating,)):
                return float(obj)
            if isinstance(obj, np.ndarray):
                return obj.tolist()
        except ImportError:
            pass
        return super().default(obj)

def dumps(obj) -> str:
    """Convenience wrapper for json.dumps that always uses LegalJSONEncoder."""
    return json.dumps(obj, cls=LegalJSONEncoder)

app = FastAPI(title="CIVIL-LEX RAG Service API")

# Initialize embedding model (global so it doesn't reload per request)
print("Loading embedding model...")
embedder = SentenceTransformer(os.getenv("EMBEDDING_MODEL_NAME", "sentence-transformers/stsb-xlm-r-multilingual"))

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEFAULT_DB_URL = os.getenv(
    "POSTGRES_DB_URL",
    "postgresql://postgres:postgres@localhost:54322/postgres"
)

def get_db_connection():
    try:
        conn = psycopg2.connect(DEFAULT_DB_URL)
        return conn
    except Exception as e:
        print(f"Error connecting to database: {e}")
        raise HTTPException(status_code=500, detail="Database connection failed")

def init_db():
    print("Initializing database FTS dictionary and vector indexes...")
    # NOTE: The schema is managed by Supabase migrations.
    # Do NOT drop and recreate the FTS column here, as it forces a complete rewrite 
    # of the entire 4.8GB table on every startup and destroys the GIN index.
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            # Full-text search index
            cur.execute("CREATE INDEX IF NOT EXISTS fts_idx ON document_chunks USING GIN (fts);")
            # Dedicated partial HNSW, B-Tree, and GIN indexes for small partitions to prevent 351,000 cases from drowning them out
            cur.execute("CREATE INDEX IF NOT EXISTS article_vector_idx ON public.document_chunks USING hnsw (embedding vector_cosine_ops) WHERE parent_type = 'article';")
            cur.execute("CREATE INDEX IF NOT EXISTS article_parent_id_idx ON public.document_chunks(parent_id) WHERE parent_type = 'article';")
            cur.execute("CREATE INDEX IF NOT EXISTS article_fts_idx ON public.document_chunks USING gin (fts) WHERE parent_type = 'article';")
            cur.execute("CREATE INDEX IF NOT EXISTS doc_vector_idx ON public.document_chunks USING hnsw (embedding vector_cosine_ops) WHERE parent_type = 'user_document';")
            conn.commit()
        conn.close()
    except Exception as e:
        print(f"Failed to update FTS/index schema: {e}")

# Run once on startup
init_db()

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "service-rag-python"}

@app.get("/system/queue-status")
@app.get("/system/status")
async def get_system_queue_status():
    """
    Returns live concurrency metrics, queue depth, active queries, and LM Studio model health.
    """
    import httpx
    status_data = queue_manager.get_status()

    # Query LM Studio health and loaded models
    lm_online = False
    loaded_models = []
    latency_ms = None
    try:
        t0 = time.time()
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{LM_STUDIO_URL.rstrip('/')}/models")
            latency_ms = round((time.time() - t0) * 1000, 1)
            if resp.status_code == 200:
                lm_online = True
                data = resp.json()
                loaded_models = [m.get("id") for m in data.get("data", [])]
    except Exception:
        lm_online = False

    status_data["lm_studio"] = {
        "url": LM_STUDIO_URL,
        "online": lm_online,
        "latency_ms": latency_ms,
        "models": loaded_models,
        "vram_profile": "6.0 GB VRAM Strict Concurrency Enforced"
    }
    return status_data


@app.get("/api/civil-code/toc")
def get_civil_code_toc():
    """
    Fetches the hierarchical table of contents for the Civil Code.
    """
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # We want to fetch all articles and their hierarchy to build the tree.
            # For TOC, we just need the hierarchy information.
            # To avoid transferring huge text, we only select necessary fields.
            cur.execute("""
                SELECT article_id, article_number, hierarchy 
                FROM civil_code_articles 
                ORDER BY article_number ASC;
            """)
            articles = cur.fetchall()
            
            # Reconstruct the tree.
            # Hierarchy looks like: {"book": 0, "book_name": "...", "title": ..., "chapter": ..., "section": ...}
            # We will build a nested dictionary/list structure for the frontend.
            
            tree_dict = {}
            
            for art in articles:
                h = art['hierarchy']
                book_name = h.get('book_name')
                title_name = h.get('title_name')
                chapter_name = h.get('chapter_name')
                
                # We'll construct string keys to group them
                book_key = book_name if book_name else "Uncategorized Book"
                title_key = title_name if title_name else "Uncategorized Title"
                chapter_key = chapter_name if chapter_name else "Uncategorized Chapter"
                
                if book_key not in tree_dict:
                    tree_dict[book_key] = {}
                if title_key not in tree_dict[book_key]:
                    tree_dict[book_key][title_key] = {}
                if chapter_key not in tree_dict[book_key][title_key]:
                    tree_dict[book_key][title_key][chapter_key] = []
                    
                tree_dict[book_key][title_key][chapter_key].append({
                    "id": art['article_id'],
                    "title": f"Article {art['article_number']}" if art['article_number'] else art['article_id'],
                    "article_number": art['article_number']
                })
            
            # Convert dictionary tree to nested list of TreeNodes
            # TreeNode: { id: string, title: string, children?: TreeNode[] }
            result_tree = []
            b_idx = 0
            for book_name, titles in tree_dict.items():
                b_idx += 1
                book_node = {
                    "id": f"book-{b_idx}",
                    "title": book_name,
                    "children": []
                }
                
                t_idx = 0
                for title_name, titles_content in titles.items():
                    # Check if there are actual chapters or just articles at the title level
                    t_idx += 1
                    title_node = {
                        "id": f"book-{b_idx}-title-{t_idx}",
                        "title": title_name,
                        "children": []
                    }
                    
                    c_idx = 0
                    for chapter_name, arts in titles_content.items():
                        c_idx += 1
                        
                        if chapter_name == "Uncategorized Chapter":
                            # Attach directly to Title if no chapter
                            arts_sorted = sorted(arts, key=lambda x: x['article_number'] if x['article_number'] else 999999)
                            for a in arts_sorted:
                                title_node["children"].append({
                                    "id": a['id'],
                                    "title": a['title']
                                })
                        else:
                            chapter_node = {
                                "id": f"book-{b_idx}-title-{t_idx}-chapter-{c_idx}",
                                "title": chapter_name,
                                "children": []
                            }
                            
                            # Sort articles by article_number
                            arts_sorted = sorted(arts, key=lambda x: x['article_number'] if x['article_number'] else 999999)
                            for a in arts_sorted:
                                chapter_node["children"].append({
                                    "id": a['id'],
                                    "title": a['title']
                                })
                                
                            title_node["children"].append(chapter_node)
                    
                    book_node["children"].append(title_node)
                
                result_tree.append(book_node)
                
            return {"toc": result_tree}
    except Exception as e:
        print(f"Error fetching TOC: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.get("/api/civil-code/article/{article_id}")
def get_civil_code_article(article_id: str):
    """
    Fetches the details of a specific article.
    """
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT article_id, article_number, hierarchy, content 
                FROM civil_code_articles 
                WHERE article_id = %s;
            """, (article_id,))
            article = cur.fetchone()
            
            if not article:
                raise HTTPException(status_code=404, detail="Article not found")
                
            # Fetch related jurisprudence (if any)
            cur.execute("""
                SELECT j.case_uid, j.title, j.gr_number, j.decision_date, j.content_summary, j.source_url
                FROM article_jurisprudence_relations r
                JOIN jurisprudence_cases j ON r.case_uid = j.case_uid
                WHERE r.article_id = %s
                LIMIT 5;
            """, (article_id,))
            related_cases = cur.fetchall()
            
            article['related_cases'] = related_cases
            return article
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching article: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

class ExtractRequest(BaseModel):
    file_url: str
    document_id: str
    filename: str

@app.post("/extract")
def extract_document(request: ExtractRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(extract_and_process_document, request.file_url, request.document_id, request.filename)
    return {"status": "processing"}

class ChatMessage(BaseModel):
    role: str
    content: str

class SearchRequest(BaseModel):
    query: str
    session_id: Optional[str] = None
    history: List[ChatMessage] = []
    document_id: Optional[str] = None
    document_name: Optional[str] = None
    prior_citations: List[Dict] = []
    clarification_context: Optional[Dict] = None  # Carries user's answers to clarification questions

# Stopwords for both English and conversational Filipino/Tagalog
SEARCH_STOPWORDS = {
    # English
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren',
    'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
    'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from',
    'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself',
    'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most',
    'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our',
    'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such', 'than',
    'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this',
    'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when',
    'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you', 'your', 'yours', 'yourself',
    # Filipino / Tagalog Conversational
    'ang', 'mga', 'ng', 'sa', 'ko', 'mo', 'niya', 'namin', 'nila', 'ninyo', 'ito', 'iyan', 'iyon',
    'na', 'pa', 'ba', 'din', 'rin', 'naman', 'kasi', 'kaya', 'kung', 'kapag', 'pag', 'at', 'o',
    'ano', 'ano-ano', 'sino', 'sino-sino', 'saan', 'kailan', 'bakit', 'paano', 'gaano',
    'pwede', 'puwede', 'maaari', 'dapat', 'gusto', 'nais', 'may', 'mayroon', 'wala',
    'ako', 'ikaw', 'siya', 'kami', 'tayo', 'kayo', 'sila', 'akin', 'iyo', 'kaniya', 'amin', 'atin',
    'inyo', 'kanila', 'yung', 'ung', 'eh', 'oh', 'po', 'opo', 'ho', 'oho'
}

PHILIPPINE_LEGAL_EXPANSIONS = [
    # Reciprocal obligations / breach of contract / cancellation / rescission / resolution
    (r'\b(rescind|rescission|resolution of contract|cancel the contract|cancel contract|cancelling the contract|failed to complete|failed to comply|contractor|advance payment|demand my money back|money back|return my money|reciprocal obligations|injured party)\b',
     'reciprocal obligations rescission resolution breach of contract delay mora damages restitution Art 1191 Art 1170 Art 1169 Art 1385'),

    # Sales / warranties / hidden defects / redhibitory action / refund
    (r'\b(hidden defect|hidden defects|defect|defects|defective|broke down|factory defect|warranty|warranties|dealership|car dealer|vehicle defect|return it for a refund|refund for defective|accion redhibitoria|quanti minoris|redhibitory)\b',
     'sale warranty hidden defects vendor liability accion redhibitoria rescission refund damages Art 1561 Art 1566 Art 1567 Art 1571'),

    # Vehicular accidents / reckless driving / road crash / employer liability
    (r'\b(aksidente|bangga|nabangga|binangga|sagasa|nasagasaan|gasgas|aksidente sa sasakyan|kotse|motor|motorsiklo|driver|tsuper|truck|delivery truck|truck hit|car hit|hit.*(?:car|vehicle|truck)|speeding|reckless driving|company that employed|employed him)\b',
     'quasi delict fault negligence vehicular accident motor vehicle employer vicarious liability damages Art 2176 Art 2180 Art 2185 Art 2199 Art 2206'),

    # Physical injury / assault / battery / violent physical acts
    (r'\b(suntok|sinuntok|manuntok|bugbog|binugbog|mambugbog|saksak|sinaksak|hampas|hinampas|palo|pinalo|sugat|sinugatan|sakitan|sinaktan|pananakit|tadyak|tinadyakan|sampal|sinampal|kinalmot|assault|battery|punch|punched|beaten|injure|injury|injuries)\b',
     'physical injuries quasi delict assault battery fault negligence civil liability damages Art 33 Art 2176 Art 2219 Art 20 Art 21'),
    
    # Neighbor disputes / boundary / nuisance / noise / easement
    (r'\b(kapitbahay|boundary|hangganan|bakod|harang|ingay|maingay|amoy|mabahong|perhuwisyo|istorbo|harang sa daan)\b',
     'neighbor property nuisance easement lateral support damages Art 684 Art 694 Art 2176'),
    
    # Land encroachment / building on another's land / land disputes
    (r'\b(tinayuan ng bahay|tinayuan ng pader|inangkin ang lupa|inagaw ang lupa|sukat ng lupa|kamkam|kinamkam)\b',
     'ownership property possession accession builder in good faith adverse possession Art 448 Art 450'),
    
    # Lease / rental / eviction / tenant / unpaid rent
    (r'\b(upa|paupa|nagpapaupa|umupa|nangungupahan|upahan|paupahan|evict|paalisin|layas|patalsikin|deposito sa upa)\b',
     'lease contract ejectment unlawful detainer obligations of lessor lessee Art 1654 Art 1673'),
    
    # Debt / loans / bounced checks / collection / interest
    (r'\b(utang|umutang|pautang|pautangan|singil|maningil|sinisingil|bayad|di nagbayad|hindi nagbayad|tseke|talbog|bounced check|borrow|borrowed|lended|lend|loan|promissory note|refuses to pay|refused to pay|unpaid loan|small claims)\b',
     'obligations contracts breach of contract delay default mora payment legal interest promissory note sum of money Art 1169 Art 1170 Art 1231 Art 1232'),
    
    # Contracts / agreements / fraud / void / consent
    (r'\b(kontrata|kasulatan|pirma|pinapirma|kasunduan|usapan|bale|contract|consent|void|niloko)\b',
     'contract essential requisites consent cause object void voidable rescissible Art 1318 Art 1381 Art 1390 Art 1409'),
    
    # Succession / inheritance / wills / heirs / estate settlement
    (r'\b(mana|pamana|namatay|pamanang|habilin|testamento|mana-mana|hati sa lupa ng magulang|mana ng anak sa labas)\b',
     'succession inheritance will legitime compulsory heirs intestate testate Art 777 Art 887 Art 960'),
    
    # Marriage / annulment / legal separation / property relations
    (r'\b(kasal|hiwalay|annulment|nullity|babaero|kabit|lalakero|asawa|pangangaliwa|pambababae|psychological incapacity|marital obligations)\b',
     'marriage family code psychological incapacity declaration of absolute nullity conjugal partnership legal separation support Art 36 Art 68 Art 69 Art 147 Art 148'),
    
    # Damages / compensation
    (r'\b(moral damages|exemplary damages|nominal damages|actual damages|bayad pinsala)\b',
     'actual moral exemplary nominal liquidated damages Art 2199 Art 2216 Art 2217 Art 2219 Art 2221 Art 2229 Art 2231')
]

# Query Intent Classification & Domain Boundary Gating

NON_LEGAL_PATTERNS = [
    # Programming, Software & Tech
    r'\b(python|javascript|typescript|react|vue|angular|html|css|c\+\+|java\b|golang|rust|php|ruby|swift|kotlin|sql\s+query|nosql|mongodb|docker|kubernetes|git\b|github|algorithm|algorithms|function\s+to|write\s+code|code\s+snippet|def\s+[a-zA-Z_]|print\(|console\.log|class\s+[a-zA-Z_]|for\s+loop|while\s+loop|linked\s*list|binary\s*tree|leetcode|sorting\s+algorithm|merge\s*sort|quick\s*sort|bubble\s*sort|binary\s*search|stack|queue|compiler|syntax\s+error|runtime\s+error|npm\s+|pip\s+install|frontend|backend|full\s*stack|web\s+development)\b',
    # Math & Natural Sciences (Physics, Quantum Mechanics, Chemistry, Biology, Astronomy)
    r'\b(quantum(?:\s+(?:entanglement|physics|mechanics|computing|theory|tunneling|gravity|field|state|leap|realm|supremacy))?|schrodinger|general\s+relativity|special\s+relativity|string\s+theory|particle\s+physics|higgs\s+boson|thermodynamics|entropy|astrophysics|black\s+hole|wormhole|supernova|speed\s+of\s+light|derivative\s+of|integral\s+of|solve\s+for\s+x|quadratic\s+equation|pythagorean|calculus|trigonometry|matrix\s+multiplication|differential\s+equation|chemical\s+formula|periodic\s+table|photosynthesis|mitosis|meiosis|cellular\s+respiration|dna\s+replication|chemical\s+reaction|gravitational\s+waves?|newton\'s\s+(?:first|second|third)?\s*law|solar\s+system|planets)\b',
    # Culinary, Food & Recipes
    r'\b(recipe|recipes|how\s+to\s+cook|how\s+to\s+bake|how\s+to\s+make\s+a\s+|ingredients\s+for|adobo\s+recipe|sinigang\s+recipe|bake\s+a\s+cake|chocolate\s+cake|cake|cookies|marinate|seasoning|fried\s+chicken|pasta\s+recipe)\b',
    # Pop Culture, Fiction, Comics, Fantasy, Creative Writing, Sports & Lifestyle
    r'\b(harry\s+potter|voldemort|hogwarts|jedi|sith|star\s+wars|lightsaber|marvel|avengers|thanos|batman|superman|spider-?man|iron\s*man|anime|goku|naruto|pokemon|manga|lord\s+of\s+the\s+rings|gandalf|frodo|middle-?earth|superhero|superheroes|time\s+travel|multiverse|teleportation|write\s+a\s+poem|write\s+a\s+song|write\s+a\s+story|write\s+an\s+essay|movie\s+recommendation|who\s+won\s+the\s+(?:game|match|finals|world\s*cup)|nba\s+finals|pba\s+finals|celebrity\s+gossip|horoscope|zodiac\s+sign|lyrics\s+of|weather\s+in|forecast\s+for|capital\s+of|translate\s+(?:this\s+)?to|workout\s+routine|diet\s+plan)\b',
]

NON_CIVIL_LEGAL_DOMAINS = [
    # Tax Law
    (
        r'\b(tax|taxes|taxation|bir\b|nirc\b|internal\s+revenue|vat\b|value-added\s+tax|income\s+tax|withholding\s+tax|estate\s+tax|donor\'s\s+tax|percentage\s+tax|customs\s+tariff|tariffs|tariff\s+and\s+customs|train\s+law|create\s+law|tax\s+evasion|bir\s+form|capital\s+gains\s+tax|tax\s+return|tax\s+deduction|tax\s+exempt|tax\s+assessment)\b',
        'Philippine Tax Law (National Internal Revenue Code [NIRC] / Bureau of Internal Revenue [BIR])'
    ),
    # Labor Law (Pure employment/labor standards/NLRC)
    (
        r'\b(nlrc\b|dole\b|labor\s+code|presidential\s+decree\s+(?:no\.?\s*)?442|illegal\s+dismissal|unjust\s+dismissal|constructive\s+dismissal|separation\s+pay|13th\s+month\s+pay|holiday\s+pay|overtime\s+pay|minimum\s+wage|labor\s+arbiter|labor\s+union|collective\s+bargaining|unfair\s+labor\s+practice|retrenchment|reinstatement\s+with\s+backwages|dole\s+complaint|seno\b)\b',
        'Philippine Labor Law (Presidential Decree No. 442 - Labor Code / DOLE / NLRC)'
    ),
    # Criminal Law (Pure offenses/procedure without civil claim)
    (
        r'\b(revised\s+penal\s+code|rpc\b|bilibid|new\s+bilibid|buCor|inquest\s+proceedings?|bail\s+bond|plea\s+bargaining|parole|probation|homicide|murder|treason|rebellion|sedition|coup\s+d\'etat|illegal\s+possession\s+of\s+firearm|ra\s*10591|dangerous\s+drugs|ra\s*9165|shabu|marijuana|drug\s+trafficking|buy-bust|anti-fencing|plunder|anti-graft|sandiganbayan|ombudsman|cybercrime\s+prevention\s+act|ra\s*10175)\b',
        "Philippine Criminal Law (Revised Penal Code / Special Penal Laws / DOJ Prosecutor's Office)"
    ),
    # Corporate & Financial Governance
    (
        r'\b(sec\s+registration|revised\s+corporation\s+code|ra\s*11232|articles\s+of\s+incorporation|by-laws\s+of\s+the\s+corporation|board\s+resolution|board\s+of\s+directors\s+meeting|quorum\s+for\s+board|stockholders\s+meeting|anti-money\s+laundering\s+act|amla\b|bsp\s+circular|bank\s+secrecy\s+law)\b',
        'Philippine Corporate & Commercial Law (Revised Corporation Code / SEC / BSP)'
    ),
    # Immigration & Election
    (
        r'\b(bureau\s+of\s+immigration|philippine\s+immigration\s+act|visa\s+extension|overstaying\s+alien|deportation\s+order|alien\s+registration|comelec\b|omnibus\s+election\s+code|voter\s+registration|election\s+protest)\b',
        'Philippine Immigration / Election Law (Bureau of Immigration / COMELEC)'
    )
]

CIVIL_LAW_POSITIVE_PATTERNS = [
    r'(?:article|art\.?)\s*\d+',
    r'\b(civil\s+code|ra\s*386|republic\s+act\s*(?:no\.?\s*)?386|family\s+code|executive\s+order\s*(?:no\.?\s*)?209|eo\s*209)\b',
    r'\b(g\.?\s*r\.?\s*(?:no\.?|nos\.?)?\s*(?:l-)?\d+[\w\-]*)\b',
    r'\b(quasi[- ]delict|tort|torts|negligence|fault|vicarious\s+liability|rescission|restitution|annulment|voidable|unenforceable|prescriptive\s+period|prescription|easement|usufruct|accession|hidden\s+defect|redhibitory|consignation|subrogation|novation|dation\s+in\s+payment|dacion\s+en\s+pago|solidary|joint\s+obligation|fortuitous\s+event|force\s+majeure|earnest\s+money|option\s+money|pactum\s+commissorium|antichresis|pledge|chattel\s+mortgage|real\s+estate\s+mortgage|co-ownership|nuisance|lateral\s+support|testator|intestate|legitime|preterition|collation|fideicommissary|family\s+home|parental\s+authority|filiation|paternity|adoption|emancipation|civil\s+registrar|change\s+of\s+name|independent\s+civil\s+action|human\s+relations|abuse\s+of\s+right|contra\s+bonus\s+mores|unjust\s+enrichment)\b',
    r'\b(kontrata|kasulatan|kasunduan|usapan|bale|utang|pautang|singil|upa|umupa|paupahan|nangungupahan|mana|pamana|testamento|habilin|kasal|annulment|hiwalay|asawa|kabit|danyos|bayad-pinsala|pananagutan|ikaso|demanda|ihabla|bakod|hangganan|lupa|kamkam|inagaw\s+ang\s+lupa|aksidente|nabangga|nasagasaan|suntok|sinuntok|bugbog|pananakit|paninirang-puri|tsismis)\b'
]

def is_refusal_or_out_of_scope(text: str) -> bool:
    """Detects whether a synthesized LLM response is an explicit refusal or out-of-scope determination."""
    refusal_patterns = [
        r'\b(?:falls|is)\s+outside\s+(?:the\s+)?scope\b',
        r'\bthere\s+are\s+no\s+statutory\s+(?:damages|provisions|remedies|articles)\s+provided\s+for\b',
        r'\bnot\s+a\s+recognized\s+civil\s+wrong\b',
        r'\bnot\s+governed\s+by\s+(?:the\s+civil\s+code|ra\s*386|philippine\s+civil\s+law)\b',
        r'\bgoverning\s+civil\s+code\s+article\(s\):\s*(?:none|n/?a|not\s+applicable)\b',
        r'\bconcept\s+from\s+(?:theoretical\s+physics|science|mathematics|computer\s+science|physics)\b',
        r'\boutside\s+the\s+field\s+of\s+law\b',
        r'\bno\s+applicable\s+civil\s+code\s+article\b',
        r'\blocal\s+llm\s+service\s+notice\b',
        r'\bunable\s+to\s+connect\s+to\s+(?:the\s+)?local\b',
    ]
    return any(bool(re.search(p, text, re.IGNORECASE)) for p in refusal_patterns)

def classify_query_intent(
    query: str, 
    history: Optional[List[ChatMessage]] = None, 
    document_id: Optional[str] = None,
    document_filename: Optional[str] = None
) -> Dict[str, Any]:
    """
    Evaluates incoming queries to determine whether they fall within the domain of
    the Philippine Civil Code (RA 386) and Family Code (EO 209), or constitute
    out-of-domain non-legal requests (refusal) or other Philippine legal branches (redirection).
    """
    q_clean = query.strip()
    q_lower = q_clean.lower()

    # 1. Check for Non-Legal patterns (physics, science, programming, cooking, fiction)
    is_non_legal = any(bool(re.search(p, q_lower)) for p in NON_LEGAL_PATTERNS)
    is_casual_greeting = bool(re.match(r'^(hello|hi|hey|good\s+morning|good\s+afternoon|good\s+evening|kumusta|kamusta|who\s+are\s+you|what\s+can\s+you\s+do|tell\s+me\s+a\s+joke)\b', q_lower)) and len(q_clean.split()) <= 6

    # Allow authentic commercial IT service/contract disputes (e.g. "developer breached contract to build app")
    is_commercial_tech_contract = bool(
        re.search(r'\b(?:contract|agreement|payment|bale|bayad|invoice|developer|freelancer|client|service\s+agreement)\b', q_lower) and
        re.search(r'\b(?:software|website|app|application|system)\b', q_lower) and
        not re.search(r'\b(?:quantum|physics|schrodinger|algorithm|sorting|recursion|derivative|recipe|cake|poem|joke|entanglement)\b', q_lower)
    )

    if (is_non_legal and not is_commercial_tech_contract) or is_casual_greeting:
        return {
            "category": "out_of_domain_non_legal",
            "target_domain": None,
            "reason": "Query involves non-legal subject matter (science, physics, programming, fiction, casual chat, or general knowledge) and contains no recognized civil cause of action under RA 386."
        }

    # 2. Explicit Civil Law statutory or doctrine references
    has_explicit_civil = any(bool(re.search(p, q_lower)) for p in CIVIL_LAW_POSITIVE_PATTERNS)

    # 3. Check for Non-Civil Philippine Legal Domains (Tax, Labor, Criminal, Corporate)
    matched_legal_domain = None
    for pattern, domain_name in NON_CIVIL_LEGAL_DOMAINS:
        if re.search(pattern, q_lower):
            matched_legal_domain = domain_name
            break

    if matched_legal_domain:
        # If the user explicitly asks about civil damages, contract breach, or Civil Code articles,
        # treat as in-domain civil law (e.g. damages arising from crimes/labor disputes)
        has_civil_damages = bool(re.search(r'\b(damages|danyos|bayad-pinsala|civil\s+liability|pananagutan|quasi[- ]delict|breach\s+of\s+contract|article|art\.?)\b', q_lower))
        if not (has_explicit_civil or has_civil_damages):
            return {
                "category": "out_of_domain_legal",
                "target_domain": matched_legal_domain,
                "reason": f"Inquiry primarily governed by specialized Philippine law: {matched_legal_domain}."
            }

    # 4. If analyzing an active document and query is contextual
    if document_id:
        return {
            "category": "in_domain_civil",
            "target_domain": None,
            "reason": "Active legal document analysis session."
        }

    # 5. Default to in-domain civil law
    return {
        "category": "in_domain_civil",
        "target_domain": None,
        "reason": "In-domain Philippine Civil Law inquiry."
    }

def expand_legal_query(query: str) -> str:
    """Enriches conversational and Filipino/layman queries with relevant statutory terms and article hints."""
    expanded_terms = []
    query_lower = query.lower()
    for pattern, expansion in PHILIPPINE_LEGAL_EXPANSIONS:
        if re.search(pattern, query_lower):
            expanded_terms.append(expansion)
    if expanded_terms:
        return f"{query} ({' '.join(expanded_terms)})"
    return query

def clean_doc_title(filename: Optional[str]) -> str:
    """Cleans a filename to extract a human-readable title for search anchoring."""
    if not filename:
        return ""
    name = filename.rsplit(".", 1)[0]
    return re.sub(r"[_\-]+", " ", name).strip()

def build_contextual_query(query: str, history: List[ChatMessage], document_filename: Optional[str] = None) -> str:
    """
    Augments the search query with recent conversational context if the user's query
    refers to previous turns (pronouns, follow-ups, article/requisite references, or document clauses),
    and enriches colloquial/layman terms with governing Philippine Civil Code statutory concepts.
    """
    base_query = query
    if history or document_filename:
        # Check if query specifically mentions an article or case GR number
        has_art_in_query = bool(re.search(r'(?:article|art\.?)\s*\d+', query, re.IGNORECASE))
        has_case_in_query = bool(re.search(r'g\.r\.\s*(?:no\.|nos\.)?\s*[\w\-]+', query, re.IGNORECASE))

        # Coreference / follow-up cues
        has_pronoun_or_relative = bool(re.search(
            r'\b(it|its|this|that|these|those|the same|said|above|former|latter|aforementioned|such|neither|either|he|she|they|them|his|her|their)\b',
            query,
            re.IGNORECASE
        ))
        has_fragment_ref = bool(re.search(
            r'\b(first|second|third|fourth|fifth|requisite|requisites|element|elements|exception|exceptions|remedy|remedies|penalty|penalties|paragraph|par\.|subparagraph|clause|clauses|section|sections|provision|provisions|valid|validity|void|enforceable|liable|liability|breach|recourse|damages|compensate|compensation|prescribe|prescription|rights|obligations|term|duration|defense|defenses|procedure|grounds|effect|effects|apply|applicable)\b',
            query,
            re.IGNORECASE
        ))
        is_conversational_followup = bool(re.match(
            r'^\s*(what about|how about|and if|what if|why|can they|can he|can she|is there|are there|does it|will it)\b',
            query,
            re.IGNORECASE
        ))
        is_very_short = len(query.split()) <= 7

        is_followup = (not (has_art_in_query or has_case_in_query) or has_pronoun_or_relative) and (
            has_pronoun_or_relative or has_fragment_ref or is_conversational_followup or is_very_short or document_filename
        )

        if is_followup:
            anchors = []

            # 1. Document filename anchor if analyzing a document
            doc_title = clean_doc_title(document_filename)
            if doc_title and doc_title.lower() not in query.lower():
                anchors.append(doc_title)

            # 2. Extract key legal identifiers from recent messages
            recent_msgs = history[-6:] if history else []
            for msg in reversed(recent_msgs):
                arts = re.findall(r'(?:Article|Art\.?)\s*(\d+)', msg.content, re.IGNORECASE)
                for a in arts:
                    snip = f"Article {a}"
                    if snip not in anchors and snip.lower() not in query.lower():
                        anchors.append(snip)
                grs = re.findall(r'G\.R\.\s*(?:No\.|Nos\.)?\s*([\w\-]+)', msg.content, re.IGNORECASE)
                for g in grs:
                    snip = f"G.R. No. {g}"
                    if snip not in anchors and snip.lower() not in query.lower():
                        anchors.append(snip)
                clauses = re.findall(r'\b((?:Clause|Section|Sec\.|Paragraph|Par\.)\s*\d+[a-zA-Z]?)\b', msg.content, re.IGNORECASE)
                for cl in clauses:
                    if cl not in anchors and cl.lower() not in query.lower():
                        anchors.append(cl)

            # 3. Extract core legal topic from prior user queries
            prior_user_queries = [m.content for m in recent_msgs if m.role == 'user']
            if prior_user_queries:
                last_user_q = prior_user_queries[-1].strip()
                cleaned = re.sub(
                    r'^(what is|what are|explain|tell me about|does this have|is there|how does|can you describe|please summarize)\s+',
                    '',
                    last_user_q,
                    flags=re.IGNORECASE
                )
                cleaned = re.sub(r'[?!.,;]+$', '', cleaned).strip()
                stopwords = {
                    'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'there', 'their', 'theirs',
                    'have', 'does', 'doing', 'done', 'about', 'under', 'with', 'from', 'into', 'during', 'before',
                    'after', 'above', 'below', 'please', 'tell', 'explain', 'describe', 'offer', 'letter'
                }
                words = [w for w in re.findall(r'\b\w+\b', cleaned) if len(w) > 2 and w.lower() not in stopwords and w.lower() not in query.lower()]
                if words:
                    topic_snippet = ' '.join(words[:4])
                    if topic_snippet and topic_snippet.lower() not in ' '.join(anchors).lower():
                        anchors.append(topic_snippet)

            if anchors:
                anchor_str = ' '.join(anchors[:4])
                base_query = f"{query} ({anchor_str})"

    # Enrich with domain-specific Philippine civil law concepts
    return expand_legal_query(base_query)

def compute_embedding(query: str) -> list:
    """Computes the normalized query embedding vector."""
    return embedder.encode(query, normalize_embeddings=True).tolist()


# Statutory Companion Association Graph & Retrieval Noise Pruning (RAGAS)

STATUTORY_COMPANION_GRAPH: Dict[str, List[str]] = {
    # Obligations & Contracts (Rescission, Delay, Damages, Restitution, Extinction)
    "RA386-ART1191": ["RA386-ART1170", "RA386-ART1169", "RA386-ART1385"],
    "RA386-ART1170": ["RA386-ART1169", "RA386-ART1191", "RA386-ART2201"],
    "RA386-ART1169": ["RA386-ART1170", "RA386-ART1191", "RA386-ART1231", "RA386-ART1232"],
    "RA386-ART1231": ["RA386-ART1232", "RA386-ART1169", "RA386-ART1170"],
    "RA386-ART1305": ["RA386-ART1318", "RA386-ART1159"],
    "RA386-ART1318": ["RA386-ART1319", "RA386-ART1347", "RA386-ART1350"],
    "RA386-ART1381": ["RA386-ART1385", "RA386-ART1191"],
    "RA386-ART1390": ["RA386-ART1391", "RA386-ART1398"],
    "RA386-ART1409": ["RA386-ART1410", "RA386-ART1411"],

    # Sales & Hidden Defects (Accion Redhibitoria / Quanti Minoris)
    "RA386-ART1458": ["RA386-ART1475", "RA386-ART1498"],
    "RA386-ART1561": ["RA386-ART1566", "RA386-ART1567", "RA386-ART1571"],
    "RA386-ART1566": ["RA386-ART1561", "RA386-ART1567"],
    "RA386-ART1567": ["RA386-ART1561", "RA386-ART1566", "RA386-ART1571"],

    # Torts / Quasi-Delicts & Civil Damages
    "RA386-ART2176": ["RA386-ART2180", "RA386-ART2199", "RA386-ART2206", "RA386-ART2219"],
    "RA386-ART2180": ["RA386-ART2176", "RA386-ART2199", "RA386-ART2206"],
    "RA386-ART2199": ["RA386-ART2200", "RA386-ART2219", "RA386-ART2229"],
    "RA386-ART2206": ["RA386-ART2176", "RA386-ART2199"],

    # Human Relations & Independent Civil Actions
    "RA386-ART19": ["RA386-ART20", "RA386-ART21"],
    "RA386-ART20": ["RA386-ART19", "RA386-ART21"],
    "RA386-ART21": ["RA386-ART19", "RA386-ART20", "RA386-ART2219"],
    "RA386-ART32": ["RA386-ART2219"],
    "RA386-ART33": ["RA386-ART2176", "RA386-ART2177"],

    # Property, Accession & Builder in Good Faith
    "RA386-ART448": ["RA386-ART546", "RA386-ART548"],
    "RA386-ART484": ["RA386-ART494", "RA386-ART500"],
    "RA386-ART649": ["RA386-ART650"],

    # Succession & Wills
    "RA386-ART777": ["RA386-ART886", "RA386-ART887"],
    "RA386-ART887": ["RA386-ART888", "RA386-ART892", "RA386-ART960"],

    # Family Code (Psychological Incapacity & Marriage)
    "RA386-ART36": ["RA386-ART68", "RA386-ART69"],
}

def rank_and_stratify_citations(
    items: List[Dict[str, Any]], 
    query: str = "",
    context_budget: int = 15
) -> List[Dict[str, Any]]:
    """
    Unified high-accuracy ranking, scoring, and context stratification.
    
    1. Deduplicates candidate authorities by chunk/parent key while preserving top scores.
    2. Computes composite relevance scores prioritizing exact statutory matches,
       high vector/FTS fusion, and statutory Civil Code primacy.
    3. Retains and outputs ALL retrieved documents (never discards candidates).
    4. Tags each item with sequential rank, calibrated suitability percentage,
       and context status (is_in_context=True for top context budget, False for out-of-rank).
    """
    if not items:
        return []

    # Chunk/parent unique key resolver
    def get_item_key(it: dict) -> str:
        cid = it.get('chunk_id')
        if cid:
            return str(cid)
        ptype = it.get('parent_type')
        pid = it.get('parent_id') or it.get('id')
        content_snip = it.get('content', '')[:60].strip()
        if ptype == 'user_document':
            return f"doc_{pid}_{content_snip}"
        return str(pid or content_snip)

    # Deduplicate while preserving best properties
    dedup_map: Dict[str, Dict[str, Any]] = {}
    for item in items:
        k = get_item_key(item)
        if k not in dedup_map:
            dedup_map[k] = item
        else:
            existing = dedup_map[k]
            # Merge suitability / rrf scores if current candidate is higher
            cur_score = float(item.get('rrf_score', 0) or item.get('similarity', 0) or item.get('suitability_percent', 0))
            old_score = float(existing.get('rrf_score', 0) or existing.get('similarity', 0) or existing.get('suitability_percent', 0))
            if cur_score > old_score:
                item['metadata'] = item.get('metadata') or existing.get('metadata')
                dedup_map[k] = item
            elif existing.get('metadata') is None and item.get('metadata') is not None:
                existing['metadata'] = item['metadata']

    unique_items = list(dedup_map.values())

    # Extract explicit article / case mentions from query for anchor weighting
    explicit_art_nums = set(re.findall(r'(?:article|art\.?)\s*(\d+)', query, re.IGNORECASE)) if query else set()
    query_lower = query.lower() if query else ""

    def calculate_sort_score(it: dict) -> float:
        ptype = it.get('parent_type', 'source')
        pid = str(it.get('parent_id') or '')
        is_exact = it.get('is_exact', False)
        
        # Check if item corresponds directly to an explicitly queried article number
        art_match = re.search(r'RA386-ART(\d+)', pid)
        if art_match and art_match.group(1) in explicit_art_nums:
            is_exact = True

        if is_exact:
            return 1000.0 + float(it.get('suitability_percent', 98.5))

        base_sim = float(it.get('similarity', 0.0) or 0.0)
        rrf = float(it.get('rrf_score', 0.0) or 0.0)
        score = (rrf * 100.0) + (base_sim * 10.0)

        # Companion expansion boost
        if it.get('is_companion'):
            score += 15.0

        # Substantive statutory Civil Code precedence
        if ptype == 'article':
            score += 8.0
        elif ptype == 'user_document':
            score += 6.0
        elif ptype == 'case':
            score += 2.0

        # Topical keyword resonance
        content_lower = str(it.get('content', '')).lower()
        key_legal_stems = ['rescind', 'defect', 'negligence', 'accident', 'loan', 'delay', 'mora', 'damages', 'void']
        for stem in key_legal_stems:
            if stem in query_lower and stem in content_lower:
                score += 3.0

        return score

    # Sort all retrieved items by accuracy score descending
    unique_items.sort(key=calculate_sort_score, reverse=True)

    # Assign rank, calibrated suitability percentage, and 70k context stratification
    prev_suitability = 100.0
    for idx, item in enumerate(unique_items):
        item['rank'] = idx + 1
        
        # Strictly monotonic, calibrated suitability score for UI
        if item.get('is_exact') or (idx == 0 and item.get('parent_type') == 'article'):
            suitability = round(max(95.0, 98.5 - (idx * 0.5)), 1)
        elif idx < context_budget:
            # Active Grounding authorities: strictly within [80.0%, 97.5%]
            slot_step = 17.5 / max(1, context_budget - 1)
            target = 97.5 - (idx * slot_step)
            suitability = round(max(80.0, min(prev_suitability - 0.2, target)), 1)
        else:
            # Out-of-rank authorities: strictly < 80.0% (within [50.0%, 78.5%])
            out_idx = idx - context_budget
            target = 78.5 - (out_idx * 1.5)
            suitability = round(max(50.0, min(prev_suitability - 0.2, target)), 1)

        prev_suitability = suitability
        item['suitability_percent'] = suitability
        item['display_suitability'] = suitability

        # Context stratification: top context_budget items enter the 70k prompt context
        if idx < context_budget:
            item['is_in_context'] = True
            item['rank_status'] = 'primary'
        else:
            item['is_in_context'] = False
            item['rank_status'] = 'out_of_rank'

    return unique_items


def prune_retrieval_noise(items: List[Dict[str, Any]], max_items: int = 15) -> List[Dict[str, Any]]:
    """Backward compatibility wrapper delegating to rank_and_stratify_citations."""
    return rank_and_stratify_citations(items, context_budget=max_items)


def search_with_embedding(q_emb: list, query: str, document_id: Optional[str] = None):
    """Executes high-recall hybrid RRF search, companion expansion, and full-spectrum citation ranking."""
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            def hybrid_search(parent_type, limit=20, parent_id=None):
                raw_words = [w for w in re.split(r'\W+', query) if w]
                filtered_words = [w for w in raw_words if len(w) > 2 and w.lower() not in SEARCH_STOPWORDS]
                search_words = filtered_words if filtered_words else [w for w in raw_words if len(w) > 1]
                or_query = " OR ".join(search_words) if search_words else query
                
                if parent_id:
                    where_clause_v = "parent_id = %s"
                    where_clause_t = "parent_id = %s AND fts @@ websearch_to_tsquery('simple', %s)"
                    params_v = (parent_id,)
                    params_t = (parent_id, or_query)
                else:
                    where_clause_v = "parent_type = %s"
                    where_clause_t = "parent_type = %s AND fts @@ websearch_to_tsquery('simple', %s)"
                    params_v = (parent_type,)
                    params_t = (parent_type, or_query)

                cur.execute(f"""
                    WITH vector_search AS (
                        SELECT chunk_id, parent_type, parent_id, content,
                                1 - (embedding <=> %s::vector) AS similarity,
                                ROW_NUMBER() OVER (ORDER BY embedding <=> %s::vector) AS rrf_vector_rank
                        FROM document_chunks
                        WHERE {where_clause_v}
                        ORDER BY embedding <=> %s::vector
                        LIMIT 50
                    ),
                    text_search AS (
                        SELECT chunk_id, parent_type, parent_id, content,
                                ts_rank_cd(fts, websearch_to_tsquery('simple', %s)) AS text_sim,
                                ROW_NUMBER() OVER (ORDER BY ts_rank_cd(fts, websearch_to_tsquery('simple', %s)) DESC) AS rrf_text_rank
                        FROM document_chunks
                        WHERE {where_clause_t}
                        ORDER BY rrf_text_rank
                        LIMIT 50
                    ),
                    rrf AS (
                        SELECT 
                            COALESCE(v.chunk_id, t.chunk_id) AS chunk_id,
                            COALESCE(v.parent_type, t.parent_type) AS parent_type,
                            COALESCE(v.parent_id, t.parent_id) AS parent_id,
                            COALESCE(v.content, t.content) AS content,
                            COALESCE(v.similarity, 0.72) AS similarity,
                            COALESCE(1.0 / (60 + v.rrf_vector_rank), 0.0) + COALESCE(1.0 / (60 + t.rrf_text_rank), 0.0) AS rrf_score
                        FROM vector_search v
                        FULL OUTER JOIN text_search t ON v.chunk_id = t.chunk_id
                    )
                    SELECT * FROM rrf
                    ORDER BY rrf_score DESC
                    LIMIT %s;
                """, (q_emb, q_emb, *params_v, q_emb, or_query, or_query, *params_t, limit))
                return cur.fetchall()

            if document_id:
                doc_results = hybrid_search('user_document', limit=15, parent_id=document_id)
                # Guaranteed fallback: if hybrid keyword search yielded 0 chunks, fetch document's chunks directly
                if not doc_results:
                    cur.execute("""
                        SELECT chunk_id, parent_type, parent_id, content, 0.90 AS similarity
                        FROM document_chunks
                        WHERE parent_id = %s
                        ORDER BY chunk_id ASC
                        LIMIT 20;
                    """, (document_id,))
                    doc_results = cur.fetchall()

                # Inspect active document content to verify if it is an actual legal document
                DOC_LEGAL_MARKERS = [
                    'contract', 'agreement', 'lease', 'lessor', 'lessee', 'party', 'parties', 
                    'obligat', 'liability', 'liable', 'breach', 'stipulat', 'hereby', 'whereas', 
                    'covenant', 'undertak', 'remedy', 'damages', 'severability', 'jurisdiction', 
                    'court', 'civil code', 'statute', 'employment', 'employee', 'employer', 
                    'affidavit', 'deed', 'mortgage', 'promissory', 'loan', 'waiver', 'quitclaim',
                    'tenant', 'landlord', 'buyer', 'seller', 'vendor', 'vendee', 'donor', 'donee',
                    'heir', 'inheritance', 'testator', 'will', 'property', 'easement'
                ]
                doc_text_sample = " ".join([d.get('content', '') for d in doc_results]).lower()
                is_doc_legal = any(marker in doc_text_sample for marker in DOC_LEGAL_MARKERS)

                # Has user explicitly referenced an article by number (e.g. "Article 1181")?
                has_explicit_article = bool(re.search(r'(?:article|art\.?)\s*\d+', query, re.IGNORECASE))

                # Check if legal provisions or jurisprudence are genuinely relevant to the document inquiry
                legal_terms = ['civil code', 'article', 'statute', 'law', 'violate', 'void', 'liability', 'obligation', 'breach', 'risk', 'remedy', 'damages', 'jurisprudence', 'case', 'compliance', 'legal', 'action', 'contract']
                query_lower = query.lower()

                needs_statutory = (is_doc_legal and any(term in query_lower for term in legal_terms)) or has_explicit_article
                if needs_statutory:
                    statutory_articles = hybrid_search('article', limit=12)
                    if statutory_articles:
                        art_ids = [a['parent_id'] for a in statutory_articles]
                        cur.execute("""
                            SELECT article_id, article_number, hierarchy
                            FROM civil_code_articles
                            WHERE article_id = ANY(%s);
                        """, (art_ids,))
                        art_meta_map = {row['article_id']: row for row in cur.fetchall()}
                        for a in statutory_articles:
                            if a['parent_id'] in art_meta_map:
                                a['metadata'] = art_meta_map[a['parent_id']]
                    linked_cases = []
                    if statutory_articles:
                        art_ids = [a['parent_id'] for a in statutory_articles]
                        cur.execute("""
                            SELECT r.article_id, j.case_uid, j.title, j.gr_number, j.content_summary, j.source_url, j.decision_date
                            FROM article_jurisprudence_relations r
                            JOIN jurisprudence_cases j ON r.case_uid = j.case_uid
                            WHERE r.article_id = ANY(%s)
                            LIMIT 3;
                        """, (art_ids,))
                        for row in cur.fetchall():
                            linked_cases.append({
                                "parent_type": "case",
                                "parent_id": row['case_uid'],
                                "content": f"[Supporting Case Doctrine for {row['article_id']}] {row['title']} (GR No. {row['gr_number']}): {row.get('content_summary', '')}",
                                "metadata": {
                                    "title": row.get('title'),
                                    "gr_number": row.get('gr_number'),
                                    "source_url": row.get('source_url'),
                                    "decision_date": row.get('decision_date'),
                                    "content_summary": row.get('content_summary'),
                                    "case_uid": row.get('case_uid')
                                }
                            })
                    all_found = doc_results + statutory_articles + linked_cases
                    all_found = rank_and_stratify_citations(all_found, query, context_budget=15)
                    return all_found

                doc_results = rank_and_stratify_citations(doc_results, query, context_budget=15)
                return doc_results

            # 1. Exact match extraction for Civil Code Articles
            exact_articles = []
            article_matches = re.findall(r'(?:article|art\.?)\s*(\d+)', query, re.IGNORECASE)
            if article_matches:
                unique_art_nums = list(dict.fromkeys(article_matches))
                exact_ids = [f"RA386-ART{num}" for num in unique_art_nums]
                cur.execute("""
                    SELECT chunk_id, parent_type, parent_id, content
                    FROM document_chunks
                    WHERE parent_id = ANY(%s) AND parent_type = 'article';
                """, (exact_ids,))
                fetched_exact = {row['parent_id']: row for row in cur.fetchall()}
                for eid in exact_ids:
                    if eid in fetched_exact:
                        exact_item = fetched_exact[eid]
                        exact_item['is_exact'] = True
                        exact_item['display_suitability'] = 98.5
                        exact_item['suitability_percent'] = 98.5
                        exact_articles.append(exact_item)
                    
            # 2. Top article matches (Civil Code statutes) via Hybrid Search - PRIORITIZED
            articles = exact_articles.copy()
            hybrid_articles = hybrid_search('article', limit=20)
            exact_ids_set = {a['parent_id'] for a in exact_articles}
            for ha in hybrid_articles:
                if ha['parent_id'] not in exact_ids_set:
                    articles.append(ha)

            # 2.5 Statutory Companion Expansion (Codified Association Graph for Context Recall)
            if articles:
                companion_ids = []
                existing_art_ids = {a['parent_id'] for a in articles}
                for a in articles[:4]:  # Check top 4 primary articles
                    art_pid = a.get('parent_id')
                    if art_pid in STATUTORY_COMPANION_GRAPH:
                        for comp_id in STATUTORY_COMPANION_GRAPH[art_pid]:
                            if comp_id not in existing_art_ids and comp_id not in companion_ids:
                                companion_ids.append(comp_id)
                
                if companion_ids:
                    cur.execute("""
                        SELECT chunk_id, parent_type, parent_id, content
                        FROM document_chunks
                        WHERE parent_id = ANY(%s) AND parent_type = 'article';
                    """, (companion_ids[:6],))
                    comp_rows = cur.fetchall()
                    for comp in comp_rows:
                        comp['is_companion'] = True
                        articles.append(comp)
                        existing_art_ids.add(comp['parent_id'])

            # Enrich articles with hierarchy and article_number from civil_code_articles
            if articles:
                art_ids = [a['parent_id'] for a in articles]
                cur.execute("""
                    SELECT article_id, article_number, hierarchy
                    FROM civil_code_articles
                    WHERE article_id = ANY(%s);
                """, (art_ids,))
                art_meta_map = {row['article_id']: row for row in cur.fetchall()}
                for a in articles:
                    if a['parent_id'] in art_meta_map:
                        a['metadata'] = art_meta_map[a['parent_id']]
            
            # 3. Graph-Augmented RAG: Retrieve linked jurisprudence for the top articles (strictly secondary)
            linked_cases = []
            if articles:
                article_ids = [a['parent_id'] for a in articles[:4]]
                cur.execute("""
                    SELECT r.article_id, j.case_uid, j.title, j.gr_number, j.content_summary, j.source_url, j.decision_date
                    FROM article_jurisprudence_relations r
                    JOIN jurisprudence_cases j ON r.case_uid = j.case_uid
                    WHERE r.article_id = ANY(%s)
                    LIMIT 4;
                """, (article_ids,))
                
                for row in cur.fetchall():
                    summary = row.get('content_summary') or ''
                    linked_cases.append({
                        "parent_type": "case",
                        "parent_id": row['case_uid'],
                        "content": f"[Supporting Case Doctrine for {row['article_id']}] {row['title']} (GR No. {row['gr_number']}): {summary}",
                        "metadata": {
                            "title": row.get('title'),
                            "gr_number": row.get('gr_number'),
                            "source_url": row.get('source_url'),
                            "decision_date": row.get('decision_date'),
                            "content_summary": row.get('content_summary'),
                            "case_uid": row.get('case_uid')
                        }
                    })

            # 4. Top case matches (jurisprudence) via Hybrid Search - supplementary
            cases = []
            if len(linked_cases) < 2:
                clean_terms = [w for w in re.split(r'\W+', query) if len(w) > 2 and w.lower() not in SEARCH_STOPWORDS]
                if clean_terms:
                    case_search_query = " ".join(clean_terms[:6])
                    cur.execute("""
                        SELECT case_uid, title, gr_number, source_url, content_summary, decision_date
                        FROM jurisprudence_cases
                        WHERE to_tsvector('simple', title || ' ' || coalesce(content_summary, '')) @@ plainto_tsquery('simple', %s)
                        LIMIT 2;
                    """, (case_search_query,))
                    for row in cur.fetchall():
                        cases.append({
                            "parent_type": "case",
                            "parent_id": row['case_uid'],
                            "content": f"[Jurisprudence Doctrine] {row['title']} (GR No. {row['gr_number']}): {row.get('content_summary', '')}",
                            "metadata": {
                                "title": row.get('title'),
                                "gr_number": row.get('gr_number'),
                                "source_url": row.get('source_url'),
                                "decision_date": row.get('decision_date'),
                                "content_summary": row.get('content_summary'),
                                "case_uid": row.get('case_uid')
                            }
                        })

            # Merge and apply unified high-accuracy ranking without discarding lower-ranked citations
            all_found = articles + linked_cases + cases
            all_found = rank_and_stratify_citations(all_found, query, context_budget=15)
            return all_found
    finally:
        conn.close()


def embed_and_search(query: str, document_id: Optional[str] = None, history: List[ChatMessage] = None):
    """Convenience wrapper for synchronous embedding and search."""
    search_q = build_contextual_query(query, history or [], None)
    q_emb = compute_embedding(search_q)
    return search_with_embedding(q_emb, search_q, document_id)


def format_context_item(row: dict, doc_filename: Optional[str] = None) -> str:
    ptype = row.get('parent_type', 'source')
    source_id = row.get('chunk_id') or row.get('parent_id')
    meta = row.get('metadata') or {}

    if ptype == "user_document":
        label = f"DOCUMENT EXCERPT [{doc_filename or 'Active Document'}]"
        return f"SOURCE TYPE: {label} (Ref: {source_id})\nCONTENT: {row.get('content', '')}\n"

    elif ptype == "article":
        art_num = meta.get('article_number')
        h = meta.get('hierarchy') or {}
        h_parts = [h.get('book_name'), h.get('title_name'), h.get('chapter_name'), h.get('section_name')]
        h_str = " > ".join([str(p) for p in h_parts if p])
        prov = f"Article {art_num} (Republic Act No. 386 - Civil Code of the Philippines)" if art_num else f"Civil Code Provision ({source_id})"
        loc_line = f"LOCATION: {h_str}\n" if h_str else ""
        return f"SOURCE TYPE: PHILIPPINE CIVIL CODE ARTICLE\nPROVISION: {prov}\n{loc_line}STATUTORY TEXT: {row.get('content', '')}\n"

    else:
        title = meta.get('title')
        gr_num = meta.get('gr_number')
        source_url = meta.get('source_url')
        lines = [f"SOURCE TYPE: JURISPRUDENCE CASE (Ref: {source_id})"]
        if title and gr_num:
            lines.append(f"TITLE: {title} (GR No. {gr_num})")
        if source_url:
            lines.append(f"LINK: {source_url}")
        content_text = row.get('content', '').strip()
        if len(content_text) > 1500:
            content_text = content_text[:1500] + "..."
        lines.append(f"CONTENT: {content_text}")
        return "\n".join(lines) + "\n"

def save_assistant_message_to_db(
    session_id: Optional[str],
    content: str,
    citations: list,
    legal_analytics: Optional[dict] = None,
):
    """Safely saves the completed assistant response and its legal analytics to chat_messages."""
    if not session_id:
        return
    try:
        import uuid
        uuid.UUID(str(session_id))
    except (ValueError, AttributeError):
        return

    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO chat_messages (session_id, role, content, citations, legal_analytics)
                VALUES (%s, 'assistant', %s, %s, %s);
            """, (session_id, content, dumps(citations), dumps(legal_analytics) if legal_analytics else None))
            conn.commit()
        conn.close()
    except Exception as db_err:
        logging.error(f"Failed to save message to DB: {db_err}")

@app.post("/search")
async def search_documents(request: SearchRequest, raw_req: Request = None):
    """
    RAG Search Endpoint with granular stage progression streamed via SSE:
    1. Resource Queue check & concurrency limiting (strict 6GB VRAM protection)
    2. Contextualize query with active conversation memory
    3. Intent classification & domain boundary guardrails
    4. Conditional embedding and hybrid retrieval
    5. Synthesizing context with retained active citations and passing prompt to model
    6. Model thinking & reasoning
    7. Streaming character response
    """
    try:
        import logging
        import urllib.parse
        user_identifier = (
            (raw_req.headers.get("x-user-id") if raw_req else None)
            or request.session_id
            or "anon"
        )
        user_email = (raw_req.headers.get("x-user-email") if raw_req else None) or ""
        user_name_raw = (raw_req.headers.get("x-user-name") if raw_req else None) or ""
        try:
            user_name = urllib.parse.unquote(user_name_raw) if user_name_raw else ""
        except Exception:
            user_name = user_name_raw
        user_role_raw = (raw_req.headers.get("x-user-role") if raw_req else None) or ""
        try:
            user_role = urllib.parse.unquote(user_role_raw) if user_role_raw else ""
        except Exception:
            user_role = user_role_raw

        logging.info(f"Received search request from user [{user_name or user_email or user_identifier}]: {request.query[:80]}")

        async def sse_generator():
            acquired_immediately, ticket, err = await queue_manager.enter_queue(
                user_id=user_identifier,
                session_id=request.session_id or "",
                user_name=user_name,
                user_email=user_email,
                user_role=user_role,
            )

            if err == "QUEUE_FULL":
                yield f"data: {dumps({'type': 'error', 'message': 'The system is experiencing peak volume and the queue is currently full. Please try again shortly.'})}\n\n"
                yield f"data: {dumps({'type': 'done'})}\n\n"
                return

            try:
                # If not acquired immediately, user is placed in queue
                if not acquired_immediately:
                    queue_pos = await queue_manager.get_queue_position(ticket)
                    yield f"data: {dumps({'type': 'status', 'stage': 'queued', 'message': f'Resource queue: You are #{queue_pos} in line. Another query is currently utilizing the legal model ({queue_manager.active_queries}/{queue_manager.max_concurrent} active)...', 'queue_position': queue_pos, 'active_queries': queue_manager.active_queries, 'max_concurrent': queue_manager.max_concurrent})}\n\n"

                    start_wait = time.time()
                    last_pos = queue_pos

                    while True:
                        waiter = None
                        async with queue_manager._lock:
                            for w in queue_manager._waiters:
                                if w["ticket"] == ticket:
                                    waiter = w
                                    break

                        if not waiter:
                            # Promoted or removed
                            if ticket in queue_manager._active_slots:
                                break
                            else:
                                yield f"data: {dumps({'type': 'error', 'message': 'Queue registration cancelled.'})}\n\n"
                                return

                        try:
                            await asyncio.wait_for(asyncio.shield(waiter["event"].wait()), timeout=1.5)
                            break
                        except asyncio.TimeoutError:
                            if time.time() - start_wait > queue_manager.queue_timeout:
                                queue_manager.total_timeouts += 1
                                await queue_manager.cancel_waiter(ticket)
                                yield f"data: {dumps({'type': 'error', 'message': 'Queue wait time exceeded limit. Please try submitting your query again.'})}\n\n"
                                yield f"data: {dumps({'type': 'done'})}\n\n"
                                return

                            cur_pos = await queue_manager.get_queue_position(ticket)
                            if cur_pos != last_pos or (int(time.time() - start_wait) % 4 == 0):
                                last_pos = cur_pos
                                yield f"data: {dumps({'type': 'status', 'stage': 'queued', 'message': f'Resource queue: You are #{cur_pos} in line. Waiting for model resources to become available...', 'queue_position': cur_pos, 'active_queries': queue_manager.active_queries, 'max_concurrent': queue_manager.max_concurrent})}\n\n"

                    yield f"data: {dumps({'type': 'status', 'stage': 'embedding', 'message': 'Resource slot acquired. Initializing legal search...', 'queue_position': 0})}\n\n"

                logging.info("Starting SSE stream with granular RAG stages and context memory...")

                # Resolve document filename if analyzing an uploaded document
                doc_filename = request.document_name
                if request.document_id:
                    try:
                        conn_doc = get_db_connection()
                        with conn_doc.cursor() as cur_doc:
                            for _ in range(8):
                                cur_doc.execute("SELECT filename, status FROM user_documents WHERE id = %s;", (request.document_id,))
                                row = cur_doc.fetchone()
                                if row:
                                    if not doc_filename and row[0]:
                                        doc_filename = row[0]
                                    if row[1] == 'completed':
                                        break
                                cur_doc.execute("SELECT count(*) FROM document_chunks WHERE parent_id = %s;", (request.document_id,))
                                count_row = cur_doc.fetchone()
                                if count_row and count_row[0] > 0:
                                    break
                                await asyncio.sleep(0.5)
                        conn_doc.close()
                    except Exception as e:
                        logging.warning(f"Could not fetch document info for {request.document_id}: {e}")

                # Stage 0: Intent Classification & Domain Boundary Gating
                intent_info = classify_query_intent(request.query, request.history, request.document_id, doc_filename)
                logging.info(f"Query intent classification: {intent_info}")
                history_dicts = [{"role": msg.role, "content": msg.content} for msg in request.history]

                # Branch A: Completely Non-Legal Inquiries (Bypass vector retrieval & suppress citations)
                if intent_info['category'] == 'out_of_domain_non_legal':
                    yield f"data: {dumps({'type': 'status', 'stage': 'embedding', 'message': 'Evaluating domain boundaries & scope...'})}\n\n"
                    await asyncio.sleep(0.3)
                    yield f"data: {dumps({'type': 'status', 'stage': 'thinking', 'message': 'Query outside legal domain; formulating scope boundary notice...'})}\n\n"
                    await asyncio.sleep(0.3)

                    analytics_payload = {
                        'nli_score': None,
                        'nli_status': 'Out of Domain',
                        'top_article_score': 0.0,
                        'is_document_legal': None,
                        'is_out_of_domain': True,
                        'domain_category': 'non_legal',
                        'target_domain': None,
                    }

                    system_prompt = """You are CIVIL-LEX, a specialized Philippine Legal AI Assistant dedicated exclusively to the Philippine Civil Code (Republic Act No. 386) and civil jurisprudence.

The user's inquiry is completely non-legal or outside the field of law (e.g., computer programming, software code, mathematics, natural sciences, cooking/recipes, pop culture, sports, or general chat).

YOUR MANDATORY RESPONSE RULES:
1. Politely state that CIVIL-LEX is an AI assistant dedicated exclusively to Philippine Civil Law.
2. Clearly explain that this inquiry falls outside your specialized scope.
3. Inform the user of the civil law topics you CAN assist with:
   - Contracts and Obligations (breach, delay, damages, rescission, loan agreements, promissory notes)
   - Property Law (ownership, possession, easements, builder in good faith, nuisance, lease)
   - Succession and Wills (inheritance, wills, compulsory heirs, estate partition)
   - Family Law (marriage, legal separation, property regimes, parental authority)
   - Torts / Quasi-Delicts and Civil Damages under RA 386.
4. Do NOT attempt to answer the non-legal question (do not write code, math solutions, recipes, or casual essays).
5. Do NOT cite any Civil Code articles or Supreme Court cases, as no statutory provisions apply.
"""
                    full_text = ""
                    is_first_chunk = True

                    async for chunk in generate_response_stream(system_prompt, request.query, history_dicts):
                        if is_first_chunk:
                            is_first_chunk = False
                            yield f"data: {dumps({'type': 'status', 'stage': 'streaming', 'message': 'Streaming domain boundary notice...'})}\n\n"
                            yield f"data: {dumps({'type': 'citations', 'data': []})}\n\n"
                            yield f"data: {dumps({'type': 'accumulated_citations', 'data': []})}\n\n"
                            yield f"data: {dumps({'type': 'legal_analytics', 'data': analytics_payload})}\n\n"
                        full_text += chunk
                        yield f"data: {dumps({'type': 'text', 'text': chunk})}\n\n"

                    if is_first_chunk:
                        yield f"data: {dumps({'type': 'citations', 'data': []})}\n\n"
                        yield f"data: {dumps({'type': 'accumulated_citations', 'data': []})}\n\n"
                        yield f"data: {dumps({'type': 'legal_analytics', 'data': analytics_payload})}\n\n"

                    logging.info("Finished streaming non-legal refusal.")
                    yield f"data: {dumps({'type': 'done'})}\n\n"
                    save_assistant_message_to_db(request.session_id, full_text, [], analytics_payload)
                    return

                # Branch B: Specialized Philippine Law Outside Civil Code (Bypass retrieval, provide statutory redirection)
                if intent_info['category'] == 'out_of_domain_legal':
                    target_domain = intent_info.get('target_domain', 'Specialized Philippine Law')
                    yield f"data: {dumps({'type': 'status', 'stage': 'embedding', 'message': f'Analyzing legal jurisdiction: {target_domain}...'})}\n\n"
                    await asyncio.sleep(0.3)
                    yield f"data: {dumps({'type': 'status', 'stage': 'thinking', 'message': f'Identifying governing framework for {target_domain}...'})}\n\n"
                    await asyncio.sleep(0.3)

                    analytics_payload = {
                        'nli_score': None,
                        'nli_status': 'Out of Domain',
                        'top_article_score': 0.0,
                        'is_document_legal': None,
                        'is_out_of_domain': True,
                        'domain_category': 'other_legal',
                        'target_domain': target_domain,
                    }

                    system_prompt = f"""You are CIVIL-LEX, a specialized Philippine Legal AI Assistant dedicated to the Philippine Civil Code (Republic Act No. 386).

The user's query primarily falls under another specialized branch of Philippine law: {target_domain}.

YOUR MANDATORY REDIRECTION RULES:
1. Constructively explain that while CIVIL-LEX specializes in Philippine Civil Law (RA 386), this inquiry is primarily governed under {target_domain}.
2. Explicitly name the applicable Philippine statute, code, or regulatory framework (e.g., National Internal Revenue Code [NIRC] for taxes; Labor Code [PD 442] for employment disputes; Revised Penal Code for crimes; Revised Corporation Code for corporate governance).
3. Recommend the appropriate government agency, commission, or forum with proper jurisdiction (e.g., Bureau of Internal Revenue [BIR]; National Labor Relations Commission [NLRC] / Department of Labor and Employment [DOLE]; Office of the City Prosecutor; Securities and Exchange Commission [SEC]).
4. Note any concurrent civil action or civil liability for damages that might arise under the Civil Code (such as independent civil actions or breach of contract), while clarifying that the primary administrative or statutory remedy lies with the specialized body.
5. Do NOT cite arbitrary Civil Code articles as controlling authority for this non-civil matter.
6. Conclude by welcoming any civil law questions or issues governed by the Philippine Civil Code.
"""
                    full_text = ""
                    is_first_chunk = True

                    async for chunk in generate_response_stream(system_prompt, request.query, history_dicts):
                        if is_first_chunk:
                            is_first_chunk = False
                            yield f"data: {dumps({'type': 'status', 'stage': 'streaming', 'message': 'Streaming statutory redirection...'})}\n\n"
                            yield f"data: {dumps({'type': 'citations', 'data': []})}\n\n"
                            yield f"data: {dumps({'type': 'accumulated_citations', 'data': []})}\n\n"
                            yield f"data: {dumps({'type': 'legal_analytics', 'data': analytics_payload})}\n\n"
                        full_text += chunk
                        yield f"data: {dumps({'type': 'text', 'text': chunk})}\n\n"

                    if is_first_chunk:
                        yield f"data: {dumps({'type': 'citations', 'data': []})}\n\n"
                        yield f"data: {dumps({'type': 'accumulated_citations', 'data': []})}\n\n"
                        yield f"data: {dumps({'type': 'legal_analytics', 'data': analytics_payload})}\n\n"

                    logging.info("Finished streaming legal redirection.")
                    yield f"data: {dumps({'type': 'done'})}\n\n"
                    save_assistant_message_to_db(request.session_id, full_text, [], analytics_payload)
                    return

                # ── Stage 0.5: Conversational Clarification (Ambiguity Detection) ─────
                # Only runs for in-domain civil queries WITHOUT existing clarification context.
                # Anti-loop guard: if clarification_context is present, skip detection entirely.
                if intent_info['category'] == 'in_domain_civil' and not request.clarification_context:
                    yield f"data: {dumps({'type': 'status', 'stage': 'embedding', 'message': 'Analyzing query context & completeness...'})}\n\n"
                    ambiguity_result = await detect_ambiguity(
                        request.query,
                        history=request.history,
                        document_id=request.document_id,
                        use_llm=True,
                    )
                    if ambiguity_result.is_ambiguous and ambiguity_result.confidence >= 0.65:
                        logging.info(f"Ambiguity detected [{ambiguity_result.category}] confidence={ambiguity_result.confidence:.2f}: {ambiguity_result.reasoning}")
                        yield f"data: {dumps({'type': 'clarification_needed', 'data': ambiguity_result.to_dict()})}\n\n"
                        yield f"data: {dumps({'type': 'done'})}\n\n"
                        return

                # Branch C: In-Domain Philippine Civil Law Inquiry (Execute hybrid retrieval)
                # If user submitted clarification answers, enrich the query first
                effective_query = request.query
                if request.clarification_context:
                    effective_query = enrich_query_with_clarification(request.query, request.clarification_context)
                    logging.info(f"Query enriched with clarification context: {effective_query[:200]}")

                # Context-aware query expansion for hybrid search
                search_query = build_contextual_query(effective_query, request.history, doc_filename)
                logging.info(f"Contextualized search query: {search_query}")

                # Stage 1: Embedding the prompt
                is_doc_analysis = bool(request.document_id)
                emb_msg = (
                    f"Generating embedding & aligning query with {doc_filename or 'document'}..."
                    if is_doc_analysis
                    else "Generating vector embedding for query..."
                )
                yield f"data: {dumps({'type': 'status', 'stage': 'embedding', 'message': emb_msg})}\n\n"
                q_emb = await asyncio.to_thread(compute_embedding, search_query)
                await asyncio.sleep(0.65)

                # Stage 2: Getting the relevant document & statutory authorities
                ret_msg = (
                    f"Cross-referencing {doc_filename or 'document'} with Philippine Civil Code & jurisprudence..."
                    if is_doc_analysis
                    else "Searching Philippine Civil Code articles & jurisprudence..."
                )
                yield f"data: {dumps({'type': 'status', 'stage': 'retrieving', 'message': ret_msg})}\n\n"
                results = await asyncio.to_thread(search_with_embedding, q_emb, search_query, request.document_id)
                logging.info(f"Found {len(results)} relevant citations for current query.")
                await asyncio.sleep(0.65)

                # Deduplicate prior citations and newly retrieved citations using chunk-specific keys
                def get_citation_key(cit: dict) -> str:
                    cid = cit.get('chunk_id')
                    if cid:
                        return str(cid)
                    ptype = cit.get('parent_type')
                    pid = cit.get('parent_id') or cit.get('id')
                    content_snip = cit.get('content', '')[:60].strip()
                    if ptype == 'user_document':
                        return f"doc_{pid}_{content_snip}"
                    return str(pid or content_snip)

                seen_cit_keys = set()
                for r in results:
                    seen_cit_keys.add(get_citation_key(r))

                retained_prior = []
                for pc in (request.prior_citations or []):
                    ckey = get_citation_key(pc)
                    if ckey not in seen_cit_keys:
                        seen_cit_keys.add(ckey)
                        retained_prior.append(pc)

                # Cap retained prior citations to top 6 to preserve memory without context explosion
                retained_prior = retained_prior[:6]
                accumulated_citations = results + retained_prior
                accumulated_citations.sort(key=lambda x: float(x.get('suitability_percent', 0.0)), reverse=True)

                # Send retrieval completion status (Citations are deferred until streaming starts)
                ret_done_msg = (
                    f"Retrieved {len(results)} relevant clauses & statutory authorities ({len(accumulated_citations)} retained in active chat)"
                    if is_doc_analysis
                    else f"Retrieved {len(results)} relevant legal provisions & doctrines ({len(accumulated_citations)} retained in active chat)"
                )
                yield f"data: {dumps({'type': 'status', 'stage': 'retrieving_done', 'message': ret_done_msg, 'count': len(results)})}\n\n"
                await asyncio.sleep(0.45)

                # Pre-generation: determine document legality, but defer real NLI
                # to post-generation (symbolic NLI needs the full generated answer).
                DOC_LEGAL_MARKERS = [
                    'contract', 'agreement', 'lease', 'lessor', 'lessee', 'party', 'parties', 
                    'obligat', 'liability', 'liable', 'breach', 'stipulat', 'hereby', 'whereas', 
                    'covenant', 'undertak', 'remedy', 'damages', 'severability', 'jurisdiction', 
                    'court', 'civil code', 'statute', 'employment', 'employee', 'employer', 
                    'affidavit', 'deed', 'mortgage', 'promissory', 'loan', 'waiver', 'quitclaim',
                    'tenant', 'landlord', 'buyer', 'seller', 'vendor', 'vendee', 'donor', 'donee',
                    'heir', 'inheritance', 'testator', 'will', 'property', 'easement'
                ]
                doc_sample = " ".join([c.get('content', '') for c in results if c.get('parent_type') == 'user_document']).lower()
                is_doc_legal_flag = any(m in doc_sample for m in DOC_LEGAL_MARKERS) if is_doc_analysis else True

                if is_doc_analysis and not is_doc_legal_flag:
                    # Non-legal document: skip NLI entirely
                    nli_score_val = None
                    nli_status = 'Out of Domain'
                    is_out_of_domain = True
                else:
                    # Placeholder: real NLI is computed post-generation
                    nli_score_val = None
                    nli_status = 'Pending'
                    is_out_of_domain = False

                top_display = max([float(c.get('display_suitability', 0.0)) for c in results], default=0.0)

                analytics_payload = {
                    'nli_score': nli_score_val,
                    'nli_status': nli_status,
                    'top_article_score': top_display,
                    'is_document_legal': is_doc_legal_flag if is_doc_analysis else None,
                    'is_out_of_domain': is_out_of_domain,
                    'domain_category': 'civil' if not is_out_of_domain else 'non_legal_document',
                    'target_domain': None,
                }

                # Stage 3: Passing final prompt & context to model
                prompt_msg = (
                    "Synthesizing document clauses, statutory grounding & preparing model prompt..."
                    if is_doc_analysis
                    else "Synthesizing statutory context & preparing model prompt..."
                )
                yield f"data: {dumps({'type': 'status', 'stage': 'prompting', 'message': prompt_msg})}\n\n"
                await asyncio.sleep(0.65)
                
                # Separate retrieved and prior items by type to enforce strict statutory Civil Code priority
                statutory_items = []
                doc_items = []
                case_items = []

                # Combine results and retained prior citations
                all_citations = results + retained_prior
                for item in all_citations:
                    # In a 70k context window, prioritize in-context authorities for the model prompt
                    if item.get('is_in_context') is False:
                        continue
                    ptype = item.get('parent_type', 'source')
                    if ptype == 'article':
                        statutory_items.append(item)
                    elif ptype == 'user_document':
                        doc_items.append(item)
                    else:
                        case_items.append(item)

                # Construct context: STATUTORY CIVIL CODE ALWAYS LEADS FIRST
                context_str = ""
                if statutory_items:
                    context_str += "=== PRIMARY STATUTORY AUTHORITY: PHILIPPINE CIVIL CODE (REPUBLIC ACT NO. 386) ===\n"
                    for idx, row in enumerate(statutory_items, 1):
                        context_str += f"\n[Statutory Article {idx}]\n" + format_context_item(row, doc_filename)
                    context_str += "\n"

                if doc_items:
                    context_str += f"=== ACTIVE DOCUMENT EXCERPTS [{doc_filename or 'Uploaded Document'}] ===\n"
                    for idx, row in enumerate(doc_items, 1):
                        context_str += f"\n[Document Excerpt {idx}]\n" + format_context_item(row, doc_filename)
                    context_str += "\n"

                if case_items:
                    context_str += "=== SECONDARY SUPPORTING INTERPRETATIONS: JURISPRUDENCE (SUPREME COURT DOCTRINES) ===\n"
                    for idx, row in enumerate(case_items, 1):
                        context_str += f"\n[Supporting Case {idx}]\n" + format_context_item(row, doc_filename)
                    context_str += "\n"

                # Bounded context safety for 70k token context window (180,000 characters safety threshold)
                # NEVER truncate the primary Civil Code statutory provisions
                if len(context_str) > 180000:
                    context_str = ""
                    if statutory_items:
                        context_str += "=== PRIMARY STATUTORY AUTHORITY: PHILIPPINE CIVIL CODE (REPUBLIC ACT NO. 386) ===\n"
                        for idx, row in enumerate(statutory_items, 1):
                            context_str += f"\n[Statutory Article {idx}]\n" + format_context_item(row, doc_filename)
                        context_str += "\n"
                    if doc_items:
                        context_str += f"=== ACTIVE DOCUMENT EXCERPTS [{doc_filename or 'Uploaded Document'}] ===\n"
                        for idx, row in enumerate(doc_items, 1):
                            context_str += f"\n[Document Excerpt {idx}]\n" + format_context_item(row, doc_filename)
                        context_str += "\n"
                    if case_items:
                        context_str += "=== SECONDARY SUPPORTING INTERPRETATIONS: JURISPRUDENCE (SUPREME COURT DOCTRINES) ===\n"
                        for idx, row in enumerate(case_items[:6], 1):
                            context_str += f"\n[Supporting Case {idx}]\n" + format_context_item(row, doc_filename)
                        context_str += "\n...[Additional secondary jurisprudence omitted to preserve context focus]...\n"

                if request.document_id:
                    doc_display_name = doc_filename or "Uploaded Legal Document"
                    system_prompt = f"""You are CIVIL-LEX, a specialized Philippine Legal AI Assistant analyzing the uploaded document: "{doc_display_name}".

YOUR TASK IN THIS ACTIVE SESSION:
1. Examine the user's questions in direct relation to the uploaded document "{doc_display_name}".
2. Use the provided DOCUMENT EXCERPTS to identify and explain specific contents, clauses, stipulations, terms, or subject matter in the document.
3. NON-LEGAL DOCUMENT HANDLING: If the document is non-legal (such as an academic assignment, computer science/math homework, technical manual, or non-legal notes):
   - Explicitly describe what the document contains based on the DOCUMENT EXCERPTS (specifying the author, course, topics, questions, and answers found in the excerpt).
   - Clearly state that the document is non-legal and contains no contracts, obligations, property rights, or legal stipulations governed by the Philippine Civil Code (Republic Act No. 386).
   - In the Legal Action Summary, state "None applicable" for Civil Code Articles, Court Jurisdiction, and Legal Actions.
4. LEGAL DOCUMENT HANDLING: If the document is a legal agreement or contract (sales, leases, loans, employment, deeds, etc.):
   - PRIMARY STATUTORY GROUNDING: Cross-examine the document's provisions PRIMARILY against the statutory provisions of the Philippine Civil Code (Republic Act No. 386). Ground all legal assessments, rights, obligations, validity, or void stipulations directly on specific Civil Code Articles first, using Supreme Court jurisprudence only as secondary supporting doctrine.
   - If a specific fact or term is stated in the document excerpts, state it clearly.

5. MANDATORY RESPONSE FORMATTING & MARKDOWN STRUCTURE:
   Your output MUST be formatted using standard GitHub-flavored Markdown. Structure your response into clear, distinct sections:

   ### 📌 Summary & Direct Conclusion
   [1-2 clear, direct sentences addressing the query in relation to "{doc_display_name}".]

   ### 📚 Statutory Grounding & Provisions
   > **[Governing Civil Code Article / Provision]**
   > *[Hierarchy / Book Title]*
   >
   > "[Core statutory text or excerpt rule]"

   **Key Requisites & Stipulations:**
   - **[Stipulation 1]**: [Explanation]
   - **[Stipulation 2]**: [Explanation]

   ### ⚖️ Legal Analysis & Application
   [Detailed analysis applying statutory provisions to the document. If the user requested a Tagalog explanation ("explain in tagalog" / "paliwanag sa tagalog"), provide this analysis in clear, professional Tagalog while preserving statutory Article numbers.]

   ### 📋 Legal Action Summary
   - **Governing Civil Code Article(s)**: [List specific RA 386 articles, e.g., Article 1191, or "None (Non-Legal Document)"]
   - **Competent Court / Jurisdiction**: [Specify court based on RA 11576 thresholds, or "None"]
   - **Pre-filing Requirement**: [State whether Barangay Conciliation is mandatory or exempt, or "None"]
   - **Possible Cause of Action to File**: [Exact technical legal title, or "None"]

ACTIVE DOCUMENT:
Filename: {doc_display_name}
Document ID: {request.document_id}

CONTEXT:
{context_str}
"""
                else:
                    system_prompt = f"""You are CIVIL-LEX, a specialized Philippine Legal Assistant. Your PRIMARY AND EXCLUSIVE MISSION is to analyze and answer legal inquiries strictly through the lens of the Philippine Civil Code (Republic Act No. 386) and Philippine civil jurisprudence.

MANDATORY RAGAS COMPLIANCE & LEGAL ACCURACY RULES:

1. INVERTED PYRAMID (DIRECT ANSWER FIRST - MAXIMUM ANSWER RELEVANCY):
   - Always begin your response immediately under `### 📌 Direct Answer & Legal Conclusion` with a clear, direct 1-to-2 sentence legal conclusion answering the user's specific inquiry.
   - Do NOT begin with generic conversational filler, historical preambles, or unsolicited lectures.

2. PRIMARY STATUTORY GROUNDING & ANCHORED CITATIONS (FAITHFULNESS):
   - The Philippine Civil Code (RA 386) is your HIGHEST AND CONTROLLING AUTHORITY.
   - Ground every legal rule, requisite, element, and remedy EXCLUSIVELY on the statutory text of the Civil Code articles provided in CONTEXT.
   - Supreme Court jurisprudence serves ONLY as secondary, supporting interpretation to illustrate how that statutory article was applied. Never allow case doctrines to overshadow the governing statute.
   - CITATION ANCHORS: Explicitly anchor every substantive legal claim, element, or rule with its bracketed citation (e.g., [Art. 1191] or [G.R. No. 173526]).

3. STRICT CONTEXT BOUNDARY & NO DOCTRINE MISAPPLICATION (SEMANTIC INTEGRITY):
   - You must derive all legal definitions, requisites, and conclusions EXCLUSIVELY from the provided CONTEXT.
   - NO EXTERNAL INVENTIONS: If an element, remedy, or prescriptive period is absent from the provided CONTEXT, state clearly that the retrieved sources do not specify it rather than hallucinating.
   - SEMANTIC INTEGRITY: Never misapply retrieved legal passages to unrelated factual situations. Apply each article strictly according to its statutory title and intended civil doctrine.

4. CIVIL LAW SCOPE & COLLOQUIAL INQUIRIES:
   - The Philippine Civil Code broadly governs: Persons & Family Relations, Human Relations (Arts. 19-21), Independent Civil Actions (Arts. 32-34), Property & Ownership, Succession & Wills, Obligations & Contracts, Torts / Quasi-Delicts (Arts. 2176-2180), and Damages (Arts. 2199-2235).
   - Inquiries involving accidents, harm, injuries, or disputes ("ikaso", "away", "nasaktan", "nabangga") inherently involve CIVIL LIABILITY for damages and quasi-delict under the Civil Code.
   - Address colloquial or Tagalog queries from the perspective of Philippine Civil Law.

5. NON-CIVIL LEGAL REDIRECTION RULE:
   - If the inquiry primarily falls outside the Philippine Civil Code (e.g., purely criminal prosecution, tax assessment under NIRC/BIR, labor standards under DOLE/NLRC):
     a. State constructively that while CIVIL-LEX specializes in Philippine Civil Law, this matter is governed under another branch of Philippine law.
     b. Explicitly name the applicable legal domain and statute (e.g., Criminal Law under RPC, Tax Law under NIRC, Labor Code PD 442).
     c. Suggest the proper forum/agency (e.g., Prosecutor's Office, BIR, NLRC/DOLE).
     d. Note any concurrent civil action for damages/restitution (e.g., Arts. 29, 32, 33, 2176).

6. MANDATORY RESPONSE FORMATTING & MARKDOWN STRUCTURE:
   Your response MUST be organized cleanly using standard Markdown headers (`###`), blockquotes (`>`), bold text, and bulleted lists. Never dump unformatted text or raw single-line blobs.

   Follow this exact section template:

   ### 📌 Direct Answer & Legal Conclusion
   [1-2 clear, direct sentences answering the query immediately with the primary legal conclusion.]

   ### 📚 Governing Statutory Basis
   > **Article [Number] (Republic Act No. 386 - Civil Code of the Philippines)**
   > *[Book / Title / Chapter Hierarchy]*
   >
   > "[Core statutory text or codified provision]"

   **Key Statutory Requisites & Elements:**
   - **[Element / Requisite 1]**: [Explanation]
   - **[Element / Requisite 2]**: [Explanation]

   ### ⚖️ Legal Analysis & Application
   [Detailed analysis applying the statutory elements directly to the factual scenario. If the query is in Tagalog or asks for a Tagalog explanation ("explain in tagalog" / "paliwanag sa tagalog"), write this analysis in clear, professional Tagalog while retaining statutory Article numbers and legal terms.]

   ### 📋 Legal Action Summary
   - **Governing Civil Code Article(s)**: [List specific RA 386 articles, e.g., Article 56, Article 1191]
   - **Competent Court / Jurisdiction**: [Specify court based on RA 11576 thresholds: MTC (≤ ₱2M), RTC (> ₱2M or incapable of pecuniary estimation), Family Court, etc.]
   - **Pre-filing Requirement**: [State whether Katarungang Pambarangay / Barangay Conciliation is mandatory or exempt]
   - **Possible Cause of Action to File**: [Exact technical legal title, e.g., Action for Nullity of Marriage, Action for Judicial Rescission, N/A]

CONTEXT:
{context_str}
"""

                # Stage 4: Thinking / Reasoning
                think_msg = (
                    "Analyzing contractual terms, legal risks, and formulating reasoning..."
                    if is_doc_analysis
                    else "Analyzing statutory provisions and formulating legal reasoning..."
                )
                yield f"data: {dumps({'type': 'status', 'stage': 'thinking', 'message': think_msg})}\n\n"

                # Stage 5: Character stream from LLM
                history_dicts = [{"role": msg.role, "content": msg.content} for msg in request.history]
                full_text = ""
                is_first_chunk = True

                async for chunk in generate_response_stream(system_prompt, request.query, history_dicts):
                    if is_first_chunk:
                        is_first_chunk = False
                        yield f"data: {dumps({'type': 'status', 'stage': 'streaming', 'message': 'Streaming legal analysis...'})}\n\n"
                        # Deferred emission: deliver citations right when streaming starts
                        yield f"data: {dumps({'type': 'citations', 'data': results})}\n\n"
                        yield f"data: {dumps({'type': 'accumulated_citations', 'data': accumulated_citations})}\n\n"
                    full_text += chunk
                    yield f"data: {dumps({'type': 'text', 'text': chunk})}\n\n"

                # ── Post-Generation Neuro-Symbolic Hybrid NLI Verification ─────
                # Run the hybrid NLI engine (Symbolic Logic + Gemma in LM Studio)
                # on the completed answer against retrieved context to compute
                # accurate statutory faithfulness and detect contradictions.
                if not is_out_of_domain and full_text.strip():
                    # Notify frontend that response generation finished and statutory NLI audit has started
                    yield f"data: {dumps({'type': 'status', 'stage': 'evaluating_nli', 'message': 'Auditing statutory grounding & NLI entailment...'})}\n\n"
                    evaluating_payload = {
                        'nli_score': None,
                        'nli_status': 'Evaluating',
                        'top_article_score': top_display,
                        'is_document_legal': is_doc_legal_flag if is_doc_analysis else None,
                        'is_out_of_domain': False,
                        'domain_category': 'civil',
                        'target_domain': None,
                    }
                    yield f"data: {dumps({'type': 'legal_analytics', 'data': evaluating_payload})}\n\n"

                    try:
                        nli_result = await nli_score_faithfulness_async(
                            full_text, results, mode="hybrid"
                        )
                        analytics_payload = {
                            'nli_score': nli_result.score_percent,
                            'nli_status': nli_result.status,
                            'top_article_score': top_display,
                            'is_document_legal': is_doc_legal_flag if is_doc_analysis else None,
                            'is_out_of_domain': False,
                            'domain_category': 'civil',
                            'target_domain': None,
                            'claims_total': nli_result.claims_total,
                            'claims_entailed': nli_result.claims_entailed,
                            'claims_neutral': nli_result.claims_neutral,
                            'claims_contradicted': nli_result.claims_contradicted,
                            'nli_engine': nli_result.engine,
                        }
                        # Emit the verified analytics to the frontend
                        yield f"data: {dumps({'type': 'legal_analytics', 'data': analytics_payload})}\n\n"
                    except Exception as nli_err:
                        logging.error(f"Post-gen Hybrid NLI failed: {nli_err}")

                # Post-Synthesis Safety Check: If the generated answer is an explicit refusal or out-of-scope determination
                if is_refusal_or_out_of_scope(full_text):
                    logging.info("Model response detected as refusal/out-of-scope; sanitizing citations and NLI score.")
                    results = []
                    accumulated_citations = []
                    analytics_payload = {
                        'nli_score': None,
                        'nli_status': 'Out of Domain',
                        'top_article_score': 0.0,
                        'is_document_legal': None,
                        'is_out_of_domain': True,
                        'domain_category': 'non_legal',
                        'target_domain': None,
                    }
                    # Emit sanitized events to clear any noise citations on refusals
                    yield f"data: {dumps({'type': 'citations', 'data': []})}\n\n"
                    yield f"data: {dumps({'type': 'accumulated_citations', 'data': []})}\n\n"
                    yield f"data: {dumps({'type': 'legal_analytics', 'data': analytics_payload})}\n\n"

                # Signal completion
                logging.info("Finished streaming response.")
                yield f"data: {dumps({'type': 'done'})}\n\n"

                # Save to DB if valid UUID session_id is provided
                save_assistant_message_to_db(request.session_id, full_text, results, analytics_payload)

            except Exception as stream_err:
                logging.error(f"Error in SSE stream generation: {stream_err}")
                yield f"data: {dumps({'type': 'error', 'message': str(stream_err)})}\n\n"
            finally:
                if ticket in queue_manager._active_slots:
                    await queue_manager.release_slot(ticket)
                else:
                    await queue_manager.cancel_waiter(ticket)

        return StreamingResponse(
            sse_generator(),
            media_type="text/event-stream"
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in search endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
