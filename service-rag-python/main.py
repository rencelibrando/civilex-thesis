import os
import re
import json
import asyncio
from decimal import Decimal
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel
from typing import List, Dict, Optional
import sys
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)

from services.document import extract_and_process_document
from services.llm_client import generate_response_stream
from sentence_transformers import SentenceTransformer

# Load environment variables
load_dotenv()

# ---------------------------------------------------------------------------
# Custom JSON encoder: handles types that psycopg2 returns but stdlib json
# cannot serialise out of the box (Decimal, RealDictRow, numpy scalars, etc.)
# ---------------------------------------------------------------------------
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
    # Physical injury / assault / battery / violent physical acts
    (r'\b(suntok|sinuntok|manuntok|bugbog|binugbog|mambugbog|saksak|sinaksak|hampas|hinampas|palo|pinalo|sugat|sinugatan|sakitan|sinaktan|pananakit|tadyak|tinadyakan|sampal|sinampal|kinalmot|assault|battery|punch|punched|hit|beaten|injure|injury|injuries)\b',
     'physical injuries quasi delict assault battery fault negligence civil liability damages Art 33 Art 2176 Art 2219 Art 20 Art 21'),
    
    # Civil liability / filing action / damages / indemnity
    (r'\b(ikaso|maikaso|ipakaso|demanda|idemanda|ihabla|habla|habulin|reklamo|ireklamo|bayaran|pananagutan|danyos|bayad-pinsala)\b',
     'civil liability independent civil action damages indemnification quasi delict Art 2176 Art 20 Art 21'),
    
    # Defamation / libel / slander / online gossip / public humiliation
    (r'\b(paninirang-puri|tsismis|chismis|paninira|siniraan|sinisiraan|sinungaling|post sa fb|facebook post|mypost|defamation|libel|slander)\b',
     'defamation libel slander independent civil action moral damages Art 33 Art 2219'),
    
    # Vehicular accidents / reckless driving / road crash
    (r'\b(aksidente|bangga|nabangga|binangga|sagasa|nasagasaan|gasgas|aksidente sa sasakyan|kotse|motor|motorsiklo|driver|tsuper)\b',
     'quasi delict fault negligence vehicular accident motor vehicle damages Art 2176 Art 2180 Art 2185'),
    
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
    (r'\b(utang|umutang|pautang|pautangan|singil|maningil|sinisingil|bayad|di nagbayad|hindi nagbayad|tseke|talbog|bounced check)\b',
     'obligations contracts breach of contract delay mora payment legal interest damages Art 1157 Art 1170 Art 1231'),
    
    # Contracts / agreements / fraud / void / consent
    (r'\b(kontrata|kasulatan|pirma|pinapirma|kasunduan|usapan|bale|contract|consent|void|niloko)\b',
     'contract essential requisites consent cause object void voidable rescissible Art 1318 Art 1381 Art 1390 Art 1409'),
    
    # Succession / inheritance / wills / heirs / estate settlement
    (r'\b(mana|pamana|namatay|pamanang|habilin|testamento|mana-mana|hati sa lupa ng magulang|mana ng anak sa labas)\b',
     'succession inheritance will legitime compulsory heirs intestate testate Art 777 Art 887 Art 960'),
    
    # Marriage / annulment / legal separation / property relations
    (r'\b(kasal|hiwalay|annulment|babaero|kabit|lalakero|asawa|pangangaliwa|pambababae)\b',
     'marriage family code conjugal partnership absolute community legal separation support Art 147 Art 148'),
    
    # Damages / compensation
    (r'\b(moral damages|exemplary damages|nominal damages|actual damages|bayad pinsala)\b',
     'actual moral exemplary nominal liquidated damages Art 2199 Art 2216 Art 2217 Art 2219 Art 2221 Art 2229 Art 2231')
]

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


def search_with_embedding(q_emb: list, query: str, document_id: Optional[str] = None):
    """Executes hybrid RRF search, exact match, and graph-augmented jurisprudence retrieval."""
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Helper function to perform Hybrid Search using RRF
            def hybrid_search(parent_type, limit=5, parent_id=None):
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
                        LIMIT 20
                    ),
                    text_search AS (
                        SELECT chunk_id, parent_type, parent_id, content,
                                ts_rank_cd(fts, websearch_to_tsquery('simple', %s)) AS similarity,
                                ROW_NUMBER() OVER (ORDER BY ts_rank_cd(fts, websearch_to_tsquery('simple', %s)) DESC) AS rrf_text_rank
                        FROM document_chunks
                        WHERE {where_clause_t}
                        ORDER BY rrf_text_rank
                        LIMIT 20
                    ),
                    rrf AS (
                        SELECT 
                            COALESCE(v.chunk_id, t.chunk_id) AS chunk_id,
                            COALESCE(v.parent_type, t.parent_type) AS parent_type,
                            COALESCE(v.parent_id, t.parent_id) AS parent_id,
                            COALESCE(v.content, t.content) AS content,
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
                doc_results = hybrid_search('user_document', limit=5, parent_id=document_id)
                # Check if legal provisions or jurisprudence are also relevant to the document inquiry
                legal_terms = ['civil code', 'article', 'statute', 'law', 'violate', 'void', 'liability', 'obligation', 'breach', 'risk', 'remedy', 'damages', 'jurisprudence', 'case']
                query_lower = query.lower()
                needs_statutory = any(term in query_lower for term in legal_terms) or len(doc_results) < 3
                if needs_statutory:
                    statutory_articles = hybrid_search('article', limit=5)
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
                            SELECT r.article_id, j.case_uid, j.title, j.gr_number, j.content_summary, j.source_url
                            FROM article_jurisprudence_relations r
                            JOIN jurisprudence_cases j ON r.case_uid = j.case_uid
                            WHERE r.article_id = ANY(%s)
                            LIMIT 1;
                        """, (art_ids,))
                        for row in cur.fetchall():
                            linked_cases.append({
                                "parent_type": "case",
                                "parent_id": row['case_uid'],
                                "content": f"[Supporting Case Doctrine for {row['article_id']}] {row['title']} (GR No. {row['gr_number']}): {row.get('content_summary', '')}",
                                "metadata": {
                                    "title": row.get('title'),
                                    "gr_number": row.get('gr_number'),
                                    "source_url": row.get('source_url')
                                }
                            })
                    return doc_results + statutory_articles + linked_cases
                return doc_results

            # 1. Exact match extraction for Civil Code Articles (e.g. "article 77", "Art 2176", "Article 33")
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
                        exact_articles.append(fetched_exact[eid])
                    
            # 2. Top article matches (Civil Code statutes) via Hybrid Search - PRIORITIZED
            articles = exact_articles.copy()
            art_limit = max(4, 6 - len(exact_articles))
            hybrid_articles = hybrid_search('article', art_limit)
            exact_ids_set = {a['parent_id'] for a in exact_articles}
            for ha in hybrid_articles:
                if ha['parent_id'] not in exact_ids_set:
                    articles.append(ha)
            articles = articles[:6] # Prioritize up to 6 statutory provisions

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
                article_ids = [a['parent_id'] for a in articles]
                cur.execute("""
                    SELECT r.article_id, j.case_uid, j.title, j.gr_number, j.content_summary, j.source_url
                    FROM article_jurisprudence_relations r
                    JOIN jurisprudence_cases j ON r.case_uid = j.case_uid
                    WHERE r.article_id = ANY(%s)
                    LIMIT 3;
                """, (article_ids,))
                
                # Format them as supporting documents
                for row in cur.fetchall():
                    summary = row.get('content_summary') or ''
                    linked_cases.append({
                        "parent_type": "case",
                        "parent_id": row['case_uid'],
                        "content": f"[Supporting Case Doctrine for {row['article_id']}] {row['title']} (GR No. {row['gr_number']}): {summary}",
                        "metadata": {
                            "title": row.get('title'),
                            "gr_number": row.get('gr_number'),
                            "source_url": row.get('source_url')
                        }
                    })

            # 4. Top case matches (jurisprudence) via Hybrid Search - strictly supplementary
            # 4. Top case matches (jurisprudence) - strictly supplementary fallback if no linked cases
            cases = []
            if not linked_cases:
                # If no linked jurisprudence was found in the graph, search jurisprudence_cases table directly
                # (11k cases table is fast and avoids scanning 351,000 document_chunks)
                clean_terms = [w for w in re.split(r'\W+', query) if len(w) > 2 and w.lower() not in SEARCH_STOPWORDS]
                if clean_terms:
                    case_search_query = " ".join(clean_terms[:6])
                    cur.execute("""
                        SELECT case_uid, title, gr_number, source_url, content_summary
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
                                "source_url": row.get('source_url')
                            }
                        })

            # Merge: Civil Code statutory articles ALWAYS lead first, followed by supporting jurisprudence
            return articles + linked_cases + cases
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

@app.post("/search")
async def search_documents(request: SearchRequest):
    """
    RAG Search Endpoint with granular stage progression streamed via SSE:
    1. Contextualize query with active conversation memory
    2. Embedding prompt
    3. Retrieving relevant documents & statutory articles
    4. Synthesizing context with retained active citations and passing prompt to model
    5. Model thinking & reasoning
    6. Streaming character response
    """
    try:
        import logging
        import uuid
        logging.info(f"Received search request: {request.query}")

        async def sse_generator():
            try:
                logging.info("Starting SSE stream with granular RAG stages and context memory...")

                # Resolve document filename if analyzing an uploaded document
                doc_filename = request.document_name
                if request.document_id and not doc_filename:
                    try:
                        conn_doc = get_db_connection()
                        with conn_doc.cursor() as cur_doc:
                            cur_doc.execute("SELECT filename FROM user_documents WHERE id = %s;", (request.document_id,))
                            row = cur_doc.fetchone()
                            if row and row[0]:
                                doc_filename = row[0]
                        conn_doc.close()
                    except Exception as e:
                        logging.warning(f"Could not fetch document filename for {request.document_id}: {e}")

                # Context-aware query expansion for hybrid search
                search_query = build_contextual_query(request.query, request.history, doc_filename)
                logging.info(f"Contextualized search query: {search_query}")

                # Stage 1: Embedding the prompt
                yield f"data: {dumps({'type': 'status', 'stage': 'embedding', 'message': 'Generating vector embedding for query...'})}\n\n"
                q_emb = await asyncio.to_thread(compute_embedding, search_query)

                # Stage 2: Getting the relevant document
                yield f"data: {dumps({'type': 'status', 'stage': 'retrieving', 'message': 'Searching Philippine Civil Code articles & jurisprudence...'})}\n\n"
                results = await asyncio.to_thread(search_with_embedding, q_emb, search_query, request.document_id)
                logging.info(f"Found {len(results)} relevant citations for current query.")

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

                # Send citations and retrieval completion status
                yield f"data: {dumps({'type': 'citations', 'data': results})}\n\n"
                yield f"data: {dumps({'type': 'accumulated_citations', 'data': accumulated_citations})}\n\n"
                yield f"data: {dumps({'type': 'status', 'stage': 'retrieving_done', 'message': f'Retrieved {len(results)} relevant legal provisions & doctrines ({len(accumulated_citations)} retained in active chat)', 'count': len(results)})}\n\n"

                # Stage 3: Passing final prompt & context to model
                yield f"data: {dumps({'type': 'status', 'stage': 'prompting', 'message': 'Synthesizing statutory context & preparing model prompt...'})}\n\n"
                
                # Separate retrieved and prior items by type to enforce strict statutory Civil Code priority
                statutory_items = []
                doc_items = []
                case_items = []

                # Combine results and retained prior citations
                all_citations = results + retained_prior
                for item in all_citations:
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

                # Bounded context safety: if context exceeds budget, truncate ONLY from secondary jurisprudence
                # NEVER truncate the primary Civil Code statutory provisions
                if len(context_str) > 24000:
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
                        for idx, row in enumerate(case_items[:2], 1):
                            context_str += f"\n[Supporting Case {idx}]\n" + format_context_item(row, doc_filename)
                        context_str += "\n...[Additional secondary jurisprudence omitted to preserve statutory focus]...\n"

                if request.document_id:
                    doc_display_name = doc_filename or "Uploaded Legal Document"
                    system_prompt = f"""You are CIVIL-LEX, a specialized Philippine Legal AI Assistant analyzing the uploaded document: "{doc_display_name}".

YOUR TASK IN THIS ACTIVE SESSION:
1. Examine the user's questions in direct relation to the uploaded document "{doc_display_name}".
2. Use the provided DOCUMENT EXCERPTS to identify and explain specific clauses, stipulations, obligations, terms, compensation, and liabilities stated in the document.
3. PRIMARY STATUTORY GROUNDING: Cross-examine the document's provisions PRIMARILY against the statutory provisions of the Philippine Civil Code (Republic Act No. 386). Ground all legal assessments, rights, obligations, validity, or void stipulations directly on specific Civil Code Articles first, using Supreme Court jurisprudence only as secondary supporting doctrine.
4. If a specific fact or term is stated in the document excerpts, state it clearly. If the document excerpts do not state a particular detail, specify that the provided excerpt does not contain that information while discussing the governing Civil Code statutory rules.
5. Provide specific citations to Civil Code Article numbers first, and Supreme Court case G.R. numbers where applicable.

ACTIVE DOCUMENT:
Filename: {doc_display_name}
Document ID: {request.document_id}

CONTEXT:
{context_str}
"""
                else:
                    system_prompt = f"""You are CIVIL-LEX, a strict and specialized Philippine Legal Assistant. Your PRIMARY AND EXCLUSIVE MISSION is to analyze and answer queries strictly related to the Philippine Civil Code and Philippine civil jurisprudence.

CRITICAL INSTRUCTIONS - YOU MUST FOLLOW THESE STRICTLY:
1. PRIMARY STATUTORY GROUNDING (MANDATORY): The Philippine Civil Code (Republic Act No. 386) is your HIGHEST AND CONTROLLING AUTHORITY. You MUST ALWAYS prioritize the statutory provisions of the Civil Code over jurisprudence.
   - Present the specific Civil Code Article(s) FIRST in your response before discussing any cases.
   - Ground your legal reasoning, definitions, elements, and conclusions directly on the statutory text of the Civil Code articles provided in CONTEXT.
   - Supreme Court jurisprudence serves ONLY as secondary, supporting interpretation to illustrate how that statutory article was applied. Never allow case doctrines to overshadow or replace the governing statutory provision.
   - If the user asks for a simple explanation, Tagalog breakdown, or general guidance, explain what the Civil Code Article prescribes first, clearly and directly.
2. REFUSAL RULE FOR QUERIES: If the user's query is NOT related to the Philippine Civil Code, civil law, or Philippine civil jurisprudence, YOU MUST REFUSE TO ANSWER. Note that the Civil Code broadly covers Persons, Property, Succession, and Obligations & Contracts. Therefore, queries about ANY agreements, real estate, inheritance, or personal civil relations inherently involve Civil Law. Do NOT provide general legal advice, and do NOT answer queries about purely criminal, tax, or corporate law. If unrelated, reply ONLY with: "I am programmed only to assist with matters related to the Philippine Civil Code. I cannot answer queries outside this scope."
3. REFUSAL RULE FOR DOCUMENTS: If the provided CONTEXT is completely unrelated to civil law (e.g., technical docs, science, random text), YOU MUST REFUSE TO ANALYZE IT. State clearly: "The provided document is unrelated to civil law. My primary and only task is to analyze documents related to the Philippine Civil Code." HOWEVER, you MUST NOT refuse to analyze any document that touches upon ANY part of the Philippine Civil Code. This includes, but is not limited to: offer letters, employment offers, agreements, contracts, leases, deeds of sale, property titles, wills, deeds of donation, or documents regarding personal civil relations. Analyze these documents strictly through the appropriate lens of the Civil Code.
4. CITATION RULE: ALWAYS cite the specific Civil Code Article number when referencing statutory provisions. When discussing jurisprudence, cite the case name, GR number, and include the provided LINK to the source document.
5. STRUCTURE RULE: Structure your response with the STATUTORY BASIS (Civil Code Articles) FIRST, followed by direct legal explanation, and conclude with secondary supporting jurisprudence only if relevant.
6. NO HALLUCINATION: If you don't know the answer based on the provided CONTEXT, say so. Do not invent or assume legal facts. Do not answer based on your internal knowledge if the context contradicts it.

CONTEXT:
{context_str}
"""

                # Stage 4: Thinking / Reasoning
                yield f"data: {dumps({'type': 'status', 'stage': 'thinking', 'message': 'Analyzing statutory provisions and formulating legal reasoning...'})}\n\n"

                # Stage 5: Character stream from LLM
                history_dicts = [{"role": msg.role, "content": msg.content} for msg in request.history]
                full_text = ""
                is_first_chunk = True

                async for chunk in generate_response_stream(system_prompt, request.query, history_dicts):
                    if is_first_chunk:
                        is_first_chunk = False
                        yield f"data: {dumps({'type': 'status', 'stage': 'streaming', 'message': 'Streaming legal analysis...'})}\n\n"
                    full_text += chunk
                    yield f"data: {dumps({'type': 'text', 'text': chunk})}\n\n"

                # Signal completion
                logging.info("Finished streaming response.")
                yield f"data: {dumps({'type': 'done'})}\n\n"

                # Save to DB if valid UUID session_id is provided
                is_valid_uuid = False
                if request.session_id:
                    try:
                        uuid.UUID(str(request.session_id))
                        is_valid_uuid = True
                    except (ValueError, AttributeError):
                        is_valid_uuid = False

                if is_valid_uuid:
                    try:
                        conn = get_db_connection()
                        with conn.cursor() as cur:
                            citations_json = dumps(results)
                            cur.execute("""
                                INSERT INTO chat_messages (session_id, role, content, citations)
                                VALUES (%s, 'assistant', %s, %s)
                            """, (request.session_id, full_text, citations_json))
                            conn.commit()
                    except Exception as db_err:
                        logging.error(f"Failed to save message to DB: {db_err}")
                    finally:
                        if 'conn' in locals():
                            conn.close()

            except Exception as stream_err:
                logging.error(f"Error in SSE stream generation: {stream_err}")
                yield f"data: {dumps({'type': 'error', 'message': str(stream_err)})}\n\n"

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
