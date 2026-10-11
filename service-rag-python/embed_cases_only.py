#!/usr/bin/env python3
import os
import sys
import json
import time
import argparse
import torch
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
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "intfloat/multilingual-e5-base")
CHECKPOINT_FILE = ".cases_checkpoint.json"

def get_connection(db_url=None):
    url = db_url or DEFAULT_DB_URL
    return psycopg2.connect(url)

def load_checkpoint() -> int:
    if os.path.exists(CHECKPOINT_FILE):
        try:
            with open(CHECKPOINT_FILE, "r") as f:
                data = json.load(f)
                return data.get("processed_chunks", 0)
        except Exception:
            return 0
    return 0

def save_checkpoint(processed_count: int):
    with open(CHECKPOINT_FILE, "w") as f:
        json.dump({"processed_chunks": processed_count, "timestamp": time.time()}, f)

def count_file_lines(filepath: str) -> int:
    # Fast newline counter for accurate progress bar initialization
    count = 0
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            count += chunk.count(b"\n")
    return count

def main():
    parser = argparse.ArgumentParser(description="Embed jurisprudence cases using intfloat/multilingual-e5-base")
    parser.add_argument("--batch-size", type=int, default=32, help="Batch size for embedding generation (default: 32)")
    parser.add_argument("--threads", type=int, default=8, help="Number of CPU threads to use (default: 8)")
    parser.add_argument("--data-file", type=str, default=None, help="Path to jurisprudence_chunks.jsonl")
    parser.add_argument("--reset-checkpoint", action="store_true", help="Start from chunk 0 ignoring any existing checkpoint")
    args = parser.parse_args()

    torch.set_num_threads(args.threads)
    print(f"Allocated {args.threads} CPU threads for PyTorch embedding.")

    base_dir = os.path.dirname(os.path.abspath(__file__))
    cases_file = args.data_file or os.path.join(base_dir, "data", "jurisprudence_chunks.jsonl")

    if not os.path.exists(cases_file):
        print(f"File not found: {cases_file}")
        sys.exit(1)

    if args.reset_checkpoint and os.path.exists(CHECKPOINT_FILE):
        os.remove(CHECKPOINT_FILE)
        print("Checkpoint reset to 0.")

    start_offset = 0 if args.reset_checkpoint else load_checkpoint()

    print(f"Counting total lines in {cases_file}...")
    total_chunks = count_file_lines(cases_file)
    print(f"Total jurisprudence chunks: {total_chunks}")
    print(f"Resuming from offset: {start_offset}")

    if start_offset >= total_chunks and total_chunks > 0:
        print("All jurisprudence chunks have already been processed.")
        sys.exit(0)

    print("Loading embedding model...")
    model = SentenceTransformer(EMBEDDING_MODEL_NAME)

    conn = get_connection()
    try:
        query = """
            INSERT INTO document_chunks (chunk_id, parent_type, parent_id, content, legal_topics, embedding)
            VALUES %s
            ON CONFLICT (chunk_id) DO UPDATE SET
                content = EXCLUDED.content,
                embedding = EXCLUDED.embedding;
        """

        pbar = tqdm(total=total_chunks, initial=start_offset, desc="Embedding Cases")
        batch = []
        current_index = 0

        with open(cases_file, "r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue

                # Skip until reaching checkpoint offset
                if current_index < start_offset:
                    current_index += 1
                    continue

                item = json.loads(line)
                batch.append({
                    "chunk_id": item.get("chunk_id"),
                    "parent_type": "case",
                    "parent_id": item.get("case_uid"),
                    "content": item.get("text", ""),
                    "legal_topics": item.get("legal_topics", [])
                })
                current_index += 1

                if len(batch) >= args.batch_size:
                    texts = [c["content"] for c in batch]
                    is_e5 = "e5" in EMBEDDING_MODEL_NAME.lower()
                    passages = [f"passage: {t}" for t in texts] if is_e5 else texts
                    embeddings = model.encode(passages, batch_size=len(passages), show_progress_bar=False, normalize_embeddings=True)

                    records = []
                    for c_item, emb in zip(batch, embeddings):
                        records.append((
                            c_item["chunk_id"],
                            c_item["parent_type"],
                            c_item["parent_id"],
                            c_item["content"],
                            c_item["legal_topics"],
                            emb.tolist()
                        ))

                    with conn.cursor() as cur:
                        execute_values(cur, query, records, template="(%s, %s, %s, %s, %s, %s::vector)")
                        conn.commit()

                    pbar.update(len(batch))
                    save_checkpoint(current_index)
                    batch = []

            # Flush any remaining items in the last partial batch
            if batch:
                texts = [c["content"] for c in batch]
                is_e5 = "e5" in EMBEDDING_MODEL_NAME.lower()
                passages = [f"passage: {t}" for t in texts] if is_e5 else texts
                embeddings = model.encode(passages, batch_size=len(passages), show_progress_bar=False, normalize_embeddings=True)

                records = []
                for c_item, emb in zip(batch, embeddings):
                    records.append((
                        c_item["chunk_id"],
                        c_item["parent_type"],
                        c_item["parent_id"],
                        c_item["content"],
                        c_item["legal_topics"],
                        emb.tolist()
                    ))

                with conn.cursor() as cur:
                    execute_values(cur, query, records, template="(%s, %s, %s, %s, %s, %s::vector)")
                    conn.commit()

                pbar.update(len(batch))
                save_checkpoint(current_index)

        pbar.close()
        print("Jurisprudence cases embedding complete.")

    finally:
        conn.close()

if __name__ == "__main__":
    main()
