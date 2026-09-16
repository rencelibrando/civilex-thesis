import os
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
    print("Initializing database FTS dictionary...")
    # NOTE: The schema is managed by Supabase migrations.
    # Do NOT drop and recreate the FTS column here, as it forces a complete rewrite 
    # of the entire 4.8GB table on every startup and destroys the GIN index.
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            # cur.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS fts;")
            # cur.execute("ALTER TABLE document_chunks ADD COLUMN fts tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;")
            cur.execute("CREATE INDEX IF NOT EXISTS fts_idx ON document_chunks USING GIN (fts);")
            conn.commit()
        conn.close()
    except Exception as e:
        print(f"Failed to update FTS schema: {e}")

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


def embed_and_search(query: str, document_id: Optional[str] = None):
    conn = get_db_connection()
    try:
        # Embed the query (blocking)
        q_emb = embedder.encode(query, normalize_embeddings=True).tolist()
        
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Helper function to perform Hybrid Search using RRF
            def hybrid_search(parent_type, limit=5, parent_id=None):
                import re
                words = [w for w in re.split(r'\W+', query) if w]
                or_query = " OR ".join(words) if words else query
                
                if parent_id:
                    where_clause_v = "parent_id = %s"
                    where_clause_t = "parent_id = %s AND fts @@ websearch_to_tsquery('simple', %s)"
                    params_v = (parent_id,)
                    params_t = (parent_id, or_query)
                else:
                    where_clause_v = "parent_type = %s AND 1 - (embedding <=> %s::vector) > 0.35"
                    where_clause_t = "parent_type = %s AND fts @@ websearch_to_tsquery('simple', %s)"
                    params_v = (parent_type, q_emb)
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
                return hybrid_search('user_document', limit=5, parent_id=document_id)

            # 1. Exact match extraction for Civil Code Articles (e.g. "article 2270")
            import re
            exact_articles = []
            article_match = re.search(r'article\s+(\d+)', query, re.IGNORECASE)
            if article_match:
                art_num = article_match.group(1)
                exact_id = f"RA386-ART{art_num}"
                cur.execute("""
                    SELECT chunk_id, parent_type, parent_id, content
                    FROM document_chunks
                    WHERE parent_id = %s AND parent_type = 'article'
                    LIMIT 1;
                """, (exact_id,))
                exact_art = cur.fetchone()
                if exact_art:
                    exact_articles.append(exact_art)
                    
            # 2. Top article matches (Civil Code statutes) via Hybrid Search
            articles = exact_articles.copy()
            hybrid_articles = hybrid_search('article', 5)
            # append only if not already in exact_articles
            exact_ids = {a['parent_id'] for a in exact_articles}
            for ha in hybrid_articles:
                if ha['parent_id'] not in exact_ids:
                    articles.append(ha)
            articles = articles[:5] # limit to 5
            
            # 2. Top case matches (jurisprudence) via Hybrid Search
            cases = hybrid_search('case', 5)
            if cases:
                case_uids = [c['parent_id'] for c in cases]
                cur.execute("""
                    SELECT case_uid, title, gr_number, source_url
                    FROM jurisprudence_cases
                    WHERE case_uid = ANY(%s)
                """, (case_uids,))
                meta_map = {row['case_uid']: row for row in cur.fetchall()}
                for c in cases:
                    if c['parent_id'] in meta_map:
                        meta = meta_map[c['parent_id']]
                        c['metadata'] = {
                            "title": meta.get('title'),
                            "gr_number": meta.get('gr_number'),
                            "source_url": meta.get('source_url')
                        }
            
            # 3. Graph-Augmented RAG: Retrieve linked jurisprudence for the top articles
            linked_cases = []
            if articles:
                article_ids = [a['parent_id'] for a in articles]
                cur.execute("""
                    SELECT r.article_id, j.case_uid, j.title, j.gr_number, j.content_summary, j.source_url
                    FROM article_jurisprudence_relations r
                    JOIN jurisprudence_cases j ON r.case_uid = j.case_uid
                    WHERE r.article_id = ANY(%s)
                """, (article_ids,))
                
                # Format them as documents
                for row in cur.fetchall():
                    linked_cases.append({
                        "parent_type": "case",
                        "parent_id": row['case_uid'],
                        "content": f"[Linked Case for {row['article_id']}] {row['title']} (GR No. {row['gr_number']}): {row['content_summary']}",
                        "metadata": {
                            "title": row.get('title'),
                            "gr_number": row.get('gr_number'),
                            "source_url": row.get('source_url')
                        }
                    })

            # Merge: articles first so statutory provisions lead the context, followed by linked cases, then vector-searched cases
            return articles + linked_cases + cases
    finally:
        conn.close()

@app.post("/search")
async def search_documents(request: SearchRequest):
    """
    RAG Search Endpoint using Hybrid Search (RRF) and streaming LLM response.
    """
    try:
        import logging
        logging.info(f"Received search request: {request.query}")
        
        # Run blocking operations in a thread pool
        results = await asyncio.to_thread(embed_and_search, request.query, request.document_id)
        logging.info(f"Found {len(results)} relevant citations for the query.")
            
        # Construct System Prompt with context
        context_str = ""
        for idx, row in enumerate(results, 1):
            ptype = row['parent_type']
            label = "CIVIL CODE ARTICLE" if ptype == "article" else "JURISPRUDENCE CASE"
            context_str += f"\n[{idx}] SOURCE TYPE: {label} (ID: {row['parent_id']})\n"
            if row.get('metadata'):
                meta = row['metadata']
                if meta.get('title') and meta.get('gr_number'):
                    context_str += f"TITLE: {meta['title']} (GR No. {meta['gr_number']})\n"
                if meta.get('source_url'):
                    context_str += f"LINK: {meta['source_url']}\n"
            context_str += f"CONTENT: {row['content']}\n"
            
        system_prompt = f"""You are CIVIL-LEX, a strict and specialized Philippine Legal Assistant. Your PRIMARY AND EXCLUSIVE MISSION is to analyze and answer queries strictly related to the Philippine Civil Code and Philippine civil jurisprudence.

CRITICAL INSTRUCTIONS - YOU MUST FOLLOW THESE STRICTLY:
1. REFUSAL RULE FOR QUERIES: If the user's query is NOT related to the Philippine Civil Code, civil law, or Philippine civil jurisprudence, YOU MUST REFUSE TO ANSWER. Note that the Civil Code broadly covers Persons, Property, Succession, and Obligations & Contracts. Therefore, queries about ANY agreements, real estate, inheritance, or personal civil relations inherently involve Civil Law. Do NOT provide general legal advice, and do NOT answer queries about purely criminal, tax, or corporate law. If unrelated, reply ONLY with: "I am programmed only to assist with matters related to the Philippine Civil Code. I cannot answer queries outside this scope."
2. REFUSAL RULE FOR DOCUMENTS: If the provided CONTEXT is completely unrelated to civil law (e.g., technical docs, science, random text), YOU MUST REFUSE TO ANALYZE IT. State clearly: "The provided document is unrelated to civil law. My primary and only task is to analyze documents related to the Philippine Civil Code." HOWEVER, you MUST NOT refuse to analyze any document that touches upon ANY part of the Philippine Civil Code. This includes, but is not limited to: offer letters, employment offers, agreements, contracts, leases, deeds of sale, property titles, wills, deeds of donation, or documents regarding personal civil relations. Analyze these documents strictly through the appropriate lens of the Civil Code.
3. CITATION RULE: ALWAYS cite the specific Civil Code Article number when referencing statutory provisions. When discussing jurisprudence, ALWAYS cite the case name, GR number, and include the provided LINK to the source document.
4. STRUCTURE RULE: Present the statutory basis FIRST, then support with relevant jurisprudence.
5. NO HALLUCINATION: If you don't know the answer based on the provided CONTEXT, say so. Do not invent or assume legal facts. Do not answer based on your internal knowledge if the context contradicts it.

CONTEXT:
{context_str}
"""
        
        # 4. Stream response from LLM (LM Studio -> Gemini fallback)
        history_dicts = [{"role": msg.role, "content": msg.content} for msg in request.history]
        
        async def sse_generator():
            logging.info("Starting SSE stream...")
            # 1. Send the citations first
            yield f"data: {dumps({'type': 'citations', 'data': results})}\n\n"
            
            # 2. Stream the AI text
            full_text = ""
            async for chunk in generate_response_stream(system_prompt, request.query, history_dicts):
                full_text += chunk
                yield f"data: {dumps({'type': 'text', 'text': chunk})}\n\n"
                
            # 3. Signal completion
            logging.info("Finished streaming response.")
            yield f"data: {dumps({'type': 'done'})}\n\n"

            # 4. Save to DB if session_id is provided
            if request.session_id:
                try:
                    conn = get_db_connection()
                    with conn.cursor() as cur:
                        # Convert citations to JSON string
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
