# CIVIL-LEX: Architectural Data & API Blueprint

## 1. Architectural Realization & Implementation Status

This blueprint outlines the complete production implementation of the CIVIL-LEX backend services, detailing the data contracts, database schemas, and microservice architectures.

### Implementation Reality vs. Initial Planning

| Component | Initial Planning | Actual Production Implementation | Rationale |
|---|---|---|---|
| **`backend-node/` Runtime** | TypeScript + Zod + Argon2id | Node.js (Express 5, ECMAScript Modules) | Streamlined architecture using Supabase Auth JWT verification directly, reducing latency and duplicate authentication logic. |
| **Vector & Keyword Indexing** | Local FAISS `.index` + `rank_bm25` pickled files + SQLite meta store | PostgreSQL 15+ Native `pgvector` (HNSW) + PostgreSQL Full-Text Search (`tsvector`/`tsquery` GIN) | Eliminates index desynchronization; permits single-query ACID consistency and transactional hybrid retrieval via SQL Reciprocal Rank Fusion (RRF). |
| **Embedding Model** | XLM-RoBERTa / `stsb-xlm-r-multilingual` | `intfloat/multilingual-e5-base` (768-dim) | Superior bilingual Tagalog/English semantic retrieval benchmark performance with calibrated `query: ` and `passage: ` prefix embeddings. |
| **LLM Inference** | Generic local endpoint | Fine-Tuned Google Gemma 4 E4B (LoRA $r=32, \alpha=64$, BF16 GGUF) via LM Studio on dedicated laptop | Provides specialized Philippine statutory reasoning, zero jurisdictional hallucinations, and low-latency inference over ZeroTier SD-WAN. |
| **Concurrency Safeguard** | None (unconstrained requests) | FIFO `QueryQueueManager` in Python RAG Core | Enforces strict 1-query concurrency to protect 6GB VRAM GPUs from CUDA out-of-memory crashes and thrashing. |

---

## 2. Repository Architecture & File Tree

### 2.1 Gateway Service (`backend-node/`)

```
backend-node/
├── index.js                      # Express 5 bootstrap, CORS, proxy mounting, socket timeouts
├── package.json                  # Dependencies (Express, @supabase/supabase-js, multer, etc.)
├── .env                          # Local environment variables
├── src/
│   ├── middleware/
│   │   └── auth.js               # Supabase JWT Bearer token validation & request-scoped client
│   ├── routes/
│   │   ├── civil-code.js         # Table of Contents, fast search, article & case details
│   │   ├── documents.js          # File uploads, storage management, binary streaming
│   │   ├── profiles.js           # User profile settings, avatar upload & in-memory cache
│   │   ├── proxy.js              # Streaming proxy for /api/chat, /cancel, and /storage
│   │   ├── sessions.js           # Chat session management and message persistence
│   │   └── system.js             # OS theme detection, queue status, presence & telemetry
│   └── services/
│       └── presence.js           # Real-time active user tracking & session monitoring
└── uploads/                      # Temporary storage for local development
```

### 2.2 RAG Core Microservice (`service-rag-python/`)

```
service-rag-python/
├── main.py                       # FastAPI application, SSE streaming endpoints, hybrid search
├── requirements.txt              # PyMuPDF, pytesseract, sentence-transformers, psycopg2, etc.
├── core/
│   ├── config.py                 # Unified environment settings (DB, LM Studio URL, E5 model)
│   ├── article_parser.py         # Statutory regex parsing, dispute detection, bound validation
│   └── queue_manager.py          # Unified in-memory FIFO concurrency limiter
├── services/
│   ├── ambiguity.py              # LLM-driven missing-facts analyzer & clarification generator
│   ├── document.py               # Document extraction, OCR fallback, chunking, and embedding
│   ├── domain_router.py          # Semantic centroid domain gating (civil vs criminal/labor/tax)
│   ├── followups.py              # Context-aware 3-question next-step suggestion engine
│   ├── ingestion_service.py      # Batch corpus ingestion utilities
│   ├── llm_client.py             # LM Studio streaming and completion HTTP client
│   ├── memory.py                 # Server-authoritative session memory, history recall, summaries
│   └── nli.py                    # Neuro-Symbolic hybrid NLI engine (Symbolic + Gemma arbitration)
└── data/                         # Statutory and jurisprudence source datasets
    ├── civil_code_rag.jsonl      # Enacted articles of Republic Act No. 386
    ├── family_code_rag.jsonl     # Enacted articles of Executive Order No. 209
    ├── jurisprudence_cases.jsonl # Supreme Court decisions & doctrinal summaries
    └── article_case_index.json   # Pre-computed statutory citation graph index
```

---

## 3. Database Data Dictionary & Relational Schema

### 3.1 Statutory & Jurisprudence Models

#### Table: `civil_code_articles`
Stores the enacted articles of the Civil Code of the Philippines (RA 386) and Family Code of the Philippines (EO 209).

| Field | Data Type | Constraints | Description |
|---|---|---|---|
| `article_id` | `TEXT` | PRIMARY KEY | Canonical ID (e.g. `RA386-ART1191`, `EO209-ART1`) |
| `article_number` | `INTEGER` | NOT NULL | Article number (1 to 2270 for Civil Code; 1 to 257 for Family Code) |
| `hierarchy` | `JSONB` | NOT NULL | Structural classification `{book_name, title_name, chapter_name, section_name}` |
| `content` | `TEXT` | NOT NULL | Full statutory text of the article |
| `is_hub` | `BOOLEAN` | DEFAULT false | Identifies heavily cross-referenced foundational provisions |

#### Table: `jurisprudence_cases`
Stores Philippine Supreme Court decisions and pre-computed analytical doctrine summaries.

| Field | Data Type | Constraints | Description |
|---|---|---|---|
| `case_uid` | `TEXT` | PRIMARY KEY | Unique identifier (e.g. `GR_189871_2012`) |
| `title` | `TEXT` | NOT NULL | Official Supreme Court title |
| `gr_number` | `TEXT` | NULL | General Register docket number |
| `decision_date` | `TEXT` | NULL | Promulgation date string |
| `source_url` | `TEXT` | NULL | Reference URL (LawPhil, ChanRobles, SC e-Library) |
| `content_summary` | `TEXT` | NULL | Analytical summary of legal doctrine |
| `full_text` | `TEXT` | NULL | Unabridged decision text for popup modals |

#### Table: `article_jurisprudence_relations`
Knowledge graph junction table linking statutory articles to Supreme Court jurisprudence.

| Field | Data Type | Constraints | Description |
|---|---|---|---|
| `article_id` | `TEXT` | FK → `civil_code_articles.article_id` | Referenced statutory article |
| `case_uid` | `TEXT` | FK → `jurisprudence_cases.case_uid` | Linked judicial precedent |
| `citation_type` | `TEXT` | DEFAULT `'mentioned'` | Relationship: `'interpreted'`, `'applied'`, `'mentioned'` |

---

### 3.2 Vector & Full-Text Search Storage

#### Table: `document_chunks`
Unified vector and full-text index storage partitioned by `parent_type`.

| Field | Data Type | Constraints | Description |
|---|---|---|---|
| `chunk_id` | `TEXT` | PRIMARY KEY | Unique chunk identifier |
| `parent_type` | `TEXT` | CHECK (`parent_type IN ('article', 'case', 'user_document')`) | Source partition type |
| `parent_id` | `TEXT` | NOT NULL | ID of article, case_uid, or user_document UUID |
| `content` | `TEXT` | NOT NULL | Text content (350-word sliding window) |
| `legal_topics` | `TEXT[]` | NULL | Extracted legal doctrine tags |
| `embedding` | `VECTOR(768)` | NULL | 768-dimensional E5 Base dense embedding vector |
| `fts` | `TSVECTOR` | GENERATED STORED | Native PostgreSQL full-text search vector (`simple` dictionary) |

**Index Architecture:**
- `fts_idx`: `GIN (fts)` on all chunks.
- `article_vector_idx`: Partial `HNSW (embedding vector_cosine_ops) WHERE parent_type = 'article'`.
- `article_parent_id_idx`: `B-Tree (parent_id) WHERE parent_type = 'article'`.
- `article_fts_idx`: Partial `GIN (fts) WHERE parent_type = 'article'`.
- `doc_vector_idx`: Partial `HNSW (embedding vector_cosine_ops) WHERE parent_type = 'user_document'`.

---

### 3.3 User Data, Sessions & History

#### Table: `user_documents`
Metadata for user-uploaded legal instruments.

| Field | Data Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PRIMARY KEY | Unique document ID |
| `user_id` | `UUID` | FK → `auth.users.id` | Owner identifier |
| `filename` | `TEXT` | NOT NULL | Original uploaded filename |
| `file_url` | `TEXT` | NOT NULL | Gateway-managed streaming URL |
| `status` | `TEXT` | CHECK (`status IN ('uploading', 'extracting', 'completed', 'rejected_unrelated', 'error')`) | Extraction lifecycle status |
| `progress` | `INTEGER` | DEFAULT 0 | Embedding progress percentage (0 to 100) |
| `error_message` | `TEXT` | NULL | Descriptive extraction failure explanation |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | Upload timestamp |

#### Table: `chat_sessions`
Conversational chat sessions ("cases").

| Field | Data Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PRIMARY KEY | Session identifier |
| `user_id` | `UUID` | FK → `auth.users.id` | Owner identifier |
| `title` | `TEXT` | DEFAULT `'New Chat'` | Conversation title |
| `session_type` | `TEXT` | DEFAULT `'legal_chat'` | Type (`'legal_chat'` or `'doc_chat'`) |
| `document_id` | `UUID` | NULL, FK → `user_documents.id` | Linked document for doc analysis |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | Session creation timestamp |

#### Table: `chat_messages`
Individual conversational turns within a session.

| Field | Data Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PRIMARY KEY | Message identifier |
| `session_id` | `UUID` | FK → `chat_sessions.id` ON DELETE CASCADE | Parent chat session |
| `role` | `TEXT` | CHECK (`role IN ('user', 'assistant')`) | Turn participant |
| `content` | `TEXT` | NOT NULL | Raw message text or markdown |
| `citations` | `JSONB` | NULL | Array of cited statutory & case objects |
| `legal_analytics` | `JSONB` | NULL | NLI faithfulness scores, domain audit payload |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | Message creation timestamp |

#### Table: `profiles`
User profiles, preferences, and organization details.

| Field | Data Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PRIMARY KEY, FK → `auth.users.id` | Matches Supabase Auth user ID |
| `full_name` | `TEXT` | NULL | User display name |
| `avatar_url` | `TEXT` | NULL | Public avatar link |
| `role` | `TEXT` | NULL | Professional title / role |
| `organization` | `TEXT` | NULL | Law firm or company affiliation |
| `practice_area` | `TEXT` | NULL | Legal practice focus |
| `phone_number` | `TEXT` | NULL | Contact phone number |
| `notification_preferences` | `JSONB` | DEFAULT `'{"email": true, "push": false}'` | Notification settings |
| `theme_preferences` | `TEXT` | DEFAULT `'system'` | `'dark'`, `'light'`, or `'system'` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT now() | Registration timestamp |

---

## 4. Cross-Service Pipeline & Retrieval Logic

### 4.1 Hybrid Search & Reciprocal Rank Fusion (RRF)

Candidate retrieval merges dense semantic similarity and keyword lexical relevance directly in PostgreSQL:

$$\text{RRF}(d) = \sum_{m \in \{\text{vector}, \text{text}\}} \frac{1}{k + r_m(d)}$$

Where:
- $k = 60$ (smoothing constant).
- $r_{\text{vector}}(d)$ is the dense rank from `pgvector` cosine similarity (`1 - (embedding <=> q_emb)`).
- $r_{\text{text}}(d)$ is the sparse rank from PostgreSQL full-text search (`ts_rank_cd(fts, query)`).

### 4.2 Multi-Stage Context Assembly

1. **Exact Statutory Regex Matcher:** Extracts article numbers (1–2270) to pull authoritative codal provisions with guaranteed 98.5% suitability.
2. **Statutory Companion Graph:** Pre-computed association network automatically pulling companion provisions (e.g., Article 1191 automatically pulls Articles 1170, 1169, and 1385).
3. **Graph-Augmented Jurisprudence:** Queries `article_jurisprudence_relations` for top landmark Supreme Court cases interpreting retrieved statutes.
4. **Adaptive Noise Pruning:** Drops candidates below the dynamic floor ($62\%$) or experiencing a suitability delta drop $> 22\%$.
5. **Inverted Pyramid Partitioning:** Orders assembled context strictly by legal primacy:
   - Primary Statutory Authority: Civil Code of the Philippines (RA 386).
   - Active Document Excerpts (if analyzing an uploaded document).
   - Secondary Supporting Interpretations: Supreme Court Jurisprudence.

---

## 5. Neuro-Symbolic Verification (NLI) Architecture

Post-generation verification in `services/nli.py` runs before stream termination:
1. **Atomic Proposition Decomposition:** Splits assistant response into individual factual assertions.
2. **Deontic Modality & Polarity Parsing:** Categorizes legal directives into Obligation ($\square$), Permission ($\Diamond$), and Prohibition ($\neg\Diamond$).
3. **Deterministic Symbolic Logic Rules:**
   - *Statutory Anchor Validation:* Checks if cited article numbers exist in retrieved context.
   - *Deontic Contradiction Detection:* Symbolic veto if the model inverts an obligation into a permission or prohibition.
   - *Asymmetric Lexical Containment:* Verifies Horn-clause statutory entailment.
4. **Local Neural NLI Inference:** Calls Gemma 4 E4B in LM Studio to resolve semantic paraphrasing when symbolic rules are neutral.
5. **Calibrated Faithfulness Scoring:**
   $$F = \frac{|V_{\text{entailed}}|}{|S_{\text{total}}|}$$
   - Status is marked **Grounded** if $F \ge 0.80$ and zero contradictions are detected.
