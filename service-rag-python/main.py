import os
import re
import json
import asyncio
import uuid
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

from core.config import (
    LM_STUDIO_URL,
)
from core.queue_manager import queue_manager
from core.article_parser import (
    parse_article_numbers, 
    is_dispute_query, 
    is_matching_article_id,
    is_compound_or_multi_intent_query,
    is_jurisprudence_query
)
from services import memory as session_memory
from services import followups as followup_svc

# Registry of active detached generation tasks keyed by session_id
active_generation_tasks: Dict[str, asyncio.Task] = {}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)

from services.document import extract_and_process_document
from services.llm_client import generate_response_stream
from services.nli import score_faithfulness_async as nli_score_faithfulness_async, score_faithfulness as nli_score_faithfulness_sync, _compute_lexical_coverage
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
        async with httpx.AsyncClient(timeout=1.5) as client:
            resp = await client.get(f"{LM_STUDIO_URL.rstrip('/')}/models")
            latency_ms = round((time.time() - t0) * 1000, 1)
            if resp.status_code == 200:
                lm_online = True
                data = resp.json()
                loaded_models = [m.get("id") for m in data.get("data", [])]
    except Exception:
        lm_online = False

    status_data["llm_provider"] = "lmstudio"
    status_data["lm_studio"] = {
        "configured": bool(LM_STUDIO_URL),
        "online": lm_online,
        "latency_ms": latency_ms,
        "models": loaded_models,
        "provider": "lmstudio",
        "vram_profile": "6.0 GB VRAM Strict Concurrency Enforced",
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
                    
                art_title = (
                    f"Article {art['article_number']}"
                    if art.get('article_number') and art['article_number'] > 0
                    else (h.get('chapter_name') or h.get('title_name') or art['article_id'])
                )
                tree_dict[book_key][title_key][chapter_key].append({
                    "id": art['article_id'],
                    "title": art_title,
                    "article_number": art['article_number']
                })
            
            # Convert dictionary tree to nested list of TreeNodes
            # TreeNode: { id: string, title: string, children?: TreeNode[] }
            result_tree = []
            book_order = {
                "GENERAL OVERVIEW & FOUNDATIONAL PRINCIPLES": -1,
                "PRELIMINARY TITLE": 0,
                "BOOK I - PERSONS": 1,
                "BOOK II - PROPERTY, OWNERSHIP, AND ITS MODIFICATIONS": 2,
                "BOOK III - DIFFERENT MODES OF ACQUIRING OWNERSHIP": 3,
                "BOOK IV - OBLIGATIONS AND CONTRACTS": 4
            }
            sorted_books = sorted(tree_dict.items(), key=lambda kv: book_order.get(kv[0], 99))
            b_idx = 0
            for book_name, titles in sorted_books:
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
                  AND j.content_summary IS NOT NULL
                  AND j.content_summary != ''
                  AND j.content_summary != 'Summary unavailable.'
                  AND j.content_summary NOT ILIKE '%%summary unavailable%%'
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
    # Deprecated client-supplied memory (kept as fallback only). The server now
    # loads canonical per-chat history/citations from the DB by session_id.
    history: List[ChatMessage] = []
    document_id: Optional[str] = None
    document_name: Optional[str] = None
    prior_citations: List[Dict] = []
    clarification_context: Optional[Dict] = None  # Carries user's answers to clarification questions

class CancelRequest(BaseModel):
    session_id: str

@app.post("/cancel")
async def cancel_generation(cancel_req: CancelRequest):
    """Explicitly cancels an active background generation task for a session, releasing GPU/queue slot."""
    session_id = cancel_req.session_id
    if session_id and session_id in active_generation_tasks:
        task = active_generation_tasks.get(session_id)
        if task and not task.done():
            task.cancel()
            logging.info(f"Explicitly cancelled active generation task for session: {session_id}")
            return {"status": "cancelled", "session_id": session_id}
    return {"status": "not_found_or_already_done", "session_id": session_id}

# Stopwords for both English and conversational Filipino/Tagalog
ENGLISH_STOPWORDS = {
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
    'tell', 'explain', 'contract', 'agreement', 'tenant', 'landlord', 'damage', 'damages', 'rights',
    'property', 'lease', 'obligation', 'civil', 'code', 'article', 'law', 'legal', 'sue', 'court',
    'statute', 'provision', 'section', 'stipulated', 'regarding', 'concerning'
}

TAGALOG_STOPWORDS = {
    # Filipino / Tagalog Conversational
    'ang', 'mga', 'ng', 'sa', 'ko', 'mo', 'niya', 'namin', 'nila', 'ninyo', 'ito', 'iyan', 'iyon',
    'na', 'pa', 'ba', 'din', 'rin', 'naman', 'kasi', 'kaya', 'kung', 'kapag', 'pag', 'at', 'o',
    'ano', 'ano-ano', 'sino', 'sino-sino', 'saan', 'kailan', 'bakit', 'paano', 'gaano',
    'pwede', 'puwede', 'maaari', 'dapat', 'gusto', 'nais', 'may', 'mayroon', 'wala',
    'ako', 'ikaw', 'siya', 'kami', 'tayo', 'kayo', 'sila', 'akin', 'iyo', 'kaniya', 'amin', 'atin',
    'inyo', 'kanila', 'yung', 'ung', 'eh', 'oh', 'po', 'opo', 'ho', 'oho',
    'lahat', 'hindi', 'ay', 'pala', 'talaga', 'paki', 'buod', 'paikliin',
    'utang', 'upa', 'asawa', 'anak', 'mana', 'bahay', 'lupa', 'kasunduan', 'kasulatan',
    'korte', 'demanda', 'habla', 'ikaso', 'nabangga', 'sinuntok', 'perwisyo', 'pinsala',
    'danyos', 'krimen', 'hukuman', 'abogado', 'paliwanag', 'ipaliwanag', 'sabihin',
    'sustento', 'bata', 'magulang', 'mag-asawa', 'kasal', 'hiwalay', 'hati',
    'batas', 'nasa', 'tungkol', 'ukol', 'salig', 'probisyon', 'artikulo', 'seksyon',
    'sinasabi', 'nilalaman', 'nakasaad', 'nakasulat', 'patungkol'
}

SEARCH_STOPWORDS = ENGLISH_STOPWORDS | TAGALOG_STOPWORDS

EXPLICIT_TAGALOG_PATTERN = re.compile(
    r'\b(in tagalog|sa tagalog|tagalog please|ipaliwanag sa tagalog|paliwanag sa tagalog|tagalog po|isalin sa tagalog|paki-tagalog|tagalog explanation)\b',
    re.IGNORECASE
)
EXPLICIT_ENGLISH_PATTERN = re.compile(
    r'\b(in english|english please|explain in english|translate to english|english po|english explanation)\b',
    re.IGNORECASE
)

TAGALOG_CORE_GRAMMAR = {
    'ang', 'mga', 'ng', 'sa', 'kung', 'kapag', 'ano', 'bakit', 'paano', 'kailan', 'saan',
    'pwede', 'puwede', 'maaari', 'dapat', 'wala', 'mayroon', 'po', 'opo', 'namin', 'nila',
    'ninyo', 'kanila', 'akin', 'atin', 'amin', 'inyo', 'paliwanag', 'ipaliwanag', 'sustento',
    'mana', 'utang', 'upa', 'kasunduan', 'nabangga'
}


def detect_query_language(query: str) -> str:
    """
    Detects whether the incoming query is Tagalog ('tl') or English ('en').
    Returns 'tl' if Tagalog/Filipino is explicitly requested or if Filipino grammatical
    markers/particles dominate or are present in a question structure.
    Returns 'en' if English is requested, predominantly used, or as default.
    """
    if not query or not query.strip():
        return "en"
    q = query.strip()

    if EXPLICIT_TAGALOG_PATTERN.search(q):
        return "tl"
    if EXPLICIT_ENGLISH_PATTERN.search(q):
        return "en"

    words = [w.lower() for w in re.findall(r'[a-zA-Z\u00c0-\u024f-]+', q)]
    if not words:
        return "en"

    tagalog_count = sum(1 for w in words if w in TAGALOG_STOPWORDS)
    english_count = sum(1 for w in words if w in ENGLISH_STOPWORDS)
    core_grammar_count = sum(1 for w in words if w in TAGALOG_CORE_GRAMMAR)

    if core_grammar_count >= 1 and tagalog_count >= english_count:
        return "tl"
    if core_grammar_count >= 2:
        return "tl"
    if tagalog_count > english_count:
        return "tl"

    return "en"


def get_language_directive(lang: str) -> str:
    """
    Returns the strict unilingual instruction block injected into every system prompt
    to prevent code-switching, Taglish mixing, and archaic/deep phrasing.
    """
    if lang == "tl":
        return (
            "### 🌐 MANDATORY STRICT LANGUAGE DIRECTIVE: FULL SIMPLIFIED TAGALOG FOR CITIZENS\n"
            "- The user asked in Filipino/Tagalog. You MUST write your ENTIRE response in natural, simplified Tagalog that an ordinary Filipino citizen without a legal background can easily understand.\n"
            "- STRICT UNILINGUAL RULE: Do NOT mix English and Tagalog (STRICTLY NO Taglish, code-switching, or hybrid English-Tagalog sentences). Every sentence, heading, explanation, and recommendation must be in Tagalog.\n"
            "- ONLY ACCEPTABLE ENGLISH: Official statutory numbers/citations (e.g., 'Republic Act No. 386', '[Art. 1191]', '[Art. 2176]', '[G.R. No. 123456]') and standard institutional acronyms (RTC, MTC, PNP, BIR, DOLE).\n"
            "- AVOID DEEP / ARCHAIC WORDS: Do not use deep, obscure, or archaic Tagalog words. Use everyday, modern Filipino words (e.g., 'kasunduan' for contract, 'bayad-pinsala / danyos' for damages, 'karapatan' for rights, 'paglabag' for breach, 'hukuman' for court).\n"
            "- EXPLAIN EVERY LEGAL TERM: If a technical legal concept is referenced, explain what it means in plain, everyday Tagalog.\n\n"
        )
    else:
        return (
            "### 🌐 MANDATORY STRICT LANGUAGE DIRECTIVE: FULL PLAIN ENGLISH FOR CITIZENS\n"
            "- The user asked in English. You MUST write your ENTIRE response in clear, plain, everyday English that an ordinary citizen without a legal background can easily understand.\n"
            "- STRICT UNILINGUAL RULE: Do NOT mix Filipino/Tagalog words or phrases anywhere in your response (STRICTLY NO Taglish, code-switching, or Filipino filler words).\n"
            "- NO DEEP OR OBSCURANT LEGALESE: Do NOT use complex, dense, Latin, or archaic lawyer jargon without an immediate plain-language translation right beside it. Keep sentences short and clear.\n"
            "- PRESERVE STATUTORY CITATIONS: Always retain bracketed citations (e.g., [Art. 1191], [Art. 1654]).\n"
            "- EXPLAIN EVERY LEGAL TERM: Whenever a legal term is used (e.g., quasi-delict, rescission, moral damages, solidary liability), immediately define and explain what it means in simple everyday English beside it.\n\n"
        )

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
    
    # Land encroachment / building on another's land / land disputes / accession
    (r'\b(tinayuan ng bahay|tinayuan ng pader|inangkin ang lupa|inagaw ang lupa|sukat ng lupa|kamkam|kinamkam|nagtayo sa lupa|nagpatayo sa lupa ng iba|builder in good faith|builder in bad faith)\b',
     'ownership property possession accession builder in good faith bad faith indemnity necessary expenses right of retention Art 448 Art 449 Art 450 Art 546'),
    
    # Lease / rental / eviction / tenant / unpaid rent / deposit
    (r'\b(upa|paupa|nagpapaupa|umupa|nangungupahan|upahan|paupahan|evict|paalisin|layas|patalsikin|deposito sa upa|advance at deposit|security deposit|di nagbayad ng upa|unpaid rent)\b',
     'lease contract ejectment unlawful detainer obligations of lessor lessee security deposit rental subsidy Art 1654 Art 1673 Batas Pambansa 877'),
    
    # Debt / loans / bounced checks / collection / interest / promissory note
    (r'\b(utang|umutang|pautang|pautangan|singil|maningil|sinisingil|bayad|di nagbayad|hindi nagbayad|tseke|talbog|bounced check|borrow|borrowed|lended|lend|loan|promissory note|refuses to pay|refused to pay|unpaid loan|small claims|sum of money|money debt)\b',
     'obligations contracts breach of contract delay default mora payment legal interest promissory note sum of money Art 1169 Art 1170 Art 1231 Art 1232 Art 1956'),
    
    # Contracts / agreements / fraud / void / consent
    (r'\b(kontrata|kasulatan|pirma|pinapirma|kasunduan|usapan|bale|contract|consent|void|niloko|nauto|panlilinlang|dolo|intimidation|undue influence)\b',
     'contract essential requisites consent cause object void voidable rescissible unenforceable Art 1318 Art 1330 Art 1338 Art 1381 Art 1390 Art 1409'),
    
    # Succession / inheritance / wills / heirs / estate settlement
    (r'\b(mana|pamana|namatay|pamanang|habilin|testamento|mana-mana|hati sa lupa ng magulang|mana ng anak sa labas|compulsory heir|legitime|probate|extrajudicial settlement of estate)\b',
     'succession inheritance will legitime compulsory heirs intestate testate executor probate Art 777 Art 886 Art 887 Art 960 Rule 74'),
    
    # Preterition / disinheritance / omission of compulsory heir
    (r'\b(tinanggal sa mana|binaon sa mana|preterition|disinheritance|disinherited|omitted heir|tinanggalan ng karapatan sa mana|hindi isinama sa testamento)\b',
     'preterition disinheritance compulsory heir legitime total omission testate succession annulment of institution Art 854 Art 915 Art 916 Art 919'),

    # Co-ownership / partition / common property
    (r'\b(co-ownership|co-owner|co-heir|kahati sa lupa|magkakasosyo sa lupa|hati-hati sa lupa|ayaw magpa-partition|demand partition|partition of property|undivided share|renounce share|renunciation of share|benta ng kaparte)\b',
     'co-ownership partition undivided interest expenses taxes renunciation co-heir common property Art 484 Art 488 Art 494 Art 495 Art 498'),

    # Donation / revocation of donation / ingratitude / reduction
    (r'\b(donation|donasyon|donated|donor|donee|binigay na lupa|binigay na bahay|bawiin ang donasyon|binabawi ang donasyon|revocation of donation|ingratitude|walang utang na loob|undue refusal to support)\b',
     'donation inter vivos mortis causa revocation of donation reduction ingratitude donor donee Art 725 Art 748 Art 749 Art 760 Art 765 Art 770'),

    # Usufruct / preservation / repairs
    (r'\b(usufruct|usufructuary|karapatang gumamit|ordinary repairs|roof repair|repair the roof|preservation of the property|naked owner|preservation)\b',
     'usufruct usufructuary ordinary repairs preservation obligations of usufructuary naked owner Art 562 Art 592 Art 603'),

    # Easement of right of way / servitude / drainage / waters
    (r'\b(easement|servitude|right of way|right-of-way|daanan|lagusan|harang sa daan|walang daanan papuntang kalsada|dominant estate|servient estate|drainage|tubig baha)\b',
     'easement servitude right of way dominant servient estate isolation indemnity indemnity drainage Art 649 Art 650 Art 651 Art 652 Art 674'),

    # Real Estate Mortgage / Chattel Mortgage / Pledge / Foreclosure / Antichresis
    (r'\b(sangla|isinangla|sanla|prenda|remata|foreclosure|foreclose|rematado|subasta|pactum commissorium|real estate mortgage|chattel mortgage|pledge|antichresis|equity of redemption|redemption period)\b',
     'real estate mortgage chattel mortgage pledge foreclosure pactum commissorium redemption equity of redemption antichresis Art 2085 Art 2088 Art 2125 Art 2132 Act 3135'),

    # Agency / Special Power of Attorney (SPA) / unauthorized acts
    (r'\b(special power of attorney|\bspa\b|power of attorney|attorney-in-fact|ahente|ahensya|authorized representative|agent exceeded authority|unauthorized sale|binentang ahente)\b',
     'agency contract of agency special power of attorney SPA agent principal authority unauthorized acts unenforceable Art 1868 Art 1874 Art 1878 Art 1881'),

    # Compromise Agreement / Amicable Settlement / Barangay conciliation / Quitclaim
    (r'\b(compromise agreement|amicable settlement|areglo|nagkasundo|kasunduan sa barangay|lupon|pangkat|quitclaim|waiver of claims|release and quitclaim|waiver of rights)\b',
     'compromise agreement amicable settlement res judicata contract judgment execution waiver quitclaim Katarungang Pambarangay RA 7160 Art 2028 Art 2037 Art 2041'),

    # Support / Child Support / Sustento / Spousal maintenance / Paternity
    (r'\b(sustento|child support|spousal support|sustento sa anak|ayaw magsustento|tatay ayaw magbigay|suporta sa pamilya|paternity|filiation|anak sa labas|illegitimate child|support pendente lite)\b',
     'support spousal support child support parental authority filiation paternity legitime Family Code Art 194 Art 195 Art 199 Art 201 EO 209'),

    # Fortuitous event / Force majeure / Act of God
    (r'\b(fortuitous event|force majeure|act of god|acts of god|kalamidad|bagyo|lindol|baha|di inaasahang pangyayari|impossibility of performance|unforeseen event)\b',
     'fortuitous event force majeure act of god impossibility of performance release of obligation fortuitous loss Art 1174 Art 1262 Art 1266'),

    # Solidary vs Joint Obligations
    (r'\b(solidary|solidarily|joint obligation|solidary liability|joint and several|kanya-kanyang bayad|lahat mananagot|solidary debtors|solidary creditors)\b',
     'solidary obligation joint obligation solidary liability mutual guarantee indemnity Art 1207 Art 1208 Art 1216 Art 1217'),

    # Quasi-Contracts / Unjust Enrichment / Mistake in payment / Negotiorum Gestio
    (r'\b(unjust enrichment|quasi-contract|quasi contract|negotiorum gestio|solutio indebiti|sobrang sukli|maling bayad|nagkamaling nagbayad|mistake in payment|walang karapatang tumanggap)\b',
     'quasi contracts negotiorum gestio solutio indebiti payment by mistake unjust enrichment Art 2142 Art 2144 Art 2154 Art 2155'),

    # Human Relations / Defamation / Privacy / Abuse of Rights / Independent Civil Actions
    (r'\b(abuse of right|abuse of rights|contra bonus mores|unjust enrichment|paninirang-puri|tsismis|paninira|slander|libel|defamation|privacy|pangingialam|independent civil action|moral shock|reputation ruined)\b',
     'human relations abuse of rights acts contra bonus mores unjust enrichment independent civil action defamation privacy Art 19 Art 20 Art 21 Art 22 Art 26 Art 33'),

    # Prescription / Prescriptive periods / Laches
    (r'\b(prescription|prescriptive period|prescribe|prescribed|bar by prescription|statute of limitations|laches|lumipas na ang panahon|huli na para magdemanda|tagal ng panahon)\b',
     'prescription acquisitive extinctive prescription statute of limitations laches period to file Art 1106 Art 1139 Art 1144 Art 1145 Art 1146'),

    # Marriage / annulment / legal separation / property relations
    (r'\b(kasal|hiwalay|annulment|nullity|babaero|kabit|lalakero|asawa|pangangaliwa|pambababae|psychological incapacity|marital obligations|conjugal partnership|absolute community|legal separation)\b',
     'marriage family code psychological incapacity declaration of absolute nullity conjugal partnership legal separation support Art 36 Art 68 Art 69 Art 147 Art 148 EO 209'),

    # Damages / compensation
    (r'\b(moral damages|exemplary damages|nominal damages|actual damages|temperate damages|liquidated damages|bayad pinsala|danyos perwisyo)\b',
     'actual moral exemplary nominal temperate liquidated damages Art 2199 Art 2216 Art 2217 Art 2219 Art 2221 Art 2224 Art 2226 Art 2229 Art 2231'),

    # General Civil Law / Civil Code Overview / Total Articles / Structure & Books
    (r'\b(total\s+articles?|ilan\s+ang\s+(?:total\s+)?(?:articles?|artikulo)|how\s+many\s+articles?|bilang\s+ng\s+artikulo|total\s+bilang|structure\s+of\s+(?:the\s+)?civil\s+code|books?\s+(?:in|of)\s+(?:the\s+)?civil\s+code|ilan\s+ang\s+libro|mga\s+libro\s+sa\s+civil\s+code|general\s+information|overview\s+of\s+(?:the\s+)?civil\s+(?:code|law)|what\s+is\s+(?:the\s+)?civil\s+(?:code|law)|ano\s+ang\s+civil\s+(?:code|law)|tungkol\s+saan\s+ang\s+civil\s+code|saklaw\s+ng\s+civil\s+code)\b',
     'Civil Code of the Philippines Republic Act 386 total articles 2270 Preliminary Title Book I Persons Book II Property Book III Ownership Succession Book IV Obligations and Contracts general overview codal structure Art 1 Art 2270')
]

# Query Intent Classification & Domain Boundary Gating

NON_LEGAL_PATTERNS = [
    # Programming, Software & Tech (general, system architecture, programming language, code)
    r'\b(python|javascript|typescript|react|vue|angular|html|css|c\+\+|java\b|golang|rust|php|ruby|swift|kotlin|sql\s+query|nosql|mongodb|docker|kubernetes|git\b|github|algorithm|algorithms|function\s+to|write\s+code|code\s+snippet|def\s+[a-zA-Z_]|print\(|console\.log|class\s+[a-zA-Z_]|for\s+loop|while\s+loop|linked\s*list|binary\s*tree|leetcode|sorting\s+algorithm|merge\s*sort|quick\s*sort|bubble\s*sort|binary\s*search|stack|queue|compiler|syntax\s+error|runtime\s+error|npm\s+|pip\s+install|frontend|backend|full\s*stack|web\s+development|programming\s+languages?|programming|coding|software\s+development|software\s+engineering|tech\s+stack|technology\s+stack|system\s+architecture|source\s+code)\b',
    r'\b(?:(?:can|could|will|would)\s+you\s+(?:help\s+(?:me\s+)?(?:to\s+|with\s+)?)?code)\b',
    r'\b(?:help\s+(?:me\s+)?(?:to\s+)?code|help\s+(?:me\s+)?with\s+coding)\b',
    r'\b(?:how\s+to\s+code|learn\s+to\s+code|teach\s+me\s+(?:to\s+)?code|start\s+coding)\b',
    r'\b(?:(?:can|could|will|would)\s+you\s+|please\s+)?(?:write|generate|debug|fix|refactor|compile|test|run|execute)\s+(?:me\s+)?(?:some\s+|a\s+|an\s+|the\s+|my\s+)?(?:code|program|script|function|app|application|bot|algorithm|snippet)\b',
    r'\bcode\s+(?:for\s+me|this|that|something|a\s+|an\s+|the\s+|in\s+\w+)\b',
    r'\b(?:debug|debugging|debugger|refactor|refactoring|syntax\s+error|runtime\s+error|stacktrace|traceback)\b',
    # AI & System Internals / Development of CIVIL-LEX
    r'\b(?:how\s+(?:was|were)\s+you\s+(?:built|trained|created|developed|coded)|what\s+(?:ai|model|llm)\s+(?:are\s+you|powers?\s+you)|who\s+(?:created|made|built|developed|programmed)\s+you|who\s+developed\s+civilex|develop\s+civilex|underlying\s+technology\s+stack)\b',
    # Tagalog tech inquiries
    r'\b(?:anong?|ano\s+ang)\s+(?:mga\s+)?(?:programming\s+language|teknolohiya|tech\s+stack|software|code)\b',
    r'\b(?:paano|sinong?)\s+(?:ka|ang\s+civilex)\s+(?:ginawa|binuo|nidevelop|ginamit|nag-code|gumawa)\b',
    r'\b(?:ginamit\s+(?:na\s+)?(?:programming\s+language|tech\s+stack|teknolohiya)|to\s+develop\s+civilex)\b',
    # Math & Natural Sciences (Physics, Quantum Mechanics, Chemistry, Biology, Astronomy)
    r'\b(quantum(?:\s+(?:entanglement|physics|mechanics|computing|theory|tunneling|gravity|field|state|leap|realm|supremacy))?|schrodinger|general\s+relativity|special\s+relativity|string\s+theory|particle\s+physics|higgs\s+boson|thermodynamics|entropy|astrophysics|black\s+hole|wormhole|supernova|speed\s+of\s+light|derivative\s+of|integral\s+of|solve\s+for\s+x|quadratic\s+equation|pythagorean|calculus|trigonometry|matrix\s+multiplication|differential\s+equation|chemical\s+formula|periodic\s+table|photosynthesis|mitosis|meiosis|cellular\s+respiration|dna\s+replication|chemical\s+reaction|gravitational\s+waves?|newton\'s\s+(?:first|second|third)?\s*law|solar\s+system|planets)\b',
    # Culinary, Food & Recipes
    r'\b(recipe|recipes|how\s+to\s+cook|how\s+to\s+bake|how\s+to\s+make\s+a\s+|ingredients\s+for|adobo\s+recipe|sinigang\s+recipe|bake\s+a\s+cake|chocolate\s+cake|cake|cookies|marinate|seasoning|fried\s+chicken|pasta\s+recipe)\b',
    # Pop Culture, Fiction, Comics, Fantasy, Creative Writing, Sports & Lifestyle
    r'\b(harry\s+potter|voldemort|hogwarts|jedi|sith|star\s+wars|lightsaber|marvel|avengers|thanos|batman|superman|spider-?man|iron\s*man|anime|goku|naruto|pokemon|manga|lord\s+of\s+the\s+rings|gandalf|frodo|middle-?earth|superhero|superheroes|time\s+travel|multiverse|teleportation|write\s+a\s+poem|write\s+a\s+song|write\s+a\s+story|write\s+an\s+essay|movie\s+recommendation|who\s+won\s+the\s+(?:game|match|finals|world\s*cup)|nba\s+finals|pba\s+finals|celebrity\s+gossip|horoscope|zodiac\s+sign|lyrics\s+of|capital\s+of|translate\s+(?:this\s+)?to|workout\s+routine|diet\s+plan)\b',
    # Real-Time Data, Date, Time, Weather, Climate & Environmental Inquiries
    r'\b(?:(?:what(?:\'s|\s+is)\s+(?:the\s+)?(?:date|time|day|year|weather|temperature|forecast)(?:\s+today|\s+now|\s+currently)?)|(?:whats?\s+(?:is\s+)?(?:the\s+)?(?:date|time|weather))|anong\s+(?:oras|petsa|araw|panahon)\s+ngayon|current\s+(?:date|time|weather|temperature)|weather\s+today|date\s+today|time\s+now|forecast\s+today)\b',
    r'\b(?:weather\s+forecast|local\s+weather|current\s+weather|check\s+the\s+weather|tell\s+me\s+the\s+weather|whats?\s+(?:the\s+)?weather)\b',
    r'\b(?:latest\s+news|stock\s+price|bitcoin\s+price|crypto\s+price|convert\s+\d+\s*(?:usd|php|eur)|who\s+is\s+(?:the\s+)?president\s+of\s+(?!the\s+philippines)|tell\s+me\s+about\s+(?:yourself|your\s+life)|how\s+are\s+you\s+doing)\b',
    # Commercial Retail, Shopping, Vehicle / Gadget Pricing & Store Inquiries
    r'\b(?:(?:what(?:\'s|\s+is)\s+(?:the\s+)?(?:price|cost|rate|pricing)\s+of)|magkano\s+(?:ang\s+)?(?:presyo|kotse|sasakyan|benta|phone|laptop)|price\s+of\s+(?:toyota|honda|cars?|vehicles?|motorcycles?|phones?|gadgets?)|how\s+much\s+(?:is|does\s+it\s+cost\s+for|are)\s+(?:a\s+|an\s+|the\s+)?(?:car|cars|vehicle|phone|laptop|toyota|product)|just\s+want\s+to\s+know\s+the\s+price)\b',
]

NON_CIVIL_LEGAL_DOMAINS = [
    # Tax Law
    (
        r'\b(tax|taxes|taxation|bir\b|nirc\b|internal\s+revenue|vat\b|value-added\s+tax|income\s+tax|withholding\s+tax|estate\s+tax|donor\'s\s+tax|percentage\s+tax|customs\s+tariff|tariffs|tariff\s+and\s+customs|train\s+law|create\s+law|tax\s+evasion|bir\s+form|capital\s+gains\s+tax|tax\s+return|tax\s+deduction|tax\s+exempt|tax\s+assessment|documentary\s+stamp\s+tax|dst\b|form\s*1701|form\s*2316)\b',
        'Philippine Tax Law (National Internal Revenue Code [NIRC] / Bureau of Internal Revenue [BIR])'
    ),
    # Labor Law (Pure employment/labor standards/NLRC)
    (
        r'\b(nlrc\b|dole\b|labor\s+code|presidential\s+decree\s+(?:no\.?\s*)?442|illegal\s+dismissal|unjust\s+dismissal|constructive\s+dismissal|separation\s+pay|13th\s+month\s+pay|holiday\s+pay|overtime\s+pay|minimum\s+wage|labor\s+arbiter|labor\s+union|collective\s+bargaining|unfair\s+labor\s+practice|retrenchment|reinstatement\s+with\s+backwages|dole\s+complaint|sena\b|floating\s+status|preventive\s+suspension|backwages)\b',
        'Philippine Labor Law (Presidential Decree No. 442 - Labor Code / DOLE / NLRC)'
    ),
    # Criminal Law (Pure offenses/procedure without civil claim)
    (
        r'\b(revised\s+penal\s+code|rpc\b|bilibid|new\s+bilibid|buCor|inquest\s+proceedings?|bail\s+bond|plea\s+bargaining|parole|probation|homicide|murder|treason|rebellion|sedition|coup\s+d\'etat|illegal\s+possession\s+of\s+firearm|ra\s*10591|dangerous\s+drugs|ra\s*9165|shabu|marijuana|drug\s+trafficking|buy-bust|anti-fencing|plunder|anti-graft|sandiganbayan|ombudsman|cybercrime\s+prevention\s+act|ra\s*10175|estafa|falsification|perjury|robbery|theft|snatching|arson|rape|carnapping)\b',
        "Philippine Criminal Law (Revised Penal Code / Special Penal Laws / DOJ Prosecutor's Office)"
    ),
    # Corporate & Financial Governance
    (
        r'\b(sec\s+registration|revised\s+corporation\s+code|ra\s*11232|articles\s+of\s+incorporation|by-laws\s+of\s+the\s+corporation|board\s+resolution|board\s+of\s+directors\s+meeting|quorum\s+for\s+board|stockholders\s+meeting|anti-money\s+laundering\s+act|amla\b|bsp\s+circular|bank\s+secrecy\s+law|general\s+information\s+sheet|gis\b|derivative\s+suit|corporate\s+dissolution)\b',
        'Philippine Corporate & Commercial Law (Revised Corporation Code / SEC / BSP)'
    ),
    # Intellectual Property Law
    (
        r'\b(ipophl\b|intellectual\s+property\s+code|ra\s*8293|trademark\s+registration|trademark\s+infringement|patent\s+application|patent\s+infringement|letters\s+patent|utility\s+model|industrial\s+design|copyright\s+registration|copyright\s+infringement|unfair\s+competition\s+under\s+section\s+168)\b',
        'Philippine Intellectual Property Law (Republic Act No. 8293 - IP Code / IPOPHL)'
    ),
    # Data Privacy Law
    (
        r'\b(data\s+privacy\s+act|ra\s*10173|national\s+privacy\s+commission|npc\s+complaint|personal\s+information\s+controller|personal\s+information\s+processor|data\s+breach\s+notification|data\s+privacy\s+officer)\b',
        'Philippine Data Privacy Law (Republic Act No. 10173 - Data Privacy Act / NPC)'
    ),
    # Immigration & Election
    (
        r'\b(bureau\s+of\s+immigration|philippine\s+immigration\s+act|visa\s+extension|overstaying\s+alien|deportation\s+order|alien\s+registration|comelec\b|omnibus\s+election\s+code|voter\s+registration|election\s+protest)\b',
        'Philippine Immigration / Election Law (Bureau of Immigration / COMELEC)'
    )
]

CIVIL_LAW_DOC_PATTERNS = [
    # Primary Civil Document Headers / Agreements (Weight = 3)
    (r'\b(?:contract\s+of\s+lease|lease\s+contract|lease\s+agreement|rental\s+agreement|contract\s+of\s+rent|tenancy\s+agreement)\b', 3),
    (r'\b(?:contract\s+of\s+sale|deed\s+of\s+(?:absolute\s+)?sale|conditional\s+sale|contract\s+to\s+sell|deed\s+of\s+donation|deed\s+of\s+assignment|deed\s+of\s+conveyance|deed\s+of\s+transfer)\b', 3),
    (r'\b(?:loan\s+agreement|promissory\s+note|contract\s+of\s+loan|acknowledgment\s+of\s+debt|kasulatan\s+ng\s+utang|pautang)\b', 3),
    (r'\b(?:real\s+estate\s+mortgage|chattel\s+mortgage|contract\s+of\s+mortgage|mortgage\s+contract|antichresis|contract\s+of\s+pledge|pactum\s+commissorium)\b', 3),
    (r'\b(?:last\s+will\s+and\s+testament|holographic\s+will|notarial\s+will|testamento|habilin|probate\s+of\s+will)\b', 3),
    (r'\b(?:extrajudicial\s+settlement|extra-judicial\s+settlement|settlement\s+of\s+estate|partition\s+of\s+(?:real\s+)?estate|deed\s+of\s+extrajudicial|kasunduan\s+sa\s+paghahati)\b', 3),
    (r'\b(?:compromise\s+agreement|amicable\s+settlement|release\s+and\s+quitclaim|waiver\s+and\s+quitclaim|release\s+of\s+claims|waiver\s+of\s+rights|kasunduan\s+ng\s+pag-aayos)\b', 3),
    (r'\b(?:special\s+power\s+of\s+attorney|general\s+power\s+of\s+attorney|\bspa\b|attorney-in-fact|principal\s+and\s+agent)\b', 3),
    (r'\b(?:marriage\s+settlement|prenuptial\s+agreement|marriage\s+contract|absolute\s+community\s+of\s+property|conjugal\s+partnership\s+of\s+gains|declaration\s+of\s+(?:absolute\s+)?nullity\s+of\s+marriage|psychological\s+incapacity|legal\s+separation|support\s+pendente\s+lite)\b', 3),
    (r'\b(?:affidavit\s+of\s+loss|affidavit\s+of\s+undertaking|affidavit\s+of\s+two\s+disinterested\s+persons|affidavit\s+of\s+guardianship|affidavit\s+of\s+support\s+and\s+consent|affidavit\s+of\s+adverse\s+claim|affidavit\s+of\s+self-adjudication)\b', 3),
    (r'\b(?:memorandum\s+of\s+agreement|\bmoa\b|memorandum\s+of\s+understanding|\bmou\b|service\s+agreement|consultancy\s+agreement|independent\s+contractor\s+agreement|retainer\s+agreement)\b', 2),
    (r'\b(?:notice\s+to\s+vacate|formal\s+demand\s+letter|demand\s+to\s+pay|demand\s+to\s+vacate|demand\s+letter|final\s+demand)\b', 3),
    (r'\b(?:complaint\s+for\s+sum\s+of\s+money|complaint\s+for\s+damages|unlawful\s+detainer\s+complaint|forcible\s+entry\s+complaint|petition\s+for\s+declaration\s+of\s+nullity|petition\s+for\s+probate|action\s+for\s+reconveyance|quieting\s+of\s+title)\b', 3),
    (r'\b(?:katarungang\s+pambarangay|certificate\s+to\s+file\s+action|lupon\s+tagapamayapa|pangkat\s+ng\s+tagapagkasundo|barangay\s+conciliation)\b', 3),
    # Codified Civil Law Provisions & Doctrine
    (r'\b(?:civil\s+code\s+of\s+the\s+philippines|republic\s+act\s+(?:no\.?\s*)?386|\bra\s*386\b)\b', 3),
    (r'\b(?:family\s+code\s+of\s+the\s+philippines|executive\s+order\s*(?:no\.?\s*)?209|\beo\s*209\b)\b', 3),
    (r'\b(?:lessor\b|lessee\b|vendor\b|vendee\b|mortgagor\b|mortgagee\b|pledgor\b|pledgee\b|testator\b|testatrix\b|compulsory\s+heir|legitime\b)\b', 2),
    (r'\b(?:quasi[- ]delict|torts?\s+and\s+damages|vicarious\s+liability|actual\s+damages|moral\s+damages|exemplary\s+damages|liquidated\s+damages|nominal\s+damages)\b', 1),
    (r'\b(?:easement\s+of\s+right\s+of\s+way|builder\s+in\s+good\s+faith|quieting\s+of\s+title|usufruct|accession|co-ownership)\b', 2),
    (r'\b(?:know\s+all\s+men\s+by\s+these\s+presents|in\s+witness\s+whereof|subscribed\s+and\s+sworn\s+to\s+before\s+me|notary\s+public|doc\.\s*no\.\s*\d+)\b', 1)
]

NON_CIVIL_LEGAL_DOC_DOMAINS = [
    {
        "domain": "Philippine Criminal Law (Revised Penal Code / Special Penal Laws / DOJ National Prosecution Service / PNP)",
        "primary": [
            r'\b(?:revised\s+penal\s+code|act\s+no\.?\s*3815|\brpc\b|special\s+penal\s+laws?)\b',
            r'\b(?:complaint-affidavit|criminal\s+complaint|information\s+filed\s+in\s+court|police\s+blotter|inquest\s+resolution|inquest\s+proceedings?|preliminary\s+investigation|probable\s+cause|warrant\s+of\s+arrest|search\s+warrant|plea\s+bargaining|bail\s+bond|criminal\s+case\s+no\.?)\b',
            r'\b(?:office\s+of\s+the\s+city\s+prosecutor|office\s+of\s+the\s+provincial\s+prosecutor|national\s+prosecution\s+service|department\s+of\s+justice|pnp-cidg|philippine\s+national\s+police|national\s+bureau\s+of\s+investigation)\b',
            r'\b(?:comprehensive\s+dangerous\s+drugs\s+act|ra\s*9165|comprehensive\s+firearms|ra\s*10591|anti-carnapping|ra\s*10883|anti-fencing\s+law|pd\s*1612|anti-graft|ra\s*3019)\b'
        ],
        "secondary": [
            r'\b(?:homicide|murder|robbery|theft|estafa|swindling|rape|kidnapping|illegal\s+detention|parricide|infanticide|rebellion|sedition|shabu|marijuana|buy-bust|accused|complainant)\b'
        ]
    },
    {
        "domain": "Philippine Labor Law (Presidential Decree No. 442 - Labor Code / DOLE / NLRC)",
        "primary": [
            r'\b(?:labor\s+code\s+of\s+the\s+philippines|presidential\s+decree\s+(?:no\.?\s*)?442|\bpd\s*442\b|dole\s+department\s+order)\b',
            r'\b(?:department\s+of\s+labor\s+and\s+employment|\bdole\b|national\s+labor\s+relations\s+commission|\bnlrc\b|labor\s+arbiter|single\s+entry\s+approach|\bsena\b|national\s+conciliation\s+and\s+mediation\s+board|\bncmb\b)\b',
            r'\b(?:illegal\s+dismissal|constructive\s+dismissal|unjust\s+dismissal|unfair\s+labor\s+practice|\bulp\b|labor\s+union|collective\s+bargaining\s+agreement|\bcba\b|retrenchment|redundancy\s+program|dole\s+labor\s+inspection)\b'
        ],
        "secondary": [
            r'\b(?:separation\s+pay|backwages|13th\s+month\s+pay|holiday\s+pay|overtime\s+pay|minimum\s+wage\s+order|strike|lockout)\b'
        ]
    },
    {
        "domain": "Philippine Tax Law (National Internal Revenue Code [NIRC] / Bureau of Internal Revenue [BIR])",
        "primary": [
            r'\b(?:national\s+internal\s+revenue\s+code|\bnirc\b|tax\s+code|republic\s+act\s+(?:no\.?\s*)?8424|\bra\s*8424\b|train\s+law|ra\s*10963|create\s+act|ra\s*11534|tariff\s+and\s+customs\s+code|customs\s+modernization\s+and\s+tariff\s+act|\bcmta\b)\b',
            r'\b(?:bureau\s+of\s+internal\s+revenue|\bbir\b|court\s+of\s+tax\s+appeals|\bcta\b|bureau\s+of\s+customs|\bboc\b|department\s+of\s+finance|\bdof\b|local\s+board\s+of\s+assessment\s+appeals)\b',
            r'\b(?:preliminary\s+assessment\s+notice|\bpan\b|final\s+assessment\s+notice|\bfan\b|formal\s+letter\s+of\s+demand|\bfld\b|letter\s+of\s+authority|\bloa\b|tax\s+audit|tax\s+deficiency|tax\s+evasion)\b'
        ],
        "secondary": [
            r'\b(?:income\s+tax\s+return|\bitr\b|value-added\s+tax|\bvat\b|percentage\s+tax|withholding\s+tax|capital\s+gains\s+tax|donor\'s\s+tax|estate\s+tax\s+return|tax\s+clearance)\b'
        ]
    },
    {
        "domain": "Philippine Data Privacy & Cybercrime Law (RA 10173 [DPA] / RA 10175 [Cybercrime Act] / NPC / CICC)",
        "primary": [
            r'\b(?:data\s+privacy\s+act\s+of\s+2012|republic\s+act\s+(?:no\.?\s*)?10173|\bra\s*10173\b|cybercrime\s+prevention\s+act\s+of\s+2012|republic\s+act\s+(?:no\.?\s*)?10175|\bra\s*10175\b)\b',
            r'\b(?:national\s+privacy\s+commission|\bnpc\b|cybercrime\s+investigation\s+and\s+coordinating\s+center|\bcicc\b|pnp\s+anti-cybercrime\s+group|pnp-acg|nbi\s+cybercrime\s+division)\b',
            r'\b(?:personal\s+information\s+controller|\bpic\b|personal\s+information\s+processor|\bpip\b|data\s+subject\s+rights|data\s+breach\s+notification|privacy\s+impact\s+assessment|\bpia\b|unauthorized\s+processing\s+of\s+personal)\b'
        ],
        "secondary": [
            r'\b(?:illegal\s+access\s+to\s+computer\s+system|data\s+interference|cyber-squatting|cyber-libel|computer-related\s+forgery|computer-related\s+fraud)\b'
        ]
    },
    {
        "domain": "Philippine Corporate & Commercial Law (Revised Corporation Code [RA 11232] / SEC / BSP)",
        "primary": [
            r'\b(?:revised\s+corporation\s+code\s+of\s+the\s+philippines|republic\s+act\s+(?:no\.?\s*)?11232|\bra\s*11232\b|securities\s+regulation\s+code|\bsrc\b|republic\s+act\s+(?:no\.?\s*)?8799|\bra\s*8799\b|anti-money\s+laundering\s+act|\bamla\b|ra\s*9160|general\s+banking\s+law|ra\s*8791)\b',
            r'\b(?:securities\s+and\s+exchange\s+commission|\bsec\b|bangko\s+sentral\s+ng\s+pilipinas|\bbsp\b|anti-money\s+laundering\s+council|\bamlc\b|insurance\s+commission|\bic\b)\b',
            r'\b(?:articles\s+of\s+incorporation|corporate\s+by-laws|general\s+information\s+sheet|\bgis\b|board\s+resolution|secretary\'s\s+certificate|sec\s+registration|sec\s+revocation|sec\s+compliance)\b'
        ],
        "secondary": [
            r'\b(?:board\s+of\s+directors\s+meeting|quorum\s+of\s+the\s+board|stockholders\'?\s+meeting|outstanding\s+capital\s+stock|subscribed\s+capital|treasury\s+shares|corporate\s+officers|ultra\s+vires|corporate\s+dissolution)\b'
        ]
    },
    {
        "domain": "Philippine Intellectual Property Law (Republic Act No. 8293 - IP Code / IPOPHL)",
        "primary": [
            r'\b(?:intellectual\s+property\s+code\s+of\s+the\s+philippines|republic\s+act\s+(?:no\.?\s*)?8293|\bra\s*8293\b|\bip\s+code\b)\b',
            r'\b(?:intellectual\s+property\s+office\s+of\s+the\s+philippines|\bipophl\b|bureau\s+of\s+legal\s+affairs|\bbla\b)\b',
            r'\b(?:trademark\s+registration|trademark\s+infringement|patent\s+application|patent\s+infringement|letters\s+patent|utility\s+model|industrial\s+design|copyright\s+registration|inter\s+partes\s+proceedings|unfair\s+competition\s+under\s+section\s+168)\b'
        ],
        "secondary": [
            r'\b(?:copyright\s+infringement|infringing\s+goods|patent\s+claim)\b'
        ]
    }
]

def classify_document_domain(text: str, filename: Optional[str] = None) -> Dict[str, Any]:
    """
    Evaluates an uploaded document's content and filename to determine whether it belongs to
    the domain of the Philippine Civil Code (RA 386), specialized non-civil Philippine law (redirection),
    or constitutes non-legal technical/academic/general material (strict refusal).
    """
    combined = f"{filename or ''} {text or ''}".lower()

    # 1. Specialized Non-Civil Legal domain matching
    non_civil_scores = []
    for d in NON_CIVIL_LEGAL_DOC_DOMAINS:
        primary_hits = sum(1 for p in d["primary"] if re.search(p, combined))
        sec_hits = sum(1 for p in d.get("secondary", []) if re.search(p, combined))
        # A non-civil domain qualifies if it has at least one primary statutory/institutional marker
        if primary_hits > 0:
            score = (primary_hits * 3) + sec_hits
            non_civil_scores.append((d["domain"], score))

    # 2. Civil Law scoring
    civil_score = sum(weight for p, weight in CIVIL_LAW_DOC_PATTERNS if re.search(p, combined))

    if non_civil_scores:
        non_civil_scores.sort(key=lambda x: x[1], reverse=True)
        top_domain, top_score = non_civil_scores[0]
        if top_score >= civil_score:
            return {
                "category": "out_of_domain_legal",
                "target_domain": top_domain,
                "reason": f"Document belongs to specialized Philippine legal jurisdiction: {top_domain}."
            }

    if civil_score >= 2:
        return {
            "category": "in_domain_civil",
            "target_domain": None,
            "reason": "Document contains authentic Philippine Civil Law concepts, instruments, or stipulations."
        }
    elif non_civil_scores:
        return {
            "category": "out_of_domain_legal",
            "target_domain": non_civil_scores[0][0],
            "reason": f"Document belongs to specialized Philippine legal jurisdiction: {non_civil_scores[0][0]}."
        }
    else:
        return {
            "category": "out_of_domain_non_legal",
            "target_domain": None,
            "reason": "Document contains non-legal material and lacks recognized Philippine Civil Code concepts."
        }

CIVIL_LAW_POSITIVE_PATTERNS = [
    r'(?:mga\s+)?(?:articles?|arts?\.?|artikulo)\s*(?:no\.?\s*|nos\.?\s*)?\d+',
    r'\b(civil\s+code|ra\s*386|republic\s+act\s*(?:no\.?\s*)?386|family\s+code|executive\s+order\s*(?:no\.?\s*)?209|eo\s*209|preliminary\s+title|total\s+articles|bilang\s+ng\s+artikulo|aklat\s+[ivx]+|books?\s+[ivx]+)\b',
    r'\b(g\.?\s*r\.?\s*(?:no\.?|nos\.?)?\s*(?:l-)?\d+[\w\-]*)\b',
    r'\b(quasi[- ]delict|tort|torts|negligence|fault|vicarious\s+liability|rescission|restitution|annulment|voidable|unenforceable|prescriptive\s+period|prescription|easement|usufruct|accession|hidden\s+defect|redhibitory|consignation|subrogation|novation|dation\s+in\s+payment|dacion\s+en\s+pago|solidary|joint\s+obligation|fortuitous\s+event|force\s+majeure|earnest\s+money|option\s+money|pactum\s+commissorium|antichresis|pledge|chattel\s+mortgage|real\s+estate\s+mortgage|co-ownership|co-owner|nuisance|lateral\s+support|testator|intestate|legitime|preterition|collation|fideicommissary|family\s+home|parental\s+authority|filiation|paternity|adoption|emancipation|civil\s+registrar|change\s+of\s+name|independent\s+civil\s+action|human\s+relations|abuse\s+of\s+right|contra\s+bonus\s+mores|unjust\s+enrichment|solutio\s+indebiti|negotiorum\s+gestio|spousal\s+support|child\s+support|ejectment|unlawful\s+detainer|forcible\s+entry|quieting\s+of\s+title|recovery\s+of\s+possession|accion\s+reivindicatoria|accion\s+publiciana|interpleader)\b',
    r'\b(kontrata|kasulatan|kasunduan|usapan|bale|utang|pautang|singil|upa|umupa|paupahan|nangungupahan|mana|pamana|testamento|habilin|kasal|annulment|hiwalay|asawa|kabit|danyos|bayad-pinsala|pananagutan|ikaso|demanda|ihabla|bakod|hangganan|lupa|kamkam|inagaw\s+ang\s+lupa|aksidente|nabangga|nasagasaan|suntok|sinuntok|bugbog|pananakit|paninirang-puri|tsismis|sustento|sangla|sanla|prenda|remata|subasta|donasyon|binawi|areglo|katarungang\s+pambarangay|lupon|pangkat|patalsikin|paalisin|daanan|harang)\b'
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
        r'\b(?:i\s+)?apologize,?\s+but\s+i\s+cannot\s+provide\s+information\s+about\s+my\b',
        r'\bcannot\s+provide\s+information\s+about\s+my\s+(?:programming|underlying\s+technology|system|code|model|architecture|developer|creator)\b',
        r'\bmy\s+function\s+is\s+solely\s+to\s+(?:analyze|answer)\s+legal\s+questions\b',
        r'\bmy\s+(?:exclusive\s+)?mission\s+is\s+solely\s+to\b',
        r'\bbased\s+exclusively\s+on\s+the\s+philippine\s+civil\s+code\b',
        r'\bi\s+(?:cannot|can\'t|am\s+unable\s+to)\s+(?:assist\s+with|help\s+(?:with|you\s+with)?|perform|do|write|provide)\s+(?:coding|code|programming|non-legal|technical)\b',
        r'\bcannot\s+help\s+with\s+(?:coding|programming|technical|non-legal)\b',
        r'\b(?:specialized|dedicated)\s+exclusively\s+in\s+philippine\s+civil\s+law\b',
        r'\bi\s+am\s+(?:an?\s+)?ai\s+legal\s+assistant\s+specialized\s+exclusively\b',
        r'\bi\s+cannot\s+(?:write|generate|debug)\s+code\b',
        r'\bcannot\s+help\s+with\s+coding\s+or\s+programming\b',
        r'\bfalls?\s+outside\s+(?:of\s+)?(?:my|the)\s+(?:scope|purview|specialization)\b',
        r'\boutside\s+(?:my|the)\s+(?:specialized\s+)?scope\b',
        r'\b(?:hindi\s+ako\s+makakapagbigay|hindi\s+ako\s+makakatulong)\s+sa\s+(?:mga\s+)?(?:programming|teknolohiya|code)\b',
        # AI Language Model Real-time / Out-of-Domain Refusal Patterns
        r'\bas\s+an\s+ai\s+(?:language\s+)?model\b',
        r'\b(?:do\s+not|don\'t)\s+have\s+access\s+to\s+real[- ]time\s+information\b',
        r'\b(?:do\s+not|don\'t)\s+have\s+access\s+to\s+(?:the\s+)?current\s+(?:date|weather|time)\b',
        r'\b(?:cannot|can\'t|am\s+unable\s+to)\s+provide\s+(?:real[- ]time|current|live)\s+(?:information|data|updates?)\b',
        r'\b(?:i\s+)?apologize,?\s+but\s+(?:as\s+an\s+ai|i\s+do\s+not\s+have|i\s+cannot|i\s+can\'t)\b',
        r'\bcheck\s+a\s+reliable\s+source\s+like\s+a\s+(?:weather|news)\b',
        r'\b(?:current\s+date\s+or\s+local\s+weather|current\s+date|local\s+weather)\b',
        r'\b(?:i\s+)?cannot\s+(?:provide|tell|give)\s+(?:you\s+)?(?:the\s+)?(?:current\s+date|current\s+time|weather)\b',
        r'\bdo\s+not\s+have\s+real[- ]time\s+(?:browsing|data|capabilities|info)\b',
        r'\bscope\s+boundary\s+notice\b',
        r'\bscope\s*&\s*governing\s+jurisdiction\b',
        r'\bproper\s+governing\s+body\b',
        r'\bprimarily\s+commercial(?:\s+in\s+nature)?\b',
        r'\boutside\s+(?:the\s+)?scope\s+of\s+(?:philippine\s+)?civil\s+law\b',
        r'\bcommercial\s+(?:price|inquiry|matter|nature|transaction)\b',
        r'\bnot\s+involve\s+a\s+specific\s+legal\s+transaction\b',
        r'\b(?:there\s+is\s+)?no\s+applicable\s+(?:law|article|statute|provision)\b',
        r'\bno\s+particular\s+article\s+governs?\b',
        r'\b(?:recommend\s+)?checking\s+official\s+.*(?:dealers?|dealerships?|sellers?|websites?|showroom)\b',
        r'\b(?:dealerships?|dealers?)\s+or\s+authorized\s+sellers?\b',
        r'\b(?:pricing\s+and\s+availability|current\s+pricing)\b',
        r'\bgoverned\s+under\s+philippine\s+(?:criminal|labor|tax|corporate)\s+law\b',
        r'\bgoverned\s+by\s+specialized\s+philippine\s+law\b',
    ]
    if any(bool(re.search(p, text, re.IGNORECASE)) for p in refusal_patterns):
        return True

    # Deterministic fallback: if response states there is no applicable law or no article,
    # and cites zero Civil Code articles, it is strictly out-of-scope / refusal.
    cleaned = text.strip()
    has_no_articles = len(parse_article_numbers(cleaned)) == 0
    mentions_no_law = bool(re.search(r'\b(?:no\s+applicable|not\s+applicable|no\s+governing|outside|commercial|dealership|general\s+guidance)\b', cleaned, re.IGNORECASE))
    if has_no_articles and mentions_no_law:
        return True

    return False

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

    # 0. Explicit Civil Code article reference always guarantees in-domain civil routing
    if parse_article_numbers(q_clean):
        return {
            "category": "in_domain_civil",
            "target_domain": None,
            "reason": "Explicit Philippine Civil Code article reference detected."
        }

    # Explicit Civil Law statutory or doctrine references
    has_explicit_civil = any(bool(re.search(p, q_lower)) for p in CIVIL_LAW_POSITIVE_PATTERNS)

    # 1. Check for Non-Legal patterns (physics, science, programming, cooking, fiction, real-time weather/date)
    is_non_legal = any(bool(re.search(p, q_lower)) for p in NON_LEGAL_PATTERNS) and not has_explicit_civil
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

def is_simple_lookup(query: str, history: Optional[List[Any]] = None) -> bool:
    """
    Determines if the query is a focused single-article lookup (definition, explanation, 
    codal text, or simple statutory inquiry) rather than a complex multi-party factual dispute,
    multi-article comparison, or compound multi-intent inquiry.
    """
    q_clean = query.strip()

    # 0. Check for jurisprudence / court case inquiry intent
    if is_jurisprudence_query(q_clean):
        return False

    # 1. Check for single article reference
    unique_art_nums = parse_article_numbers(q_clean)

    if len(unique_art_nums) != 1:
        # If no article or multiple articles (e.g. comparison queries like "Art 445 vs Art 415" or "article 667 and 445"), not a single-article simple lookup
        return False

    # 2. Check for compound / multi-intent indicators (e.g. "and also", multiple questions, example requests)
    if is_compound_or_multi_intent_query(q_clean):
        return False

    # 3. Check for general / structural inquiries about the Civil Code
    if re.search(
        r'\b(total\s+articles?|how\s+many\s+articles?|ilan\s+ang\s+(?:total\s+)?(?:articles?|artikulo)|bilang\s+ng\s+artikulo|number\s+of\s+articles?|articles?\s+count|structure\s+of\s+(?:the\s+)?civil\s+code|books?\s+(?:in|of)\s+(?:the\s+)?civil\s+code|ilan\s+ang\s+libro|mga\s+libro\s+sa\s+civil\s+code|general\s+information|overview\s+of\s+(?:the\s+)?civil\s+(?:code|law)|what\s+is\s+(?:the\s+)?civil\s+(?:code|law)|ano\s+ang\s+civil\s+(?:code|law)|tungkol\s+saan\s+ang\s+civil\s+code|saklaw\s+ng\s+civil\s+code)\b',
        q_clean,
        re.IGNORECASE
    ):
        return False

    # 4. Check for complex dispute indicators (facts, injury, lawsuit, multi-party conflict)
    if is_dispute_query(q_clean):
        return False

    return True


def detect_article_distractor(
    query: str,
    exact_article: Optional[Dict[str, Any]],
    candidate_articles: Optional[List[Dict[str, Any]]] = None
) -> Optional[Dict[str, Any]]:
    """
    Detects if the user is asking about a specific Civil Code article with a false premise 
    (topic mismatch/distractor), e.g., 'Article 445 about pets' when Article 445 actually 
    governs accession/improvements on land of another, and pets/animals are governed under Art 415(6).
    
    Symbolic, deterministic, zero-LLM call.
    Trigger only if single Art num + remainder non-empty. Else skip (protects 445 vs 415 comparisons).

    Explanation-intent guard: "ano ang ibig sabihin ng Article X" / "ano ang sakop
    nito" (including common misspellings like "ibigsabihin", "ibigsahin", "sakot")
    are requests for the article's meaning/scope, NOT false premises. Such generic
    meaning/scope tokens are stripped before topic extraction; if nothing
    substantive remains, this is a pure explanation request -> return None so the
    caller routes to the simple-lookup path instead of the refusal template.
    """
    # Common Filipino misspellings / joined forms -> normalized before tokenizing,
    # so typos never leak into queried_topic or break coverage computation.
    _TYPO_NORMALIZATION = (
        (r'\bibigsahin\b', 'ibig sabihin'),
        (r'\bibigsabihn\b', 'ibig sabihin'),
        (r'\bibigsabihin\b', 'ibig sabihin'),
        (r'\bibigsabhn\b', 'ibig sabihin'),
        (r'\bsakot\b', 'sakop'),
        (r'\bsakup\b', 'sakop'),
        (r'\bkahulogan\b', 'kahulugan'),
    )
    # Generic meaning/scope/explanation-intent tokens: never a "topic".
    _MEANING_INTENT_TOKENS = frozenset({
        'ibig', 'sabihin', 'kahulugan', 'meaning', 'means', 'mean', 'meant',
        'sakop', 'scope', 'coverage', 'saklaw', 'nilalaman',
        'case', 'cases', 'kaso', 'jurisprudence', 'jurisprudensya', 'ruling',
        'rulings', 'decision', 'decisions', 'doctrine', 'doctrines', 'hatol',
        'desisyon', 'doktrina', 'related', 'relative', 'court', 'supreme',
        # Demonstrative / possessive fillers with no topical content
        # (e.g. "...ang mga sakop nito" -> "nito" must not become a topic).
        'nito', 'niyan', 'niyon', 'dito', 'diyan', 'doon',
        'rito', 'riyan', 'roon', 'ganito', 'ganyan', 'ganoon',
    })

    q_clean = query.strip()
    for _pat, _repl in _TYPO_NORMALIZATION:
        q_clean = re.sub(_pat, _repl, q_clean, flags=re.IGNORECASE)

    # Jurisprudence / court case inquiry intent guard: inquiries about cases interpreting an article
    # are requesting judicial doctrines, NOT asserting a false premise.
    if is_jurisprudence_query(q_clean):
        return None

    unique_art_nums = parse_article_numbers(q_clean)

    # Trigger only if single Art num. Else skip (protects multi-article comparisons like 667 and 445 or 445 vs 415)
    if len(unique_art_nums) != 1 or not exact_article:
        return None

    # Compound queries or multi-intent questions are not single-premise distractors
    if is_compound_or_multi_intent_query(q_clean):
        return None

    art_num = unique_art_nums[0]

    # Extract remainder words after stripping article pattern and search stopwords
    remainder_clean = re.sub(
        r'(?:\bmga\s+)?(?:\b(?:art[a-z]*|atr[a-z]*)\.?|\bcivil\s+code|\bra\s*386)\s*(?:(?:no|nos|bilang)\b\.?)?\s*' + re.escape(art_num),
        '',
        q_clean,
        flags=re.IGNORECASE
    )
    raw_tokens = re.findall(r'\b[a-zA-Z]{3,}\b', remainder_clean.lower())
    remainder_tokens = [
        w for w in raw_tokens
        if w not in SEARCH_STOPWORDS
        and w not in _MEANING_INTENT_TOKENS
        and not w.isdigit()
    ]

    # If remainder is empty, this is a pure article query (e.g. "what is article 445"), no false premise
    if not remainder_tokens:
        return None

    remainder_str = " ".join(remainder_tokens)

    # Build signature for exact article (hierarchy + content)
    exact_content = str(exact_article.get('content', '')).lower()
    exact_hier = exact_article.get('hierarchy') or (exact_article.get('metadata') or {}).get('hierarchy', '')
    if isinstance(exact_hier, dict):
        exact_hier_str = f"{exact_hier.get('book_name', '')} {exact_hier.get('title_name', '')} {exact_hier.get('chapter_name', '')} {exact_hier.get('section_name', '')}".lower()
    else:
        exact_hier_str = str(exact_hier).lower()

    exact_full_sig = f"{exact_hier_str} {exact_content}"

    # Compute coverage of remainder on exact article
    cov_exact = _compute_lexical_coverage(remainder_str, exact_full_sig)
    if cov_exact > 0.25:
        # Queried article genuinely covers the topic
        return None

    # Check candidates for topic alignment (confirm remainder in hybrid_top.content and not in exact.content)
    redirect_cand = None
    if candidate_articles:
        for cand in candidate_articles:
            cand_pid = str(cand.get('parent_id') or '')
            if cand_pid == f"RA386-ART{art_num}" or cand_pid == exact_article.get('parent_id'):
                continue
            cand_content = str(cand.get('content', '')).lower()
            cand_cov = _compute_lexical_coverage(remainder_str, cand_content)
            if cand_cov > 0.0:
                redirect_cand = cand
                break

    redirect_art_num = None
    redirect_pid = None
    if redirect_cand:
        redirect_pid = str(redirect_cand.get('parent_id', ''))
        m = re.search(r'RA386-ART(\d+)', redirect_pid)
        if m:
            redirect_art_num = m.group(1)

    return {
        "is_mismatch": True,
        "queried_article": art_num,
        "queried_article_id": f"RA386-ART{art_num}",
        "queried_topic": remainder_str,
        "redirect_article": redirect_art_num,
        "redirect_article_id": redirect_pid,
        "redirect_content": redirect_cand.get('content', '') if redirect_cand else ""
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
        has_art_in_query = bool(parse_article_numbers(query))
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
                arts = re.findall(r'(?:Article|Art\.?|Artikulo)\s*(?:no\.?\s*)?(\d+)', msg.content, re.IGNORECASE)
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

    # Lease & Tenancy
    "RA386-ART1643": ["RA386-ART1654", "RA386-ART1657", "RA386-ART1673"],
    "RA386-ART1654": ["RA386-ART1657", "RA386-ART1673"],
    "RA386-ART1657": ["RA386-ART1654", "RA386-ART1673"],
    "RA386-ART1673": ["RA386-ART1654", "RA386-ART1657", "RA386-ART1670"],

    # Donation
    "RA386-ART725": ["RA386-ART748", "RA386-ART749", "RA386-ART760", "RA386-ART765"],
    "RA386-ART749": ["RA386-ART725", "RA386-ART748"],
    "RA386-ART765": ["RA386-ART725", "RA386-ART760"],

    # Mortgage, Pledge & Antichresis
    "RA386-ART2085": ["RA386-ART2087", "RA386-ART2088", "RA386-ART2125", "RA386-ART2132"],
    "RA386-ART2088": ["RA386-ART2085", "RA386-ART2132"],
    "RA386-ART2125": ["RA386-ART2085", "RA386-ART2126"],

    # Agency & Representation
    "RA386-ART1868": ["RA386-ART1874", "RA386-ART1878"],
    "RA386-ART1874": ["RA386-ART1868", "RA386-ART1878"],
    "RA386-ART1878": ["RA386-ART1868", "RA386-ART1874"],

    # Compromise
    "RA386-ART2028": ["RA386-ART2037", "RA386-ART2041"],
    "RA386-ART2037": ["RA386-ART2028", "RA386-ART2041"],

    # Quasi-Contracts & Solutio Indebiti
    "RA386-ART2142": ["RA386-ART2144", "RA386-ART2154"],
    "RA386-ART2154": ["RA386-ART2142", "RA386-ART2155"],

    # Prescription & Limitations
    "RA386-ART1144": ["RA386-ART1145", "RA386-ART1146", "RA386-ART1155"],
    "RA386-ART1145": ["RA386-ART1144", "RA386-ART1146"],
    "RA386-ART1146": ["RA386-ART1144", "RA386-ART2176"],
    "RA386-ART1155": ["RA386-ART1144", "RA386-ART1145"],

    # Fortuitous Event & Extinguishment
    "RA386-ART1174": ["RA386-ART1262", "RA386-ART1266"],

    # Solidary Obligations
    "RA386-ART1207": ["RA386-ART1208", "RA386-ART1216", "RA386-ART1217"],
}

def collapse_duplicate_statute_blocks(text: str, queried_art_nums: Optional[List[str]] = None) -> str:
    """
    Server-side safety collapse guard:
    1. Collapses duplicate '###  Governing Statutory Basis' sections to a single occurrence.
    2. Collapses duplicate '> **Article N' quote blocks to exactly one blockquote per article.
    3. If queried_art_nums is provided, ensures that only the queried article(s) are quoted
       under Governing Statutory Basis, stripping out incidental/unqueried statute blocks.
    4. Cleans redundant blank lines while preserving markdown structure.
    """
    if not text:
        return text

    # 1. Normalize duplicate '### 📚 Governing Statutory Basis' headers
    header_pattern = re.compile(r'(#{2,4}[^\n]*?(?:Governing Statutory Basis|Statutory Basis)[^\n]*)', re.IGNORECASE)
    matches = list(header_pattern.finditer(text))

    if len(matches) > 1:
        cleaned_parts = [text[:matches[0].start()]]
        seen_art_quotes = set()
        for i, m in enumerate(matches):
            sec_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            sec_content = text[m.start():sec_end]
            arts_in_sec = re.findall(r'>\s*\*\*Article\s*(\d+)', sec_content, re.IGNORECASE)
            if i == 0:
                seen_art_quotes.update(arts_in_sec)
                cleaned_parts.append(sec_content)
            else:
                if not arts_in_sec or any(a in seen_art_quotes for a in arts_in_sec):
                    other_h = re.search(r'\n(#{2,4}\s*[^\n]+)', sec_content[m.end() - m.start():])
                    if other_h:
                        cleaned_parts.append(sec_content[m.end() - m.start() + other_h.start():])
                else:
                    seen_art_quotes.update(arts_in_sec)
                    cleaned_parts.append(sec_content)
        text = ''.join(cleaned_parts)

    # 2. Dedup multiple blockquotes within the Governing Statutory Basis section
    statute_section = re.search(r'(#{2,4}[^\n]*?(?:Governing Statutory Basis|Statutory Basis)[\s\S]*?)(?=\n#{2,4}|\Z)', text, re.IGNORECASE)
    if statute_section:
        sec_text = statute_section.group(1)
        quote_starts = [m.start() for m in re.finditer(r'>\s*\*\*Article\s*(\d+)', sec_text, re.IGNORECASE)]
        if len(quote_starts) > 0:
            header_prefix = sec_text[:quote_starts[0]]
            chunks = []
            for idx, start_pos in enumerate(quote_starts):
                end_pos = quote_starts[idx + 1] if idx + 1 < len(quote_starts) else len(sec_text)
                chunk = sec_text[start_pos:end_pos]
                chunks.append(chunk)

            seen_articles = set()
            kept_chunks = []
            trailing_non_quote = ''
            for c in chunks:
                art_m = re.search(r'>\s*\*\*Article\s*(\d+)', c, re.IGNORECASE)
                if not art_m:
                    continue
                art_num = art_m.group(1)
                if queried_art_nums and art_num not in queried_art_nums and seen_articles:
                    continue
                if art_num not in seen_articles:
                    seen_articles.add(art_num)
                    q_lines = [l for l in c.split('\n') if l.strip().startswith('>')]
                    kept_chunks.append('\n'.join(q_lines))
                    extra_lines = [l for l in c.split('\n') if not l.strip().startswith('>') and l.strip()]
                    if extra_lines:
                        trailing_non_quote += '\n' + '\n'.join(extra_lines)

            new_sec = header_prefix.rstrip() + '\n\n' + '\n\n'.join(kept_chunks)
            if trailing_non_quote:
                new_sec += '\n\n' + trailing_non_quote.strip()
            new_sec += '\n\n'
            text = text[:statute_section.start()] + new_sec + text[statute_section.end():]

    text = re.sub(r'\n{3,}', '\n\n', text).strip() + '\n'
    return text


def validate_statute_blocks(text: str, queried_art_nums: Optional[List[str]] = None) -> bool:
    """
    Validates that the output contains exactly one statutory quote block per queried article
    and no duplicate Governing Statutory Basis headers or unqueried articles.
    """
    if not text or not queried_art_nums:
        return True

    header_matches = re.findall(
        r'#{2,4}[^\n]*?(?:Governing Statutory Basis|Statutory Basis)',
        text,
        re.IGNORECASE
    )
    if len(header_matches) > 1:
        return False

    statute_section = re.search(
        r'(#{2,4}[^\n]*?(?:Governing Statutory Basis|Statutory Basis)[\s\S]*?)(?=\n#{2,4}|\Z)',
        text,
        re.IGNORECASE
    )
    if not statute_section:
        return True

    quotes = re.findall(r'>\s*\*\*Article\s*(\d+)', statute_section.group(1), re.IGNORECASE)
    unique_quotes = set(quotes)
    if len(quotes) != len(unique_quotes):
        return False

    if len(quotes) > max(len(queried_art_nums), 1):
        return False

    # Quoted articles in Governing Statutory Basis should only be queried articles
    clean_queried = [str(a).lstrip('0') for a in queried_art_nums]
    if any(str(q).lstrip('0') not in clean_queried for q in unique_quotes):
        return False

    return True


def rank_and_stratify_citations(
    items: List[Dict[str, Any]], 
    query: str = "",
    context_budget: int = 15,
    distractor_info: Optional[Dict[str, Any]] = None,
    is_simple: bool = False
) -> List[Dict[str, Any]]:
    """
    Unified high-accuracy ranking, scoring, and context stratification.
    
    1. Deduplicates candidate authorities by parent_id (articles) and case_id/gr_number (cases)
       while preserving top scores and flags.
    2. Computes composite relevance scores prioritizing exact statutory matches,
       high vector/FTS fusion, and statutory Civil Code primacy.
    3. Handles distractor queries, simple lookups, and jurisprudence inquiries with strict caps:
       prioritizing the queried article, capping cases to max 3-4, and gating non-exact citations.
    4. Calibrates suitability to score-derived values with a sim >= 0.55 gate for active grounding.
    5. Tags each item with sequential rank, calibrated suitability percentage,
       and context status (is_in_context=True for active citations, False for out-of-rank).
    """
    if not items:
        return []

    # Parent/case unique key resolver preventing multi-chunk duplicates
    def get_item_key(it: dict) -> str:
        ptype = it.get('parent_type')
        pid = str(it.get('parent_id') or it.get('id') or '').strip()
        if ptype == 'article':
            if pid:
                return f"article_{pid}"
        elif ptype == 'case':
            meta = it.get('metadata') or {}
            gr = meta.get('gr_number') or ''
            if gr:
                clean_gr = re.sub(r'[^A-Za-z0-9]', '', str(gr)).upper()
                if clean_gr:
                    return f"case_gr_{clean_gr}"
            if pid:
                return f"case_{pid}"
        elif ptype == 'user_document':
            content_snip = it.get('content', '')[:60].strip()
            return f"doc_{pid}_{content_snip}"

        cid = it.get('chunk_id')
        if cid:
            return str(cid)
        return str(pid or it.get('content', '')[:60].strip())

    # Deduplicate while preserving best properties and flags
    dedup_map: Dict[str, Dict[str, Any]] = {}
    for item in items:
        k = get_item_key(item)
        if k not in dedup_map:
            dedup_map[k] = item
        else:
            existing = dedup_map[k]
            # Carry over boolean flags and metadata
            if item.get('is_exact'):
                existing['is_exact'] = True
            if item.get('is_linked_jurisprudence'):
                existing['is_linked_jurisprudence'] = True
            if item.get('is_companion'):
                existing['is_companion'] = True
            if existing.get('metadata') is None and item.get('metadata') is not None:
                existing['metadata'] = item['metadata']

            cur_score = float(item.get('rrf_score', 0) or item.get('similarity', 0) or item.get('suitability_percent', 0))
            old_score = float(existing.get('rrf_score', 0) or existing.get('similarity', 0) or existing.get('suitability_percent', 0))
            if cur_score > old_score:
                if existing.get('is_exact'):
                    item['is_exact'] = True
                if existing.get('is_linked_jurisprudence'):
                    item['is_linked_jurisprudence'] = True
                if existing.get('is_companion'):
                    item['is_companion'] = True
                item['metadata'] = item.get('metadata') or existing.get('metadata')
                dedup_map[k] = item

    unique_items = list(dedup_map.values())

    # Extract explicit article / case mentions from query for anchor weighting
    explicit_art_nums = set(parse_article_numbers(query)) if query else set()
    query_lower = query.lower() if query else ""
    is_juris = is_jurisprudence_query(query) if query else False

    # Special handling for false-premise topic distractor:
    # Only keep the queried article and the redirect article (if found), discarding all unrelated noise
    if distractor_info and distractor_info.get("is_mismatch"):
        queried_id = distractor_info.get("queried_article_id")
        redirect_id = distractor_info.get("redirect_article_id")
        filtered_items = []
        for it in unique_items:
            pid = str(it.get('parent_id') or '')
            if pid == queried_id or (distractor_info.get("queried_article") and is_matching_article_id(pid, distractor_info["queried_article"])):
                it['is_exact'] = True
                filtered_items.append(it)
                break
        if redirect_id:
            for it in unique_items:
                pid = str(it.get('parent_id') or '')
                if pid == redirect_id or (distractor_info.get("redirect_article") and is_matching_article_id(pid, distractor_info["redirect_article"])):
                    if it not in filtered_items:
                        it['is_exact'] = False
                        it['is_redirect_reference'] = True
                        filtered_items.append(it)
                        break
        if filtered_items:
            unique_items = filtered_items

    elif is_simple and len(explicit_art_nums) == 1:
        single_num = list(explicit_art_nums)[0]
        exact_match = None
        structural_cands = []
        other_cands = []
        for it in unique_items:
            pid = str(it.get('parent_id') or '')
            if is_matching_article_id(pid, single_num):
                if exact_match is None:
                    it['is_exact'] = True
                    exact_match = it
            elif "STRUCTURE" in pid or "GENERAL-INFO" in pid or "SPECIAL-LAWS" in pid:
                structural_cands.append(it)
            else:
                other_cands.append(it)
        if exact_match:
            unique_items = [exact_match] + structural_cands + other_cands[:2]

    def calculate_sort_score(it: dict) -> float:
        ptype = it.get('parent_type', 'source')
        pid = str(it.get('parent_id') or '')
        is_exact = it.get('is_exact', False)
        
        # Check if item corresponds directly to an explicitly queried article number
        art_match = re.search(r'RA386-ART(\d+)', pid)
        if art_match and art_match.group(1) in explicit_art_nums:
            is_exact = True
            it['is_exact'] = True

        if is_exact:
            return 1000.0 + float(it.get('suitability_percent', 98.5))

        base_sim = float(it.get('similarity', 0.0) or 0.0)
        rrf = float(it.get('rrf_score', 0.0) or 0.0)
        score = (rrf * 100.0) + (base_sim * 10.0)

        # Companion expansion boost
        if it.get('is_companion'):
            score += 15.0

        # Linked jurisprudence boost
        if it.get('is_linked_jurisprudence'):
            score += 30.0

        # Substantive statutory Civil Code precedence
        if ptype == 'article':
            score += 2.0 if is_juris else 8.0
        elif ptype == 'user_document':
            score += 6.0
        elif ptype == 'case':
            score += 25.0 if is_juris else 2.0

        # Topical keyword resonance
        content_lower = str(it.get('content', '')).lower()
        key_legal_stems = [
            'rescind', 'defect', 'negligence', 'accident', 'loan', 'delay', 'mora',
            'damages', 'void', 'lease', 'rent', 'tenant', 'landlord', 'sale',
            'vendor', 'vendee', 'usufruct', 'easement', 'servitude', 'mortgage',
            'pledge', 'antichresis', 'donation', 'heir', 'inheritance', 'will',
            'testate', 'intestate', 'legitime', 'partition', 'co-ownership',
            'prescription', 'laches', 'solidary', 'joint', 'compromise',
            'settlement', 'support', 'quasi-delict', 'tort', 'quasi-contract',
            'unjust enrichment', 'fortuitous', 'force majeure', 'good faith',
            'bad faith', 'restitution', 'annulment', 'psychological incapacity',
            'utang', 'upa', 'mana', 'sangla', 'bakod', 'danyos'
        ]
        for stem in key_legal_stems:
            if stem in query_lower and stem in content_lower:
                score += 3.0

        return score

    # Sort all retrieved items by accuracy score descending
    unique_items.sort(key=calculate_sort_score, reverse=True)

    # Caps for active in-context citations
    active_statute_count = 0
    active_case_count = 0
    max_active_statutes = (len(explicit_art_nums) if explicit_art_nums else 2) if is_juris else context_budget
    max_active_cases = 4 if is_juris else context_budget

    # Assign rank, calibrated suitability percentage, and context stratification
    prev_suitability = 100.0
    for idx, item in enumerate(unique_items):
        item['rank'] = idx + 1
        ptype = item.get('parent_type', 'source')
        base_sim = float(item.get('similarity', 0.0) or 0.0)
        is_exact = item.get('is_exact', False)
        pid = str(item.get('parent_id') or '')
        art_match = re.search(r'RA386-ART(\d+)', pid)
        if art_match and art_match.group(1) in explicit_art_nums:
            is_exact = True
            item['is_exact'] = True

        # False-premise distractor mode: exactly 1 active citation (the queried article), redirect article is out_of_rank < 70%
        if distractor_info and distractor_info.get("is_mismatch"):
            if is_exact or idx == 0:
                suitability = 98.5
                item['is_in_context'] = True
                item['rank_status'] = 'primary'
            else:
                # Redirect candidate: strictly out_of_rank and < 70.0%
                if base_sim > 0:
                    suitability = round(min(68.5, max(45.0, base_sim * 100.0)), 1)
                else:
                    suitability = 68.0
                item['is_in_context'] = False
                item['rank_status'] = 'out_of_rank'

        elif is_exact or (idx == 0 and item.get('parent_type') == 'article' and (is_simple or len(explicit_art_nums) > 0)):
            if is_juris and active_statute_count >= max_active_statutes:
                item['is_in_context'] = False
                item['rank_status'] = 'out_of_rank'
                suitability = round(min(68.5, max(45.0, base_sim * 100.0 if base_sim > 0 else 60.0)), 1)
            else:
                suitability = round(max(95.0, 98.5 - (active_statute_count * 0.5)), 1)
                item['is_in_context'] = True
                item['rank_status'] = 'primary'
                active_statute_count += 1

        elif item.get('is_linked_jurisprudence'):
            if active_case_count < max_active_cases:
                suitability = round(max(91.0, 96.0 - (active_case_count * 0.5)), 1)
                item['is_in_context'] = True
                item['rank_status'] = 'primary'
                active_case_count += 1
            else:
                suitability = round(max(40.0, min(prev_suitability - 0.2, 68.0)), 1)
                item['is_in_context'] = False
                item['rank_status'] = 'out_of_rank'

        elif ptype == 'case':
            # Case candidates (hybrid / supplementary)
            if base_sim >= 0.55 and active_case_count < max_active_cases:
                score_derived = 75.0 + ((base_sim - 0.55) / 0.45) * 22.5
                suitability = round(max(80.0, min(prev_suitability - 0.2, score_derived)), 1)
                item['is_in_context'] = True
                item['rank_status'] = 'primary'
                active_case_count += 1
            else:
                if base_sim > 0:
                    score_derived = min(69.0, max(45.0, base_sim * 100.0))
                else:
                    score_derived = 68.0 - (idx * 1.5)
                suitability = round(max(40.0, min(prev_suitability - 0.2, score_derived)), 1)
                item['is_in_context'] = False
                item['rank_status'] = 'out_of_rank'

        else:
            if is_juris:
                # In jurisprudence inquiries, unrelated articles MUST NOT enter active context
                if base_sim > 0:
                    score_derived = min(69.0, max(45.0, base_sim * 100.0))
                else:
                    score_derived = 65.0 - (idx * 1.0)
                suitability = round(max(40.0, min(prev_suitability - 0.2, score_derived)), 1)
                item['is_in_context'] = False
                item['rank_status'] = 'out_of_rank'
            else:
                # Score-derived suitability with sim >= 0.55 gate
                passes_gate = base_sim >= 0.55
                if passes_gate and idx < context_budget:
                    # Active Grounding authorities: calibrated score-derived within [80.0%, 97.5%]
                    score_derived = 75.0 + ((base_sim - 0.55) / 0.45) * 22.5
                    suitability = round(max(80.0, min(prev_suitability - 0.2, score_derived)), 1)
                    item['is_in_context'] = True
                    item['rank_status'] = 'primary'
                else:
                    # Out-of-rank authorities: strictly < 80.0% (and if sim < 0.55, strictly < 70.0%)
                    if base_sim > 0:
                        score_derived = min(69.0, max(45.0, base_sim * 100.0))
                    else:
                        out_idx = idx - context_budget
                        score_derived = 68.0 - (out_idx * 1.5)
                    suitability = round(max(40.0, min(prev_suitability - 0.2, score_derived)), 1)
                    item['is_in_context'] = False
                    item['rank_status'] = 'out_of_rank'

        prev_suitability = suitability
        item['suitability_percent'] = suitability
        item['display_suitability'] = suitability

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
                filtered_words = [
                    w for w in raw_words 
                    if len(w) > 2 and (not w.isdigit() or (1 <= int(w) <= 2270)) and w.lower() not in SEARCH_STOPWORDS
                ]
                search_words = filtered_words if filtered_words else [w for w in raw_words if len(w) > 1]
                if not search_words:
                    search_words = [w for w in raw_words if len(w) > 1]
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

                doc_text_sample = " ".join([d.get('content', '') for d in doc_results])
                doc_domain = classify_document_domain(doc_text_sample)
                is_doc_legal = doc_domain['category'] == 'in_domain_civil'

                # Has user explicitly referenced an article by number (e.g. "Article 1181" or "Artikulo 1181")?
                has_explicit_article = bool(parse_article_numbers(query))

                # Check if legal provisions or jurisprudence are genuinely relevant to the document inquiry
                legal_terms = [
                    'civil code', 'article', 'statute', 'law', 'violate', 'void', 'liability', 
                    'obligation', 'breach', 'risk', 'remedy', 'damages', 'jurisprudence', 
                    'case', 'compliance', 'legal', 'action', 'contract', 'agreement', 'lease',
                    'terms', 'clause', 'provisions', 'stipulation', 'rights', 'summary', 
                    'summarize', 'overview', 'about', 'valid', 'validity', 'ano ito', 'tungkol'
                ]
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
                              AND j.content_summary IS NOT NULL
                              AND j.content_summary != ''
                              AND j.content_summary != 'Summary unavailable.'
                              AND j.content_summary NOT ILIKE '%%summary unavailable%%'
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

            # 1. Exact match extraction for Civil Code Articles or General Codal Overview
            exact_articles = []

            # Check for general / structural inquiries about the Civil Code
            is_general_or_structural = bool(re.search(
                r'\b(total\s+articles?|how\s+many\s+articles?|ilan\s+ang\s+(?:total\s+)?(?:articles?|artikulo)|bilang\s+ng\s+artikulo|number\s+of\s+articles?|articles?\s+count|structure\s+of\s+(?:the\s+)?civil\s+code|books?\s+(?:in|of)\s+(?:the\s+)?civil\s+code|ilan\s+ang\s+libro|mga\s+libro\s+sa\s+civil\s+code|general\s+information|overview\s+of\s+(?:the\s+)?civil\s+(?:code|law)|what\s+is\s+(?:the\s+)?civil\s+(?:code|law)|ano\s+ang\s+civil\s+(?:code|law)|tungkol\s+saan\s+ang\s+civil\s+code|saklaw\s+ng\s+civil\s+code)\b',
                query,
                re.IGNORECASE
            ))
            if is_general_or_structural:
                general_ids = [
                    "RA386-STRUCTURE-AND-ARTICLES",
                    "RA386-GENERAL-INFO",
                    "RA386-ART1",
                    "RA386-ART2270",
                    "RA386-SPECIAL-LAWS-AND-AMENDMENTS"
                ]
                cur.execute("""
                    SELECT chunk_id, parent_type, parent_id, content
                    FROM document_chunks
                    WHERE parent_id = ANY(%s) AND parent_type = 'article';
                """, (general_ids,))
                fetched_gen = {row['parent_id']: row for row in cur.fetchall()}
                for gid in general_ids:
                    if gid in fetched_gen:
                        gen_item = fetched_gen[gid]
                        gen_item['is_exact'] = True
                        gen_item['display_suitability'] = 98.5
                        gen_item['suitability_percent'] = 98.5
                        exact_articles.append(gen_item)

            unique_art_nums = parse_article_numbers(query)
            if unique_art_nums:
                exact_ids = [f"RA386-ART{num}" for num in unique_art_nums]
                cur.execute("""
                    SELECT chunk_id, parent_type, parent_id, content
                    FROM document_chunks
                    WHERE parent_id = ANY(%s) AND parent_type = 'article';
                """, (exact_ids,))
                fetched_exact = {row['parent_id']: row for row in cur.fetchall()}
                for eid in exact_ids:
                    if eid in fetched_exact and eid not in {a['parent_id'] for a in exact_articles}:
                        exact_item = fetched_exact[eid]
                        exact_item['is_exact'] = True
                        exact_item['display_suitability'] = 98.5
                        exact_item['suitability_percent'] = 98.5
                        exact_articles.append(exact_item)
                    
            # 2. Top article matches (Civil Code statutes) via Hybrid Search - PRIORITIZED
            articles = exact_articles.copy()
            art_limit = 3 if is_jurisprudence_query(query) else 20
            hybrid_articles = hybrid_search('article', limit=art_limit)
            exact_ids_set = {a['parent_id'] for a in exact_articles}
            for ha in hybrid_articles:
                if ha['parent_id'] not in exact_ids_set:
                    articles.append(ha)

            # 2.5 Statutory Companion Expansion (Codified Association Graph for Context Recall)
            # Skip for jurisprudence inquiries to prevent context pollution
            if articles and not is_jurisprudence_query(query):
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
            
            # Check for simple single-article lookup, multi-article lookup, and false-premise topic distractor
            is_multi_article = len(unique_art_nums) >= 2
            simple_lookup = is_simple_lookup(query)
            distractor_info = None
            if exact_articles and not is_multi_article:
                distractor_info = detect_article_distractor(query, exact_articles[0], hybrid_articles)

            if distractor_info and distractor_info.get("is_mismatch"):
                logging.info(f"Symbolic distractor detected in search: {distractor_info}")
                exact_articles[0]['distractor_info'] = distractor_info
                redirect_cand = []
                if distractor_info.get('redirect_article_id'):
                    for ha in hybrid_articles:
                        if ha.get('parent_id') == distractor_info['redirect_article_id']:
                            redirect_cand.append(ha)
                            break
                # Only keep exact queried article + optional redirect reference
                all_found = exact_articles + redirect_cand
                return rank_and_stratify_citations(
                    all_found, 
                    query, 
                    context_budget=1, 
                    distractor_info=distractor_info, 
                    is_simple=True
                )

            if simple_lookup and exact_articles and not is_jurisprudence_query(query):
                logging.info(f"Simple lookup detected for query: {query}")
                exact_articles[0]['is_simple_lookup'] = True
                top_hybrid = [ha for ha in hybrid_articles if ha.get('parent_id') not in exact_ids_set]
                all_found = exact_articles + top_hybrid[:2]
                return rank_and_stratify_citations(
                    all_found, 
                    query, 
                    context_budget=max(len(exact_articles), 3), 
                    distractor_info=None, 
                    is_simple=True
                )

            if is_multi_article and exact_articles and not is_jurisprudence_query(query):
                logging.info(f"Multi-article statutory lookup detected for articles: {unique_art_nums}")
                is_dispute = is_dispute_query(query)
                # If pure statutory inquiry/comparison, focus context budget on the queried articles
                multi_budget = min(15, max(len(exact_articles), 6)) if is_dispute else len(exact_articles)
                all_found = articles
                return rank_and_stratify_citations(
                    all_found,
                    query,
                    context_budget=multi_budget,
                    distractor_info=None,
                    is_simple=False
                )
            
            # 3. Graph-Augmented RAG: Retrieve linked jurisprudence for the queried or top articles
            linked_cases = []
            is_juris = is_jurisprudence_query(query)
            case_limit = 6 if is_juris else 4
            if articles:
                target_articles = exact_articles if exact_articles else articles[:4]
                article_ids = [a['parent_id'] for a in target_articles]
                cur.execute("""
                    SELECT r.article_id, j.case_uid, j.title, j.gr_number, j.content_summary, j.source_url, j.decision_date
                    FROM article_jurisprudence_relations r
                    JOIN jurisprudence_cases j ON r.case_uid = j.case_uid
                    WHERE r.article_id = ANY(%s)
                      AND j.content_summary IS NOT NULL
                      AND j.content_summary != ''
                      AND j.content_summary != 'Summary unavailable.'
                      AND j.content_summary NOT ILIKE '%%summary unavailable%%'
                    LIMIT %s;
                """, (article_ids, case_limit))
                
                for row in cur.fetchall():
                    summary = row.get('content_summary') or ''
                    linked_cases.append({
                        "parent_type": "case",
                        "parent_id": row['case_uid'],
                        "content": f"[Supporting Case Doctrine for {row['article_id']}] {row['title']} (GR No. {row['gr_number']}): {summary}",
                        "similarity": 0.92 if is_juris else 0.85,
                        "rrf_score": 0.05,
                        "is_linked_jurisprudence": True,
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
                hybrid_case_chunks = hybrid_search('case', limit=4)
                if hybrid_case_chunks:
                    case_uids = [c['parent_id'] for c in hybrid_case_chunks]
                    cur.execute("""
                        SELECT case_uid, title, gr_number, decision_date, source_url, content_summary
                        FROM jurisprudence_cases
                        WHERE case_uid = ANY(%s)
                          AND content_summary IS NOT NULL
                          AND content_summary != ''
                          AND content_summary != 'Summary unavailable.'
                          AND content_summary NOT ILIKE '%%summary unavailable%%';
                    """, (case_uids,))
                    meta_map = {row['case_uid']: row for row in cur.fetchall()}
                    for hc in hybrid_case_chunks:
                        h_sim = float(hc.get('similarity', 0.0) or 0.0)
                        if is_juris and h_sim < 0.55:
                            continue
                        if hc['parent_id'] in meta_map:
                            m = meta_map[hc['parent_id']]
                            hc['metadata'] = m
                            summary_snip = m.get('content_summary') or hc.get('content', '')
                            hc['content'] = f"[Jurisprudence Doctrine] {m.get('title', '')} (GR No. {m.get('gr_number', '')}): {summary_snip}"
                            cases.append(hc)
                else:
                    clean_terms = [w for w in re.split(r'\W+', query) if len(w) > 2 and w.lower() not in SEARCH_STOPWORDS]
                    if clean_terms:
                        case_search_query = " ".join(clean_terms[:6])
                        cur.execute("""
                            SELECT case_uid, title, gr_number, source_url, content_summary, decision_date
                            FROM jurisprudence_cases
                            WHERE to_tsvector('simple', title || ' ' || coalesce(content_summary, '')) @@ plainto_tsquery('simple', %s)
                              AND content_summary IS NOT NULL
                              AND content_summary != ''
                              AND content_summary != 'Summary unavailable.'
                              AND content_summary NOT ILIKE '%%summary unavailable%%'
                            LIMIT 2;
                        """, (case_search_query,))
                        for row in cur.fetchall():
                            cases.append({
                                "parent_type": "case",
                                "parent_id": row['case_uid'],
                                "content": f"[Jurisprudence Doctrine] {row['title']} (GR No. {row['gr_number']}): {row.get('content_summary', '')}",
                                "similarity": 0.82,
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
        if art_num and int(art_num) > 0:
            prov = f"Article {art_num} (Republic Act No. 386 - Civil Code of the Philippines)"
        elif source_id == "RA386-STRUCTURE-AND-ARTICLES" or "STRUCTURE" in str(source_id):
            prov = "Republic Act No. 386 - Codified Structure & Total Articles (Civil Code of the Philippines)"
        elif source_id == "RA386-GENERAL-INFO" or "GENERAL-INFO" in str(source_id):
            prov = "Republic Act No. 386 - General Information, Enactment & Scope (Civil Code of the Philippines)"
        elif source_id == "RA386-SPECIAL-LAWS-AND-AMENDMENTS" or "SPECIAL-LAWS" in str(source_id):
            prov = "Philippine Civil Law - Interaction with Special Laws & Judicial Jurisdiction"
        else:
            prov = f"Civil Code Provision ({source_id})"
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

    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            try:
                cur.execute("""
                    INSERT INTO chat_messages (session_id, role, content, citations, legal_analytics)
                    VALUES (%s, 'assistant', %s, %s, %s);
                """, (session_id, content, dumps(citations), dumps(legal_analytics) if legal_analytics else None))
            except Exception as col_err:
                # Older schemas lack legal_analytics — retry without it.
                if "legal_analytics" in str(col_err).lower():
                    conn.rollback()
                    cur.execute("""
                        INSERT INTO chat_messages (session_id, role, content, citations)
                        VALUES (%s, 'assistant', %s, %s);
                    """, (session_id, content, dumps(citations)))
                else:
                    raise
            conn.commit()
    except Exception as db_err:
        logging.error(f"Failed to save message to DB: {db_err}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

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
        detected_lang = detect_query_language(request.query)
        lang_directive = get_language_directive(detected_lang)

        def build_user_persona_prefix(name: str, lang: str = "en") -> str:
            """
            Returns a concise persona prefix injected at the top of every system prompt,
            greeting the user by first name if available and setting a clear, accessible
            Philippine Civil Code analysis tone with strict unilingual adherence.
            """
            first_name = (name.split(" ")[0] if name else "").strip()
            greeting = f"The user's first name is {first_name}. " if first_name else ""
            if lang == "tl":
                lang_rule = (
                    "- LANGUAGE ENFORCEMENT: The user communicated in Filipino/Tagalog. "
                    "Provide your ENTIRE response in simplified, natural Tagalog for normal citizens. "
                    "Strictly NO English sentences or Taglish mixing (except statutory article numbers like [Art. 1191])."
                )
            else:
                lang_rule = (
                    "- LANGUAGE ENFORCEMENT: The user communicated in English. "
                    "Provide your ENTIRE response in simple, plain everyday English for normal citizens. "
                    "Strictly NO Tagalog or Taglish words anywhere in the response."
                )

            return (
                f"USER PROFILE:\n"
                f"{greeting}"
                f"COMMUNICATION STYLE FOR THIS SESSION:\n"
                f"- Write in clear, structured, and accessible language for normal citizens.\n"
                f"- Prioritize statutory precision: cite the exact Article number and Title from the Philippine Civil Code (RA 386).\n"
                f"- Clearly explain legal concepts, requisites, and practical remedies in straightforward terms without deep jargon.\n"
                f"{lang_rule}\n\n"
            )

        user_persona_prefix = build_user_persona_prefix(user_name, detected_lang)

        logging.info(
            f"Received search request from user [{user_name or user_email or user_identifier}]: {request.query[:80]}"
        )


        async def sse_generator():
            acquired_immediately, ticket, err = await queue_manager.enter_queue(
                user_id=user_identifier,
                session_id=request.session_id or "",
                user_name=user_name,
                user_email=user_email,
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

                # ── Per-chat server-authoritative memory ──
                # DB is source of truth; client `history` is fallback only.
                _db_history = await asyncio.to_thread(
                    session_memory.load_session_history,
                    request.session_id,
                    session_memory.HISTORY_LIMIT,
                    user_identifier if user_identifier != "anon" else None,
                    get_db_connection,
                )
                _client_dicts = [{"role": m.role, "content": m.content} for m in (request.history or [])]
                canonical_history = session_memory.resolve_history(_client_dicts, _db_history)
                canonical_msgs = session_memory.to_chat_messages(canonical_history)
                # Snapshot before the current turn is persisted — history-recall
                # answers must quote *prior* queries, not the recall question itself.
                _recall_base = list(canonical_history)
                session_summary = await asyncio.to_thread(
                    session_memory.load_session_summary, request.session_id, get_db_connection
                )
                server_citations = await asyncio.to_thread(
                    session_memory.load_recent_citations,
                    request.session_id,
                    session_memory.PRIOR_CITATIONS_LIMIT,
                    get_db_connection,
                )
                merged_prior_citations = session_memory.merge_prior_citations(
                    server_citations, request.prior_citations
                )
                # Persist the incoming user turn (deduped vs the frontend's
                # fire-and-forget POST to /api/sessions/:id/messages).
                await asyncio.to_thread(
                    session_memory.save_user_message,
                    request.session_id,
                    request.query,
                    get_db_connection,
                )
                # Refresh canonical history to include the just-saved user turn.
                if _db_history is not None:
                    _db_history2 = await asyncio.to_thread(
                        session_memory.load_session_history,
                        request.session_id,
                        session_memory.HISTORY_LIMIT,
                        user_identifier if user_identifier != "anon" else None,
                        get_db_connection,
                    )
                    if _db_history2:
                        canonical_history = session_memory.resolve_history(_client_dicts, _db_history2)
                        canonical_msgs = session_memory.to_chat_messages(canonical_history)

                # ── History-recall shortcut ──
                # Meta-questions about the conversation itself ("whats my first query
                # all about") are answered deterministically from the stored
                # transcript. They bypass domain gating, ambiguity detection,
                # retrieval, and NLI — none of which apply to conversation recall.
                if session_memory.is_history_recall_query(request.query):
                    recall_text = session_memory.build_recall_response(request.query, _recall_base)
                    recall_analytics = {
                        'nli_score': None,
                        'nli_status': 'N/A',
                        'top_article_score': 0.0,
                        'is_document_legal': None,
                        'is_out_of_domain': False,
                        'domain_category': 'conversation',
                        'target_domain': None,
                    }
                    yield f"data: {dumps({'type': 'status', 'stage': 'streaming', 'message': 'Recalling conversation history...'})}\n\n"
                    yield f"data: {dumps({'type': 'citations', 'data': []})}\n\n"
                    yield f"data: {dumps({'type': 'accumulated_citations', 'data': merged_prior_citations})}\n\n"
                    yield f"data: {dumps({'type': 'legal_analytics', 'data': recall_analytics})}\n\n"
                    yield f"data: {dumps({'type': 'text', 'text': recall_text})}\n\n"
                    yield f"data: {dumps({'type': 'done'})}\n\n"
                    save_assistant_message_to_db(request.session_id, recall_text, [], recall_analytics)
                    return

                # ── Summary-request shortcut ──
                # "In short...", "buod", "paikliin" and similar ask to shorten the
                # answer just given. They are answered deterministically from the
                # stored transcript and bypass ambiguity detection (which would
                # otherwise re-interrogate already-resolved facts), retrieval, and NLI.
                if session_memory.is_summary_request(request.query):
                    short_text = session_memory.build_summary_response(request.query, _recall_base)
                    short_analytics = {
                        'nli_score': None,
                        'nli_status': 'N/A',
                        'top_article_score': 0.0,
                        'is_document_legal': None,
                        'is_out_of_domain': False,
                        'domain_category': 'conversation',
                        'target_domain': None,
                    }
                    yield f"data: {dumps({'type': 'status', 'stage': 'streaming', 'message': 'Summarizing the previous answer...'})}\n\n"
                    yield f"data: {dumps({'type': 'citations', 'data': []})}\n\n"
                    yield f"data: {dumps({'type': 'accumulated_citations', 'data': merged_prior_citations})}\n\n"
                    yield f"data: {dumps({'type': 'legal_analytics', 'data': short_analytics})}\n\n"
                    yield f"data: {dumps({'type': 'text', 'text': short_text})}\n\n"
                    yield f"data: {dumps({'type': 'done'})}\n\n"
                    save_assistant_message_to_db(request.session_id, short_text, [], short_analytics)
                    return

                # Resolve document filename and sample content if analyzing an uploaded document
                doc_filename = request.document_name
                doc_sample_text = ""
                if request.document_id:
                    conn_doc = None
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

                            # Fetch representative text chunks from the active document for domain gating
                            cur_doc.execute("""
                                SELECT content FROM document_chunks 
                                WHERE parent_id = %s 
                                ORDER BY chunk_id ASC 
                                LIMIT 15;
                            """, (request.document_id,))
                            chunk_rows = cur_doc.fetchall()
                            if chunk_rows:
                                doc_sample_text = " ".join([cr[0] for cr in chunk_rows if cr and cr[0]])
                    except Exception as e:
                        logging.warning(f"Could not fetch document info for {request.document_id}: {e}")
                    finally:
                        if conn_doc:
                            try:
                                conn_doc.close()
                            except Exception:
                                pass

                history_dicts = canonical_history

                # Stage 0: Document Domain Classification (Guardrail for Document Analysis)
                if request.document_id:
                    doc_domain_info = classify_document_domain(doc_sample_text, doc_filename)
                    logging.info(f"Document domain classification for '{doc_filename}': {doc_domain_info}")
                    doc_display_name = doc_filename or "Uploaded Document"

                    # Branch Doc-Refusal: Uploaded document is entirely non-legal / has no civil law concepts
                    if doc_domain_info['category'] == 'out_of_domain_non_legal':
                        yield f"data: {dumps({'type': 'status', 'stage': 'embedding', 'message': 'Evaluating document content & legal domain boundaries...'})}\n\n"
                        await asyncio.sleep(0.3)
                        yield f"data: {dumps({'type': 'status', 'stage': 'thinking', 'message': 'Document contains non-legal material; formulating civil scope boundary refusal...'})}\n\n"
                        await asyncio.sleep(0.3)

                        analytics_payload = {
                            'nli_score': None,
                            'nli_status': 'Out of Domain',
                            'top_article_score': 0.0,
                            'is_document_legal': False,
                            'is_out_of_domain': True,
                            'domain_category': 'non_legal',
                            'target_domain': None,
                        }

                        system_prompt = f"""{user_persona_prefix}{lang_directive}You are CIVIL-LEX, a specialized Philippine Legal AI Assistant dedicated exclusively to the Philippine Civil Code (Republic Act No. 386) and civil jurisprudence.

ACTIVE DOCUMENT: "{doc_display_name}"
USER QUERY: "{request.query}"

DOCUMENT STATUS: NON-LEGAL / OUT-OF-DOMAIN.
The uploaded document "{doc_display_name}" contains non-legal technical, academic, scientific, or general content (such as computer science, information security, authentication protocols, math, engineering, natural sciences, recipes, creative writing, or general notes).
It contains NO contracts, obligations, property rights, succession/wills, family relations, or legal stipulations governed by the Philippine Civil Code (Republic Act No. 386).

YOUR MANDATORY REFUSAL RULES:
1. STRICT REFUSAL: You MUST refuse to answer questions about the contents of this non-legal document, and refuse to provide technical explanations, code summaries, or security protocols. Do NOT summarize or explain Kerberos, CHAP, MFA, biometrics, or other non-legal subjects.
2. CLEAR NOTICE: State clearly and politely that "{doc_display_name}" is a technical or non-legal document that does not contain any legal provisions or civil obligations under Philippine law.
3. EXCLUSIVE MISSION: Explain that CIVIL-LEX is exclusively dedicated and strictly calibrated for the Philippine Civil Code (Republic Act No. 386) and civil jurisprudence.
4. SCOPE OF CIVIL-LEX: Inform the user of the civil legal instruments CIVIL-LEX CAN analyze:
   - Contracts & Leases (e.g., Contracts of Lease, Tenancy Agreements, Service Contracts, MOA)
   - Sales & Conveyances (e.g., Deeds of Absolute Sale, Contracts to Sell, Deeds of Donation)
   - Loans & Mortgages (e.g., Promissory Notes, Real Estate/Chattel Mortgages, Loan Agreements)
   - Succession & Wills (e.g., Last Wills and Testaments, Extrajudicial Settlements of Estate)
   - Family Law Documents (e.g., Marriage Settlements, Custody & Support Agreements)
   - Affidavits & Civil Claims (e.g., Affidavits of Loss/Undertaking, Compromise Agreements, Quasi-Delicts/Damages under RA 386).
5. CALL TO ACTION: Invite the user to upload a valid Philippine civil law contract or legal document to proceed with statutory cross-examination and compliance analysis.
6. NO CITATIONS: Do NOT cite any Civil Code articles or court cases, as no statutory provisions apply to this non-legal material.
7. LANGUAGE: Follow the MANDATORY STRICT LANGUAGE DIRECTIVE: write this refusal entirely in the detected language (simplified Tagalog if query is Tagalog, or plain simple English if query is English) with zero code-switching.
"""
                        full_text = ""
                        is_first_chunk = True

                        async for chunk in generate_response_stream(system_prompt, request.query, history_dicts):
                            if is_first_chunk:
                                is_first_chunk = False
                                yield f"data: {dumps({'type': 'status', 'stage': 'streaming', 'message': 'Streaming domain boundary notice...'})}\n\n"
                                yield f"data: {dumps({'type': 'citations', 'data': []})}\n\n"
                                yield f"data: {dumps({'type': 'accumulated_citations', 'data': merged_prior_citations})}\n\n"
                                yield f"data: {dumps({'type': 'legal_analytics', 'data': analytics_payload})}\n\n"
                            full_text += chunk
                            yield f"data: {dumps({'type': 'text', 'text': chunk})}\n\n"

                        if is_first_chunk:
                            fallback_refusal = f"""### ⚠️ Scope Boundary Refusal: Non-Civil Law Material

I am unable to analyze or provide legal assessments for **"{doc_display_name}"**.

#### Reason for Refusal
The uploaded document contains non-legal technical, academic, or general content (such as information security, computer science, or technical specifications). It contains no contracts, civil obligations, property rights, or legal stipulations governed by the **Philippine Civil Code (Republic Act No. 386)** or the **Family Code of the Philippines (Executive Order No. 209)**.

CIVIL-LEX is an AI assistant exclusively specialized in Philippine Civil Law. Its analytical models, statutory indexing, and NLI verification pipelines are strictly calibrated for civil legal matters.

#### Document Types Supported by CIVIL-LEX
You may upload and analyze valid legal documents within the scope of Philippine Civil Law, including:
- **Contracts & Leases**: Contracts of Lease, Tenancy Agreements, Service Contracts, Memoranda of Agreement (MOA).
- **Sales & Conveyances**: Deeds of Absolute Sale, Contracts to Sell, Deeds of Donation, Deeds of Assignment.
- **Loans & Security Instruments**: Loan Agreements, Promissory Notes, Real Estate Mortgages, Chattel Mortgages.
- **Succession & Estate Settlements**: Last Wills and Testaments, Extrajudicial Settlements of Estate.
- **Family Law Agreements**: Marriage Settlements, Custody and Support Agreements.
- **Affidavits & Civil Claims**: Affidavits of Loss/Undertaking, Compromise Agreements, Tort/Damage settlements under RA 386.

Please upload a legal document falling under Philippine Civil Law to proceed with statutory analysis."""
                            yield f"data: {dumps({'type': 'status', 'stage': 'streaming', 'message': 'Streaming domain boundary notice...'})}\n\n"
                            yield f"data: {dumps({'type': 'citations', 'data': []})}\n\n"
                            yield f"data: {dumps({'type': 'accumulated_citations', 'data': merged_prior_citations})}\n\n"
                            yield f"data: {dumps({'type': 'legal_analytics', 'data': analytics_payload})}\n\n"
                            yield f"data: {dumps({'type': 'text', 'text': fallback_refusal})}\n\n"
                            full_text = fallback_refusal

                        logging.info("Finished streaming non-legal document refusal.")
                        yield f"data: {dumps({'type': 'done'})}\n\n"
                        save_assistant_message_to_db(request.session_id, full_text, [], analytics_payload)
                        return

                    # Branch Doc-Redirection: Uploaded document is legal, but outside Civil Code jurisdiction
                    if doc_domain_info['category'] == 'out_of_domain_legal':
                        target_domain = doc_domain_info.get('target_domain', 'Specialized Philippine Law')
                        yield f"data: {dumps({'type': 'status', 'stage': 'embedding', 'message': f'Analyzing legal jurisdiction for {doc_display_name}...'})}\n\n"
                        await asyncio.sleep(0.3)
                        yield f"data: {dumps({'type': 'status', 'stage': 'thinking', 'message': f'Identifying governing statutory framework for {target_domain}...'})}\n\n"
                        await asyncio.sleep(0.3)

                        analytics_payload = {
                            'nli_score': None,
                            'nli_status': 'Out of Domain',
                            'top_article_score': 0.0,
                            'is_document_legal': True,
                            'is_out_of_domain': True,
                            'domain_category': 'other_legal',
                            'target_domain': target_domain,
                        }

                        system_prompt = f"""{user_persona_prefix}{lang_directive}You are CIVIL-LEX, a specialized Philippine Legal AI Assistant dedicated exclusively to the Philippine Civil Code (Republic Act No. 386) and civil jurisprudence.

ACTIVE DOCUMENT: "{doc_display_name}"
USER QUERY: "{request.query}"

DOCUMENT STATUS: SPECIALIZED PHILIPPINE LEGAL DOCUMENT OUTSIDE CIVIL CODE.
The uploaded document "{doc_display_name}" is a formal legal document, but its subject matter primarily falls under another specialized branch of Philippine law: {target_domain}.

YOUR MANDATORY REDIRECTION RULES:
1. REFUSE CIVIL CODE ANALYSIS: Explain constructively that while "{doc_display_name}" is a legal document, its subject matter is governed under {target_domain} rather than the Philippine Civil Code (Republic Act No. 386).
2. GOVERNING STATUTE & REGULATORY FRAMEWORK:
   - Explicitly cite the governing Philippine statute, code, or law governing this document:
     * If Criminal Law: Cite the Revised Penal Code (Act No. 3815) and applicable Special Penal Laws.
     * If Labor Law: Cite the Labor Code of the Philippines (Presidential Decree No. 442) and DOLE Department Orders.
     * If Tax Law: Cite the National Internal Revenue Code (NIRC - Republic Act No. 8424 as amended by TRAIN and CREATE).
     * If Data Privacy & Cybercrime: Cite the Data Privacy Act of 2012 (Republic Act No. 10173) and Cybercrime Prevention Act of 2012 (Republic Act No. 10175).
     * If Corporate & Commercial: Cite the Revised Corporation Code (Republic Act No. 11232) and Securities Regulation Code (RA 8799).
     * If Intellectual Property: Cite the Intellectual Property Code of the Philippines (Republic Act No. 8293).
     * If Immigration: Cite the Philippine Immigration Act of 1940 (Commonwealth Act No. 613).
     * If Election Law: Cite the Omnibus Election Code (Batas Pambansa Blg. 881).
     * If Administrative/Public Accountability: Cite the Ombudsman Act of 1989 (RA 6770) or RA 6713.
3. COMPETENT TRIBUNAL / REGULATORY AGENCY / FORUM:
   - Clearly name the appropriate government agency, commission, or court with primary jurisdiction:
     * Criminal: Department of Justice (DOJ) / Office of the City or Provincial Prosecutor (for inquest or preliminary investigation), Philippine National Police (PNP), National Bureau of Investigation (NBI).
     * Labor: Department of Labor and Employment (DOLE), National Labor Relations Commission (NLRC), Single Entry Approach (SEnA), Labor Arbiter.
     * Tax: Bureau of Internal Revenue (BIR), Court of Tax Appeals (CTA).
     * Data Privacy & Cybercrime: National Privacy Commission (NPC), Cybercrime Investigation and Coordinating Center (CICC), PNP Anti-Cybercrime Group (PNP-ACG).
     * Corporate: Securities and Exchange Commission (SEC).
     * IP: Intellectual Property Office of the Philippines (IPOPHL) / Bureau of Legal Affairs (BLA).
4. CIVIL CODE CONCURRENT REMEDIES:
   - Clarify any potential concurrent civil liability or independent civil action under the Civil Code (such as civil liability ex delicto under Art. 100 RPC, or independent civil actions under Arts. 32, 33, 34 of the Civil Code, or quasi-delict/contractual claims), while reiterating that primary administrative or criminal jurisdiction rests with the specialized governing body.
5. NO ARBITRARY CIVIL CODE CITATIONS: Do NOT cite arbitrary Civil Code articles as controlling authority for this non-civil matter.
6. CALL TO ACTION: Conclude by welcoming the user to upload Philippine civil law contracts, deeds, leases, wills, or damage settlements for Civil Code analysis.
7. LANGUAGE: Follow the MANDATORY STRICT LANGUAGE DIRECTIVE: write this redirection entirely in the detected language (simplified Tagalog if query is Tagalog, or plain simple English if query is English) with zero code-switching.
"""
                        full_text = ""
                        is_first_chunk = True

                        async for chunk in generate_response_stream(system_prompt, request.query, history_dicts):
                            if is_first_chunk:
                                is_first_chunk = False
                                yield f"data: {dumps({'type': 'status', 'stage': 'streaming', 'message': 'Streaming statutory redirection...'})}\n\n"
                                yield f"data: {dumps({'type': 'citations', 'data': []})}\n\n"
                                yield f"data: {dumps({'type': 'accumulated_citations', 'data': merged_prior_citations})}\n\n"
                                yield f"data: {dumps({'type': 'legal_analytics', 'data': analytics_payload})}\n\n"
                            full_text += chunk
                            yield f"data: {dumps({'type': 'text', 'text': chunk})}\n\n"

                        if is_first_chunk:
                            fallback_redirection = f"""### ⚖️ Statutory Redirection: {target_domain}

The uploaded document **"{doc_display_name}"** is a formal legal document, but its subject matter falls outside the jurisdiction of the **Philippine Civil Code (Republic Act No. 386)**.

#### Governing Statutory Framework
- **Specialized Domain**: {target_domain}
- **Primary Statutory Basis**: Please refer to the governing specialized Philippine code or statute referenced above.

#### Competent Regulatory Agency / Forum
For formal complaints, regulatory compliance, preliminary investigations, or administrative relief, this matter must be submitted to the competent specialized government agency or tribunal having primary jurisdiction.

#### Philippine Civil Code Relationship
While the primary legal framework is {target_domain}, any independent civil action for restitution or damages arising from this matter (such as civil liability ex delicto under Art. 100 of the Revised Penal Code or independent civil actions under Arts. 32, 33, and 34 of the Civil Code) must be instituted separately before the regular trial courts.

CIVIL-LEX is strictly specialized in Philippine Civil Law (RA 386). Please upload Philippine civil law contracts, deeds, leases, or property agreements for Civil Code analysis."""
                            yield f"data: {dumps({'type': 'status', 'stage': 'streaming', 'message': 'Streaming statutory redirection...'})}\n\n"
                            yield f"data: {dumps({'type': 'citations', 'data': []})}\n\n"
                            yield f"data: {dumps({'type': 'accumulated_citations', 'data': merged_prior_citations})}\n\n"
                            yield f"data: {dumps({'type': 'legal_analytics', 'data': analytics_payload})}\n\n"
                            yield f"data: {dumps({'type': 'text', 'text': fallback_redirection})}\n\n"
                            full_text = fallback_redirection

                        logging.info("Finished streaming legal document redirection.")
                        yield f"data: {dumps({'type': 'done'})}\n\n"
                        save_assistant_message_to_db(request.session_id, full_text, [], analytics_payload)
                        return

                # Stage 0.5: Query Intent Classification & Domain Boundary Gating (for General Chat or In-Domain Civil Documents)
                intent_info = classify_query_intent(request.query, canonical_msgs, request.document_id, doc_filename)
                logging.info(f"Query intent classification: {intent_info}")

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

                    system_prompt = f"""{user_persona_prefix}{lang_directive}You are CIVIL-LEX, a specialized Philippine Legal AI Assistant dedicated exclusively to the Philippine Civil Code (Republic Act No. 386) and civil jurisprudence.

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
6. LANGUAGE: Follow the MANDATORY STRICT LANGUAGE DIRECTIVE: write this boundary notice entirely in the detected language (simplified Tagalog if query is Tagalog, or plain simple English if query is English) with zero code-switching.
"""
                    full_text = ""
                    is_first_chunk = True

                    async for chunk in generate_response_stream(system_prompt, request.query, history_dicts):
                        if is_first_chunk:
                            is_first_chunk = False
                            yield f"data: {dumps({'type': 'status', 'stage': 'streaming', 'message': 'Streaming domain boundary notice...'})}\n\n"
                            yield f"data: {dumps({'type': 'citations', 'data': []})}\n\n"
                            yield f"data: {dumps({'type': 'accumulated_citations', 'data': merged_prior_citations})}\n\n"
                            yield f"data: {dumps({'type': 'legal_analytics', 'data': analytics_payload})}\n\n"
                        full_text += chunk
                        yield f"data: {dumps({'type': 'text', 'text': chunk})}\n\n"

                    if is_first_chunk:
                        yield f"data: {dumps({'type': 'citations', 'data': []})}\n\n"
                        yield f"data: {dumps({'type': 'accumulated_citations', 'data': merged_prior_citations})}\n\n"
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

                    system_prompt = f"""{user_persona_prefix}{lang_directive}You are CIVIL-LEX, a specialized Philippine Legal AI Assistant dedicated to the Philippine Civil Code (Republic Act No. 386).

The user's query primarily falls under another specialized branch of Philippine law: {target_domain}.

YOUR MANDATORY REDIRECTION RULES:
1. Constructively explain that while CIVIL-LEX specializes in Philippine Civil Law (RA 386), this inquiry is primarily governed under {target_domain}.
2. Explicitly name the applicable Philippine statute, code, or regulatory framework (e.g., National Internal Revenue Code [NIRC] for taxes; Labor Code [PD 442] for employment disputes; Revised Penal Code for crimes; Revised Corporation Code for corporate governance).
3. Recommend the appropriate government agency, commission, or forum with proper jurisdiction (e.g., Bureau of Internal Revenue [BIR]; National Labor Relations Commission [NLRC] / Department of Labor and Employment [DOLE]; Office of the City Prosecutor; Securities and Exchange Commission [SEC]).
4. Note any concurrent civil action or civil liability for damages that might arise under the Civil Code (such as independent civil actions or breach of contract), while clarifying that the primary administrative or statutory remedy lies with the specialized body.
5. Do NOT cite arbitrary Civil Code articles as controlling authority for this non-civil matter.
6. Conclude by welcoming any civil law questions or issues governed by the Philippine Civil Code.
7. LANGUAGE: Follow the MANDATORY STRICT LANGUAGE DIRECTIVE: write this redirection entirely in the detected language (simplified Tagalog if query is Tagalog, or plain simple English if query is English) with zero code-switching.
"""
                    full_text = ""
                    is_first_chunk = True

                    async for chunk in generate_response_stream(system_prompt, request.query, history_dicts):
                        if is_first_chunk:
                            is_first_chunk = False
                            yield f"data: {dumps({'type': 'status', 'stage': 'streaming', 'message': 'Streaming statutory redirection...'})}\n\n"
                            yield f"data: {dumps({'type': 'citations', 'data': []})}\n\n"
                            yield f"data: {dumps({'type': 'accumulated_citations', 'data': merged_prior_citations})}\n\n"
                            yield f"data: {dumps({'type': 'legal_analytics', 'data': analytics_payload})}\n\n"
                        full_text += chunk
                        yield f"data: {dumps({'type': 'text', 'text': chunk})}\n\n"

                    if is_first_chunk:
                        yield f"data: {dumps({'type': 'citations', 'data': []})}\n\n"
                        yield f"data: {dumps({'type': 'accumulated_citations', 'data': merged_prior_citations})}\n\n"
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
                        history=canonical_msgs,
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
                search_query = build_contextual_query(effective_query, canonical_msgs, doc_filename)
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

                # Deduplicate prior citations and newly retrieved citations using parent/case keys
                def get_citation_key(cit: dict) -> str:
                    ptype = cit.get('parent_type')
                    pid = str(cit.get('parent_id') or cit.get('id') or '').strip()
                    if ptype == 'article':
                        if pid:
                            return f"article_{pid}"
                    elif ptype == 'case':
                        meta = cit.get('metadata') or {}
                        gr = meta.get('gr_number') or ''
                        if gr:
                            clean_gr = re.sub(r'[^A-Za-z0-9]', '', str(gr)).upper()
                            if clean_gr:
                                return f"case_gr_{clean_gr}"
                        if pid:
                            return f"case_{pid}"
                    elif ptype == 'user_document':
                        content_snip = cit.get('content', '')[:60].strip()
                        return f"doc_{pid}_{content_snip}"

                    cid = cit.get('chunk_id')
                    if cid:
                        return str(cid)
                    return str(pid or cit.get('content', '')[:60].strip())

                seen_cit_keys = set()
                for r in results:
                    seen_cit_keys.add(get_citation_key(r))

                is_simple = is_simple_lookup(request.query, canonical_msgs)
                queried_art_nums = parse_article_numbers(request.query)
                is_multi_article = len(queried_art_nums) >= 2
                is_dispute = is_dispute_query(request.query)
                is_juris = is_jurisprudence_query(request.query)

                distractor_info = None
                if not is_multi_article:
                    for r in results:
                        if r.get('distractor_info'):
                            distractor_info = r['distractor_info']
                            break
                    if not distractor_info:
                        exact_cand = next((r for r in results if r.get('is_exact')), None)
                        if exact_cand:
                            distractor_info = detect_article_distractor(request.query, exact_cand, results)

                if (is_simple or distractor_info or (is_multi_article and not is_dispute and not is_juris)) and not request.document_id:
                    retained_prior = []
                    accumulated_citations = results
                else:
                    retained_prior = []
                    for pc in merged_prior_citations:
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

                # Pre-generation: set initial analytics state (real NLI is computed post-generation)
                nli_score_val = None
                nli_status = 'Pending'
                is_out_of_domain = False
                is_doc_legal_flag = True if is_doc_analysis else None

                top_display = max([float(c.get('display_suitability', 0.0)) for c in results], default=0.0)

                analytics_payload = {
                    'nli_score': nli_score_val,
                    'nli_status': nli_status,
                    'top_article_score': top_display,
                    'is_document_legal': is_doc_legal_flag,
                    'is_out_of_domain': False,
                    'domain_category': 'civil',
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
                    # In a 80k context window, prioritize in-context authorities for the model prompt
                    if item.get('is_in_context') is False:
                        continue
                    ptype = item.get('parent_type', 'source')
                    if ptype == 'article':
                        statutory_items.append(item)
                    elif ptype == 'user_document':
                        doc_items.append(item)
                    else:
                        case_items.append(item)

                # Cap statutory and jurisprudence context items for jurisprudence queries
                if is_juris:
                    if queried_art_nums:
                        statutory_items = [
                            s for s in statutory_items
                            if any(is_matching_article_id(s.get('parent_id'), num) for num in queried_art_nums)
                        ] or statutory_items[:1]
                    else:
                        statutory_items = statutory_items[:2]
                    linked_in_ctx = [c for c in case_items if c.get('is_linked_jurisprudence')]
                    case_items = linked_in_ctx[:3] if linked_in_ctx else case_items[:3]

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

                # Bounded context safety for 80k token context window (205,000 characters safety threshold)
                # NEVER truncate the primary Civil Code statutory provisions
                if len(context_str) > 205000:
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

                # Anti-Hallucination Guard: Check if user inquired about specific articles that were NOT retrieved
                queried_articles = parse_article_numbers(request.query)
                if queried_articles and not is_doc_analysis:
                    retrieved_article_nums = set()
                    for s_item in statutory_items:
                        pid = str(s_item.get('parent_id', ''))
                        m_num = str((s_item.get('metadata') or {}).get('article_number', ''))
                        if m_num:
                            retrieved_article_nums.add(m_num)
                        digits = re.findall(r'\d+', pid)
                        for d in digits:
                            retrieved_article_nums.add(d)

                    missing_articles = [art for art in queried_articles if art not in retrieved_article_nums]
                    if missing_articles:
                        missing_str = ", ".join([f"Article {a}" for a in missing_articles])
                        deficit_notice = (
                            f"\n=== ⚠️ RETRIEVAL DEFICIT NOTICE (CRITICAL ANTI-HALLUCINATION DIRECTIVE) ===\n"
                            f"The user inquired about {missing_str}, but {missing_str} is NOT present in the retrieved database context.\n"
                            f"MANDATORY INSTRUCTION: You are STRICTLY FORBIDDEN from fabricating, guessing, or reconstructing the text or rules for {missing_str}.\n"
                            f"You MUST explicitly state: '{missing_str} was not found in the retrieved Civil Code database.'\n"
                            f"Do NOT generate fictitious blockquotes or simulated provisions for {missing_str}.\n"
                        )
                        context_str = deficit_notice + "\n" + context_str

                if request.document_id:
                    doc_display_name = doc_filename or "Uploaded Legal Document"
                    system_prompt = f"""{lang_directive}You are CIVIL-LEX, a specialized Philippine Legal AI Assistant analyzing the uploaded civil document: "{doc_display_name}".

YOUR TASK IN THIS ACTIVE SESSION:
1. Examine the user's questions in direct relation to the uploaded document "{doc_display_name}".
2. Use the provided DOCUMENT EXCERPTS to identify and explain specific contents, clauses, stipulations, terms, or subject matter in the document.
3. PRIMARY STATUTORY GROUNDING & ANCHORED CITATIONS:
   - The Philippine Civil Code (RA 386) and Family Code (EO 209) are your CONTROLLING STATUTORY AUTHORITIES.
   - Cross-examine the document's provisions PRIMARILY against the statutory provisions of the Philippine Civil Code. Ground all legal assessments, rights, obligations, validity, or void stipulations directly on specific Civil Code Articles provided in CONTEXT, using Supreme Court jurisprudence only as secondary supporting doctrine.
   - Anchor every substantive legal rule or finding with its bracketed citation (e.g. [Art. 1654] or [Art. 1191]).
4. FACTUAL INTEGRITY & CLOSED-BOOK CONSTRAINT: If a specific fact or term is stated in the document excerpts, state it clearly. Do not assume or hallucinate clauses not found in the excerpts. If a clause or article is absent from CONTEXT, state that it was not found.

5. PLAIN LANGUAGE FOR ORDINARY CITIZENS (THESIS REQUIREMENT — applies to every section below):
   - Your reader is a normal Filipino citizen, not a lawyer. Write in short, simple sentences using everyday words.
   - Every time you use a legal term (e.g., quasi-delict, rescission, moral damages, jurisdiction), immediately explain what it means in plain words beside it.
   - Never use Latin or lawyer jargon without a plain explanation. STRICT UNILINGUAL OUTPUT: If the query is in English, write entirely in simple plain English with zero Tagalog words. If the query is in Tagalog, write entirely in simplified Tagalog with zero English (except statutory Article numbers). NEVER mix languages or produce Taglish.
   - ALWAYS keep the bracketed citations ([Art. XXXX]) — plain wording never removes legal grounding.

6. MANDATORY RESPONSE FORMATTING & MARKDOWN STRUCTURE:
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
   [Detailed analysis applying statutory provisions to the document. Strictly follow the active MANDATORY STRICT LANGUAGE DIRECTIVE: explain fully in simplified Tagalog if the query is in Tagalog, or fully in simple plain English if the query is in English. Never mix languages.]

   ### 📋 Legal Action Summary
   (Include this section ONLY if the document review reveals actionable violations, contractual breaches, or enforceable remedies. Omit completely if the inquiry is purely descriptive or informational. Write every bullet in plain, non-lawyer language: technical title first, then what it means and what the citizen must actually do, in one simple sentence.)
   - **Governing Civil Code Article(s)**: [List specific RA 386 articles, e.g., Article 1191, Article 1654] + one plain sentence per article on what it means for the reader.
   - **Competent Court / Jurisdiction**: [Specify court based on RA 11576 thresholds: MTC (<= 2M), RTC (> 2M or incapable of pecuniary estimation), Family Court, etc.] + one plain sentence on where to go.
   - **Pre-filing Requirement**: [State whether Katarungang Pambarangay / Barangay Conciliation is mandatory or exempt] + the concrete first step in plain words.
   - **Possible Cause of Action to File**: [Technical legal title + plain-meaning translation: what the case asks the court to do, in one simple sentence. Recommend ONLY civil actions under RA 386/EO 209 — never advise filing criminal charges.]

ACTIVE DOCUMENT:
Filename: {doc_display_name}
Document ID: {request.document_id}

CONTEXT:
{context_str}
"""
                elif distractor_info and distractor_info.get("is_mismatch"):
                    queried_art = distractor_info.get("queried_article", "")
                    queried_topic = distractor_info.get("queried_topic", "")
                    redirect_art = distractor_info.get("redirect_article", "")

                    if redirect_art:
                        redirect_directive = (
                            f"Redirect the user to the correct provision: Article {redirect_art} "
                            f"(e.g. in Tagalog: 'Ang tamang probisyon kaugnay ng mga hayop/pets ay Artikulo {redirect_art} (talata 6 kaugnay ng mga kulungan ng hayop)...' / "
                            f"in English: 'The governing provision regarding animal houses/pets is Article {redirect_art} (paragraph 6)...')."
                        )
                    else:
                        redirect_directive = "State that the queried topic is not governed under this article."

                    system_prompt = f"""{lang_directive}You are CIVIL-LEX, a specialized Philippine Legal Assistant.

CRITICAL FALSE-PREMISE REFUSAL & REDIRECTION DIRECTIVE:
The user is inquiring about "{queried_topic}" under Article {queried_art}.
FACTUAL TRUTH: Article {queried_art} DOES NOT govern or mention "{queried_topic}".
1. Under `### 📌 Direct Answer & Legal Conclusion`: You MUST explicitly state in your very first sentence that Article {queried_art} is NOT about "{queried_topic}" (in Tagalog: "Ang Artikulo {queried_art} ng Civil Code ay HINDI tungkol sa {queried_topic}..." / in English: "Article {queried_art} of the Civil Code does not govern {queried_topic}...").
2. State clearly what Article {queried_art} actually covers in 1 simple sentence.
3. {redirect_directive}
4. NEVER affirm, agree with, or adopt the false premise that Article {queried_art} pertains to "{queried_topic}".

BREVITY REQUIREMENT: Keep total response strictly under 120 words. Provide only a 1-2 sentence direct answer and the verbatim quote. Do NOT include Analysis or Legal Action Summary sections.

MANDATORY MARKDOWN FORMAT:
### 📌 Direct Answer & Legal Conclusion
[1-2 clear, direct sentences explicitly stating Article {queried_art} is NOT about "{queried_topic}", explaining what Article {queried_art} actually is, and redirecting to Article {redirect_art or 'the correct article'}.]

### 📚 Governing Statutory Basis
> **Article {queried_art} (Republic Act No. 386)**
> "[Quote the core statutory text of Article {queried_art} verbatim from CONTEXT]"

CONTEXT:
{context_str}
"""
                elif is_juris and case_items:
                    art_str = f"Article {queried_art_nums[0]}" if queried_art_nums else "the Philippine Civil Code provision"
                    system_prompt = f"""{lang_directive}You are CIVIL-LEX, a specialized Philippine Legal Assistant synthesizing Philippine Supreme Court civil jurisprudence.

The user is inquiring about relevant Supreme Court jurisprudence, court rulings, and landmark cases interpreting {art_str}.

MANDATORY RULES:
1. Under `### 📌 Direct Answer & Legal Conclusion`: Summarize in 1-2 clear, direct sentences how Philippine courts and the Supreme Court interpret and apply {art_str}. STRICT BINDING: Anchor your direct answer strictly to {art_str}. Do NOT cite or introduce other articles (such as articles referenced incidentally inside case descriptions or citations, e.g., Articles 732, 752, 771, 908, 911). Focus exclusively on the queried article.
2. Under `### 📚 Governing Statutory Basis`: Quote the governing statutory basis for {art_str} EXACTLY ONCE. Provide exactly one quote block for the queried article. NEVER repeat the verbatim block, and never quote the same article multiple times.
3. Under `### ⚖️ Related Supreme Court Jurisprudence & Doctrines`:
   - For EACH supporting Supreme Court case provided in CONTEXT:
     - State the **Case Title** (*G.R. No. [number], [Date]*).
     - **Core Doctrine & Ruling**: In 1-2 clear, direct sentences, explain the legal rule or doctrine laid down by the Supreme Court interpreting this article.
     - **Factual Context & Application**: In 1-2 clear, direct sentences, explain how the Court applied the law to the dispute or parties.
     - Keep summaries concise and focused so that every case in CONTEXT is covered completely without truncation.
4. STRICT CLOSED-BOOK FIDELITY: Rely strictly on the case titles, G.R. numbers, and doctrines provided in CONTEXT. Never fabricate non-existent case citations or external memory.
5. PLAIN LANGUAGE FOR CITIZENS: Explain legal terms in simple, everyday language that non-lawyers can easily grasp.

MANDATORY MARKDOWN FORMAT:
### 📌 Direct Answer & Legal Conclusion
[1-2 clear, direct sentences summarizing the judicial doctrine and legal conclusion strictly for {art_str}.]

### 📚 Governing Statutory Basis
(Quote the governing statutory basis for {art_str} EXACTLY ONCE:)
> **Article [Number] (Republic Act No. 386 - Civil Code of the Philippines)**
> "[Quote statutory text verbatim from CONTEXT]"

### ⚖️ Related Supreme Court Jurisprudence & Doctrines
(Provide a dedicated bullet for each case found in CONTEXT:)
- **[Case Title]** (*G.R. No. [GR Number], [Date]*):
  - **Core Doctrine & Ruling**: [1-2 concise sentences on the Supreme Court's ruling interpreting this article.]
  - **Factual Context & Application**: [1-2 concise sentences on how the Court applied the law in this decision.]

### 📋 Practical Legal Implications
[1-2 clear paragraphs explaining what these judicial rulings mean in practice for ordinary citizens or litigants.]

CONTEXT:
{context_str}
"""
                elif is_simple:
                    system_prompt = f"""{lang_directive}You are CIVIL-LEX, a specialized Philippine Legal Assistant providing an accurate, concise statutory answer in simple words for ordinary citizens.

BREVITY & PLAIN-LANGUAGE REQUIREMENT: Keep total response under 150 words. Provide only a direct 1-2 sentence explanation and the exact governing article quote. Do NOT include lengthy Analysis or Legal Action Summary sections.

STRICT CLOSED-BOOK STATUTORY CONSTRAINT:
- Quote and explain ONLY the specific Article provided in the CONTEXT below.
- If the requested article is absent from CONTEXT, you MUST state that it was not found in the database. Never fabricate, guess, or reconstruct quotes from external memory.

PLAIN LANGUAGE DIRECTIVE FOR CITIZENS:
- Explain the provision in simple, everyday words that a normal Filipino citizen with no legal background can easily understand.
- Never leave Latin terms (e.g., negotiorum gestio, quasi-delict) or legal jargon (e.g., ratification, indemnity, reimbursement) without an immediate plain-language translation beside it.

MANDATORY MARKDOWN FORMAT:
### 📌 Direct Answer & Legal Conclusion
[1-2 clear, direct sentences explaining the provision directly in everyday plain language, with any technical or Latin terms translated.]

### 📚 Governing Statutory Basis
> **Article [Number] (Republic Act No. 386 - Civil Code of the Philippines)**
> "[Quote the core statutory text verbatim from CONTEXT]"

CONTEXT:
{context_str}
"""
                elif is_multi_article and not is_dispute:
                    art_list_str = ", ".join([f"Article {n}" for n in queried_art_nums])
                    system_prompt = f"""{lang_directive}You are CIVIL-LEX, a specialized Philippine Legal Assistant providing an accurate, plain-language statutory comparative explanation.

The user is inquiring about multiple Civil Code provisions: {art_list_str}.

MANDATORY RULES:
1. You MUST address, explain, and quote EVERY single queried article ({art_list_str}) provided in the CONTEXT. Never omit any queried article.
2. STRICT CLOSED-BOOK STATUTORY GROUNDING: Strictly ground your definitions and explanations EXCLUSIVELY on the statutory text provided in CONTEXT. If any queried article is missing from CONTEXT, state that Article [X] was not found in the retrieved database; NEVER fabricate quotes or statutory rules for missing articles.
3. Plain language: Write in short, clear sentences for ordinary citizens.
4. STRICT UNILINGUAL OUTPUT: If the query is in Tagalog, write entirely in Tagalog (except statutory Article titles/numbers). If in English, write entirely in English. Never mix languages.
5. OMIT THE `### 📋 Legal Action Summary` SECTION ENTIRELY: Because this is an informational and statutory explanation inquiry without an active lawsuit or dispute, do NOT include a Legal Action Summary.

MANDATORY MARKDOWN FORMAT:
### 📌 Direct Answer & Legal Conclusion
[2-3 clear sentences directly answering the inquiry, summarizing what each queried article covers, and highlighting their relationship or distinction.]

### 📚 Governing Statutory Basis
(Provide a dedicated quote block for EACH queried article found in CONTEXT:)
> **Article [Number] (Republic Act No. 386 - Civil Code of the Philippines)**
> *[Book / Title / Chapter Hierarchy]*
>
> "[Quote the core statutory text verbatim from CONTEXT]"

### ⚖️ Legal Analysis & Comparison
- **[Article Number / Title 1]**: [Plain-language explanation of what this article means, its requirements, and practical application.]
- **[Article Number / Title 2]**: [Plain-language explanation of what this article means, its requirements, and practical application.]
- **Relationship & Comparison (Ugnayan at Pagkakaiba)**: [Clear plain-language comparison of how these provisions differ or how they operate together under Philippine civil law.]

CONTEXT:
{context_str}
"""
                else:
                    system_prompt = f"""{lang_directive}You are CIVIL-LEX, a specialized Philippine Legal Assistant dedicated exclusively to the Philippine Civil Code (Republic Act No. 386), the Family Code (EO 209), and Philippine civil jurisprudence.

YOUR CORE DECISION RULE (3-WAY TRIAGE BASED ON QUERY AND RETRIEVED CONTEXT):
Carefully evaluate the user's inquiry against the retrieved CONTEXT and respond using EXACTLY ONE of the following THREE branches:

======================================================================
BRANCH 1: IN-DOMAIN PHILIPPINE CIVIL LAW (ANSWER USING RETRIEVED CONTEXT)
======================================================================
SELECT THIS BRANCH IF:
The query is about Philippine Civil Law (e.g. contracts, loans, debts, sales, leases, property ownership, boundary disputes, wills, succession, inheritance, marriage, legal separation, torts, quasi-delicts, civil damages, or Civil Code structure/articles) AND is supported by the retrieved CONTEXT.

RESPONSE STRUCTURE FOR BRANCH 1:
### 📌 Direct Answer & Legal Conclusion
[1-2 clear, direct sentences answering the query immediately with the primary legal conclusion in plain language for ordinary citizens.]

### 📚 Governing Statutory Basis
(For each governing Civil Code article in CONTEXT, provide a dedicated blockquote EXACTLY ONCE. Never repeat verbatim quote blocks:)
> **Article [Number] (Republic Act No. 386 - Civil Code of the Philippines)**
> *[Book / Title / Chapter Hierarchy]*
>
> "[Quote the core statutory text verbatim from CONTEXT]"

**Key Statutory Requisites & Elements:**
- **[Element / Requisite 1]**: [Explanation in simple words]
- **[Element / Requisite 2]**: [Explanation in simple words]

### ⚖️ Legal Analysis & Application
[Detailed analysis applying statutory provisions to the factual scenario. If Supreme Court jurisprudence cases are provided in CONTEXT, explicitly cite and discuss them (including Case Title and G.R. Number) to reinforce the legal analysis. Include a concrete everyday real-life example. Explain every legal or Latin term in simple everyday words.]

### 📋 Legal Action Summary
(Include ONLY when the query presents an actionable dispute, breach, claim, injury, or lawsuit requiring barangay conciliation or court filing. OMIT THIS ENTIRE SECTION for purely informational, educational, structural, or single-article lookups.)
- **Governing Civil Code Article(s)**: [List specific RA 386 articles] + plain-language explanation.
- **Competent Court / Jurisdiction**: [MTC (≤ ₱2M), RTC (> ₱2M or incapable of pecuniary estimation), Family Court] + plain explanation.
- **Pre-filing Requirement**: [Barangay conciliation mandatory or exempt] + first step.
- **Possible Cause of Action to File**: [Civil action under RA 386 / EO 209].

======================================================================
BRANCH 2: OTHER PHILIPPINE LAW (NON-CIVIL LEGAL REDIRECTION)
======================================================================
SELECT THIS BRANCH IF:
The query is a legal question, but falls under another specialized branch of Philippine law outside the Civil Code (such as Criminal Law under the Revised Penal Code, Labor Law under the Labor Code / DOLE / NLRC, Tax Law under NIRC / BIR, Corporate Law under SEC, or Traffic Regulations under LTO).

MANDATORY RULES FOR BRANCH 2:
1. Do NOT cite, quote, or apply Civil Code articles as controlling authority for this non-civil matter.
2. Clearly explain that while CIVIL-LEX specializes in Philippine Civil Law (RA 386), this matter is governed under another specialized branch of Philippine law.
3. Explicitly name the governing code or statute and direct the citizen to the proper agency or forum with jurisdiction.

RESPONSE STRUCTURE FOR BRANCH 2:
### 📌 Scope & Governing Jurisdiction
[Explain clearly and politely that this inquiry is governed by specialized Philippine law (e.g. Philippine Labor Law / Criminal Law / Tax Law), rather than the Civil Code.]

### 🏛️ Proper Governing Body & Remedies
- **Governing Statute**: [Name the governing Philippine statute, e.g., Presidential Decree No. 442 (Labor Code of the Philippines), Revised Penal Code, National Internal Revenue Code (NIRC), etc.]
- **Proper Forum / Government Agency**: [Name the agency or tribunal with jurisdiction, e.g., Department of Labor and Employment (DOLE) / NLRC, City Prosecutor's Office, Bureau of Internal Revenue (BIR), SEC, etc.]
- **Appropriate Action & Next Steps**: [Explain the practical first step the citizen should take in plain, simple words.]
- **Concurrent Civil Action Note**: [Mention if there is any concurrent civil claim for damages under RA 386, or clarify that primary relief lies with the administrative/specialized agency.]

======================================================================
BRANCH 3: NON-LEGAL / COMMERCIAL / OUT-OF-SCOPE (REFUSAL)
======================================================================
SELECT THIS BRANCH IF:
The query is NOT about law (such as commercial price inquiries, vehicle or product pricing, car shopping, electronics, computer programming/code, natural sciences, cooking recipes, weather, pop culture, sports, general advice, or casual chat).

MANDATORY RULES FOR BRANCH 3:
1. Do NOT attempt to answer the non-legal question (do NOT quote car prices, do NOT estimate vehicle values, do NOT write code, do NOT provide cooking recipes).
2. Do NOT cite, quote, or misapply any retrieved Civil Code articles from CONTEXT (no civil statute governs vehicle prices or shopping).
3. Politely refuse to answer and inform the user of CIVIL-LEX's specialized civil law scope.

RESPONSE STRUCTURE FOR BRANCH 3:
### 📌 Scope Boundary Notice
[Politely explain that CIVIL-LEX is an AI assistant dedicated exclusively to Philippine Civil Law (Republic Act No. 386). State clearly that the user's inquiry (e.g. vehicle pricing, commercial product rates, shopping, technical coding) is a non-legal matter that falls outside the scope of Philippine Civil Law. If applicable, recommend consulting official manufacturer, dealership, or industry sources for commercial pricing.]

### ⚖️ Philippine Civil Law Scope
State clearly what civil law matters CIVIL-LEX can assist with:
- **Contracts & Obligations**: Loan agreements, promissory notes, breach of contract, non-payment of debts, civil damages.
- **Property & Real Estate**: Land ownership, title disputes, tenancy and lease, boundary conflicts, easements.
- **Family & Marriage**: Marriage validity, property regimes, legal separation, child support, parental authority.
- **Wills & Succession**: Inheritance rights, wills and testaments, estate partition, legitime.
- **Torts & Quasi-Delicts**: Accidents, negligence, personal injury, and civil liability for damages under RA 386.

======================================================================
GENERAL RULES (APPLY TO ALL BRANCHES):
- PLAIN LANGUAGE FOR CITIZENS: Use simple everyday words. Explain every legal or Latin term immediately in plain words.
- STRICT UNILINGUAL OUTPUT: If the query is in English, write entirely in simple English. If the query is in Tagalog, write entirely in simplified Tagalog with zero English (except statutory Article numbers). Never mix languages or output Taglish.
- CLOSED-BOOK FIDELITY: Never fabricate articles or text not found in CONTEXT.
- ONCE-ONLY STATUTORY RULE: Quote each governing Civil Code article in CONTEXT EXACTLY ONCE. Never repeat verbatim quote blocks. Anchor your direct answer strictly to the queried provisions without bleeding into incidental articles mentioned only inside case text.

CONTEXT:
{context_str}
"""

                # Inject user persona prefix at the top so the LLM always
                # sees the user's professional profile first.
                if user_persona_prefix:
                    system_prompt = user_persona_prefix + system_prompt

                # Inject rolling per-chat summary (long-chat memory) if present.
                system_prompt = session_memory.inject_summary_into_system_prompt(
                    system_prompt, session_summary
                )

                # Stage 4: Thinking / Reasoning
                think_msg = (
                    "Analyzing contractual terms, legal risks, and formulating reasoning..."
                    if is_doc_analysis
                    else "Analyzing statutory provisions and formulating legal reasoning..."
                )
                yield f"data: {dumps({'type': 'status', 'stage': 'thinking', 'message': think_msg})}\n\n"

                # Stage 5: Character stream from LLM
                history_dicts = canonical_history
                raw_text = ""
                if ((is_simple or distractor_info) and not request.document_id):
                    max_tokens_val = 1024
                elif is_juris:
                    # Jurisprudence syntheses cover 1 statute + up to 3 cases
                    # (doctrine + facts each) + implications; 2048 truncates
                    # mid-case. LM Studio is configured for 64k context.
                    max_tokens_val = 16192
                else:
                    max_tokens_val = 4096
                finish_info: dict = {}

                async for chunk in generate_response_stream(system_prompt, request.query, history_dicts, max_tokens=max_tokens_val, finish_info=finish_info):
                    raw_text += chunk

                if finish_info.get("reason") == "length":
                    logging.warning(
                        f"Response hit max_tokens={max_tokens_val} (finish_reason=length) "
                        f"for query: {request.query[:120]}"
                    )

                # Server-side collapse of duplicate statutory blocks and headers
                full_text = collapse_duplicate_statute_blocks(raw_text, queried_art_nums)
                if not validate_statute_blocks(full_text, queried_art_nums):
                    logging.warning(f"Statute block count validation mismatch for queried articles {queried_art_nums}; collapsing further.")
                    full_text = collapse_duplicate_statute_blocks(full_text, queried_art_nums)

                yield f"data: {dumps({'type': 'status', 'stage': 'streaming', 'message': 'Streaming legal analysis...'})}\n\n"
                # Batch stream the clean text to client to ensure smooth animation
                batch_size = 16
                for i in range(0, len(full_text), batch_size):
                    sub_chunk = full_text[i:i + batch_size]
                    yield f"data: {dumps({'type': 'text', 'text': sub_chunk})}\n\n"
                    await asyncio.sleep(0.015)

                # ── Post-Synthesis Citation & Safety Determination ─────
                # Citations are emitted ONLY IF the response is genuinely an in-domain civil law analysis.
                # If the response is a refusal, redirection, or states there is no applicable law:
                # suppress all citations to empty [], mark out-of-domain, and skip NLI audit.
                if is_refusal_or_out_of_scope(full_text):
                    logging.info("Model response detected as refusal/out-of-scope; suppressing citations and skipping NLI.")
                    is_out_of_domain = True
                    results = []
                    is_legal_redirection = bool(re.search(
                        r'(?:proper\s+governing\s+body|governing\s+statute|governing\s+jurisdiction|labor\s+code|revised\s+penal\s+code|nirc|nlrc|dole|bir|prosecutor|sec\b)',
                        full_text,
                        re.IGNORECASE
                    ))
                    analytics_payload = {
                        'nli_score': None,
                        'nli_status': 'Out of Domain',
                        'top_article_score': 0.0,
                        'is_document_legal': None,
                        'is_out_of_domain': True,
                        'domain_category': 'other_legal' if is_legal_redirection else 'non_legal',
                        'target_domain': 'Specialized Philippine Law' if is_legal_redirection else None,
                    }
                    yield f"data: {dumps({'type': 'citations', 'data': []})}\n\n"
                    yield f"data: {dumps({'type': 'accumulated_citations', 'data': merged_prior_citations})}\n\n"
                    yield f"data: {dumps({'type': 'legal_analytics', 'data': analytics_payload})}\n\n"
                else:
                    # In-domain grounded Civil Law analysis: deliver citations to the client
                    yield f"data: {dumps({'type': 'citations', 'data': results})}\n\n"
                    yield f"data: {dumps({'type': 'accumulated_citations', 'data': accumulated_citations})}\n\n"

                # ── Post-Generation Neuro-Symbolic Hybrid NLI Verification ─────
                # Run the hybrid NLI engine (Symbolic Logic + Gemma in LM Studio)
                # on the completed answer against retrieved context to compute
                # accurate statutory faithfulness and detect contradictions.
                # Follow-up suggestions are generated concurrently so they don't
                # add latency after NLI finishes.
                followup_task = None
                if not is_out_of_domain and full_text.strip():
                    _prior_user_turns = [
                        m.get("content", "") for m in canonical_history
                        if isinstance(m, dict) and m.get("role") == "user"
                    ][-2:]
                    followup_task = asyncio.create_task(
                        followup_svc.generate_followups(
                            query=request.query,
                            answer=full_text,
                            prior_user_turns=_prior_user_turns,
                            doc_filename=doc_filename if is_doc_analysis else None,
                        )
                    )
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
                        # RAGAS-compliant: score against the FULL in-context evidence
                        # actually given to the generator (statutory + doc + case items),
                        # not just this turn's `results` (which omits retained priors and
                        # may include out-of-context ranked items never shown to the LLM).
                        nli_context_items = statutory_items + doc_items + case_items
                        if not nli_context_items:
                            nli_context_items = [
                                c for c in all_citations
                                if c.get('is_in_context') is not False
                            ] or results
                        # Hard budget: the NLI audit must never stall the SSE stream.
                        # On timeout/failure we fall back to symbolic-only scoring
                        # (threadpool, never blocking the event loop) and ALWAYS emit
                        # a terminal analytics payload so the frontend never sticks
                        # on 'Evaluating'.
                        nli_timed_out = False
                        try:
                            nli_result = await asyncio.wait_for(
                                nli_score_faithfulness_async(
                                    full_text, nli_context_items, mode="hybrid"
                                ),
                                timeout=60.0,
                            )
                        except asyncio.TimeoutError:
                            logging.warning("Post-gen hybrid NLI exceeded 60s budget; using symbolic fallback.")
                            nli_result = await asyncio.to_thread(
                                nli_score_faithfulness_sync,
                                full_text, nli_context_items, "symbolic",
                            )
                            nli_timed_out = True
                        except Exception as nli_hybrid_err:
                            logging.warning(f"Post-gen hybrid NLI failed ({nli_hybrid_err}); using symbolic fallback.")
                            nli_result = await asyncio.to_thread(
                                nli_score_faithfulness_sync,
                                full_text, nli_context_items, "symbolic",
                            )
                            nli_timed_out = True
                        analytics_payload = {
                            'nli_score': nli_result.score_percent,
                            'nli_score_net': nli_result.score_net_percent,
                            'nli_score_weighted': nli_result.score_weighted,
                            'nli_status': nli_result.status,
                            'nli_timed_out': nli_timed_out,
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
                        # Last resort: even the symbolic fallback failed. Emit a
                        # terminal 'unavailable' payload (never a fake score) so the
                        # NLI card resolves instead of spinning forever.
                        logging.error(f"Post-gen NLI failed: {nli_err}")
                        analytics_payload = {
                            'nli_score': None,
                            'nli_status': 'Unverified',
                            'nli_unavailable': True,
                            'top_article_score': top_display,
                            'is_document_legal': is_doc_legal_flag if is_doc_analysis else None,
                            'is_out_of_domain': False,
                            'domain_category': 'civil',
                            'target_domain': None,
                        }
                        yield f"data: {dumps({'type': 'legal_analytics', 'data': analytics_payload})}\n\n"

                # ── LLM-generated follow-up suggestions (best-effort) ──
                if followup_task is not None:
                    try:
                        suggestions = await followup_task
                    except Exception as fu_err:
                        logging.warning(f"Follow-up suggestion task failed: {fu_err}")
                        suggestions = []
                    if suggestions:
                        yield f"data: {dumps({'type': 'follow_ups', 'data': suggestions})}\n\n"

                # Signal completion
                logging.info("Finished streaming response.")
                yield f"data: {dumps({'type': 'done'})}\n\n"

                # Save to DB if valid UUID session_id is provided
                save_assistant_message_to_db(request.session_id, full_text, results, analytics_payload)

                # Best-effort rolling summary refresh for long chats (never blocks SSE — already done).
                try:
                    await session_memory.maybe_refresh_summary(request.session_id, get_db_connection)
                except Exception as summ_err:
                    logging.warning(f"Session summary refresh failed: {summ_err}")

            except Exception as stream_err:
                logging.error(f"Error in SSE stream generation: {stream_err}", exc_info=True)
                err_lower = str(stream_err).lower()
                if any(k in err_lower for k in ["connect", "refused", "timeout", "1234", "lm_studio", "lmstudio"]):
                    clean_msg = "Unable to connect to the language model. LM Studio is currently offline or unreachable."
                else:
                    clean_msg = "An error occurred while generating the legal analysis. Please try again."
                yield f"data: {dumps({'type': 'error', 'message': clean_msg})}\n\n"
            finally:
                try:
                    if ticket in queue_manager._active_slots:
                        await asyncio.shield(queue_manager.release_slot(ticket))
                    else:
                        await asyncio.shield(queue_manager.cancel_waiter(ticket))
                except Exception as clean_err:
                    logging.error(f"Error releasing queue slot for ticket #{ticket}: {clean_err}")

        session_key = request.session_id or f"anon_{uuid.uuid4().hex}"
        sse_queue: asyncio.Queue = asyncio.Queue()

        async def pipeline_worker():
            gen = sse_generator()
            try:
                async for chunk in gen:
                    await sse_queue.put(chunk)
            except asyncio.CancelledError:
                logging.info(f"Pipeline worker explicitly cancelled for session {session_key}")
                try:
                    await gen.aclose()
                except Exception:
                    pass
                raise
            except Exception as e:
                logging.error(f"Pipeline worker unhandled error for session {session_key}: {e}", exc_info=True)
                await sse_queue.put(f"data: {dumps({'type': 'error', 'message': 'An error occurred while generating the legal analysis.'})}\n\n")
            finally:
                if session_key in active_generation_tasks:
                    active_generation_tasks.pop(session_key, None)
                await sse_queue.put(None)

        worker_task = asyncio.create_task(pipeline_worker())
        active_generation_tasks[session_key] = worker_task

        async def sse_consumer():
            try:
                while True:
                    try:
                        item = await asyncio.wait_for(sse_queue.get(), timeout=12.0)
                    except asyncio.TimeoutError:
                        # iOS Safari / Dev Tunnel / reverse proxy keepalive heartbeat
                        yield f": ping\n\ndata: {dumps({'type': 'ping'})}\n\n"
                        continue

                    if item is None:
                        break
                    yield item
            except (asyncio.CancelledError, GeneratorExit):
                logging.info(f"Client disconnected from SSE stream for session {session_key}. Background worker continues.")

        return StreamingResponse(
            sse_consumer(),
            media_type="text/event-stream"
        )


    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error in search endpoint: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="An error occurred while processing your legal query. Please try again."
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
