#!/usr/bin/env python3
import os
import sys
import argparse
from dotenv import load_dotenv

# Load environment variables from .env if present
load_dotenv()

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.ingestion_service import (
    DBHelper,
    MetadataIngestor,
    RelationsIngestor,
    VectorIngestor,
    Verifier
)


def main():
    parser = argparse.ArgumentParser(description="CIVIL-LEX Data & Vector Ingestion Pipeline")
    parser.add_argument(
        "--stage",
        choices=["all", "metadata", "relations", "vectors"],
        default="all",
        help="Stage to execute: metadata (Articles & Cases), relations (Citation links), vectors (XML-RoBERTa embeddings & HNSW index), or all."
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=250,
        help="Batch size for embedding generation & vector insertion (default: 250)."
    )
    parser.add_argument(
        "--data-dir",
        type=str,
        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"),
        help="Directory containing JSONL / JSON datasets (default: ./data)."
    )
    parser.add_argument(
        "--reset-db",
        action="store_true",
        help="Drop and recreate database tables before running ingestion."
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Run row count checks and sample vector similarity search after ingestion."
    )
    parser.add_argument(
        "--db-url",
        type=str,
        default=None,
        help="PostgreSQL connection string (defaults to POSTGRES_DB_URL env var or localhost:54322)."
    )

    args = parser.parse_args()

    print("======================================================")
    print("      CIVIL-LEX Ingestion & Embedding Pipeline        ")
    print("======================================================")
    print(f"• Stage: {args.stage}")
    print(f"• Data Directory: {args.data_dir}")
    print(f"• Batch Size: {args.batch_size}")
    print(f"• Reset DB: {args.reset_db}")
    print("======================================================")

    conn = DBHelper.get_connection(args.db_url)
    try:
        if args.reset_db:
            DBHelper.reset_database(conn)
        else:
            DBHelper.init_schema(conn)

        if args.stage in ["metadata", "all"]:
            MetadataIngestor(args.data_dir).run(conn)

        if args.stage in ["relations", "all"]:
            RelationsIngestor(args.data_dir).run(conn)

        if args.stage in ["vectors", "all"]:
            VectorIngestor(args.data_dir, batch_size=args.batch_size).run(conn)

        if args.verify or args.stage == "all":
            Verifier.verify(conn, args.data_dir)

        print("\n✓ Ingestion process completed successfully!")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
