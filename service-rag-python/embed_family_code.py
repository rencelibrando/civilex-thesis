#!/usr/bin/env python3
import os
import sys
import json
import argparse
import torch
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv
from tqdm import tqdm
from sentence_transformers import SentenceTransformer

load_dotenv()

DEFAULT_DB_URL = os.getenv(
    "POSTGRES_DB_URL",
    "postgresql://postgres:postgres@localhost:54322/postgres"
)
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "intfloat/multilingual-e5-base")


def get_connection(db_url=None):
    url = db_url or DEFAULT_DB_URL
    return psycopg2.connect(url)


def main():
    parser = argparse.ArgumentParser(description="Embed Family Code articles into PostgreSQL vector database")
    parser.add_argument("--batch-size", type=int, default=32, help="Batch size for embedding generation (default: 32)")
    parser.add_argument("--threads", type=int, default=8, help="Number of CPU threads to use (default: 8)")
    parser.add_argument("--skip-embeddings", action="store_true", help="Only insert article metadata without re-embedding chunks")
    args = parser.parse_args()

    torch.set_num_threads(args.threads)
    print(f"Allocated {args.threads} CPU threads for PyTorch embedding.")

    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    family_code_file = os.path.join(data_dir, "family_code_rag.jsonl")

    if not os.path.exists(family_code_file):
        print(f"Error: dataset file not found: {family_code_file}")
        sys.exit(1)

    print(f"Reading Family Code articles from {family_code_file}...")
    articles_meta = []
    chunks_to_embed = []

    with open(family_code_file, "r", encoding="utf-8") as f:
        for line in f:
            line_str = line.strip()
            if not line_str:
                continue
            item = json.loads(line_str)
            art_id = item["article_id"]
            art_num = item["article_number"]
            hierarchy = json.dumps(item["hierarchy"])
            content = item["text_clean"] or item["text"]
            is_hub = item.get("is_hub", False)
            topics = item.get("legal_topics", [])

            articles_meta.append((art_id, art_num, hierarchy, content, is_hub))

            for idx, c in enumerate(item.get("chunks", [])):
                chunks_to_embed.append({
                    "chunk_id": c.get("chunk_id", f"{art_id}_c{idx}"),
                    "parent_type": "article",
                    "parent_id": art_id,
                    "content": c.get("text", ""),
                    "legal_topics": topics
                })

    print(f"Loaded {len(articles_meta)} articles and {len(chunks_to_embed)} chunks.")

    conn = get_connection()
    try:
        # Step 1: Insert metadata into civil_code_articles
        print("Inserting/updating metadata in civil_code_articles...")
        upsert_article_sql = """
            INSERT INTO civil_code_articles (article_id, article_number, hierarchy, content, is_hub)
            VALUES %s
            ON CONFLICT (article_id) DO UPDATE SET
                article_number = EXCLUDED.article_number,
                hierarchy = EXCLUDED.hierarchy,
                content = EXCLUDED.content,
                is_hub = EXCLUDED.is_hub;
        """
        with conn.cursor() as cur:
            execute_values(cur, upsert_article_sql, articles_meta, template="(%s, %s, %s::jsonb, %s, %s)")
            conn.commit()
        print(f"Successfully synchronized {len(articles_meta)} articles in civil_code_articles.")

        if args.skip_embeddings:
            print("Skipping vector embeddings as requested.")
            return

        # Step 2: Generate embeddings and insert into document_chunks
        print(f"Loading embedding model: {EMBEDDING_MODEL_NAME}...")
        model = SentenceTransformer(EMBEDDING_MODEL_NAME)

        total_chunks = len(chunks_to_embed)
        upsert_chunk_sql = """
            INSERT INTO document_chunks (chunk_id, parent_type, parent_id, content, legal_topics, embedding)
            VALUES %s
            ON CONFLICT (chunk_id) DO UPDATE SET
                content = EXCLUDED.content,
                legal_topics = EXCLUDED.legal_topics,
                embedding = EXCLUDED.embedding;
        """

        batch_size = args.batch_size
        pbar = tqdm(total=total_chunks, desc="Embedding Family Code Chunks")
        is_e5 = "e5" in EMBEDDING_MODEL_NAME.lower()

        for i in range(0, total_chunks, batch_size):
            batch = chunks_to_embed[i:i + batch_size]
            texts = [c["content"] for c in batch]
            passages = [f"passage: {t}" for t in texts] if is_e5 else texts
            embeddings = model.encode(passages, batch_size=len(passages), show_progress_bar=False, normalize_embeddings=True)

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
                execute_values(cur, upsert_chunk_sql, records, template="(%s, %s, %s, %s, %s, %s::vector)")
                conn.commit()

            pbar.update(len(batch))

        pbar.close()
        print(f"Successfully inserted {total_chunks} Family Code chunks into document_chunks.")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
