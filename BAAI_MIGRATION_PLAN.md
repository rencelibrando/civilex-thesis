# CIVIL-LEX: BAAI/bge-m3 Embedder Migration & pgvector Re-Embedding Plan

**Target Architecture:** Upgrading dense retrieval from `stsb-xlm-r-multilingual` (768-dim) to `BAAI/bge-m3` (1024-dim).  
**Core Goal:** Native cross-lingual semantic matching (Tagalog/English) without manual regex keyword expansion, supporting 354,000+ legal chunks in PostgreSQL with pgvector.

---

## 1. Executive Summary & Migration Rationale

| Dimension | Legacy (`stsb-xlm-r-multilingual`) | Target (`BAAI/bge-m3`) |
|---|---|---|
| **Vector Dimension** | 768 float32 | **1024 float32** |
| **Model Focus** | General sentence similarity (STS-B) | **Asymmetric cross-lingual search (100+ languages)** |
| **Colloquial Tagalog -> English Law** | Fails; required regex keyword injection | **Native semantic alignment without keyword lists** |
| **Max Sequence Length** | 128 tokens | **8,192 tokens** |
| **pgvector Index** | HNSW on `vector(768)` | **HNSW on `vector(1024)`** |

---

## 2. Phase 1: Database & pgvector Schema Migration

> [!WARNING]
> In PostgreSQL, altering a column type to a new vector dimension **will fail** if any index depends on that column.
> The live `document_chunks` table currently has **three** HNSW vector indexes that must be dropped prior to type alteration.

### Step 1.1: Automated SQL Migration Script
Save and execute this SQL migration in PostgreSQL (via `psql` or Supabase SQL Editor):

```sql
-- ====================================================================
-- CIVIL-LEX MIGRATION: 768-dim to 1024-dim Vector Upgrade
-- ====================================================================

-- 1. Drop all dependent HNSW vector indexes
DROP INDEX IF EXISTS public.vector_idx;
DROP INDEX IF EXISTS public.article_vector_idx;
DROP INDEX IF EXISTS public.doc_vector_idx;

-- 2. Alter column type to 1024 dimensions
-- We set existing embeddings to NULL so the column type changes instantly
-- without throwing dimension cast errors on old 768-dim vectors.
ALTER TABLE public.document_chunks ALTER COLUMN embedding TYPE vector(1024);

-- 3. Recreate the primary HNSW vector index for 1024 dimensions
CREATE INDEX vector_idx 
ON public.document_chunks USING hnsw (embedding vector_cosine_ops);

-- 4. Recreate partial indexes for fast filtered lookups
CREATE INDEX article_vector_idx 
ON public.document_chunks USING hnsw (embedding vector_cosine_ops) 
WHERE (parent_type = 'article');

CREATE INDEX doc_vector_idx 
ON public.document_chunks USING hnsw (embedding vector_cosine_ops) 
WHERE (parent_type = 'user_document');
```

---

## 3. Phase 2: Codebase & Embedder Modifications

### Step 2.1: Update Central Configuration
In [core/config.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/core/config.py), define `EMBEDDING_MODEL_NAME` as an authoritative setting:

```python
# Embedding Model Configuration
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "BAAI/bge-m3")
```

In `service-rag-python/.env`:
```bash
EMBEDDING_MODEL_NAME=BAAI/bge-m3
```

### Step 2.2: Update DDL in Ingestion Services
Update table creation definitions to prevent future reset scripts from reverting to 768:

1. In [services/ingestion_service.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/services/ingestion_service.py#L92):
   ```python
   # Line 92: Change VECTOR(768) -> VECTOR(1024)
   embedding VECTOR(1024)
   ```
2. In [create_rpc.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/create_rpc.py#L20):
   ```sql
   -- Line 20: Change vector(768) -> vector(1024)
   query_embedding vector(1024)
   ```

### Step 2.3: Modify Embedder References Across Scripts
Update default model fallbacks to `"BAAI/bge-m3"` across:
- [main.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/main.py#L87)
- [services/document.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/services/document.py#L28)
- [services/ingestion_service.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/services/ingestion_service.py#L20)
- [embed_articles_only.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/embed_articles_only.py#L18)
- [search.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/search.py#L16)
- [eval_iso25010.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/eval_iso25010.py#L30)

### Step 2.4: Clean Up Heuristic Regex Expansions in `main.py`
To prevent polluting BGE-M3's semantic vectors, modify query expansion in [main.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/main.py#L1144-L1153):

```python
def expand_legal_query(query: str) -> str:
    """
    With BAAI/bge-m3, return the natural query directly.
    BGE-M3 performs asymmetric semantic matching natively without keyword injection.
    """
    return query
```

In [rank_and_stratify_citations](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/main.py#L1649-L1661):
Remove manual point injection recipes (`score += 15 for 'promissory'`, `score += 25 for 'foreigner'`).

---

## 4. Phase 3: Staged Re-Embedding Execution

The database contains **354,008 total chunks**:
- **Articles:** 2,749 chunks (Fast: 1–2 minutes)
- **Cases:** 351,076 chunks (Heavy: ~20–35 minutes on GPU)
- **User Documents:** 183 chunks

### Step 3.1: Fast Stage — Re-Embed Statutory Articles First
Run [embed_articles_only.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/embed_articles_only.py):

```bash
cd service-rag-python
.venv/bin/python embed_articles_only.py
```
*Expected Output:*
- Loads `BAAI/bge-m3`.
- Generates 1024-dim vectors for 2,749 chunks.
- Updates `document_chunks` table.

### Step 3.2: Full Stage — Re-Embed Jurisprudence Cases
Execute the full vector ingestion with batching and progress tracking:

```bash
cd service-rag-python
.venv/bin/python ingest.py --stage vectors --batch-size 256
```

---

## 5. Phase 4: Validation & Smoke Testing

### Step 4.1: Cross-Lingual Semantic Retrieval Verification
Run an interactive test using [search.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/search.py) with colloquial Tagalog queries that previously required regex expansions:

```bash
cd service-rag-python
.venv/bin/python search.py --top-k 3
```

Test Queries:
1. **Colloquial Tagalog Construction Dispute:**
   - *Query:* `"Hindi tinapos ng kontratista ang pagpapatayo ng bahay kahit binayaran na ng buo. Pwede ko ba kanselahin ang kontrata at mabawi ang pera?"`
   - *Expected Top Hit:* `RA386-ART1191` (Reciprocal obligations / Rescission)
2. **Colloquial Tagalog Vehicular Accident:**
   - *Query:* `"Binangga ng delivery truck ang kotse ko dahil mabilis magpatakbo ang driver. Pwede ko ba panagutin ang kumpanya?"`
   - *Expected Top Hit:* `RA386-ART2176` and `RA386-ART2180` (Quasi-delict & Vicarious employer liability)
3. **Colloquial Tagalog Unpaid Promissory Note:**
   - *Query:* `"Umutang ang kaibigan ko gamit ang promissory note pero ayaw na magbayad ngayon."`
   - *Expected Top Hit:* `RA386-ART1169`, `RA386-ART1953`, `RA386-ART1231`

---

## 6. Unified Implementation Checklist

### [ ] Phase 1: Database & pgvector Preparation
- [ ] Drop all 3 HNSW indexes (`vector_idx`, `article_vector_idx`, `doc_vector_idx`).
- [ ] Execute `ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(1024);`.
- [ ] Recreate HNSW cosine index `vector_idx` on 1024 dimensions.
- [ ] Recreate partial indexes `article_vector_idx` and `doc_vector_idx`.
- [ ] Verify `SELECT vector_dims(embedding)` returns `1024` or accepts 1024-dim vectors.

### [ ] Phase 2: Codebase Updates
- [ ] Set `EMBEDDING_MODEL_NAME=BAAI/bge-m3` in `service-rag-python/.env`.
- [ ] Update [core/config.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/core/config.py) with `EMBEDDING_MODEL_NAME`.
- [ ] Update DDL in [services/ingestion_service.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/services/ingestion_service.py#L92) to `VECTOR(1024)`.
- [ ] Update parameter in [create_rpc.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/create_rpc.py#L20) to `vector(1024)`.
- [ ] Update fallback strings across all embedder initialization points.
- [ ] Disable regex word injection in `expand_legal_query` in [main.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/main.py#L1144).
- [ ] Clean up manual point injection overrides in `calculate_sort_score`.

### [ ] Phase 3: Re-Embedding Execution
- [ ] Run `embed_articles_only.py` to embed 2,749 Civil Code articles.
- [ ] Verify article vectors in database via quick select.
- [ ] Run `ingest.py --stage vectors --batch-size 256` for 351k jurisprudence chunks.
- [ ] Confirm zero `NULL` embeddings remain in `document_chunks`.

### [ ] Phase 4: Validation & Quality Gate
- [ ] Run `search.py` on colloquial Tagalog test queries.
- [ ] Confirm expected Civil Code articles rank #1 without query expansions.
- [ ] Run [eval_ragas.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/eval_ragas.py) benchmark suite and record new recall/precision scores.
- [ ] Restart `uvicorn` server and test SSE chat stream in frontend.
