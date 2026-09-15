#!/usr/bin/env python3
import os
import sys
import json
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv
from tqdm import tqdm
from sentence_transformers import SentenceTransformer

# Load environment variables
load_dotenv()

DEFAULT_DB_URL = os.getenv(
    "POSTGRES_DB_URL",
    "postgresql://postgres:postgres@localhost:54322/postgres"
)
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "sentence-transformers/stsb-xlm-r-multilingual")

def get_connection(db_url=None):
    url = db_url or DEFAULT_DB_URL
    return psycopg2.connect(url)

def main():
    print("Loading embedding model...")
    model = SentenceTransformer(EMBEDDING_MODEL_NAME)
    
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    articles_file = os.path.join(data_dir, "civil_code_rag.jsonl")
    
    if not os.path.exists(articles_file):
        print(f"File not found: {articles_file}")
        sys.exit(1)

    print(f"Loading article chunks from {articles_file}...")
    all_chunks = []
    with open(articles_file, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            item = json.loads(line)
            art_id = item.get("article_id")
            topics = item.get("legal_topics", [])
            for idx, c in enumerate(item.get("chunks", [])):
                all_chunks.append({
                    "chunk_id": c.get("chunk_id", f"{art_id}_c{idx}"),
                    "parent_type": "article",
                    "parent_id": art_id,
                    "content": c.get("text", ""),
                    "legal_topics": topics
                })
    
    total_chunks = len(all_chunks)
    print(f"Total article chunks to embed: {total_chunks}")
    
    conn = get_connection()
    try:
        query = """
            INSERT INTO document_chunks (chunk_id, parent_type, parent_id, content, legal_topics, embedding)
            VALUES %s
            ON CONFLICT (chunk_id) DO UPDATE SET
                content = EXCLUDED.content,
                embedding = EXCLUDED.embedding;
        """
        
        batch_size = 250
        pbar = tqdm(total=total_chunks, desc="Embedding & Inserting Articles")
        
        for i in range(0, total_chunks, batch_size):
            batch = all_chunks[i:i + batch_size]
            texts = [c["content"] for c in batch]
            
            embeddings = model.encode(texts, batch_size=len(texts), show_progress_bar=False, normalize_embeddings=True)
            
            records = []
            for item, emb in zip(batch, embeddings):
                records.append((
                    item["chunk_id"],
                    item["parent_type"],
                    item["parent_id"],
                    item["content"],
                    item["legal_topics"],
                    emb.tolist()
                ))

            with conn.cursor() as cur:
                execute_values(cur, query, records, template="(%s, %s, %s, %s, %s, %s::vector)")
                conn.commit()
                
            pbar.update(len(batch))
            
        pbar.close()
        print("✓ Article vector batch insertion complete.")
        
    finally:
        conn.close()

if __name__ == "__main__":
    main()
