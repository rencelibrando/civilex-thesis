# CIVIL-LEX: AI-Powered Philippine Civil Law Legal Assistant & RAG System

> **Undergraduate Thesis Project — Group 7**  
> An intelligent, grounded Retrieval-Augmented Generation (RAG) system specialized in the **Civil Code of the Philippines (Republic Act No. 386)** and the **Family Code of the Philippines (Executive Order No. 209)**.

---

## Table of Contents
1. [Overview & Objectives](#overview--objectives)
2. [Key System Capabilities](#key-system-capabilities)
3. [System Architecture](#system-architecture)
4. [RAG Pipeline & Guardrail Innovations](#rag-pipeline--guardrail-innovations)
5. [Evaluation & Empirical Benchmarks](#evaluation--empirical-benchmarks)
   - [RAGAS Evaluation Framework](#ragas-evaluation-framework)
   - [ISO/IEC 25010 Quality Model](#isoiec-25010-quality-model)
6. [Repository Structure](#repository-structure)
7. [Getting Started & Installation](#getting-started--installation)
   - [Prerequisites](#prerequisites)
   - [Database Setup (Supabase / pgvector)](#database-setup-supabase--pgvector)
   - [Python RAG Service (`service-rag-python`)](#python-rag-service-service-rag-python)
   - [Node.js Gateway (`backend-node`)](#nodejs-gateway-backend-node)
   - [Frontend Web App (`frontend`)](#frontend-web-app-frontend)
8. [Automated Verification & Testing](#automated-verification--testing)
9. [Academic & Legal Disclaimer](#academic--legal-disclaimer)

---

## 1. Overview & Objectives

**CIVIL-LEX** addresses the accessibility gap in Philippine civil law by providing conversational, legally grounded assistance for everyday citizens, students, and legal researchers. 

Unlike general-purpose conversational LLMs that suffer from jurisdictional hallucinations and doctrine misapplication, CIVIL-LEX enforces:
- **Strict Statutory Grounding**: Primary reliance on the enacted statutory text of RA 386 and EO 209, complemented by Supreme Court jurisprudence.
- **Strict Domain Boundary Guardrails**: Proactive detection and constructive refusal of out-of-scope inquiries (e.g., Code Generation, Tax Law [NIRC/BIR], Criminal Law [RPC], and Labor Law [DOLE/NLRC]).
- **Actionable Procedural Guidance**: Automatic extraction of competent trial courts under Republic Act No. 11576 monetary jurisdictional thresholds, Katarungang Pambarangay (Barangay Conciliation under RA 7160) prerequisites, and specific causes of action.

---

## 2. Key System Capabilities

-  **Interactive Civil Law Assistant**: Real-time Server-Sent Events (SSE) streaming chat supporting both English and Tagalog / Taglish legal inquiries.
-  **Statutory Explorer (`/civil-code`)**: Full-text and categorical browsing of RA 386 (Civil Code) and EO 209 (Family Code) articles with integrated search.
-  **Legal Document Analysis**: Ingestion and parsing of contract drafts, affidavits, and deeds (PDF/DOCX) with clause-by-clause compliance and liability analysis.
-  **Legal Action Summary**: Automatically determines:
  - Governing Civil Code Articles and essential statutory elements.
  - Trial Court Jurisdiction (Small Claims $\le$ ₱1M, MTC $\le$ ₱2M, RTC > ₱2M, Family Courts under RA 8369).
  - Pre-litigation Katarungang Pambarangay requirements.
  - Actionable remedies (e.g., Judicial Rescission, Accion Redhibitoria, Quasi-Delict damages).
- **NLI Grounding & Hallucination Guard**: Cross-encoder verification ensuring every assertion in generated advice is entailed by retrieved statutory text.

---

## 3. System Architecture

CIVIL-LEX operates as a modern microservices architecture:

```mermaid
flowchart TD
    subgraph Client ["Frontend Client (Port 3000)"]
        UI["Next.js 16 + React 19 UI\n(Chat, Statutory Reader, Document Upload)"]
    end

    subgraph Gateway ["API Gateway (Port 4000)"]
        NodeGW["Node.js Express Gateway\n(Auth, Session State, Proxy)"]
    end

    subgraph RAG ["Python RAG Service (Port 8000)"]
        FastAPI["FastAPI Engine"]
        Guardrails["Domain Guardrails & Intent Classifier"]
        FTS["PostgreSQL FTS Dictionary"]
        VecSearch["pgvector Dense Semantic Search\n(stsb-xlm-r-multilingual)"]
        CompGraph["Statutory Companion Graph"]
        Pruner["Adaptive Noise Pruner"]
        NLI["NLI Cross-Encoder Grounding\n(roberta-large-snli_mnli_fever_anli)"]
    end

    subgraph Data ["Database & Inference"]
        Postgres[("Supabase PostgreSQL 15+\n(RA 386, EO 209, Jurisprudence)")]
        LocalLLM["Local LLM Server / LM Studio\n(OpenAI-Compatible API)"]
    end

    UI <-->|HTTP / SSE| NodeGW
    NodeGW <-->|Reverse Proxy / SSE| FastAPI
    NodeGW <-->|Direct Queries| Postgres
    FastAPI --> Guardrails
    Guardrails -->|Out of Domain| LocalLLM
    Guardrails -->|In-Domain Civil| FTS & VecSearch
    FTS & VecSearch <--> Postgres
    VecSearch --> CompGraph
    CompGraph --> Pruner
    Pruner --> LocalLLM
    LocalLLM --> NLI
    NLI -->|Stream Tokens & Analytics| UI
```

---

## 4. RAG Pipeline & Guardrail Innovations

### 1. Statutory Companion Graph (`STATUTORY_COMPANION_GRAPH`)
In civil law, remedies rarely exist in a vacuum. A breach of contract inquiry involving rescission under Article 1191 inherently requires delay principles (Art. 1169), general breach liability (Art. 1170), and mutual restitution (Art. 1385). CIVIL-LEX automatically expands anchor articles to their substantive companions:
- **Reciprocal Obligations**: $\text{Art. 1191} \longleftrightarrow \text{Arts. 1170, 1169, 1385}$
- **Hidden Defects / Warranties**: $\text{Art. 1561} \longleftrightarrow \text{Arts. 1566, 1567, 1571}$
- **Torts / Quasi-Delict**: $\text{Art. 2176} \longleftrightarrow \text{Arts. 2180, 2185, 2199}$
- **Loan Defaults & Legal Delay**: $\text{Art. 1169} \longleftrightarrow \text{Arts. 1170, 1231, 1232}$

### 2. Adaptive Retrieval Noise Pruning (`prune_retrieval_noise`)
To prevent fixed Top-$K$ retrieval from diluting statutory context, the adaptive pruner calculates the relative similarity drop from the top anchor:
$$\Delta_i = \frac{S_{\text{top}} - S_i}{S_{\text{top}}}$$
Any retrieved chunk with $\Delta_i > 22\%$ or an absolute similarity score below $62\%$ is pruned, boosting Context Precision to **93.8%**.

### 3. Inverted Pyramid Prompt Synthesis
Generated answers strictly adhere to an Inverted Pyramid structure:
1. **Direct Answer First**: 1-to-2 sentence direct affirmative/negative legal conclusion answering the query.
2. **Statutory Grounding**: Specific RA 386/EO 209 articles with bracketed anchors (`[Art. XXXX]`).
3. **Application to Facts & Legal Action Summary**: Court thresholds and procedural requisites.

---

## 5. Evaluation & Empirical Benchmarks

CIVIL-LEX is benchmarked using two formal software and AI quality evaluation frameworks:

### RAGAS Evaluation Framework
Evaluated across **Stage 1 (Guardrail Routing)** and **Stage 2 (In-Domain Civil Law Core Metrics)**:

| Metric / Dimension | Target Threshold | Initial Baseline | Achieved Score | Evaluation Outcome |
| :--- | :---: | :---: | :---: | :---: |
| **Stage 1: Guardrail Compliance** | **100.0%** | 50.0% | **100.0%** (4/4 Passed) | **PASS** |
| **Stage 2: Context Recall** | $\ge$ **90.0%** | 0.0% | **100.0%** | **PASS**  |
| **Stage 2: Context Precision** | $\ge$ **85.0%** | 39.6% | **93.8%** | **PASS**  |
| **Stage 2: Faithfulness (Grounding)** | $\ge$ **90.0%** | 0.0% | **100.0%** | **PASS**  |
| **Stage 2: Answer Relevancy** | $\ge$ **85.0%** | 60.0% | **91.2%** | **PASS**  |

>  **Full Report**: For complete mathematical formulations, test matrices, and case-by-case outputs, see [`service-rag-python/RAGAS_METRICS_REPORT.md`](file:///home/rence/Documents/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/RAGAS_METRICS_REPORT.md).

### ISO/IEC 25010 Quality Model
Automated quality assessment testing **Performance Efficiency** (query embedding, hybrid retrieval, and pipeline latency) and **Functional Suitability & Reliability** (statutory recall and NLI entailment).
- Executable script: [`service-rag-python/eval_iso25010.py`](file:///home/rence/Documents/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/eval_iso25010.py).

---

## 6. Repository Structure

```text
civilex-thesis/
├── frontend/                     # Next.js 16 + React 19 Frontend Web App
│   ├── app/
│   │   ├── (auth)/               # Login & Authentication routes
│   │   ├── (dashboard)/
│   │   │   ├── chat/             # Conversational legal assistant interface
│   │   │   ├── civil-code/       # Civil & Family Code statutory reader
│   │   │   ├── research/         # Advanced legal search & clause analyzer
│   │   │   ├── history/          # Interaction & audit logs
│   │   │   └── dashboard/        # Analytics & metrics visualization
│   │   └── globals.css           # Design tokens, themes & layout styles
│   └── lib/                      # Supabase client, hooks & utility helpers
│
├── backend-node/                 # Express.js API Gateway (Port 4000)
│   ├── index.js                  # Gateway server entry & route mounting
│   ├── src/routes/
│   │   ├── proxy.js              # Streaming SSE reverse proxy to Python service
│   │   ├── civil-code.js         # Direct statutory access endpoints
│   │   ├── documents.js          # File uploads & document processing
│   │   └── sessions.js           # Chat history & session management
│   └── uploads/                  # Temporary upload storage
│
├── service-rag-python/           # Python RAG & Legal Intelligence Engine (Port 8000)
│   ├── main.py                   # FastAPI service, hybrid search & SSE pipeline
│   ├── eval_ragas.py             # End-to-end RAGAS evaluation harness
│   ├── eval_iso25010.py          # ISO/IEC 25010 software quality benchmark
│   ├── test_intent.py            # Unit & live streaming endpoint integration tests
│   ├── RAGAS_METRICS_REPORT.md   # Comprehensive RAGAS technical documentation
│   ├── ingest.py                 # Statutory chunking & embedding ingestion script
│   └── requirements.txt          # Python dependencies
│
└── supabase/                     # Supabase Database & Migrations
    ├── config.toml               # Local Supabase configuration
    └── migrations/               # PostgreSQL DDL, pgvector schemas & indexes
```

---

## 7. Getting Started & Installation

### Prerequisites
- **Node.js**: `v20.x` or higher
- **Python**: `3.11.x` or higher
- **PostgreSQL 15+** with `pgvector` extension (or local Supabase CLI)
- **Local LLM Server**: LM Studio or any OpenAI-compatible API running locally (e.g. `http://127.0.0.1:1234/v1`)

---

### Database Setup (Supabase / pgvector)

1. Start local Supabase containers or connect to your PostgreSQL instance:
   ```bash
   npx supabase start
   ```
2. Apply database migrations:
   ```bash
   npx supabase migration up
   ```

---

### Python RAG Service (`service-rag-python`)

1. Navigate to the Python service directory and create a virtual environment:
   ```bash
   cd service-rag-python
   python3 -m venv .venv
   source .venv/bin/activate
   ```
2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Configure environment variables (`.env`):
   ```ini
   POSTGRES_DB_URL=postgresql://postgres:postgres@localhost:54322/postgres
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   LM_STUDIO_URL=http://127.0.0.1:1234/v1
   EMBEDDING_MODEL_NAME=sentence-transformers/stsb-xlm-r-multilingual
   ```
4. Start the FastAPI server (Port 8000):
   ```bash
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```

---

### Node.js Gateway (`backend-node`)

1. Navigate to the backend directory:
   ```bash
   cd backend-node
   npm install
   ```
2. Configure `.env`:
   ```ini
   PORT=4000
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   ```
3. Start the gateway server:
   ```bash
   npm run dev
   ```

---

### Frontend Web App (`frontend`)

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   npm install
   ```
2. Configure `.env.local`:
   ```ini
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
   ```
3. Start the Next.js development server:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 8. Automated Verification & Testing

CIVIL-LEX includes automated test scripts to ensure regression-free deployments:

```bash
# 1. Run the RAGAS Benchmark Suite (Recall, Precision, Faithfulness, Relevancy, Guardrails)
cd service-rag-python
source .venv/bin/activate
python eval_ragas.py

# 2. Run the Live Stream & Intent Routing Tests
python test_intent.py

# 3. Run the ISO/IEC 25010 Quality Benchmark
python eval_iso25010.py

# 4. Code Quality & Type Checks
ruff check .               # In /service-rag-python
npm run type-check         # In /frontend
node --check index.js      # In /backend-node
```

---

## 9. Academic & Legal Disclaimer

> **IMPORTANT LEGAL NOTICE**:  
> CIVIL-LEX is developed solely as an **academic undergraduate thesis project** by Group 7. It is designed for educational, informational, and research purposes.  
> 
> The system's syntheses and recommendations **do NOT constitute formal legal advice** and do not establish an attorney-client relationship. Users should always consult a licensed attorney with the Integrated Bar of the Philippines (IBP) for formal legal representation and counsel on specific civil disputes.
