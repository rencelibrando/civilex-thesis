# CIVIL-LEX: AI-Powered Philippine Civil Law Legal Assistant & RAG System

[![Model on Hugging Face](https://img.shields.io/badge/%F0%9F%A4%97%20Hugging%20Face-civilex--gemma--4--e4b-blue)](https://huggingface.co/renzzyyy1028/civilex-gemma-4-e4b)
[![Dataset on Hugging Face](https://img.shields.io/badge/%F0%9F%A4%97%20Dataset-civil--code--phil-green)](https://huggingface.co/datasets/renzzyyy1028/civil-code-phil)

An intelligent, grounded Retrieval-Augmented Generation (RAG) system specialized in the **Civil Code of the Philippines (Republic Act No. 386)** and the **Family Code of the Philippines (Executive Order No. 209)**.

---

## 1. Overview & Objectives

**CIVIL-LEX** bridges the accessibility gap in Philippine civil law by providing conversational, legally grounded assistance for citizens, students, and legal practitioners.

Unlike general-purpose conversational LLMs prone to jurisdictional hallucinations, CIVIL-LEX enforces:
- **Strict Statutory Grounding**: Primary reliance on enacted provisions of RA 386 and EO 209, supported by Supreme Court jurisprudence.
- **Domain Guardrails**: Automatic detection and constructive refusal of out-of-scope inquiries (Criminal Law, Labor Law, Taxation, and Code Generation).
- **Procedural Guidance**: Extraction of competent trial courts under RA 11576 monetary thresholds, Katarungang Pambarangay (RA 7160) prerequisites, and actionable legal remedies.

---

## 2. Models & Data Resources

| Asset | Link | Description |
| :--- | :--- | :--- |
| **Fine-Tuned LLM** | [`civilex-gemma-4-e4b`](https://huggingface.co/renzzyyy1028/civilex-gemma-4-e4b) | Fine-tuned Gemma model tailored for Philippine civil legal analysis. |
| **Statutory Dataset** | [`civil-code-phil`](https://huggingface.co/datasets/renzzyyy1028/civil-code-phil) | Structured statutory text and benchmark queries for RA 386 and EO 209. |

---

## 3. Key Capabilities

- **Interactive Legal Assistant**: Real-time SSE streaming chat supporting English and Tagalog / Taglish legal inquiries.
- **Statutory Explorer (`/civil-code`)**: Full-text and categorical browsing of RA 386 and EO 209 articles with integrated search.
- **Legal Document Analysis**: Ingestion and clause-by-clause compliance review of legal drafts, affidavits, and deeds (PDF/DOCX).
- **Legal Action Summary**: Automatically computes:
  - Governing Civil Code Articles and essential statutory elements.
  - Court Jurisdiction (Small Claims $\le$ ₱1M, MTC $\le$ ₱2M, RTC > ₱2M under RA 11576; Family Courts under RA 8369).
  - Pre-litigation Katarungang Pambarangay conciliation requirements.
  - Recommended civil actions (e.g., Judicial Rescission, *Accion Redhibitoria*, Quasi-Delict damages).
- **NLI Grounding Verification**: Cross-encoder verification ensuring generated advice is entailed by retrieved statutory text.

---

## 4. Pipeline & Retrieval Highlights

- **Statutory Companion Graph**: Expands anchor articles to companion provisions (e.g., Rescission under Art. 1191 links with Arts. 1169, 1170, and 1385; Quasi-Delict Art. 2176 links with Arts. 2180, 2185, and 2199).
- **Adaptive Noise Pruning**: Filters retrieved chunks that drop significantly in semantic similarity relative to top-ranked anchors, preserving precision.
- **Inverted Pyramid Synthesis**: Responses prioritize direct legal conclusions first, followed by bracketed article citations (`[Art. XXXX]`) and factual application.

---

## 5. Evaluation Benchmarks

CIVIL-LEX was benchmarked using the RAGAS framework across Guardrail Routing (Stage 1) and In-Domain Civil Law Core Metrics (Stage 2):

| Metric / Dimension | Target Threshold | Baseline | Achieved Score | Evaluation Outcome |
| :--- | :---: | :---: | :---: | :---: |
| **Stage 1: Guardrail Compliance** | **100.0%** | 50.0% | **100.0%** | **PASS** |
| **Stage 2: Context Recall** | $\ge$ **90.0%** | 0.0% | **100.0%** | **PASS** |
| **Stage 2: Context Precision** | $\ge$ **85.0%** | 39.6% | **93.8%** | **PASS** |
| **Stage 2: Faithfulness (Grounding)** | $\ge$ **90.0%** | 0.0% | **100.0%** | **PASS** |
| **Stage 2: Answer Relevancy** | $\ge$ **85.0%** | 60.0% | **91.2%** | **PASS** |
  
Detailed test suites, including ISO/IEC 25010 performance benchmarks, are available in the test execution scripts.
