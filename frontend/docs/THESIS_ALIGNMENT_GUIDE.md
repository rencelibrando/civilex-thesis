# CIVIL-LEX Thesis Documentation vs. Implementation Alignment Guide

**Target Document:** `CIVIL-LEX_ Group 7 THESIS.docx`  
**Evaluation Scope:** Chapters 1, 2, 3, 4, Diagrams, Tech Stack, AI Models, Data Flow, and UI Implementation  
**Audited Against:** `/frontend` (Next.js 16 App Router), `/backend-node` (Express Gateway), `/service-rag-python` (FastAPI Microservice), and `/supabase` (PostgreSQL + pgvector)

---

## Executive Summary of Core Findings

| Dimension | Thesis Documentation Claim | Actual Codebase Implementation | Verdict & Severity |
| :--- | :--- | :--- | :--- |
| **Generator Model** | "Gemma4 (E4B)" / "Gemma4 e4b" with 32 layers | Fine-tuned **Gemma 4 (E4B)** (exported to GGUF from `output/gemma4-civil-code-qlora`) hosted and served locally via LM Studio | 🟢 **ALIGNED**: Model is Gemma 4 (E4B) running locally via LM Studio. Note: adjust Figure 1.5 text to 26 layers if detailing base weights. |
| **Retriever Model** | "Fine-tuned XLM-RoBERTa retriever on civil law Q&A pairs" | Pre-trained `sentence-transformers/stsb-xlm-r-multilingual` | 🔴 **CRITICAL**: No fine-tuning script, dataset, or weights exist for XLM-R. |
| **Web Tech Stack** | Not mentioned or vaguely referred to as "web application" | 3-tier architecture: **Next.js 16 (React 19, TypeScript, Tailwind CSS v4, Shadcn UI)** + **Node.js Express 5 Gateway** + **Python FastAPI Microservice** | 🟠 **HIGH**: Entire software engineering stack is omitted from methodology. |
| **Cloud Fallback LLM** | "Groq or Gemini Flash as cloud fallback" | **Removed in Code**. System now runs **exclusively on LM Studio** with zero cloud fallback APIs. | 🟢 **RESOLVED IN CODE**: Fallbacks removed; update thesis to state exclusive local LM Studio inference. |
| **OCR Pipeline** | Conflicted claims: `PaddleOCR / PP-OCRv4` in IPO & Definition of Terms vs. `PyMuPDF + Tesseract OCR` in text | **PyMuPDF (`fitz`)** for digital text extraction + **Tesseract OCR (`pytesseract`)** for scanned images. PaddleOCR is not used. | 🟠 **HIGH**: Internal contradiction; clean up PaddleOCR references. |
| **OCR Feature Scope** | Confidence gate (≥ 0.80), OCR spell correction, editable text preview with low-confidence highlights, auto-flagged clauses | Document Research Studio with side-by-side viewer (PDF, DOCX, TXT, Images) + interactive Civil Code Q&A assistant | 🟠 **HIGH**: Over-documented features not present in current UI. |
| **UI Features** | Thumbs-up/down feedback, persistent language toggle, post-answer follow-up buttons, auto-delete images at session end | Session persistence, live multi-stage RAG stepper, side citation drawer (Latest vs Retained), 70vw citation modal, manual document delete | 🟡 **MODERATE**: Align UI feature list with actual UI components. |
| **Document Numbering** | Multiple duplicate figure and table numbers, broken cross-references | Numerous numbering glitches (duplicate Table 3.5, duplicate Fig 1.1, misnumbered captions) | 🟡 **MODERATE**: Formatting & editorial errors to fix. |
| **Chapter 4** | Title only ("CHAPTER 4 Presentation, Analysis And Interpretation Of Data") | Zero content / unwritten | ℹ️ **NOTE**: Chapter 4 is entirely empty. |

---

## 1. AI Models & Machine Learning Discrepancies

### 1.1 Generator: Gemma 4 (E4B) Implementation & Architecture Details
* **Where in Thesis:**
  - **Chapter 1:** Section 1.2 (Statement of the Problem), Section 1.3 (Objectives), Section 1.4 (Figure 1.5 caption & text), Section 1.5 (IPO Model), Section 1.7 (Scope), Definition of Terms.
  - **Chapter 2:** Section 2.2 (Synthesis).
  - **Chapter 3:** Section 3.1, Figure 3.2, Section 3.4, Table 3.4.
* **Current Status & Architecture Alignment:**
  - The project officially designates and deploys **Gemma 4 (E4B)** as its fine-tuned generator model.
  - In the codebase (`service-rag-python/finetune/config.yaml`), the fine-tuning pipeline trains the model and outputs weights to `./output/gemma4-civil-code-qlora`, which are merged and exported to GGUF (`export_gguf.py`) and loaded directly into **LM Studio** for local streaming inference.
  - **Architectural Refinement for Figure 1.5:** The thesis text under Figure 1.5 describes `32 stacked transformer layers`. If you are detailing the underlying base transformer weights, note that the 2B architecture features **26 stacked transformer layers** (hidden dimension 2048, Grouped-Query Attention with 8 key-value heads and 16 query heads). Updating this layer count aligns your documentation with technical precision.

---

### 1.2 Retriever: "Fine-Tuned XLM-RoBERTa" vs. Pre-Trained `stsb-xlm-r-multilingual`
* **Where in Thesis:**
  - **Chapter 1:** Section 1.2 ("fine-tuned XLM-RoBERTa retriever"), Section 1.3 ("utilizing a fine-tuned XLM-RoBERTa retriever"), Section 1.5 ("trains the XLM-R retriever on bilingual civil law Q&A pairs"), Section 1.7.
  - **Chapter 3:** Section 3.1, Figure 3.2, Table 3.3 ("XLM-RoBERTa Retriever - Classification Metrics").
* **The Error:**
  - The thesis claims XLM-RoBERTa was fine-tuned on bilingual civil law Q&A pairs to embed Philippine legal semantics.
  - In the codebase (`service-rag-python/main.py:L68`, `services/document.py:L20`, `services/ingestion_service.py:L20`):
    ```python
    embedder = SentenceTransformer(os.getenv("EMBEDDING_MODEL_NAME", "sentence-transformers/stsb-xlm-r-multilingual"))
    ```
  - There is **no fine-tuning script, training loss (e.g. MultipleNegativesRankingLoss), or custom checkpoint** for XLM-RoBERTa in the project. It is used as a pre-trained off-the-shelf multilingual sentence transformer.
* **How to Fix in Document:**
  - Clarify that XLM-RoBERTa (`sentence-transformers/stsb-xlm-r-multilingual`) is utilized as a **pre-trained multilingual dense semantic encoder**, while fine-tuning was focused on the generator (Gemma 4 E4B via QLoRA).
  - Adjust Research Question 3 and Objective 2 & 3: change "fine-tuned XLM-RoBERTa retriever" to "pre-trained multilingual XLM-RoBERTa dense retriever".

---

### 1.3 Removal of Cloud Fallbacks (Exclusive LM Studio Usage for Gemma 4 E4B)
* **Where in Thesis:**
  - **Chapter 1:** Section 1.5, Section 1.7, Definition of Terms.
  - **Chapter 3:** Section 3.1 (P17).
* **Codebase Update & Thesis Alignment:**
  - The thesis originally stated: *"served via LM Studio with Groq or Gemini Flash as cloud fallback"*.
  - **Codebase Action Taken:** All cloud fallback routes (Google Gemini API and Groq) have been **completely removed** from `service-rag-python/services/llm_client.py` and `core/config.py`. The application now connects **exclusively to LM Studio** running the local Gemma 4 (E4B) model.
* **How to Fix in Document:**
  - Remove all mentions of "Groq" and "Gemini Flash fallback" across Chapters 1 and 3.
  - Explicitly document that CIVIL-LEX operates under **complete local inference and data sovereignty**, deploying Gemma 4 (E4B) exclusively through LM Studio with zero reliance on third-party cloud LLM APIs.

---

## 2. Technical Stack & System Architecture Discrepancies

### 2.1 Complete Omission of Web Application & Backend Frameworks
* **Where in Thesis:**
  - **Chapter 3:** Section 3.1, Figure 3.2, Figure 3.3.
* **The Error:**
  - The thesis describes the research as developing a "Web Application", but **never specifies the actual web framework, programming languages, or backend architecture** anywhere in Chapter 3!
  - Terms like `Next.js`, `React`, `Node.js`, `Express`, `FastAPI`, `TypeScript`, and `Tailwind CSS` have **0 occurrences** in Chapter 3.
* **Actual Implementation:**
  The project is a decoupled **3-Tier Microservice Architecture**:
  1. **Presentation Tier (Frontend):** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Shadcn UI / Radix primitives, Lucide icons, `react-markdown` with GFM, and `mammoth.js` for client-side Word document rendering.
  2. **Gateway Tier (Backend-Node):** Node.js with Express 5, `@supabase/supabase-js` authentication middleware (`requireAuth`), `multer` for memory file uploads, and `http-proxy-middleware` proxying `/api/chat` to the RAG microservice.
  3. **Inference & RAG Tier (Service-RAG-Python):** Python FastAPI microservice, `SentenceTransformers` (`stsb-xlm-r-multilingual`), `psycopg2` + `pgvector` HNSW index, `PyMuPDF` + `pytesseract` OCR engine, and LM Studio / Gemini streaming integration via SSE (Server-Sent Events).
  4. **Database Tier (Supabase / PostgreSQL):** PostgreSQL 15+ with `pgvector` extension (768-dimensional vectors), native `tsvector` with GIN indexing for Full-Text Search, and Supabase Storage for user documents.
* **How to Fix in Document:**
  - In Chapter 3 (Section 3.1 and under Figure 3.2), add a dedicated subsection: **"System Implementation & Software Architecture"** explicitly outlining the 3 tiers above.

---

### 2.2 Vector Database & Hybrid Search Terminology
* **Where in Thesis:**
  - Section 1.5, Section 1.7, Definition of Terms (`tsvector`), Chapter 3 Section 3.1.
* **The Inaccuracy:**
  - The thesis defines `tsvector` as: *"A probabilistic keyword ranking function used in this study as a hybrid lexical re-ranking layer over Postgresql pgvector semantic retrieval results..."*
  - In PostgreSQL:
    - `tsvector` is a **document representation data type** (a sorted list of normalized lexemes with positions), not a ranking function.
    - The full-text search matching uses `tsquery` (`@@`), and ranking is computed via `ts_rank_cd()`.
    - The hybrid fusion is performed using **Reciprocal Rank Fusion (RRF)**:
      $$\text{RRF Score} = \frac{1}{60 + \text{rank}_{\text{vector}}} + \frac{1}{60 + \text{rank}_{\text{text}}}$$
    - The vector index uses **HNSW (Hierarchical Navigable Small World)** with cosine distance (`vector_cosine_ops`), not flat search.
* **How to Fix in Document:**
  - Correct the definition of `tsvector`: *"A PostgreSQL data type that stores preprocessed, stemmed lexemes for high-speed lexical full-text searching, combined with HNSW pgvector semantic search via Reciprocal Rank Fusion (RRF)."*

---

### 3.2 OCR Pipeline: Contradiction & Feature Overstatement
* **Where in Thesis:**
  - **Chapter 1:** Section 1.4 (Figure 1.3), Section 1.5 (Process Stage 4), Section 1.7 (Scope A & B), Definition of Terms.
  - **Chapter 3:** Section 3.1 (P10), Figure 3.12 (Research Wireframe).
* **The Errors:**
  1. **PaddleOCR / PP-OCRv4 Contradiction:**
     - In Section 1.7 (Scope), there is a copy-paste remnant: *"PP-OCRv4: image preprocessing, text extraction with layout analysis, legal term post-processing..."*
     - In Definition of Terms, it defines PaddleOCR and Tesseract merged into one line: `...uploaded by users.Tesseract OCR. Tesseract is...`.
     - In `image12.png` (IPO diagram), the box reads: *"PaddleOCR Pipeline"*.
     - **Actual code:** The codebase uses **PyMuPDF (`fitz`)** for digitally-authored PDFs, falling back to **Tesseract OCR (`pytesseract`)** for scanned PDFs, images (PNG, JPG), and `mammoth` / `docx` for Word documents. PaddleOCR is not used.
  2. **Overstated OCR Features:**
     - Thesis claims: "confidence gate ($\ge 0.80$ auto-proceed, $< 0.80$ user confirmation)", "legal term spell correction", "editable extracted text preview with low-confidence region highlights", "auto-flagged legal issues like missing clauses or absent notarization".
     - **Actual code:** The frontend `/research` page uploads files to Supabase Storage, polls extraction status (`uploading` $\rightarrow$ `extracting` $\rightarrow$ `completed`), renders a side-by-side document viewer (PDF iframe, Word HTML, image, text), and provides an interactive chat assistant with pre-configured legal analysis starters ("Summary", "Legal Risks", "Civil Code", "Obligations", "Void Clauses"). It does not feature an editable OCR text editor with confidence heatmaps.
* **How to Fix in Document:**
  - Delete all references to `PaddleOCR` and `PP-OCRv4` in Section 1.7, Definition of Terms, and diagram Figure 1.1 (IPO). Standardize on **"PyMuPDF + Tesseract OCR Pipeline"**.
  - Align the Research module description with the actual implementation: A side-by-side legal research studio featuring document preview and an integrated multi-turn legal assistant for document interrogation and Civil Code risk compliance.

---

### 3.3 Query Preprocessing: ML Classification vs. Heuristic Expansion
* **Where in Thesis:**
  - Section 1.5 (Process Stage 4), Section 1.7 (Technical Scope), Figure 3.5.
* **The Error:**
  - Thesis claims: *"processes text input through language detection, intent classification into five query types, and named entity extraction of article numbers, dates, and amounts"*.
  - **In the codebase (`main.py`):**
    - Exact article extraction uses regex: `r'(?:article|art\.?)\s*(\d+)'`.
    - Query contextualization and enrichment use conversation history windowing (`build_contextual_query`) and domain dictionary expansion (`expand_legal_query`).
    - Scope boundaries are enforced by LLM system prompt refusal rules.
    - There are no separate 5-class ML classifiers, statistical language detectors, or spaCy/transformers NER models running at runtime.
* **How to Fix in Document:**
  - Update the description to reflect **regex-based statutory entity detection, conversation history contextualization, and domain term expansion**.

---

### 3.4 Web Application User Interface Features
* **Where in Thesis:**
  - Section 1.5 (Output), Section 1.7 (UI Scope B), Section 3.7 (Wireframes).
* **Discrepancies:**
  - **Thumbs-up / thumbs-down feedback:** Claimed in Section 1.5 & 1.7; not present on chat messages in `frontend/app/(dashboard)/chat/page.tsx`.
  - **Persistent Language Toggle:** Claimed in Section 1.5 & 1.7; no language toggle button exists in the header or chat UI (bilingual/Taglish handling is handled directly by the LLM based on user input).
  - **Contextual Follow-up Buttons after each answer:** Claimed in Section 1.5 & 1.7; smart prompt starters exist on empty chat, but buttons like "explain simpler", "show related articles", "translate" are not appended after each assistant bubble.
  - **Auto-deletion of images at session end:** Claimed in Section 1.5 & 1.7; documents persist in Supabase Storage and `user_documents` until manually deleted by the user via the Delete icon.
* **How to Fix in Document:**
  - Either remove these unbuilt features from Section 1.7 Scope B, or label them as *"Planned Future Enhancements"*.
  - Highlight the features that **are** implemented:
    - Multi-stage live visual stepper (`RagPipelineStepper`) showing vectorization, retrieval, context prep, reasoning, and streaming.
    - Two-tier citation panel: "Latest Query Citations" vs. "All Retained Citations" (maintains up to 6 prior legal citations across conversation turns).
    - Large (70vw) Citation Modal with verbatim article text, Supreme Court docket info, copy button, and direct links to official legal repositories.
    - Table of Contents statutory explorer for all 4 Books + Preliminary Title of RA 386 with linked jurisprudence modals.

---


## 5. Master Checklist for Manual Word Editing

Use this step-by-step checklist while editing `CIVIL-LEX_ Group 7 THESIS.docx`:

- [ ] **1. Standardize Gemma 4 (E4B)** as the designated fine-tuned generator model across Chapters 1, 2, and 3, and adjust Figure 1.5 text to 26 layers if detailing base weights.
- [ ] **2. Correct Figure 1.5 description** to state 26 transformer layers (underlying base architecture) instead of 32.
- [ ] **3. Change "fine-tuned XLM-RoBERTa"** to **pre-trained multilingual XLM-RoBERTa dense encoder** (`sentence-transformers/stsb-xlm-r-multilingual`).
- [ ] **4. Remove all cloud fallbacks (Groq and Gemini Flash)**; state that the system operates **exclusively via local LM Studio inference** for Gemma 4 (E4B) with zero cloud API dependency.
- [ ] **5. Eliminate all references to PaddleOCR / PP-OCRv4** (in Section 1.7, Definition of Terms, and Figure 1.1 IPO diagram); standardize on **PyMuPDF + Tesseract OCR**.
- [ ] **6. Resolve the Family Code contradiction** between Section 1.5 and Section 1.7.2.
- [ ] **7. Renumber Section 1.7 Definition of Terms** to **1.8 Definition of Terms**.
- [ ] **8. Fix Figure Numbering:**
  - [ ] Renumber IPO Model from Figure 1.1 to Figure 1.6.
  - [ ] Fix CRISP-DM caption from Figure 3.2 to Figure 3.4.
  - [ ] Fix Case History caption from Figure 3.5 to Figure 3.6.
  - [ ] Renumber Wireframes sequentially (Figure 3.6, 3.7, 3.8, 3.9, 3.10, 3.11).
- [ ] **9. Fix Table Numbering in Chapter 3:**
  - [ ] Fix in-text table references (Table 3 $\rightarrow$ Table 3.2, Table 6 $\rightarrow$ Table 3.5).
  - [ ] Renumber duplicate Table 3.5 (Response Time) to Table 3.6, and Throughput to Table 3.7.
- [ ] **10. Add Software Stack Details in Chapter 3:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, Node.js Express 5 Gateway, Python FastAPI, Supabase / PostgreSQL with `pgvector` HNSW & `tsvector` GIN.
- [ ] **11. Align Research Studio / OCR Feature Scope:** Replace unbuilt features (OCR spell correction, confidence gate, editable text preview) with the actual side-by-side legal document viewer, multi-format parsing (PDF, DOCX, TXT, Images), and contextual chat assistant.
