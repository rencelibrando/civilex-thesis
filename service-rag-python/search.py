#!/usr/bin/env python3
import os
import sys
import argparse
from dotenv import load_dotenv
import psycopg2
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
    try:
        return psycopg2.connect(url)
    except Exception as e:
        print(f"Error connecting to database: {e}")
        sys.exit(1)

def print_results(title, results):
    print(f"\n=== {title} ===")
    if not results:
        print("  No results found.")
        return
    for idx, row in enumerate(results, 1):
        chunk_id = row[0]
        parent_type = row[1]
        parent_id = row[2]
        content_preview = row[3]
        similarity = row[4]
        print(f"[{idx}] Similarity: {similarity:.4f} | ID: {parent_id} ({parent_type.upper()})")
        print(f"    Content: {content_preview}...\n")

def main():
    parser = argparse.ArgumentParser(description="CIVIL-LEX Vector Search CLI")
    parser.add_argument("--db-url", type=str, default=None, help="PostgreSQL connection string")
    parser.add_argument("--top-k", type=int, default=3, help="Number of results to retrieve per category")
    args = parser.parse_args()

    print("Loading embedding model, please wait...")
    model = SentenceTransformer(EMBEDDING_MODEL_NAME)
    
    conn = get_connection(args.db_url)
    
    print("\nCIVIL-LEX Interactive RAG Search CLI")
    print("Type 'quit', 'exit', or 'q' to stop.")
    print("-" * 50)

    try:
        with conn.cursor() as cur:
            while True:
                query = input("\nEnter your query: ").strip()
                if query.lower() in ['quit', 'exit', 'q']:
                    break
                if not query:
                    continue
                
                print(f"\nSearching for: '{query}'...")
                q_emb = model.encode(query, normalize_embeddings=True).tolist()
                
                # Fetch Top Articles
                cur.execute("""
                    SELECT chunk_id, parent_type, parent_id, left(content, 300), 1 - (embedding <=> %s::vector) AS similarity
                    FROM document_chunks
                    WHERE parent_type = 'article'
                    ORDER BY embedding <=> %s::vector
                    LIMIT %s;
                """, (q_emb, q_emb, args.top_k))
                articles = cur.fetchall()
                print_results(f"Top {args.top_k} ARTICLES", articles)
                
                # Fetch Top Cases
                cur.execute("""
                    SELECT chunk_id, parent_type, parent_id, left(content, 300), 1 - (embedding <=> %s::vector) AS similarity
                    FROM document_chunks
                    WHERE parent_type = 'case'
                    ORDER BY embedding <=> %s::vector
                    LIMIT %s;
                """, (q_emb, q_emb, args.top_k))
                cases = cur.fetchall()
                print_results(f"Top {args.top_k} JURISPRUDENCE CASES", cases)
                
    except KeyboardInterrupt:
        print("\nExiting...")
    finally:
        conn.close()

if __name__ == "__main__":
    main()
