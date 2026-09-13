import os
import json
import time
import psycopg2
from psycopg2.extras import execute_values, Json
from typing import List, Dict, Any, Optional
from tqdm import tqdm

try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    SentenceTransformer = None


DEFAULT_DB_URL = os.getenv(
    "POSTGRES_DB_URL",
    "postgresql://postgres:postgres@localhost:54322/postgres"
)
CHECKPOINT_FILE = ".ingest_checkpoint.json"
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "sentence-transformers/stsb-xlm-r-multilingual")


class DBHelper:
    @staticmethod
    def get_connection(db_url: Optional[str] = None):
        url = db_url or DEFAULT_DB_URL
        return psycopg2.connect(url)

    @staticmethod
    def init_schema(conn):
        with conn.cursor() as cur:
            # Enable vector extension
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            cur.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

            # 1. civil_code_articles
            cur.execute("""
                CREATE TABLE IF NOT EXISTS civil_code_articles (
                    article_id TEXT PRIMARY KEY,
                    article_number INT,
                    hierarchy JSONB,
                    content TEXT,
                    is_hub BOOLEAN DEFAULT FALSE
                );
            """)

            # 2. jurisprudence_cases
            cur.execute("""
                CREATE TABLE IF NOT EXISTS jurisprudence_cases (
                    case_uid TEXT PRIMARY KEY,
                    title TEXT,
                    gr_number TEXT,
                    decision_date TEXT,
                    source_url TEXT,
                    content_summary TEXT,
                    full_text TEXT
                );
            """)

            # 3. article_jurisprudence_relations
            cur.execute("""
                CREATE TABLE IF NOT EXISTS article_jurisprudence_relations (
                    article_id TEXT REFERENCES civil_code_articles(article_id) ON DELETE CASCADE,
                    case_uid TEXT REFERENCES jurisprudence_cases(case_uid) ON DELETE CASCADE,
                    citation_type TEXT DEFAULT 'mentioned',
                    PRIMARY KEY (article_id, case_uid)
                );
            """)

            # 4. user_documents
            cur.execute("""
                CREATE TABLE IF NOT EXISTS user_documents (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    user_id UUID REFERENCES auth.users(id),
                    filename TEXT,
                    file_url TEXT,
                    status TEXT CHECK (status IN ('uploading', 'extracting', 'completed', 'rejected_unrelated')),
                    progress INT DEFAULT 0,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)

            # 5. document_chunks
            cur.execute("""
                CREATE TABLE IF NOT EXISTS document_chunks (
                    chunk_id TEXT PRIMARY KEY,
                    parent_type TEXT CHECK (parent_type IN ('article', 'case', 'user_document')),
                    parent_id TEXT,
                    content TEXT,
                    legal_topics TEXT[],
                    embedding VECTOR(768)
                );
            """)

            # 6. chat_sessions
            cur.execute("""
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    user_id UUID REFERENCES auth.users(id),
                    title TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)

            # 7. chat_messages
            cur.execute("""
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
                    role TEXT CHECK (role IN ('user', 'assistant')),
                    content TEXT,
                    citations JSONB,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)
            conn.commit()

    @staticmethod
    def create_indexes(conn):
        print("Creating post-ingestion indexes (HNSW vector index & Full-Text Search index)...")
        with conn.cursor() as cur:
            cur.execute("""
                CREATE INDEX IF NOT EXISTS vector_idx 
                ON document_chunks USING hnsw (embedding vector_cosine_ops);
            """)
            cur.execute("""
                ALTER TABLE document_chunks 
                ADD COLUMN IF NOT EXISTS fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS fts_idx 
                ON document_chunks USING GIN (fts);
            """)
            conn.commit()
        print("✓ Post-ingestion indexes created successfully.")

    @staticmethod
    def reset_database(conn):
        print("Resetting existing database tables...")
        with conn.cursor() as cur:
            cur.execute("DROP TABLE IF EXISTS chat_messages CASCADE;")
            cur.execute("DROP TABLE IF EXISTS chat_sessions CASCADE;")
            cur.execute("DROP TABLE IF EXISTS document_chunks CASCADE;")
            cur.execute("DROP TABLE IF EXISTS article_jurisprudence_relations CASCADE;")
            cur.execute("DROP TABLE IF EXISTS jurisprudence_cases CASCADE;")
            cur.execute("DROP TABLE IF EXISTS civil_code_articles CASCADE;")
            cur.execute("DROP TABLE IF EXISTS user_documents CASCADE;")
            conn.commit()
        DBHelper.init_schema(conn)
        print("✓ Database schema reset complete.")


class MetadataIngestor:
    def __init__(self, data_dir: str):
        self.data_dir = data_dir

    def run(self, conn):
        print("\n--- STAGE 1: Relational Metadata Ingestion ---")
        self._ingest_articles(conn)
        self._ingest_jurisprudence_cases(conn)

    def _ingest_articles(self, conn):
        articles_file = os.path.join(self.data_dir, "civil_code_rag.jsonl")
        if not os.path.exists(articles_file):
            print(f"Skipping articles: file {articles_file} not found.")
            return

        print(f"Ingesting civil code articles from {articles_file}...")
        records = []
        with open(articles_file, "r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                item = json.loads(line)
                art_id = item.get("article_id")
                art_num = item.get("article_number")
                hierarchy = json.dumps(item.get("hierarchy", {}))
                content = item.get("text_clean") or item.get("text") or ""
                is_hub = item.get("is_hub", False)
                records.append((art_id, art_num, hierarchy, content, is_hub))

        query = """
            INSERT INTO civil_code_articles (article_id, article_number, hierarchy, content, is_hub)
            VALUES %s
            ON CONFLICT (article_id) DO UPDATE SET
                article_number = EXCLUDED.article_number,
                hierarchy = EXCLUDED.hierarchy,
                content = EXCLUDED.content,
                is_hub = EXCLUDED.is_hub;
        """
        with conn.cursor() as cur:
            execute_values(cur, query, records, template="(%s, %s, %s::jsonb, %s, %s)")
            conn.commit()
        print(f"✓ Inserted/Updated {len(records)} Civil Code Articles.")

    def _ingest_jurisprudence_cases(self, conn):
        doc_file = os.path.join(self.data_dir, "jurisprudence_document.jsonl")
        if not os.path.exists(doc_file):
            print(f"Skipping cases: file {doc_file} not found.")
            return

        print(f"Ingesting jurisprudence cases from {doc_file}...")
        records = []
        
        with open(doc_file, "r", encoding="utf-8") as f:
            for line in tqdm(f, desc="Reading jurisprudence documents"):
                if not line.strip():
                    continue
                item = json.loads(line)
                case_uid = item.get("case_uid")
                if not case_uid:
                    continue

                title = item.get("case_id", "Jurisprudence Case")
                gr_number = item.get("gr_number", "N/A")
                decision_date = str(item.get("decision_date", item.get("year", "N/A")))
                source_url = item.get("url", "")
                content_summary = item.get("content_summary", "")
                full_text = item.get("content", "")

                records.append((
                    case_uid,
                    title,
                    gr_number,
                    decision_date,
                    source_url,
                    content_summary,
                    full_text
                ))

        print(f"Bulk inserting {len(records)} jurisprudence cases...")
        query = """
            INSERT INTO jurisprudence_cases (case_uid, title, gr_number, decision_date, source_url, content_summary, full_text)
            VALUES %s
            ON CONFLICT (case_uid) DO UPDATE SET
                title = EXCLUDED.title,
                gr_number = EXCLUDED.gr_number,
                decision_date = EXCLUDED.decision_date,
                source_url = EXCLUDED.source_url,
                content_summary = EXCLUDED.content_summary,
                full_text = EXCLUDED.full_text;
        """
        with conn.cursor() as cur:
            execute_values(cur, query, records, page_size=1000)
            conn.commit()
        print(f"✓ Inserted/Updated {len(records)} Jurisprudence Cases.")


class RelationsIngestor:
    def __init__(self, data_dir: str):
        self.data_dir = data_dir

    def run(self, conn):
        print("\n--- STAGE 2: Citation Relations Ingestion ---")
        index_file = os.path.join(self.data_dir, "article_case_index.json")
        if not os.path.exists(index_file):
            print(f"Skipping relations: file {index_file} not found.")
            return

        print(f"Reading article-case citation index from {index_file}...")
        with open(index_file, "r", encoding="utf-8") as f:
            index_data = json.load(f)

        records = []
        for art_id, info in index_data.items():
            top_cases = info.get("top_cases", [])
            seen_cases = set()
            for case_uid in top_cases:
                if case_uid and case_uid not in seen_cases:
                    seen_cases.add(case_uid)
                    records.append((art_id, case_uid, "cited"))

        print(f"Bulk inserting {len(records)} citation linkages...")
        query = """
            INSERT INTO article_jurisprudence_relations (article_id, case_uid, citation_type)
            VALUES %s
            ON CONFLICT (article_id, case_uid) DO NOTHING;
        """
        with conn.cursor() as cur:
            execute_values(cur, query, records, page_size=2000)
            conn.commit()
        print(f"✓ Inserted {len(records)} Article-Case Relations.")


class VectorIngestor:
    def __init__(self, data_dir: str, batch_size: int = 250):
        self.data_dir = data_dir
        self.batch_size = batch_size
        self.model = None

    def _load_model(self):
        if self.model is None:
            if SentenceTransformer is None:
                raise RuntimeError("sentence-transformers library is required for vector generation.")
            print(f"Loading embedding model ({EMBEDDING_MODEL_NAME})...")
            self.model = SentenceTransformer(EMBEDDING_MODEL_NAME)
            print("✓ Model loaded successfully.")

    def _load_checkpoint(self) -> int:
        if os.path.exists(CHECKPOINT_FILE):
            try:
                with open(CHECKPOINT_FILE, "r") as f:
                    data = json.load(f)
                    return data.get("processed_chunks", 0)
            except Exception:
                return 0
        return 0

    def _save_checkpoint(self, processed_count: int):
        with open(CHECKPOINT_FILE, "w") as f:
            json.dump({"processed_chunks": processed_count, "timestamp": time.time()}, f)

    def run(self, conn):
        print("\n--- STAGE 3: Embedding Generation & pgvector Insertion ---")
        self._load_model()

        # Collect all raw text chunks from articles and jurisprudence
        all_chunks: List[Dict[str, Any]] = []

        # 1. Articles chunks
        articles_file = os.path.join(self.data_dir, "civil_code_rag.jsonl")
        if os.path.exists(articles_file):
            print(f"Loading article text chunks from {articles_file}...")
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

        # 2. Jurisprudence chunks
        cases_file = os.path.join(self.data_dir, "jurisprudence_chunks.jsonl")
        if os.path.exists(cases_file):
            print(f"Loading jurisprudence text chunks from {cases_file}...")
            with open(cases_file, "r", encoding="utf-8") as f:
                for line in f:
                    if not line.strip():
                        continue
                    chunk = json.loads(line)
                    all_chunks.append({
                        "chunk_id": chunk.get("chunk_id"),
                        "parent_type": "case",
                        "parent_id": chunk.get("case_uid"),
                        "content": chunk.get("text", ""),
                        "legal_topics": chunk.get("legal_topics", [])
                    })

        total_chunks = len(all_chunks)
        start_offset = self._load_checkpoint()
        print(f"Total chunks found: {total_chunks}. Resuming from checkpoint offset: {start_offset}.")

        if start_offset >= total_chunks and total_chunks > 0:
            print("✓ All chunks have already been processed according to checkpoint.")
            DBHelper.create_indexes(conn)
            return

        query = """
            INSERT INTO document_chunks (chunk_id, parent_type, parent_id, content, legal_topics, embedding)
            VALUES %s
            ON CONFLICT (chunk_id) DO UPDATE SET
                content = EXCLUDED.content,
                embedding = EXCLUDED.embedding;
        """

        pbar = tqdm(total=total_chunks, initial=start_offset, desc="Embedding & Inserting Chunks")
        
        for i in range(start_offset, total_chunks, self.batch_size):
            batch = all_chunks[i:i + self.batch_size]
            texts = [c["content"] for c in batch]
            
            # Generate vectors
            embeddings = self.model.encode(texts, batch_size=len(texts), show_progress_bar=False, normalize_embeddings=True)
            
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

            processed = i + len(batch)
            self._save_checkpoint(processed)
            pbar.update(len(batch))

        pbar.close()
        print("✓ Vector batch insertion complete.")

        # Build HNSW index post insertion
        DBHelper.create_indexes(conn)


class Verifier:
    @staticmethod
    def verify(conn, data_dir: str):
        print("\n--- INGESTION VERIFICATION ---")
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM civil_code_articles;")
            art_count = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM jurisprudence_cases;")
            case_count = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM article_jurisprudence_relations;")
            rel_count = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM document_chunks;")
            vector_count = cur.fetchone()[0]

            print(f"• civil_code_articles count: {art_count}")
            print(f"• jurisprudence_cases count: {case_count}")
            print(f"• article_jurisprudence_relations count: {rel_count}")
            print(f"• document_chunks vector count: {vector_count}")

            # Verify similarity search if vectors exist
            if vector_count > 0:
                print("\nTesting sample vector similarity search query...")
                if SentenceTransformer is not None:
                    model = SentenceTransformer(EMBEDDING_MODEL_NAME)
                    sample_query = "What are the requisites of marriage under Philippine Civil Code?"
                    q_emb = model.encode(sample_query, normalize_embeddings=True).tolist()
                    
                    cur.execute("""
                        SELECT chunk_id, parent_type, parent_id, left(content, 120), 1 - (embedding <=> %s::vector) AS similarity
                        FROM document_chunks
                        ORDER BY embedding <=> %s::vector
                        LIMIT 3;
                    """, (q_emb, q_emb))
                    results = cur.fetchall()
                    print(f"Query: '{sample_query}'")
                    print("Top 3 retrieved vector matches:")
                    for idx, row in enumerate(results, 1):
                        print(f"  {idx}. [{row[1].upper()} {row[2]}] Similarity: {row[4]:.4f} | Content: {row[3]}...")
            print("\n✓ Verification Complete.")
