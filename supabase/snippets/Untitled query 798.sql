-- 1. Drop existing indexes tied to the old 768-dim column
DROP INDEX IF EXISTS public.vector_idx;
DROP INDEX IF EXISTS public.article_vector_idx;
DROP INDEX IF EXISTS public.doc_vector_idx;

-- 2. Alter column to 1024 dimensions using NULL
-- (USING NULL tells Postgres to clear the old incompatible 768 vectors 
-- while preserving all chunk text, IDs, and metadata)
ALTER TABLE public.document_chunks 
  ALTER COLUMN embedding TYPE vector(1024) 
  USING NULL;

-- 3. Recreate the HNSW vector indexes for the new 1024 dimension
CREATE INDEX vector_idx 
ON public.document_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX article_vector_idx 
ON public.document_chunks USING hnsw (embedding vector_cosine_ops) 
WHERE (parent_type = 'article');

CREATE INDEX doc_vector_idx 
ON public.document_chunks USING hnsw (embedding vector_cosine_ops) 
WHERE (parent_type = 'user_document');
