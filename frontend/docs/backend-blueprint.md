# Civilex — Architectural Data & API Blueprint

## Repository Folder Mapping

| Blueprint Label | Actual Repo Folder | Runtime / Framework |
|---|---|---|
| `express/` | `backend-node/` | Node.js + Express 5 (ESM) + TypeScript |
| `fastapi/` | `service-rag-python/` | Python + FastAPI (Uvicorn) |
| `frontend/` | `frontend/` | Next.js (App Router) + TypeScript |

---

## Cross-Service Data Flow (Overview)

1. Browser → Next.js (`frontend`) renders UI from typed interfaces.
2. Auth, sessions, chat history, document metadata, and statute lookups → `backend-node` (Express) → PostgreSQL/Supabase.
3. Document upload → Express records metadata → forwards file to `service-rag-python` (FastAPI) → chunk → embed (XLM-RoBERTa) → FAISS + BM25 index.
4. Chat query → Express validates/saves user message → calls FastAPI `/retrieval/search` (hybrid) → FastAPI calls Express `/statutes` for metadata cross-ref → FastAPI calls LM Studio → SSE streams back through FastAPI → Next.js `EventSource`.
5. Assistant message + retrieved sources → persisted by Express to Postgres.

---

# TASK 1 — Authentication, User Sessions & History (Express.js)

## 1.1 Target File Tree Mapping

| File Path | Responsibility |
|---|---|
| `backend-node/src/index.ts` | Process bootstrap, env load, graceful shutdown |
| `backend-node/src/app.ts` | Express app wiring, CORS, routes, error handler |
| `backend-node/src/config/env.ts` | Typed env vars (JWT secrets, Supabase keys, FastAPI URL, LM Studio URL) |
| `backend-node/src/config/db.ts` | Supabase/Postgres client singleton |
| `backend-node/src/config/fastapi.ts` | FastAPI base URL client config |
| `backend-node/src/middleware/auth.middleware.ts` | JWT verification, attach `req.user` |
| `backend-node/src/middleware/error.middleware.ts` | Central error → JSON envelope |
| `backend-node/src/middleware/validate.middleware.ts` | Zod schema validation adapter |
| `backend-node/src/routes/auth.routes.ts` | `/api/v1/auth/*` |
| `backend-node/src/routes/session.routes.ts` | `/api/v1/sessions/*` |
| `backend-node/src/routes/document.routes.ts` | `/api/v1/documents/*` |
| `backend-node/src/routes/statute.routes.ts` | `/api/v1/statutes/*` |
| `backend-node/src/controllers/auth.controller.ts` | Auth handlers |
| `backend-node/src/controllers/session.controller.ts` | Session/message handlers |
| `backend-node/src/controllers/document.controller.ts` | Document metadata handlers |
| `backend-node/src/controllers/statute.controller.ts` | Statute lookup handlers |
| `backend-node/src/services/auth.service.ts` | Register/login/refresh business logic |
| `backend-node/src/services/session.service.ts` | Session & message persistence |
| `backend-node/src/services/document.service.ts` | Document metadata + FastAPI orchestration |
| `backend-node/src/services/statute.service.ts` | Statute query logic |
| `backend-node/src/services/token.service.ts` | Access/refresh token issuance + rotation |
| `backend-node/src/schemas/auth.schema.ts` | Zod: register/login/refresh |
| `backend-node/src/schemas/session.schema.ts` | Zod: session create/rename/message |
| `backend-node/src/schemas/document.schema.ts` | Zod: document metadata |
| `backend-node/src/schemas/statute.schema.ts` | Zod: statute query filters |
| `backend-node/src/types/index.ts` | Shared TS interfaces (mirror frontend) |
| `backend-node/src/utils/jwt.util.ts` | Sign/verify JWT |
| `backend-node/src/utils/hash.util.ts` | Argon2id hash/verify |
| `backend-node/src/utils/http.util.ts` | Axios wrapper to FastAPI/LM Studio |

## 1.2 Frontend-to-Backend Data Contract (TS Interfaces)

| Interface | Property | Type | Notes |
|---|---|---|---|
| `UserProfile` | `id` | `string` (UUID) | Matches existing frontend `UserProfile.id` |
| `UserProfile` | `name` | `string` | Frontend `name` (from `full_name`) |
| `UserProfile` | `email` | `string` | |
| `UserProfile` | `initials` | `string` | Derived client-side |
| `RegisterRequest` | `fullName` | `string` | |
| `RegisterRequest` | `email` | `string` | |
| `RegisterRequest` | `password` | `string` | |
| `LoginRequest` | `email` | `string` | |
| `LoginRequest` | `password` | `string` | |
| `AuthResponse` | `user` | `UserProfile` | |
| `AuthResponse` | `accessToken` | `string` | JWT, short-lived |
| `AuthResponse` | `refreshToken` | `string` | JWT, long-lived (httpOnly cookie) |
| `ChatRole` | — | `"user" \| "assistant"` | Matches frontend |
| `CaseSummary` | `id` | `string` (UUID) | = session id |
| `CaseSummary` | `title` | `string` | |
| `CaseSummary` | `referenceId` | `string` | Human-readable ref (e.g. `CS-0001`) |
| `CaseSummary` | `lastActive` | `string` (ISO 8601) | |
| `CaseSummary` | `tags` | `string[]` | |
| `ChatMessage` | `id` | `string` (UUID) | |
| `ChatMessage` | `role` | `ChatRole` | |
| `ChatMessage` | `text` | `string` | |
| `ChatMessage` | `reasoning` | `string \| null` | |
| `ChatMessage` | `suggestions` | `string[] \| undefined` | |
| `ChatMessage` | `citation` | `Citation \| null` | |
| `ChatMessage` | `timestamp` | `string \| undefined` (ISO) | |
| `ChatMessage` | `retriever` | `RetrieverState \| null` | |
| `Citation` | `heading` | `string` | |
| `Citation` | `body` | `string` | |
| `SourceCategory` | — | `"statutory" \| "jurisprudence"` | |
| `RetrievedSource` | `id` | `string` | chunk/document id |
| `RetrievedSource` | `title` | `string` | |
| `RetrievedSource` | `category` | `SourceCategory` | |
| `RetrievedSource` | `chunk` | `string` | |
| `RetrievedSource` | `score` | `number` | 0–1 |
| `RetrievedSource` | `highlight` | `string \| undefined` | |
| `RetrieverState` | `method` | `string` | e.g. `"BM25 + XLM-RoBERTa"` |
| `RetrieverState` | `index` | `string` | e.g. `"FAISS Index (N Chunks)"` |
| `RetrieverState` | `sources` | `RetrievedSource[]` | |

## 1.3 Database Schema (Data Dictionary)

**Table: `users`**

| Field | Data Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK, DEFAULT gen_random_uuid() |
| `email` | `VARCHAR(320)` | UNIQUE, NOT NULL, CITEXT |
| `password_hash` | `VARCHAR(255)` | NOT NULL (Argon2id) |
| `full_name` | `VARCHAR(120)` | NOT NULL |
| `role` | `VARCHAR(20)` | NOT NULL, DEFAULT `'user'` |
| `is_active` | `BOOLEAN` | NOT NULL, DEFAULT true |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() |

**Table: `refresh_tokens`**

| Field | Data Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `user_id` | `UUID` | FK → `users.id`, ON DELETE CASCADE, INDEX |
| `token_hash` | `VARCHAR(255)` | UNIQUE, NOT NULL (SHA-256 of token) |
| `expires_at` | `TIMESTAMPTZ` | NOT NULL |
| `revoked` | `BOOLEAN` | NOT NULL, DEFAULT false |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() |

**Table: `sessions`** (chat sessions = "cases" in frontend)

| Field | Data Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `user_id` | `UUID` | FK → `users.id`, INDEX |
| `reference_id` | `VARCHAR(32)` | UNIQUE, NOT NULL (e.g. `CS-0001`) |
| `title` | `VARCHAR(255)` | NOT NULL |
| `tags` | `JSONB` | DEFAULT `[]` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() |
| `last_active_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now(), INDEX |

**Table: `messages`**

| Field | Data Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `session_id` | `UUID` | FK → `sessions.id`, ON DELETE CASCADE, INDEX |
| `role` | `VARCHAR(16)` | NOT NULL (`user` / `assistant`) |
| `content` | `TEXT` | NOT NULL |
| `reasoning` | `TEXT` | NULL |
| `citation` | `JSONB` | NULL (`{ heading, body }`) |
| `retriever` | `JSONB` | NULL (`{ method, index, sources[] }`) |
| `suggestions` | `JSONB` | NULL (`string[]`) |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now(), INDEX |

**Table: `documents`** (document metadata — owned by Express)

| Field | Data Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `user_id` | `UUID` | FK → `users.id`, INDEX |
| `filename` | `VARCHAR(512)` | NOT NULL |
| `storage_path` | `VARCHAR(1024)` | NOT NULL (Supabase Storage key) |
| `mime_type` | `VARCHAR(100)` | NOT NULL (application/pdf) |
| `size_bytes` | `BIGINT` | NOT NULL |
| `status` | `VARCHAR(30)` | NOT NULL, DEFAULT `'uploaded'` (`uploaded`/`processing`/`indexed`/`failed`) |
| `chunk_count` | `INT` | DEFAULT 0 |
| `embedding_model` | `VARCHAR(100)` | NULL (`xlm-roberta-base`) |
| `faiss_index_id` | `VARCHAR(255)` | NULL |
| `bm25_index_id` | `VARCHAR(255)` | NULL |
| `metadata` | `JSONB` | NULL |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() |

**Table: `statutes`** (Civil Code + jurisprudence — owned by Express)

| Field | Data Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `category` | `VARCHAR(30)` | NOT NULL (`statutory` / `jurisprudence`), INDEX |
| `code` | `VARCHAR(50)` | NULL (`Civil Code` / `RPC` / `Family Code`) |
| `book_id` | `VARCHAR(20)` | NULL (Book number) |
| `title_id` | `VARCHAR(20)` | NULL |
| `chapter_id` | `VARCHAR(20)` | NULL |
| `article_number` | `VARCHAR(20)` | NULL (for statutory; `Art. 1159`) |
| `gr_number` | `VARCHAR(40)` | NULL (for jurisprudence; `G.R. No. 189871`) |
| `case_name` | `VARCHAR(255)` | NULL |
| `year` | `SMALLINT` | NULL |
| `heading` | `TEXT` | NULL |
| `body` | `TEXT` | NOT NULL |
| `breadcrumb` | `JSONB` | NULL (`string[]`) |
| `cross_references` | `JSONB` | NULL (`string[]`) |
| `annotations_count` | `INT` | DEFAULT 0 |
| `search_vector` | `TSVECTOR` | GENERATED, GIN INDEX |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() |

## 1.4 Backend Validation (Zod)

| Field | Constraint | Data Type |
|---|---|---|
| `fullName` | 1–120 chars, trimmed | `string` |
| `email` | valid email, ≤ 320 chars, lowercased | `string` |
| `password` | 8–128 chars, ≥ 1 upper + ≥ 1 lower + ≥ 1 digit | `string` |
| `refreshToken` | JWT string, ≤ 2048 chars | `string` |
| `sessionId` | UUID v4 | `string` (UUID) |
| `title` | 1–255 chars, trimmed | `string` |
| `tags` | array of ≤ 20 items, each 1–50 chars | `string[]` |
| `role` | enum `user` / `assistant` | `enum` |
| `content` | 1–100,000 chars | `string` |
| `reasoning` | nullable, ≤ 50,000 chars | `string \| null` |
| `citation` | object `{ heading, body }` both strings | `object` |
| `retriever` | object `{ method, index, sources[] }` | `object` |
| `category` | enum `statutory` / `jurisprudence` | `enum` |
| `articleNumber` | pattern `^Art\.\s*\d+[A-Za-z]?$` | `string` |
| `grNumber` | pattern `^G\.R\.\s*No\.\s*\d+$` | `string` |
| `page` / `limit` | int ≥ 1 / 1–100 | `number` |

## 1.5 API Endpoints

**`POST /api/v1/auth/register`**

| Aspect | Spec |
|---|---|
| Headers | `Content-Type: application/json` |
| Body | `fullName: string`, `email: string`, `password: string` |
| Response `201` | `{ user: UserProfile, accessToken: string, refreshToken: string }` |
| Response `400` | `{ error: { code: "VALIDATION_ERROR", message: string, fields?: object } }` |
| Response `409` | `{ error: { code: "EMAIL_EXISTS", message: string } }` |
| Response `500` | `{ error: { code: "SERVER_ERROR", message: string } }` |

**`POST /api/v1/auth/login`**

| Aspect | Spec |
|---|---|
| Headers | `Content-Type: application/json` |
| Body | `email: string`, `password: string` |
| Response `200` | `{ user: UserProfile, accessToken: string, refreshToken: string }` + `Set-Cookie: refresh_token` (httpOnly, Secure, SameSite=Lax, Path=/api/v1/auth) |
| Response `401` | `{ error: { code: "INVALID_CREDENTIALS", message: string } }` |
| Response `400` / `500` | as register |

**`POST /api/v1/auth/refresh`**

| Aspect | Spec |
|---|---|
| Headers | `Cookie: refresh_token=...` |
| Body | `{ refreshToken: string }` (optional if cookie present) |
| Response `200` | `{ accessToken: string, refreshToken: string }` (rotates token) |
| Response `401` | `{ error: { code: "INVALID_REFRESH_TOKEN" } }` |

**`POST /api/v1/auth/logout`** → `200 { success: true }`, revokes refresh token.

**`GET /api/v1/auth/me`** — `Authorization: Bearer <accessToken>` → `200 { user: UserProfile }`, `401` unauthorized.

**`GET /api/v1/sessions`** — Auth Bearer → `200 { sessions: CaseSummary[] }` (ordered by `last_active_at`).

**`POST /api/v1/sessions`** — Body `{ title?: string, tags?: string[] }` → `201 { session: CaseSummary }`.

**`GET /api/v1/sessions/:sessionId`** — `200 { session: CaseSummary, messages: ChatMessage[] }`.

**`POST /api/v1/sessions/:sessionId/messages`** — Body `{ role, content, reasoning?, citation?, retriever?, suggestions? }` → `201 { message: ChatMessage }`.

**`PATCH /api/v1/sessions/:sessionId`** — Body `{ title?, tags? }` → `200 { session: CaseSummary }`.

**`DELETE /api/v1/sessions/:sessionId`** — `204 No Content`.

---

# TASK 2 — Document Ingestion, Chunking & FAISS Indexing (FastAPI)

## 2.1 Target File Tree Mapping

| File Path | Responsibility |
|---|---|
| `service-rag-python/app/main.py` | FastAPI app, CORS, lifespan |
| `service-rag-python/app/core/config.py` | Pydantic settings (paths, model names, dims, LM Studio URL) |
| `service-rag-python/app/core/logging.py` | Structured logging |
| `service-rag-python/app/api/deps.py` | Shared dependencies (auth token forward, stores) |
| `service-rag-python/app/api/routes/documents.py` | `/api/v1/documents/*` |
| `service-rag-python/app/api/routes/retrieval.py` | `/api/v1/retrieval/*` |
| `service-rag-python/app/api/routes/generation.py` | `/api/v1/generation/*` |
| `service-rag-python/app/schemas/document.py` | Pydantic: upload, status, chunk |
| `service-rag-python/app/schemas/retrieval.py` | Pydantic: search request/response |
| `service-rag-python/app/schemas/generation.py` | Pydantic: chat/stream |
| `service-rag-python/app/services/ingestion/loader.py` | PDF text extraction (PyMuPDF/pdfplumber) |
| `service-rag-python/app/services/ingestion/chunker.py` | Recursive/semantic chunker |
| `service-rag-python/app/services/ingestion/pipeline.py` | Orchestrate load→chunk→embed→index |
| `service-rag-python/app/services/embeddings/xlm_roberta.py` | XLM-RoBERTa embedding wrapper |
| `service-rag-python/app/services/vectorstore/faiss_store.py` | FAISS index load/save/search |
| `service-rag-python/app/services/vectorstore/bm25_index.py` | BM25 (rank_bm25) build/search |
| `service-rag-python/app/services/vectorstore/meta_store.py` | Chunk↔document↔vector mapping (SQLite) |
| `service-rag-python/app/services/retrieval/hybrid.py` | Hybrid fusion (RRF) |
| `service-rag-python/app/services/retrieval/reranker.py` | Cross-encoder / score rerank |
| `service-rag-python/app/services/generation/lmstudio.py` | LM Studio OpenAI-compatible client |
| `service-rag-python/app/services/generation/sse.py` | SSE event formatting |
| `service-rag-python/app/storage/uploads/` | Raw uploaded PDFs (local) |
| `service-rag-python/app/storage/faiss/` | FAISS `.index` + `.faiss` + meta |
| `service-rag-python/app/storage/bm25/` | BM25 pickled indexes |
| `service-rag-python/app/storage/chunks.sqlite` | Chunk metadata + vector-id mapping |

## 2.2 Data Contract (Pydantic)

| Model | Field | Type | Notes |
|---|---|---|---|
| `DocumentUploadRequest` | `document_id` | `UUID` | From Express |
| `DocumentUploadRequest` | `user_id` | `UUID` | Owner |
| `DocumentUploadRequest` | `filename` | `str` | |
| `Chunk` | `chunk_id` | `UUID` | |
| `Chunk` | `document_id` | `UUID` | |
| `Chunk` | `chunk_index` | `int` | 0-based |
| `Chunk` | `text` | `str` | |
| `Chunk` | `start_char` | `int` | |
| `Chunk` | `end_char` | `int` | |
| `Chunk` | `page` | `int \| None` | |
| `Chunk` | `metadata` | `dict[str, Any]` | |
| `IngestionResult` | `document_id` | `UUID` | |
| `IngestionResult` | `status` | `str` | `indexed`/`failed` |
| `IngestionResult` | `chunk_count` | `int` | |
| `IngestionResult` | `faiss_index_id` | `str` | |
| `IngestionResult` | `bm25_index_id` | `str` | |
| `IngestionResult` | `embedding_model` | `str` | |
| `DocumentStatusResponse` | `document_id` | `UUID` | |
| `DocumentStatusResponse` | `status` | `str` | |
| `DocumentStatusResponse` | `chunk_count` | `int` | |

## 2.3 Vector Metadata Store (Data Dictionary — SQLite, FastAPI-local)

**Table: `chunks`**

| Field | Data Type | Constraints |
|---|---|---|
| `chunk_id` | `TEXT` (UUID) | PK |
| `document_id` | `TEXT` (UUID) | INDEX, FK → document registry |
| `chunk_index` | `INTEGER` | NOT NULL |
| `text` | `TEXT` | NOT NULL |
| `start_char` | `INTEGER` | NOT NULL |
| `end_char` | `INTEGER` | NOT NULL |
| `page` | `INTEGER` | NULL |
| `vector_id` | `INTEGER` | UNIQUE (FAISS row offset) |
| `bm25_token_count` | `INTEGER` | NULL |
| `metadata` | `TEXT` (JSON) | NULL |

**Table: `index_registry`**

| Field | Data Type | Constraints |
|---|---|---|
| `index_id` | `TEXT` | PK |
| `document_id` | `TEXT` (UUID) | INDEX |
| `index_kind` | `TEXT` | `faiss` / `bm25` |
| `path` | `TEXT` | local file path |
| `dimension` | `INTEGER` | NULL (FAISS only) |
| `created_at` | `TEXT` (ISO 8601) | NOT NULL |

## 2.4 Validation (Pydantic)

| Field | Constraint | Type |
|---|---|---|
| `file` | `UploadFile`, `application/pdf`, ≤ 50 MB | `UploadFile` |
| `document_id` | valid UUID | `UUID` |
| `user_id` | valid UUID | `UUID` |
| `chunk_size` | 128–2048, default 512 | `int` |
| `chunk_overlap` | 0–256, default 64, `< chunk_size` | `int` |
| `embedding_model` | enum `xlm-roberta-base` | `str` |
| `index_type` | enum `faiss-flat` / `faiss-ivf` | `str` |

## 2.5 API Endpoints

**`POST /api/v1/documents/upload`** (FastAPI)

| Aspect | Spec |
|---|---|
| Headers | `Content-Type: multipart/form-data`, `X-Internal-Token: <shared>` |
| Form fields | `file: file (application/pdf)`, `document_id: string (UUID)`, `user_id: string (UUID)`, `filename: string` |
| Response `202` | `{ document_id, status: "processing" }` |
| Response `400` | `{ detail: { code: "UNSUPPORTED_FILE", message } }` |
| Response `413` | `{ detail: { code: "FILE_TOO_LARGE", message } }` |
| Response `500` | `{ detail: { code: "INGESTION_ERROR", message } }` |

**`GET /api/v1/documents/{document_id}/status`** → `200 { document_id, status, chunk_count }`.

**`DELETE /api/v1/documents/{document_id}`** → `204`, removes FAISS + BM25 + chunk rows.

**`POST /api/v1/documents/{document_id}/reindex`** → `202 { document_id, status: "reindexing" }`.

### Ingestion Pipeline (Flow)

1. `loader.py` extracts raw text + page numbers from PDF.
2. `chunker.py` splits into overlapping chunks (`chunk_size`/`chunk_overlap`).
3. `xlm_roberta.py` embeds each chunk → `vector[768]` (XLM-RoBERTa hidden size).
4. `faiss_store.py` writes `IndexFlatIP`/`IndexIVFFlat` to `storage/faiss/{index_id}.index`.
5. `bm25_index.py` tokenizes chunks → BM25 sparse index → `storage/bm25/{index_id}.pkl`.
6. `meta_store.py` persists `chunk_id → document_id → vector_id` mapping.
7. Callback to Express `PATCH /api/v1/documents/{id}` to set `status = indexed`, `chunk_count`, `faiss_index_id`, `bm25_index_id`.

---

# TASK 3 — Hybrid Search Retrieval & Statute Lookup

## 3.1 File Tree Mapping

Already listed in TASK 2 (`retrieval.py`, `hybrid.py`, `reranker.py`) plus:

| File Path | Responsibility |
|---|---|
| `backend-node/src/services/statute.service.ts` | Statute metadata queries (Express) |
| `backend-node/src/services/search.service.ts` | Orchestrate cross-service retrieval call |
| `backend-node/src/controllers/search.controller.ts` | Expose unified search endpoint |

## 3.2 Data Contract

| Model | Field | Type | Notes |
|---|---|---|---|
| `SearchRequest` | `query` | `str` | 1–2000 chars |
| `SearchRequest` | `top_k` | `int` | 1–50, default 8 |
| `SearchRequest` | `document_ids` | `list[UUID] \| None` | scope filter |
| `SearchRequest` | `categories` | `list[str] \| None` | `statutory`/`jurisprudence` |
| `SearchRequest` | `alpha` | `float` | dense weight 0–1, default 0.5 |
| `SearchRequest` | `beta` | `float` | sparse weight 0–1, default 0.5 |
| `SearchRequest` | `rerank` | `bool` | default true |
| `SearchResult` | `chunk_id` | `str` | |
| `SearchResult` | `document_id` | `str` | |
| `SearchResult` | `text` | `str` | |
| `SearchResult` | `score` | `float` | 0–1 |
| `SearchResult` | `rank` | `int` | |
| `SearchResult` | `source` | `str` | `dense`/`sparse`/`hybrid` |
| `SearchResult` | `title` | `str` | |
| `SearchResult` | `category` | `str` | `statutory`/`jurisprudence` |
| `SearchResponse` | `results` | `list[SearchResult]` | |
| `SearchResponse` | `method` | `str` | `"BM25 + XLM-RoBERTa"` |
| `SearchResponse` | `index` | `str` | `"FAISS Index (N Chunks)"` |

## 3.3 Schema

Uses `chunks` table (FastAPI local) + `statutes` table (Express/Postgres). No new tables, except optional:

**Table: `search_log`** (Express/Postgres)

| Field | Data Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `user_id` | `UUID` | FK → `users.id`, INDEX |
| `session_id` | `UUID` | NULL, FK → `sessions.id` |
| `query` | `TEXT` | NOT NULL |
| `result_count` | `INT` | NOT NULL |
| `latency_ms` | `INT` | NULL |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() |

## 3.4 Validation

| Field | Constraint | Type |
|---|---|---|
| `query` | 1–2000 chars | `str` |
| `top_k` | int 1–50 | `int` |
| `alpha` / `beta` | float 0–1, sum = 1 | `float` |
| `document_ids` | list of valid UUIDs | `list[UUID]` |
| `categories` | subset of `{statutory, jurisprudence}` | `list[str]` |

## 3.5 API Endpoints

**`POST /api/v1/retrieval/search`** (FastAPI)

| Aspect | Spec |
|---|---|
| Headers | `Content-Type: application/json`, `X-Internal-Token` |
| Body | `SearchRequest` |
| Response `200` | `SearchResponse` |
| Response `400` | `{ detail: { code: "VALIDATION_ERROR", message } }` |
| Response `500` | `{ detail: { code: "RETRIEVAL_ERROR", message } }` |

**`GET /api/v1/statutes`** (Express) — `?category=&code=&book_id=&title_id=&chapter_id=&article_number=&q=` → `200 { statutes: Article[] }`.

**`GET /api/v1/statutes/{id}`** → `200 { article: Article }`.

**`GET /api/v1/statutes/search?q=...`** → full-text via `search_vector` → `200 { statutes: Article[] }`.

**`GET /api/v1/jurisprudence`** — `?gr_number=&case_name=&year=` → `200 { cases: JurisprudenceCase[] }`.

### Hybrid Retrieval Flow

1. Encode `query` → dense vector (XLM-RoBERTa).
2. `faiss_store.search(query_vec, top_k)` → dense candidates.
3. `bm25_index.search(query, top_k)` → sparse candidates.
4. `hybrid.py` fuses via Reciprocal Rank Fusion: `score = Σ 1/(k + rank)` weighted by `alpha`/`beta`.
5. `reranker.py` (cross-encoder) rescored top N → final `score`.
6. Map `chunk_id → document_id → statute/case` metadata (calls Express `GET /statutes` for `title`, `category`, `breadcrumb`).
7. Return `SearchResponse` with `method` and `index` labels matching frontend `RetrieverState`.

---

# TASK 4 — SSE Token Streaming & LM Studio Orchestration (FastAPI)

## 4.1 File Tree Mapping

| File Path | Responsibility |
|---|---|
| `service-rag-python/app/api/routes/generation.py` | SSE endpoint |
| `service-rag-python/app/services/generation/lmstudio.py` | LM Studio stream client |
| `service-rag-python/app/services/generation/sse.py` | Event formatting helpers |
| `service-rag-python/app/schemas/generation.py` | Pydantic request/event models |

## 4.2 Data Contract

| Model | Field | Type |
|---|---|---|
| `ChatCompletionRequest` | `session_id` | `UUID` |
| `ChatCompletionRequest` | `message` | `str` |
| `ChatCompletionRequest` | `messages` | `list[dict]` (history) |
| `ChatCompletionRequest` | `sources` | `list[SearchResult]` |
| `ChatCompletionRequest` | `temperature` | `float \| None` |
| `ChatCompletionRequest` | `max_tokens` | `int \| None` |
| `ChatCompletionRequest` | `model` | `str` = `gemma-4-e4b` |
| `MetadataChunkEvent` | `sources` | `list[SearchResult]` |
| `TextDeltaEvent` | `delta` | `str` |
| `FinishReasonEvent` | `finish_reason` | `str` (`stop`/`length`/`tool_calls`) |
| `FinishReasonEvent` | `usage` | `dict` (prompt/completion tokens) |
| `ErrorEvent` | `error` | `{ code: str, message: str }` |

## 4.3 Schema

No new tables. Uses `messages` (Express) for persistence of the final assistant reply.

## 4.4 Validation

| Field | Constraint | Type |
|---|---|---|
| `session_id` | valid UUID | `UUID` |
| `message` | 1–100,000 chars | `str` |
| `messages` | ≤ 100 items | `list` |
| `temperature` | 0.0–2.0 | `float \| None` |
| `max_tokens` | 1–8192 | `int \| None` |
| `model` | enum `gemma-4-e4b` | `str` |

## 4.5 SSE Endpoint

**`POST /api/v1/generation/chat`** (FastAPI, streams `text/event-stream`)

| Aspect | Spec |
|---|---|
| Headers | `Content-Type: application/json`, `Accept: text/event-stream`, `X-Internal-Token` |
| Body | `ChatCompletionRequest` |
| Response headers | `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no` |
| Response `200` | SSE event stream (below) |
| Response `400` | `{ detail: { code: "VALIDATION_ERROR" } }` |
| Response `502` | `{ detail: { code: "LMSTUDIO_UNREACHABLE" } }` |

### SSE Event Formats

| Event | Data Payload | Purpose |
|---|---|---|
| `metadata_chunk` | `{ "sources": SearchResult[] }` | Retrieved sources sent first (renders citations) |
| `text_delta` | `{ "delta": string }` | Incremental token text |
| `finish_reason` | `{ "finish_reason": "stop" \| "length", "usage": { "prompt_tokens": int, "completion_tokens": int } }` | Stream termination + usage |
| `error` | `{ "error": { "code": string, "message": string } }` | Mid-stream failure |

### Streaming Flow

1. `generation.py` receives request; first emits `metadata_chunk` with retrieved sources.
2. `lmstudio.py` opens `POST http://localhost:1234/v1/chat/completions` (`stream: true`) with `gemma-4-e4b`.
3. Each LM Studio `choices[].delta.content` → emitted as `text_delta` event.
4. On `choices[].finish_reason` → emit `finish_reason` event, close stream.
5. On upstream error → emit `error` event then close.
6. Express listens/saves the full concatenated assistant text + sources to `messages`.

---

## Cross-Service Auth & Shared Constants

| Constant | Value | Notes |
|---|---|---|
| Access token TTL | 15 min | JWT HS256 |
| Refresh token TTL | 7 days | JWT, httpOnly cookie |
| Internal service token | `X-Internal-Token` header | Shared secret between Express ↔ FastAPI |
| Embedding dim | 768 | XLM-RoBERTa hidden size |
| LM Studio endpoint | `http://localhost:1234/v1` | OpenAI-compatible |
| LM Studio model | `gemma-4-e4b` | |
| SSE media type | `text/event-stream` | |
