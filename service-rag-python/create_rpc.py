import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DEFAULT_DB_URL = os.getenv(
    "POSTGRES_DB_URL",
    "postgresql://postgres:postgres@localhost:54322/postgres"
)

def create_hybrid_search_rpc():
    conn = psycopg2.connect(DEFAULT_DB_URL)
    conn.autocommit = True
    
    sql = """
    DROP FUNCTION IF EXISTS match_documents;
    
    CREATE OR REPLACE FUNCTION match_documents(
      query_embedding vector(768),
      query_text text,
      match_count int DEFAULT 10,
      full_text_weight float DEFAULT 1,
      semantic_weight float DEFAULT 1,
      rrf_k int DEFAULT 50
    )
    RETURNS TABLE (
      chunk_id text,
      parent_type text,
      parent_id text,
      content text,
      similarity float
    )
    LANGUAGE sql
    AS $$
    WITH fts AS (
      SELECT
        chunk_id,
        row_number() OVER (ORDER BY ts_rank(to_tsvector('english', content), websearch_to_tsquery('english', query_text)) DESC) AS rank_ix
      FROM
        document_chunks
      WHERE
        to_tsvector('english', content) @@ websearch_to_tsquery('english', query_text)
      ORDER BY rank_ix
      LIMIT 100
    ),
    semantic AS (
      SELECT
        chunk_id,
        row_number() OVER (ORDER BY embedding <=> query_embedding) AS rank_ix
      FROM
        document_chunks
      ORDER BY rank_ix
      LIMIT 100
    )
    SELECT
      document_chunks.chunk_id,
      document_chunks.parent_type,
      document_chunks.parent_id,
      document_chunks.content,
      (COALESCE(1.0 / (rrf_k + fts.rank_ix), 0.0) * full_text_weight +
       COALESCE(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight) AS similarity
    FROM
      document_chunks
    FULL OUTER JOIN fts ON fts.chunk_id = document_chunks.chunk_id
    FULL OUTER JOIN semantic ON semantic.chunk_id = document_chunks.chunk_id
    WHERE fts.chunk_id IS NOT NULL OR semantic.chunk_id IS NOT NULL
    ORDER BY similarity DESC
    LIMIT match_count;
    $$;
    """
    
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
            print("Successfully created match_documents RPC!")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    create_hybrid_search_rpc()
