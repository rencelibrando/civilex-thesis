# CIVIL-LEX: Architectural & Implementation Specification

## 1. System Architecture Overview

CIVIL-LEX is a bilingual (English and Tagalog) legal hybrid Retrieval-Augmented Generation (RAG) system engineered to deliver accurate, citation-backed legal analysis grounded in the Civil Code of the Philippines (Republic Act No. 386), the Family Code of the Philippines (Executive Order No. 209), and Philippine Supreme Court jurisprudence.

### Technology Stack Inventory

- **Frontend:** Next.js 16 (App Router, React 19, TypeScript), TailwindCSS, Radix UI primitives, Lucide Icons.
  - *State & Cache Management:* React Context (`ChatContext`, `DocChatContext`, `AuthContext`) for real-time Server-Sent Events (SSE) tracking and in-memory caching of jurisprudence cases and Table of Contents nodes.
- **API Gateway Backend:** Node.js (Express 5, ECMAScript Modules). Hosted locally on Linux (Port `4000`).
  - *Authentication & Authorization:* Bearer JWT verification via Supabase Auth (`requireAuth` middleware) and request-scoped Supabase client creation.
  - *Reverse Proxy:* `http-proxy-middleware` forwarding streaming chat requests (`/api/chat` to Python `/search`), cancellation commands (`/api/chat/cancel` to Python `/cancel`), and storage assets (`/api/storage` to Supabase Storage).
  - *Internal Services:* Direct PostgreSQL/Supabase data access for Civil Code Table of Contents, statutory queries, jurisprudence retrieval, user session persistence, profiles, avatar in-memory caching, and presence telemetry.
- **Database & Storage Engine:** Supabase PostgreSQL 15+ running in local Docker (Port `54322`).
  - *Vector Search:* `pgvector` extension supporting 768-dimensional vector cosine similarity with dedicated partial HNSW indexes.
  - *Full-Text Search:* Native PostgreSQL `tsvector` and `tsquery` utilizing the `simple` dictionary configuration with GIN indexing.
  - *Object Storage:* Supabase Storage buckets (`documents` for uploaded contracts/deeds with a 50MB file limit; `avatars` for user profile photos).
- **RAG Core Microservice:** Python 3.11+ (FastAPI, Uvicorn). Hosted locally on Linux (Port `8000`).
  - *Embedding Model:* `intfloat/multilingual-e5-base` (768-dimensional dense vectors) with explicit `query: ` and `passage: ` instruction prefixes.
  - *Document Extraction Pipeline:* `PyMuPDF` (`fitz`) for digital text extraction, `python-docx` for Word documents, and `pytesseract` (Tesseract OCR) as fallback for scanned image-based PDFs and images (PNG, JPEG).
  - *Hybrid Retrieval & Fusion:* Reciprocal Rank Fusion (RRF, $k=60$) combining `pgvector` HNSW cosine similarity and PostgreSQL Full-Text Search (`ts_rank_cd`), augmented by exact article regex matching, statutory companion graph expansion, and graph-linked jurisprudence.
  - *Semantic Guardrails:* Embedding centroid domain router (`DomainRouter`) separating civil law inquiries from non-legal topics, specialized external statutes, and illicit contract requests.
  - *Ambiguity Detection:* LLM-driven query analyzer (`services/ambiguity.py`) determining missing factual requisites and generating interactive clarification questions.
  - *Verification & NLI:* Neuro-symbolic hybrid Natural Language Inference (NLI) engine combining deontic modality rules, polarity inversion checks, statutory anchor validation, and local LLM semantic entailment.
  - *Concurrency & Resource Management:* In-memory FIFO queue manager (`QueryQueueManager`) strictly enforcing 1-query concurrency to safeguard 6GB VRAM GPUs from out-of-memory crashes.
- **Local LLM Inference Engine:** Google Gemma 4 E4B (Fine-Tuned via LoRA $r=32, \alpha=64$, 16-bit Brain Floating Point / BF16 GGUF quantization) hosted locally via LM Studio (Port `1234`), exposed over an encrypted ZeroTier SD-WAN virtual network.

---

## 2. Physical Network Deployment Topology

The system operates across a distributed hybrid environment connecting cloud deployment with local hardware:

```mermaid
flowchart TD
    User(["User Browser"]) -->|"HTTPS / WSS"| Vercel["Vercel Cloud Deployment<br/>Next.js 16 Frontend (:3000)"]
    Vercel -->|"Secure Tunnel HTTPS"| Tunnel["Cloudflare / Dev Tunnel"]
    
    subgraph HostServer ["Host Machine (Ubuntu Linux)"]
        Tunnel --> NodeGW["Node.js API Gateway (:4000)"]
        NodeGW -->|"Internal HTTP (:8000)"| PyRAG["Python FastAPI RAG Service (:8000)"]
        NodeGW -->|"PostgreSQL TCP (:54322)"| SupaDB[("Supabase PostgreSQL 15+<br/>pgvector + FTS")]
        PyRAG -->|"PostgreSQL TCP (:54322)"| SupaDB
        NodeGW -->|"Storage API (:54321)"| SupaStore["Supabase Storage Service"]
    end
    
    PyRAG -->|"ZeroTier Encrypted SD-WAN (10.57.24.131:1234)"| LLMHost
    
    subgraph LLMHost ["Dedicated Inference Machine"]
        LLMServer["LM Studio Server (:1234)"] --> GPU["Gemma 4 E4B Fine-Tuned GGUF<br/>Local VRAM Inference"]
    end
```

### Network Configuration Details
1. **Frontend to Gateway:** The Next.js client transmits authenticated requests via public endpoints routed through secure HTTPS tunnels (Cloudflare Tunnel or Microsoft Dev Tunnel) directly into the Node.js API Gateway on Port `4000`.
2. **Gateway to RAG Microservice:** The Node.js server proxies streaming endpoints (`/api/chat` -> `/search`, `/api/chat/cancel` -> `/cancel`) over internal `http://localhost:8000`, injecting authenticated user identity headers (`x-user-id`, `x-user-email`, `x-user-name`).
3. **RAG Microservice to LLM Host:** The Python RAG service connects to the LM Studio OpenAI-compatible endpoint (`http://10.57.24.131:1234/v1`) through an isolated ZeroTier SD-WAN network.

---

## 3. End-to-End System Sequence Flows

### 3.1 Document Ingestion and Analysis Flow

```mermaid
sequenceDiagram
    autonumber
    participant Client as Next.js UI
    participant Gateway as Node.js Gateway (:4000)
    participant Storage as Supabase Storage
    participant DB as Supabase PostgreSQL (:54322)
    participant Python as Python RAG Service (:8000)

    Client->>Gateway: POST /api/documents/upload (multipart/form-data)
    Gateway->>Gateway: Validate Bearer token & MIME type
    Gateway->>Storage: Upload binary to 'documents' bucket
    Storage-->>Gateway: File upload acknowledged
    Gateway->>DB: INSERT into user_documents (status='uploading')
    Gateway->>Python: POST /extract {file_url, document_id, filename} (Async)
    Gateway-->>Client: 201 Created {id, file_url, status='uploading'}

    Note over Python, DB: Background Asynchronous Processing
    Python->>DB: UPDATE user_documents SET status='extracting'
    Python->>Storage: Download file bytes
    alt Format is Digital PDF / Word / TXT
        Python->>Python: Extract text via PyMuPDF / python-docx
    else Format is Scanned PDF or Image
        Python->>Python: Downsample image & run Tesseract OCR
    end
    Python->>Python: Slice into sliding window chunks (350 words, 50 overlap)
    loop For each chunk
        Python->>Python: Vectorize with E5 Base ('passage: ' prefix)
        Python->>DB: INSERT into document_chunks (parent_type='user_document')
        Python->>DB: UPDATE user_documents SET progress=percent
    end
    Python->>DB: UPDATE user_documents SET status='completed', progress=100
```

### 3.2 Real-Time Chat & Retrieval-Augmented Generation Flow

```mermaid
sequenceDiagram
    autonumber
    participant Client as Next.js UI (ChatContext)
    participant Gateway as Node.js Gateway (:4000)
    participant Queue as QueryQueueManager
    participant Python as Python RAG Service (:8000)
    participant DB as Supabase PostgreSQL (:54322)
    participant LLM as LM Studio (Gemma 4 E4B)

    Client->>Gateway: POST /api/chat {query, session_id, history, document_id}
    Gateway->>Gateway: requireAuth validation & attach user headers
    Gateway->>Python: Proxy POST /search (Keep-Alive, No Buffering)
    
    Python->>Queue: enter_queue(user_id, session_id)
    alt Execution Slot Busy (Active == 1)
        Queue-->>Python: Enqueued at position #N
        Python-->>Client: SSE status: queued (queue_position=N)
        Queue->>Queue: Wait for FIFO slot signal
    end
    Queue-->>Python: Execution slot granted
    Python-->>Client: SSE status: embedding

    Python->>DB: Load canonical session history & recent citations
    Python->>Python: Intent gating (DomainRouter) & Ambiguity detection
    
    alt Query is Ambiguous (Missing Facts)
        Python-->>Client: SSE clarification_needed {questions, options}
        Python-->>Client: SSE done
    else In-Domain Civil Query
        Python->>Python: Dense vectorization ('query: ' prefix)
        Python-->>Client: SSE status: retrieving
        Python->>DB: Hybrid Search (Exact Match + HNSW Cosine + GIN FTS)
        DB-->>Python: Ranked candidate statutory articles & cases
        Python->>DB: Graph expansion (Statutory companion graph & linked cases)
        Python->>Python: Reciprocal Rank Fusion (RRF, k=60) & noise pruning
        Python-->>Client: SSE status: retrieving_done {count}
        Python-->>Client: SSE status: prompting
        Python->>Python: Inverted pyramid prompt assembly with statutory primacy
        Python-->>Client: SSE status: thinking
        Python->>LLM: POST /v1/chat/completions (stream=True, temp=0.3)
        LLM-->>Python: Stream delta tokens
        Python-->>Client: SSE text {delta}
        LLM-->>Python: Stream finished (finish_reason='stop')
        
        Python-->>Client: SSE citations {data} & accumulated_citations {data}
        Python-->>Client: SSE status: evaluating_nli
        Python->>Python: Execute Neuro-Symbolic NLI verification
        Python-->>Client: SSE legal_analytics {nli_score, status, top_score}
        Python->>Python: Generate 3 unilingual follow-up suggestions
        Python-->>Client: SSE follow_ups {data}
        Python-->>Client: SSE done
        Python->>DB: Persist assistant message, citations & analytics
        Python->>Queue: release_slot(ticket)
    end
```

---

## 4. Database Schema Specification

The database utilizes Supabase PostgreSQL with the `pgvector` extension and native full-text search indexing.

### 4.1 Statutory & Jurisprudence Models

1. **`civil_code_articles` (Statutory Corpus):**
   - `article_id` (`TEXT`, PK): Canonical identifier (e.g., `RA386-ART1191`, `EO209-ART1`).
   - `article_number` (`INT`): Sequential integer (1 to 2270 for Civil Code; 1 to 257 for Family Code).
   - `hierarchy` (`JSONB`): Structural taxonomy containing `{book_name, title_name, chapter_name, section_name}`.
   - `content` (`TEXT`): Full enacted text of the statute.
   - `is_hub` (`BOOLEAN`): Flags heavily cross-referenced foundational anchor articles.

2. **`jurisprudence_cases` (Supreme Court Precedents):**
   - `case_uid` (`TEXT`, PK): Unique precedent identifier (e.g., `GR_189871_2012`).
   - `title` (`TEXT`): Official Supreme Court case title.
   - `gr_number` (`TEXT`): General Register docket number.
   - `decision_date` (`TEXT`): Date promulgated.
   - `source_url` (`TEXT`): Source reference link.
   - `content_summary` (`TEXT`): Pre-computed analytical case doctrine summary.
   - `full_text` (`TEXT`): Complete unabridged judicial decision text.

3. **`article_jurisprudence_relations` (Knowledge Graph Edges):**
   - `article_id` (`TEXT`): Foreign key referencing `civil_code_articles.article_id`.
   - `case_uid` (`TEXT`): Foreign key referencing `jurisprudence_cases.case_uid`.
   - `citation_type` (`TEXT`): Relationship qualification (`interpreted`, `applied`, `cited`, or `mentioned`).

### 4.2 Vector & Chunk Storage

```sql
CREATE TABLE public.document_chunks (
    chunk_id TEXT PRIMARY KEY,
    parent_type TEXT CHECK (parent_type IN ('article', 'case', 'user_document')),
    parent_id TEXT,
    content TEXT NOT NULL,
    legal_topics TEXT[],
    embedding VECTOR(768),
    fts tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED
);

-- Full-text search index
CREATE INDEX IF NOT EXISTS fts_idx ON public.document_chunks USING GIN (fts);

-- Dedicated partial HNSW and GIN indexes for fast partition retrieval
CREATE INDEX IF NOT EXISTS article_vector_idx ON public.document_chunks 
    USING hnsw (embedding vector_cosine_ops) WHERE parent_type = 'article';
CREATE INDEX IF NOT EXISTS article_parent_id_idx ON public.document_chunks(parent_id) 
    WHERE parent_type = 'article';
CREATE INDEX IF NOT EXISTS article_fts_idx ON public.document_chunks 
    USING gin (fts) WHERE parent_type = 'article';
CREATE INDEX IF NOT EXISTS doc_vector_idx ON public.document_chunks 
    USING hnsw (embedding vector_cosine_ops) WHERE parent_type = 'user_document';
```

### 4.3 User Documents & Session History

```sql
CREATE TABLE public.user_documents (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file_url TEXT NOT NULL,
    status TEXT CHECK (status IN ('uploading', 'extracting', 'completed', 'rejected_unrelated', 'error')),
    progress INT DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.chat_sessions (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT DEFAULT 'New Chat',
    session_type TEXT DEFAULT 'legal_chat',
    document_id UUID REFERENCES public.user_documents(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.chat_messages (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    session_id UUID REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
    role TEXT CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    citations JSONB,
    legal_analytics JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    avatar_url TEXT,
    role TEXT,
    organization TEXT,
    practice_area TEXT,
    phone_number TEXT,
    notification_preferences JSONB DEFAULT '{"email": true, "push": false}'::jsonb,
    theme_preferences TEXT DEFAULT 'system',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 5. Security & Verification Directives

1. **Row Level Security (RLS):** All user tables (`chat_sessions`, `chat_messages`, `user_documents`, `profiles`) enforce RLS policies restricting data visibility to `auth.uid() = user_id`.
2. **Reverse Proxy Security:** The Node.js gateway validates incoming Bearer JWT tokens with the Supabase Auth server before executing proxy forwarding. Downstream microservices run on internal loopback interfaces or encrypted SD-WAN subnets.
3. **Prompt Hardening:** Prompts incorporate closed-book constraints, strict unilingual output directives, system prompt confidentiality rules, and rejection of foreign common law doctrines.
