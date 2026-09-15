import os
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

from services.document import extract_and_process_pdf
from services.llm_client import generate_response_stream
from sentence_transformers import SentenceTransformer

# Load environment variables
load_dotenv()

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

@app.post("/extract")
def extract_document(request: ExtractRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(extract_and_process_pdf, request.file_url, request.document_id)
    return {"status": "processing"}

class ChatMessage(BaseModel):
    role: str
    content: str

class SearchRequest(BaseModel):
    query: str
    history: List[ChatMessage] = []

import asyncio

def embed_and_search(query: str):
    conn = get_db_connection()
    try:
        # Embed the query (blocking)
        q_emb = embedder.encode(query, normalize_embeddings=True).tolist()
        
        # Two-query approach: separate article and case retrieval
        # to guarantee article statutes always appear (despite 99:1 data imbalance)
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # 1. Top article matches (Civil Code statutes)
            cur.execute("""
                SELECT parent_type, parent_id, content,
                       1 - (embedding <=> %s::vector) AS similarity
                FROM document_chunks
                WHERE parent_type = 'article'
                ORDER BY embedding <=> %s::vector
                LIMIT 5;
            """, (q_emb, q_emb))
            articles = cur.fetchall()
            
            # 2. Top case matches (jurisprudence)
            cur.execute("""
                SELECT parent_type, parent_id, content,
                       1 - (embedding <=> %s::vector) AS similarity
                FROM document_chunks
                WHERE parent_type = 'case'
                ORDER BY embedding <=> %s::vector
                LIMIT 5;
            """, (q_emb, q_emb))
            cases = cur.fetchall()
            
            # Merge: articles first so statutory provisions lead the context
            return articles + cases
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
        results = await asyncio.to_thread(embed_and_search, request.query)
        logging.info(f"Found {len(results)} relevant citations for the query.")
            
        # Construct System Prompt with context
        context_str = ""
        for idx, row in enumerate(results, 1):
            ptype = row['parent_type']
            label = "CIVIL CODE ARTICLE" if ptype == "article" else "JURISPRUDENCE CASE"
            context_str += f"\n[{idx}] SOURCE TYPE: {label} (ID: {row['parent_id']})\n"
            context_str += f"CONTENT: {row['content']}\n"
            
        system_prompt = f"""You are CIVIL-LEX, a highly knowledgeable Philippine Legal Assistant.
Use the following retrieved context to answer the user's query.

IMPORTANT INSTRUCTIONS:
- Always cite the specific Civil Code Article number when referencing statutory provisions.
- When discussing jurisprudence, cite the case name and GR number.
- Present the statutory basis FIRST, then support with relevant jurisprudence.
- If you don't know the answer based on the context, say so. Do not invent legal facts.

CONTEXT:
{context_str}
"""
        
        # 4. Stream response from LLM (LM Studio -> Gemini fallback)
        history_dicts = [{"role": msg.role, "content": msg.content} for msg in request.history]
        
        import json
        async def sse_generator():
            logging.info("Starting SSE stream...")
            # 1. Send the citations first
            yield f"data: {json.dumps({'type': 'citations', 'data': results})}\n\n"
            
            # 2. Stream the AI text
            async for chunk in generate_response_stream(system_prompt, request.query, history_dicts):
                yield f"data: {json.dumps({'type': 'text', 'text': chunk})}\n\n"
                
            # 3. Signal completion
            logging.info("Finished streaming response.")
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        
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
