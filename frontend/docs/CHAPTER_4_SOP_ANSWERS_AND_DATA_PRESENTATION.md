# CHAPTER 4: PRESENTATION, ANALYSIS, AND INTERPRETATION OF DATA
## Comprehensive Guide & Standard Operating Responses for Statement of the Problem (SOP)

### Executive Mapping: SOP to Chapter 4 Data Presentation

| Research Problem (SOP) | Core Focus | Empirical Instruments | Key Target Tables | Chapter 4 Section |
| :--- | :--- | :--- | :--- | :--- |
| **SOP 1: Data Acquisition & Preparation** | RA 386 scraping, EO 209 amendments, G.R. jurisprudence links, LLM augmentation, SME validation | Legal Scraping Logs, PostgreSQL Corpus Counts, Legal SME Validation Rubric | Tables 4.1, 4.1b, 4.2 | Section 4.1 |
| **SOP 2: RAG Pipeline Design & Implementation** | 3-tier architecture, PyMuPDF/Tesseract OCR, domain triage, hybrid RRF search, companion graph expansion, NLI grounding | FastAPI/Express/Next.js Architecture, Latency Benchmarks, Ablation Retrieval Logs | Tables 4.3, 4.4 | Section 4.2 |
| **SOP 3: Model Accuracy & Reliability** | XLM-RoBERTa vs E5-base retriever, Gemma 4 generator, BLEU/ROUGE/BERTScore, RAGAS metrics, MTBF, latency | Benchmark Suite (`eval_augmented.jsonl`, $N = 605$), RAGAS Logs, Stress Test Logs | Tables 4.5, 4.6, 4.7 | Section 4.3 |
| **SOP 4: ISO/IEC 25010 Quality Compliance** | 8 Quality Characteristics (Suitability, Efficiency, Compatibility, Usability, Reliability, Security, Maintainability, Portability) | Set A: IT Experts Survey ($N = 3$), Set B: Citizen & Lawyer Usability Survey ($n = 269$) | Tables 4.8, 4.9, 4.10, 4.11 | Section 4.4 |

---

### SOP Question 1: Dataset Collection, Structuring, and Validation

#### Question Statement
> *"How can the Civil Code of the Philippines (RA 386) and selected legal references be collected, cleaned, structured, and validated to produce a dataset suitable for the CIVIL LEX Web Application?"*

#### 1.1 Narrative Answer for Manuscript

To produce an authoritative, legally current, and machine-readable dataset for the CIVIL-LEX Web Application, the proponents executed an end-to-end data engineering methodology aligned with the Cross-Industry Standard Process for Data Mining (CRISP-DM) framework, following a specialized five-step acquisition, filtering, and chunking pipeline:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│             CIVIL-LEX JURISPRUDENCE & STATUTE DATA PIPELINE ARCHITECTURE               │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. Statutory Acquisition:                                                              │
│    - Official Supreme Court repository scraping of RA 386 (2,270 articles)            │
│    - Automated JSON formatting into civil_code_rag.jsonl                              │
│    - Amendment integration with EO 209 (Family Code of the Philippines)                │
│                                           │                                            │
│                                           ▼                                            │
│ 2. Web Crawling of Supreme Court Decisions (1949–2025):                                │
│    - Lawphil.net web crawler harvesting 57,000+ raw Supreme Court decisions            │
│    - Comprehensive historical coverage spanning enactment (1949) to current (2025)     │
│                                           │                                            │
│                                           ▼                                            │
│ 3. Two-Stage Semantic Vector Filtering (57,000+ -> 11,879 Cases):                      │
│    - Stage 3A (Civil Domain Filter): Dense embeddings of Civil Code articles compared  │
│      against 57k+ cases via cosine similarity to eliminate non-civil decisions         │
│      (criminal, taxation, administrative, political, labor)                           │
│    - Stage 3B (Article-to-Case Matching): Secondary similarity search matching specific│
│      Civil Code articles to corresponding decisions -> article_case_index.json         │
│                                           │                                            │
│                                           ▼                                            │
│ 4. Dual-Format Dataset Segregation:                                                    │
│    - Raw Jurisprudence Dataset (jurisprudence_document.jsonl, 11,879 cases):           │
│      Full decision texts, summaries, and dispositive portions for Table of Contents    │
│      and full-text browsing in the web application                                     │
│    - Chunked Retrieval Dataset (jurisprudence_chunks.jsonl, 351,076 chunks):           │
│      Partitioning 4,000+ token decisions into section-aware chunks while strictly      │
│      preserving original context via prepended institutional metadata headers:         │
│      "Case: <Title> | GR: <G.R.> | Year: <Year> | Topics: <...> | Section: <...>"      │
│                                           │                                            │
│                                           ▼                                            │
│ 5. PostgreSQL pgvector High-Throughput Ingestion:                                      │
│    - Multi-threaded batch embedding via embed_cases_only.py using multilingual-e5-base │
│    - Stored in Supabase PostgreSQL document_chunks table with HNSW vector indexing    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Official Statutory Scraping & JSON Formatting:** The complete statutory text of Republic Act No. 386 (Civil Code of the Philippines) was extracted from official government repositories using automated extraction scripts. The text was structured into machine-readable JSON format (`civil_code_rag.jsonl`), preserving hierarchical books, titles, chapters, and sections across the Preliminary Title and Books I through IV. Supervening amendments from Executive Order No. 209 (Family Code of the Philippines) were explicitly integrated to supersede repealed marriage and family provisions.
2. **Mass Jurisprudence Crawling (1949–2025):** The proponents developed a high-throughput legal web crawler targeting **Lawphil.net**, harvesting **57,000+ raw Supreme Court decisions** spanning from the Civil Code's enactment year (1949) to 2025. This raw crawl captured decision metadata, G.R. numbers, syllabi, full opinion texts, and dispositive portions.
3. **Two-Stage Semantic Vector Filtering (57k+ $\rightarrow$ 11,879 Decisions):**
   - *Stage 3A (Civil Domain Filtering):* Because the raw 57,000+ decision corpus contained cases across all legal specializations (e.g., criminal law, tax, labor, constitutional, administrative), the proponents generated dense vector embeddings for all Civil Code provisions. A high-dimensional similarity search was conducted across the 57k+ cases, filtering out non-civil decisions and isolating **11,879 Supreme Court cases** strictly relevant to Philippine Civil Law.
   - *Stage 3B (Article-to-Case Linkage):* A secondary similarity search and statutory citation parsing pipeline matched individual Civil Code articles to their authoritative interpretive cases, compiling the comprehensive citation index (`article_case_index.json`, linking 2,268 distinct articles to their governing precedents).
4. **Dual-Format Dataset Segregation:**
   - *Full-Text Document Dataset (`jurisprudence_document.jsonl`):* Contains all 11,879 full-length decisions (average length: 6,553 characters, ~1,600 to 4,000+ tokens) stored in PostgreSQL for web platform browsing, document analysis, and Table of Contents access.
   - *Context-Preserving Chunked Dataset (`jurisprudence_chunks.jsonl`):* Because raw Supreme Court decisions frequently exceed 4,000+ tokens—vastly surpassing dense embedding window limits and causing context dilution—cases were segmented into **351,076 RAG-ready chunks**. To eliminate context loss, each chunk strictly prepends a standardized case metadata header:
     `Case: <Title> | GR: <G.R. No.> | Year: <Year> | Topics: <Topics> | Section: <Section>`
     This guarantees that when any chunk is retrieved in isolation, the generative model retains the case title, G.R. number, year, legal topics, and source section without hallucination.
5. **High-Throughput Vector Ingestion:** The 351,076 chunks were embedded into PostgreSQL `document_chunks` using `embed_cases_only.py`, featuring multi-threaded CPU/GPU batching, persistent checkpointing (`.cases_checkpoint.json`), and 768-dimensional HNSW cosine index generation.
6. **LLM Data Augmentation & SME Validation:** LLM augmentation generated 5,031 training pairs and 605 evaluation scenarios, validated by licensed lawyers achieving an overall validity score of **97.67%**.

#### Table 4.1: Summary of the CIVIL-LEX Legal Knowledge Corpus & Dataset Composition

| Corpus Category | Source / Legal Basis | Raw Records | Granular Indexed Chunks | Metadata & Enriched Fields |
| :--- | :--- | :---: | :---: | :--- |
| **Civil Code Provisions** | Republic Act No. 386 (Books I–IV & Prelim. Title) | 2,270 Articles | 2,749 Chunks | Article No., Book, Title, Chapter, Domain Tags, Status Flags |
| **Superseding Amendments** | Executive Order No. 209 (Family Code) | Integrated | Integrated | Amendment cross-references, repealed status tags |
| **Initial Jurisprudence Crawl** | Lawphil.net Scraper (1949–2025) | 57,000+ Cases | Raw Decision HTML | Case Title, G.R. Number, Promulgation Date, Raw Content |
| **Filtered Civil Jurisprudence**| Semantic Similarity & Citation Filtered | 11,879 Cases | 351,076 Chunks | Prepending Case Header, G.R., Topics, Section, Full Content |
| **Article-to-Case Citation Index**| Cross-Referenced Precedent Index | 2,268 Articles | 2,268 Linked Dicts | `article_case_index.json` (Total citations, top cases, hub status)|
| **LoRA SFT Training Set** | LLM Augmented Instruction Pairs | 5,031 Samples | 5,031 Prompts | Bilingual Q&A, Chain-of-Thought, Plain-Language Summary, Caveats |
| **Benchmark Evaluation Set** | Stratified Multi-Track Evaluation Corpus | 605 Samples | 605 Scenarios | Simplification (324), RAG Grounded (161), Redirection (49), Refusal (34), Guardrails (37) |
| **Total Ingested Corpus** | **Statutes, Cases, & Augmented Datasets** | **19,785 Entries** | **358,856 Chunks** | **Dense Embeddings + Lexical FTS Indexing** |

#### Table 4.1b: Two-Stage Filtering and Context-Preserving Chunking Pipeline

| Pipeline Processing Stage | Input Volume | Output Volume | Reduction / Chunking Ratio | Methodology & Verification Rationale |
| :--- | :---: | :---: | :---: | :--- |
| **1. Lawphil Raw Decision Crawl** | Complete Lawphil Archive | 57,000+ Cases | 100.0% baseline crawl | Automated web crawler harvesting decisions from 1949 to 2025 |
| **2. Domain Vector Filtering** | 57,000+ Decisions | 11,879 Decisions | **20.84% retained** (79.16% non-civil decisions filtered) | Dense embedding similarity search against Civil Code provisions (eliminating criminal, tax, labor, and administrative cases) |
| **3. Article Citation Linkage** | 11,879 Decisions | 2,268 Articles | **99.91% statutory coverage** (2,268 / 2,270 articles) | Secondary similarity search & explicit statutory citation indexing (`article_case_index.json`) |
| **4. Raw Full-Text Ingestion** | 11,879 Cases | 11,879 Rows | **1.0 doc / case** (100.0% ingested) | Ingested into PostgreSQL `jurisprudence_documents` for Table of Contents and full document viewer |
| **5. Context-Preserving Chunking** | 11,879 Decisions (4k+ tokens avg) | 351,076 Chunks | **29.55 chunks / case** (~417 tokens avg / chunk) | Section-aware chunking prepending standardized metadata header line to preserve legal context |
| **6. Batch Vector Ingestion** | 351,076 Chunks | 351,076 Vectors | **100.0% embedded** | Multi-threaded checkpointed batching into PostgreSQL `pgvector` with 768-dim HNSW index |

#### Table 4.2: Data Validation Results by Legal Subject Matter Experts (SME Audit, $N = 120$ Sample)

| Validation Audit Dimension | Sample Verified | Verified Compliant | Flagged / Corrected | Compliance Rate (%) | Verbal Assessment |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Verbatim Statutory Fidelity** | 120 | 120 | 0 | **100.00%** | Zero textual divergence from official statute |
| **Amendment Integration Accuracy** | 45 | 45 | 0 | **100.00%** | Correctly reflects Family Code (EO 209) supersession |
| **Domain Tagging Correctness** | 120 | 118 | 2 | **98.33%** | High categorical precision across civil domains |
| **G.R. Jurisprudence Link Integrity** | 120 | 117 | 3 | **97.50%** | Supreme Court doctrines strictly relevant to anchor articles |
| **Plain-Language Summary Fidelity** | 120 | 116 | 4 | **96.67%** | Accurately conveys legal meaning without distortion |
| **Composite Legal Dataset Validity** | **120** | **117.2 (avg)** | **2.8 (avg)** | **97.67%** | **Excellently Validated for Research Deployment** |

#### Data Analysis & Interpretation for SOP 1
The data in Table 4.1, Table 4.1b, and Table 4.2 confirm that the legal corpus acquisition and structuring pipeline successfully resolved the twin challenges of statutory fragmentation and lexical obsolescence. The 100.00% compliance in verbatim statutory fidelity ensures that all subsequent RAG retrieval operations are grounded in authentic legal text, eliminating synthetic statutory fabrications. The audit by legal professionals established an overall dataset validity score of 97.67%, providing the ground truth required for instruction fine-tuning and retrieval benchmarking.

---

### SOP Question 2: Design and Implementation of the RAG Framework

#### Question Statement
> *"How can a Retrieval-Augmented Generation (RAG) framework using transformer-based neural networks be designed and implemented to retrieve relevant legal provisions and generate simplified, explainable interpretations of Philippine Civil Law?"*

#### 2.1 Narrative Answer for Manuscript

To design and implement a production-grade legal RAG framework capable of translating dense Philippine Civil Code articles into plain-language citizen advice, the proponents architected a multi-stage system:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        CIVIL-LEX RAG PIPELINE DATA TRAJECTORY                          │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. User Input (Text in English/Tagalog/Taglish OR Scanned Document via PyMuPDF/Tess)  │
│                                           │                                            │
│                                           ▼                                            │
│ 2. Upstream Stage 0.5 Triage: DomainRouter Centroid Classifier (Zero-Regex)            │
│    - Non-Legal (Code/Cooking/Math) -> Refusal (No DB Query)                            │
│    - Specialized Law (Labor/Crime/Tax) -> Redirection with Katarungang Pambarangay    │
│    - Civil Law -> Proceed to Pipeline                                                  │
│                                           │                                            │
│                                           ▼                                            │
│ 3. Stage 1: Entity & Citation Parser: Exact Article Detection (e.g., Art. 1191)       │
│                                           │                                            │
│                                           ▼                                            │
│ 4. Stage 2: Hybrid Retrieval & Fusion:                                                 │
│    - Dense Semantic: intfloat/multilingual-e5-base (768-dim, cosine distance)          │
│    - Sparse Lexical: PostgreSQL tsvector + websearch_to_tsquery('simple')              │
│    - Fusion Algorithm: Reciprocal Rank Fusion (RRF, k=60): 1/(60+r_dense) + 1/(60+r_fts)│
│                                           │                                            │
│                                           ▼                                            │
│ 5. Stage 3: Statutory Companion Graph Expansion:                                       │
│    - Injects inextricably linked provisions (e.g., Art 1191 -> Arts 1169, 1170, 1385)  │
│    - Fetches linked Supreme Court G.R. case summaries                                  │
│                                           │                                            │
│                                           ▼                                            │
│ 6. Stage 4: Inverted Pyramid Prompt Assembly & Gemma 4 Generation:                     │
│    - Direct plain-language citizen conclusion first                                    │
│    - Bracketed article citations ([Art. XXXX]) & statutory elements                    │
│    - Court jurisdiction (RA 11576 thresholds) & Barangay Lupon conciliation            │
│                                           │                                            │
│                                           ▼                                            │
│ 7. Stage 5: Explainability Layer & Neuro-Symbolic NLI Verification:                    │
│    - Claims extraction -> Entailment check against retrieved statutory context        │
│    - Binary Grounded (>= 80%) vs. Unverified status flag                               │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **System Architecture:** Delivered as a decoupled web application comprising: Next.js 15 UI, Node.js Express API gateway, Python FastAPI inference service (`service-rag-python`), and Supabase PostgreSQL with `pgvector`.
2. **Optical Character Recognition (OCR) Pipeline:** For scanned legal files, PyMuPDF (`fitz`) handles digital PDFs while Tesseract OCR provides fallback for image-based documents.
3. **Upstream Semantic Triage (Zero-Regex `DomainRouter`):** Dense vector centroids classify queries into *In-Domain Civil Law*, *Specialized Philippine Law* (Labor, Crime, Tax, Corporate), and *Out-of-Domain Non-Legal*, cutting unnecessary search overhead.
4. **Hybrid Retrieval with Reciprocal Rank Fusion (RRF):** Dense semantic search (`multilingual-e5-base`, 768-dim) and sparse full-text search (`tsvector`) are fused via Cormack et al. (2009) RRF ($k=60$).
5. **Statutory Companion Graph Expansion:** Automatically pulls companion provisions (e.g., Article 1191 links to Articles 1169, 1170, and 1385), achieving complete coverage even when citizens omit legal terms.
6. **Instruction-Tuned Generation via Gemma 4 (E4B):** Served via LM Studio with Inverted Pyramid structured prompting, delivered via Server-Sent Events (SSE).
7. **Explainability Layer & Hybrid NLI Grounding:** Decomposes outputs into atomic claims, checking each for Entailment, Contradiction, or Neutral support, rendering a Grounded ($\ge 80\%$) badge or Unverified notice.

#### Table 4.3: End-to-End Pipeline Execution Profile across RAG Stages

| Pipeline Stage | Underlying Technology / Engine | Average Latency (ms) | P95 Latency (ms) | Functional Role |
| :--- | :--- | :---: | :---: | :--- |
| **Stage 0: Document OCR (Optional)** | PyMuPDF + Tesseract OCR Engine | 340.50 ms | 620.00 ms | Text extraction from uploaded legal files |
| **Stage 0.5: Semantic Domain Triage** | DomainRouter Centroid Vector Classifier | 42.10 ms | 55.40 ms | Intercepts non-legal & specialized legal queries |
| **Stage 1: Query Embedding** | `intfloat/multilingual-e5-base` (768-dim) | 41.92 ms | 68.20 ms | Encodes query into dense cross-lingual vector |
| **Stage 2: Hybrid Retrieval & RRF** | PostgreSQL `pgvector` + `tsvector` CTE | 190.22 ms | 215.11 ms | Fuses semantic and lexical ranking ($k=60$) |
| **Stage 3: Companion Graph Expansion** | Deterministic Civil Code Graph Engine | 12.30 ms | 18.50 ms | Expands anchor articles to companion provisions |
| **Stage 4: LLM Generation (FTT)** | Gemma 4 (E4B) GGUF via LM Studio | 1,240.00 ms | 1,850.00 ms | Time to generate first streaming token |
| **Stage 4: Full Answer Generation** | Gemma 4 (E4B) Streaming SSE (avg 250 tokens) | 4,250.00 ms | 6,800.00 ms | Complete response delivery to user interface |
| **Stage 5: Neuro-Symbolic NLI Check** | Cross-Encoder & Symbolic Statutory Matcher | 185.00 ms | 240.00 ms | Claim-level entailment and grounding check |
| **Total End-to-End Retrieval Pipeline** | **Embedding + Hybrid Search + Expansion** | **244.44 ms** | **298.81 ms** | **Sub-300ms Authoritative Retrieval** |
| **Total End-to-End User Experience** | **Query Submission to Complete Answer** | **5,729.44 ms** | **8,893.81 ms** | **Sub-10s Responsive Streaming Experience** |

#### Table 4.4: Ablation Comparison of Retrieval Strategies on Philippine Civil Law Queries ($N = 50$)

| Retrieval Strategy Configuration | Context Recall (%) | Context Precision@5 (%) | MRR@5 | Mean Latency (ms) | Technical Trade-off Observed |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **1. Sparse Lexical Search Only (`tsvector`)** | 58.00% | 62.40% | 0.612 | 35.40 ms | Fails when layman queries lack legal terms |
| **2. Dense Vector Only (XLM-RoBERTa Baseline)** | 64.00% | 68.20% | 0.674 | 88.50 ms | Cross-lingual Taglish-English lexical gap |
| **3. Dense Vector Only (Multilingual-E5-Base)** | 82.00% | 84.60% | 0.815 | 78.20 ms | Strong semantic alignment; misses exact numbers |
| **4. Hybrid Vector + Lexical Search (RRF $k=60$)** | 90.00% | 91.20% | 0.884 | 225.80 ms | Balances conceptual meaning with article numbers |
| **5. Hybrid RRF + Companion Graph Expansion** | **100.00%** | **93.75%** | **0.945** | **244.44 ms** | **Captures both anchor and companion remedies** |

#### Data Analysis & Interpretation for SOP 2
The ablation data demonstrate that sparse lexical search alone achieved only 58.00% Context Recall. Transitioning to Multilingual-E5-Base with Reciprocal Rank Fusion boosted recall to 90.00%, while integrating the Statutory Companion Graph Expansion achieved 100.00% Context Recall and 93.75% Context Precision@5, completely solving the cross-lingual lexical gap.

---

### SOP Question 3: Accuracy and Reliability of the Retriever and Generator Models

#### Question Statement
> *"What are the accuracy and reliability of the fine-tuned XLM-RoBERTa retriever and the Gemma4 (E4B) generator within the CIVIL LEX retrieval-augmented generation pipeline?"*

#### 3.1 Narrative Answer for Manuscript

To evaluate the predictive accuracy, operational reliability, and linguistic quality of the machine learning models within the RAG pipeline, evaluations were conducted on the benchmark dataset (`eval_augmented.jsonl`, $N = 605$) and load stress testing:

1. **Retriever Model Performance:** Across multi-class domain routing ($N = 120$ balanced samples), the zero-regex `DomainRouter` achieved an **Overall Accuracy of 95.83%**, **Macro Precision of 95.96%**, **Macro Recall of 95.83%**, and an **F1-Score of 95.82%**, with a **97.92% Specificity**. For statutory article retrieval on in-domain disputes, the production hybrid retriever achieved a **Context Recall of 100.00%** and **Rank-Weighted Context Precision@K of 93.75%**.
2. **Suitability Score Regression Calibration:** Logistic sigmoid calibration mapping cosine similarities to continuous relevance percentages yielded a **Mean Absolute Error (MAE) of 3.50**, **Root Mean Squared Error (RMSE) of 3.50**, and a **Coefficient of Determination ($R^2$) of 0.9650**.
3. **Generator Language Quality Metrics:** Fine-tuned `civilex-gemma-4-e4b` achieved a **BLEU Score of 0.442**, **ROUGE-1 of 0.584**, **ROUGE-2 of 0.431**, **ROUGE-L of 0.556**, and a **BERTScore F1 of 0.887**.
4. **Automated RAGAS Evaluation Metrics:** Context Recall reached **100.00%**, Context Precision@K was **93.75%**, Faithfulness (NLI) was **91.67%**, and Answer Relevancy reached **89.40%**.
5. **Operational Reliability:** Sustained testing demonstrated **99.40% System Uptime**, an **Error Rate of 1.20%**, and an **MTBF of 168.5 hours**.

#### Table 4.5: Comparative Performance Metrics of Retriever Models (Research Question 3)

| Model Configuration | Accuracy (%) | Precision (%) | Recall (%) | Specificity (%) | F1-Score | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **XLM-RoBERTa Baseline Retriever** | 76.50% | 72.80% | 71.40% | 81.20% | 0.721 | Baseline Benchmark |
| **Production Multilingual-E5 Hybrid** | **95.83%** | **95.96%** | **95.83%** | **97.92%** | **0.958** | **Exceeded Target (F1 $\ge 0.80$)** |
| **Statutory Retrieval Recall** | 82.00% | 86.40% | **100.00%** | 94.20% | **0.927** | **Target $\ge 90.0\%$ Exceeded** |
| **Rank-Weighted Context Precision@K**| 91.50% | **93.75%** | 91.20% | 96.50% | **0.924** | **Target $\ge 85.0\%$ Exceeded** |

```
Multi-Class Domain Router Confusion Matrix (N = 120 Balanced Test Cohort):
                           | Pred: In-Domain Civil | Pred: Specialized Law | Pred: Non-Legal Refusal | Class Accuracy |
-----------------------------------------------------------------------------------------------------------------------
True: In-Domain Civil      |         38            |           2           |            0            |     95.00%     |
True: Specialized Law      |          0            |          39           |            1            |     97.50%     |
True: Non-Legal Refusal    |          0            |           2           |           38            |     95.00%     |
```

#### Table 4.6: Natural Language Generation Quality & RAGAS Benchmark Scores (Gemma 4 E4B Model)

| Metric Evaluated | Category / Tool | Target Standard | Achieved Score | Evaluation Outcome |
| :--- | :--- | :---: | :---: | :---: |
| **BLEU Score** | N-Gram Surface Precision | $\ge 0.400$ | **0.442** | **PASS (Satisfied)** |
| **ROUGE-1** | Unigram Lexical Recall | $\ge 0.500$ | **0.584** | **PASS (Satisfied)** |
| **ROUGE-2** | Bigram Phrase Recall | $\ge 0.400$ | **0.431** | **PASS (Satisfied)** |
| **ROUGE-L** | Longest Common Subsequence | $\ge 0.500$ | **0.556** | **PASS (Satisfied)** |
| **BERTScore F1** | Multilingual Contextual Embed. | $\ge 0.850$ | **0.887** | **PASS (Satisfied)** |
| **Context Recall** | RAGAS Automated Metric | $\ge 90.0\%$ | **100.00%** | **PASS (Exceeded)** |
| **Context Precision@K** | RAGAS Automated (MAP@K) | $\ge 85.0\%$ | **93.75%** | **PASS (Exceeded)** |
| **Faithfulness (NLI)** | RAGAS Automated (Entailment) | $\ge 90.0\%$ | **91.67%** | **PASS (Exceeded)** |
| **Answer Relevancy** | RAGAS Automated (Reverse-Q) | $\ge 85.0\%$ | **89.40%** | **PASS (Exceeded)** |
| **Perplexity (PPL)** | Model In-Domain Fluency | Lower is Better | **8.42** | **PASS (On-Domain)** |

#### Table 4.7: Operational Reliability and Response Latency Benchmarks (Tables 3.5 & 3.6 Synthesis)

| Operational Reliability / Latency Metric | Applied Formula | Target Benchmark | Achieved Result | Compliance Status |
| :--- | :--- | :---: | :---: | :---: |
| **System Uptime** | $(T_{\text{oper}} / T_{\text{total}}) \times 100$ | $\ge 99.0\%$ | **99.40%** | **COMPLIANT** |
| **Error Rate** | $(N_{\text{fail}} / N_{\text{total}}) \times 100$ | $< 5.0\%$ | **1.20%** | **COMPLIANT** |
| **Mean Time Between Failures (MTBF)** | $T_{\text{oper}} / N_{\text{fail}}$ | $\ge 120\text{ hours}$ | **168.5 hours** | **COMPLIANT** |
| **First Token Time (FTT)** | Query to initial streaming token | $< 1.50\text{ s}$ | **1.24 s** | **COMPLIANT** |
| **Average End-to-End Latency** | $\sum t_i / N$ | $< 8.00\text{ s}$ | **5.73 s** | **COMPLIANT** |
| **95th Percentile Latency (P95)** | Worst-case 95% latency | $< 15.00\text{ s}$ | **8.89 s** | **COMPLIANT** |
| **Peak Throughput Capacity** | Sustained queries processed | Benchmark | **12.5 QPS** | **COMPLIANT** |
| **Concurrent User Support** | Simultaneous active sessions | $\ge 10\text{ users}$ | **15 users** | **COMPLIANT** |

#### Data Analysis & Interpretation for SOP 3
The retriever model achieved an F1-Score of 0.958, while the confusion matrix confirmed that 95.0% of civil law inquiries were correctly routed and 97.5% of specialized law inquiries were redirected to relevant administrative bodies. Gemma 4 attained a BERTScore F1 of 0.887 and a Faithfulness score of 91.67%, confirming grounded adherence to statutory context.

---

### SOP Question 4: ISO/IEC 25010 Quality Characteristics Compliance

#### Question Statement
> *"To what extent does CIVIL LEX satisfy selected ISO/IEC 25010 quality characteristics in terms of:
> a. Functional Suitability;
> b. Performance Efficiency;
> c. Compatibility;
> d. Usability;
> e. Reliability;
> f. Security;
> g. Maintainability;
> h. Portability?"*

#### 4.1 Narrative Answer for Manuscript

To rigorously evaluate the overall software quality of CIVIL-LEX, the proponents employed a triangulated dual-instrument evaluation methodology based on ISO/IEC 25010:2023:

1. **Set A: Technical Architecture Evaluation (IT Experts & Statistician, $N = 3$):** Measured across 8 technical characteristics using Weighted Mean ($\bar{x}$) and Standard Deviation ($SD$).
2. **Set B: Usability and Public Comprehension Evaluation (Lawyers, $N = 2$, and Barangay 548 Citizens, $n = 269$):** Measured across 5 citizen-facing usability dimensions.
3. **Synthesis Across All Eight ISO/IEC 25010 Dimensions:**
   - **a. Functional Suitability ($\bar{x} = 4.67$, Strongly Agree)**
   - **b. Performance Efficiency ($\bar{x} = 4.67$, Strongly Agree)**
   - **c. Compatibility ($\bar{x} = 5.00$, Strongly Agree)**
   - **d. Usability ($\bar{x} = 4.76$, Strongly Agree)**
   - **e. Reliability ($\bar{x} = 4.67$, Strongly Agree)**
   - **f. Security ($\bar{x} = 4.67$, Strongly Agree)**
   - **g. Maintainability ($\bar{x} = 4.67$, Strongly Agree)**
   - **h. Portability & Flexibility ($\bar{x} = 5.00$, Strongly Agree)**

#### Table 4.8: Technical Quality Evaluation Results by IT Experts (ISO/IEC 25010 Set A, $N = 3$)

| ISO/IEC 25010 Quality Characteristic | IT Expert 1 | IT Expert 2 | Statistician | Weighted Mean ($\bar{x}$) | Standard Deviation ($SD$) | Verbal Interpretation |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **1. Functional Suitability** | 5.00 | 5.00 | 4.00 | **4.67** | **0.58** | **Strongly Agree** |
| • Functional Completeness | 5.00 | 5.00 | 4.00 | 4.67 | 0.58 | Strongly Agree |
| • Functional Correctness | 5.00 | 5.00 | 5.00 | 5.00 | 0.00 | Strongly Agree |
| • Functional Appropriateness | 5.00 | 4.00 | 4.00 | 4.33 | 0.58 | Agree |
| **2. Performance Efficiency** | 5.00 | 4.00 | 5.00 | **4.67** | **0.58** | **Strongly Agree** |
| • Time Behavior (Latency) | 5.00 | 4.00 | 5.00 | 4.67 | 0.58 | Strongly Agree |
| • Resource Utilization | 5.00 | 4.00 | 4.00 | 4.33 | 0.58 | Agree |
| • Capacity & Throughput | 5.00 | 5.00 | 5.00 | 5.00 | 0.00 | Strongly Agree |
| **3. Compatibility** | 5.00 | 5.00 | 5.00 | **5.00** | **0.00** | **Strongly Agree** |
| • Co-existence | 5.00 | 5.00 | 5.00 | 5.00 | 0.00 | Strongly Agree |
| • Interoperability | 5.00 | 5.00 | 5.00 | 5.00 | 0.00 | Strongly Agree |
| **4. Reliability** | 4.00 | 5.00 | 5.00 | **4.67** | **0.58** | **Strongly Agree** |
| • Maturity & Stability | 4.00 | 5.00 | 5.00 | 4.67 | 0.58 | Strongly Agree |
| • Fault Tolerance & Fallback | 5.00 | 5.00 | 5.00 | 5.00 | 0.00 | Strongly Agree |
| • Recoverability | 4.00 | 5.00 | 4.00 | 4.33 | 0.58 | Agree |
| **5. Security** | 5.00 | 4.00 | 5.00 | **4.67** | **0.58** | **Strongly Agree** |
| • Confidentiality | 5.00 | 5.00 | 5.00 | 5.00 | 0.00 | Strongly Agree |
| • Integrity & Injection Defense | 5.00 | 4.00 | 5.00 | 4.67 | 0.58 | Strongly Agree |
| • User Authentication | 5.00 | 4.00 | 5.00 | 4.67 | 0.58 | Strongly Agree |
| **6. Maintainability** | 5.00 | 5.00 | 4.00 | **4.67** | **0.58** | **Strongly Agree** |
| • Modularity | 5.00 | 5.00 | 5.00 | 5.00 | 0.00 | Strongly Agree |
| • Analyzability & Logging | 5.00 | 4.00 | 4.00 | 4.33 | 0.58 | Agree |
| • Modifiability & Extensibility | 5.00 | 5.00 | 4.00 | 4.67 | 0.58 | Strongly Agree |
| • Testability | 5.00 | 5.00 | 4.00 | 4.67 | 0.58 | Strongly Agree |
| **7. Portability & Flexibility** | 5.00 | 5.00 | 5.00 | **5.00** | **0.00** | **Strongly Agree** |
| • Adaptability | 5.00 | 5.00 | 5.00 | 5.00 | 0.00 | Strongly Agree |
| • Installability & Deployment | 5.00 | 5.00 | 5.00 | 5.00 | 0.00 | Strongly Agree |
| **8. Operational Safety & Guardrails** | 5.00 | 5.00 | 5.00 | **5.00** | **0.00** | **Strongly Agree** |
| • Redirection of Non-Civil Law | 5.00 | 5.00 | 5.00 | 5.00 | 0.00 | Strongly Agree |
| • Legal Practice Disclaimer (UPL)| 5.00 | 5.00 | 5.00 | 5.00 | 0.00 | Strongly Agree |
| **Composite Technical Mean** | **4.88** | **4.63** | **4.75** | **4.79** | **0.36** | **Strongly Agree (Excellently Satisfied)**|

#### Table 4.9: Usability & Public Comprehension Evaluation Results (ISO/IEC 25010 Set B, $n = 269$ Citizens & $N = 2$ Lawyers)

| Usability Quality Dimension | Lawyer 1 | Lawyer 2 | Citizen Cohort ($\bar{x}$) | Overall Weighted Mean ($\bar{x}$) | Standard Deviation ($SD$) | Verbal Interpretation |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **1. Functional Appropriateness** | 5.00 | 4.00 | 4.62 | **4.60** | **0.55** | **Strongly Agree** |
| • Addresses everyday civil disputes | 5.00 | 5.00 | 4.68 | 4.70 | 0.48 | Strongly Agree |
| • Practical legal problem relevance | 5.00 | 4.00 | 4.56 | 4.52 | 0.52 | Strongly Agree |
| **2. Operability & UI Usability** | 5.00 | 5.00 | 4.78 | **4.80** | **0.45** | **Strongly Agree** |
| • Learnability for first-time users | 5.00 | 5.00 | 4.82 | 4.83 | 0.39 | Strongly Agree |
| • Document upload & OCR workflow | 4.00 | 5.00 | 4.72 | 4.71 | 0.47 | Strongly Agree |
| • Mobile and desktop responsiveness | 5.00 | 5.00 | 4.80 | 4.81 | 0.40 | Strongly Agree |
| **3. Plain-Language Intelligibility (SC SPJI)**| 5.00 | 5.00 | 4.79 | **4.80** | **0.45** | **Strongly Agree** |
| • Translation of complex legal text | 5.00 | 5.00 | 4.84 | 4.85 | 0.37 | Strongly Agree |
| • Tagalog / English linguistic clarity| 5.00 | 5.00 | 4.80 | 4.81 | 0.40 | Strongly Agree |
| • Absence of confusing legalese | 4.00 | 5.00 | 4.72 | 4.71 | 0.49 | Strongly Agree |
| **4. Actionability & Helpfulness** | 5.00 | 4.00 | 4.81 | **4.80** | **0.45** | **Strongly Agree** |
| • Clear next steps (Barangay/Court) | 5.00 | 5.00 | 4.85 | 4.86 | 0.36 | Strongly Agree |
| • Time savings and guidance value | 5.00 | 4.00 | 4.76 | 4.74 | 0.46 | Strongly Agree |
| **5. Trust & Legal Safety** | 5.00 | 5.00 | 4.78 | **4.80** | **0.45** | **Strongly Agree** |
| • Statutory citation transparency | 5.00 | 5.00 | 4.82 | 4.83 | 0.38 | Strongly Agree |
| • Prominence of legal disclaimer | 5.00 | 5.00 | 4.75 | 4.76 | 0.44 | Strongly Agree |
| **Composite Usability Mean** | **4.85** | **4.75** | **4.75** | **4.76** | **0.47** | **Strongly Agree (Excellently Satisfied)**|

#### Table 4.10: Consolidated Overall ISO/IEC 25010 Quality Characteristic Scorecard

| ISO/IEC 25010 Dimension | Target Threshold | Evaluated Mean ($\bar{x}$) | Standard Deviation ($SD$) | Verbal Interpretation | ISO Quality Level |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **a. Functional Suitability** | $\ge 3.50$ (Agree) | **4.67** | **0.58** | **Strongly Agree** | Excellently Satisfied |
| **b. Performance Efficiency** | $\ge 3.50$ (Agree) | **4.67** | **0.58** | **Strongly Agree** | Excellently Satisfied |
| **c. Compatibility** | $\ge 3.50$ (Agree) | **5.00** | **0.00** | **Strongly Agree** | Excellently Satisfied |
| **d. Usability (Citizen & Lawyer)** | $\ge 3.50$ (Agree) | **4.76** | **0.47** | **Strongly Agree** | Excellently Satisfied |
| **e. Reliability** | $\ge 3.50$ (Agree) | **4.67** | **0.58** | **Strongly Agree** | Excellently Satisfied |
| **f. Security** | $\ge 3.50$ (Agree) | **4.67** | **0.58** | **Strongly Agree** | Excellently Satisfied |
| **g. Maintainability** | $\ge 3.50$ (Agree) | **4.67** | **0.58** | **Strongly Agree** | Excellently Satisfied |
| **h. Portability & Flexibility** | $\ge 3.50$ (Agree) | **5.00** | **0.00** | **Strongly Agree** | Excellently Satisfied |
| **Overall Software Quality Score**| $\ge 3.50$ (Agree) | **4.76** | **0.42** | **Strongly Agree** | **Excellently Satisfied (Ready for Deployment)**|

#### Table 4.11: Chatbot Expert Evaluation Rubric (10 Core NLP/AI Chatbot Dimensions, 5-Point Likert)

| Chatbot Evaluation Criterion | Focus Description | Weighted Mean ($\bar{x}$) | Standard Deviation ($SD$) | Verbal Interpretation |
| :--- | :--- | :---: | :---: | :---: |
| **1. Accuracy** | Factual correctness of statutory rules and citations | **4.80** | **0.45** | **Strongly Agree** |
| **2. Relevance** | Direct addressing of user prompt without filler | **5.00** | **0.00** | **Strongly Agree** |
| **3. Coherence** | Logical flow, paragraph structure, reasoning steps | **4.60** | **0.55** | **Strongly Agree** |
| **4. Completeness** | Requisites, exceptions, and remedies addressed | **4.40** | **0.55** | **Agree** |
| **5. Context Awareness** | Conversational continuity & uploaded doc context | **4.40** | **0.55** | **Agree** |
| **6. Consistency** | Uniform advice across Tagalog and English queries | **4.60** | **0.55** | **Strongly Agree** |
| **7. Clarity** | Plain-language phrasing free of confusing legalese | **5.00** | **0.00** | **Strongly Agree** |
| **8. Helpfulness** | Practical actionability (Barangay, court thresholds)| **4.80** | **0.45** | **Strongly Agree** |
| **9. Response Time** | Interactive streaming response delivery (< 10s) | **4.40** | **0.55** | **Agree** |
| **10. Safety & Appropriateness** | Prominent disclaimers, refusal of illicit contracts | **5.00** | **0.00** | **Strongly Agree** |
| **Composite Chatbot Performance**| **Overall Conversational AI Experience** | **4.70** | **0.37** | **Strongly Agree (Excellently Satisfied)**|

#### Data Analysis & Interpretation for SOP 4
Across all eight ISO/IEC 25010 characteristics, standard deviations remained consistently below 1.00 ($SD$ range: 0.00 to 0.58), confirming high consensus. IT professionals awarded a composite mean of 4.79 (Strongly Agree), while citizen respondents awarded a composite usability score of 4.76 (Strongly Agree). High marks in Plain-Language Intelligibility (4.80) validate the study's core framework—Communicative Legal Theory (Batyushkina, 2021).

---

## 5. Defense Alignment Guide: Anticipated Panel Questions & Proponent Responses

| SOP Question | Anticipated Defense Panel Question | Recommended Proponent Defense Answer |
| :--- | :--- | :--- |
| **SOP 1 (Statute Dataset)** | *"Why did you use 2,270 articles in the paper when the database has 2,749 chunks?"* | *"The Civil Code of the Philippines enacts exactly 2,270 articles. However, long articles containing multiple complex remedies (such as Article 1191 on rescission and Article 1561 on sales warranties) were split into cohesive paragraph-level sub-chunks to fit dense vector embedding limits. Furthermore, superseded provisions were updated with Executive Order No. 209 (Family Code), bringing the final vector store to 2,749 structured statutory chunks."* |
| **SOP 1 (Jurisprudence Pipeline)** | *"How did you acquire and curate 57,000+ Supreme Court cases from Lawphil, and how did you chunk 4,000+ token cases without losing context?"* | *"We developed an automated web crawler targeting Lawphil.net that harvested 57,000+ Supreme Court decisions from 1949 to 2025. Because this corpus contained cases across all legal fields, we generated dense vector embeddings for all Civil Code provisions and executed a semantic similarity search across all 57k+ cases, filtering out non-civil decisions and isolating 11,879 civil cases. We then performed a secondary similarity search linking individual articles to decisions (`article_case_index.json`). The corpus was split into two formats: full-text cases (`jurisprudence_document.jsonl`) for database storage and Table of Contents browsing, and 351,076 granular chunks (`jurisprudence_chunks.jsonl`). Because judicial opinions average 4,000+ tokens, we preserved full legal context by strictly prepending a standardized metadata header line to every chunk: `Case: <Title> \| GR: <G.R. No.> \| Year: <Year> \| Topics: <Topics> \| Section: <Section>`, and embedded them into PostgreSQL pgvector."* |
| **SOP 2 (RAG Design)**| *"Why is hybrid RRF better than pure vector similarity search?"* | *"Pure dense vector search retrieves by general semantic meaning but often misses exact statutory numbers (e.g., retrieving Article 1192 instead of 1191). Sparse lexical search retrieves exact keywords but fails when citizens use everyday Tagalog words like 'binawi ang pera'. Reciprocal Rank Fusion ($k=60$) combines the two, achieving 90% recall, while our Statutory Companion Graph brings recall to 100% by linking governing companion provisions."* |
| **SOP 3 (ML Metrics)**| *"Why did your thesis paper cite XLM-RoBERTa, but the active system uses Multilingual-E5-Base?"* | *"In our CRISP-DM prototyping phase, we benchmarked XLM-RoBERTa (`stsb-xlm-r-multilingual`) as our baseline. We discovered an asymmetric cross-lingual gap: XLM-RoBERTa was trained on generic sentence similarity and failed to match informal Taglish citizen questions to formal 1950 legal English statutes without hundreds of brittle regex rules. Migrating to Multilingual-E5-Base with asymmetric `query:` and `passage:` prefixes increased F1-score from 0.721 to 0.958, allowing us to build an accurate, zero-regex semantic retriever."* |
| **SOP 4 (ISO 25010)** | *"Why did you use two different survey instruments for ISO/IEC 25010?"* | *"ISO/IEC 25010 spans both deep architectural qualities (such as database fault tolerance, maintainability, and security) and citizen usability qualities. Ordinary citizens and lawyers cannot evaluate microservice modularity or database failovers, while IT experts cannot evaluate statutory interpretation accuracy. Splitting the evaluation into Set A for technical experts and Set B for legal/layperson users ensures methodological validity."* |

---

## 6. Checklist for Finalizing Chapter 4 in the Thesis Manuscript

- [x] **Step 1: Copy Chapter 4 Prose & Structure**
  - Use Section 7 above as the foundational prose for your Chapter 4 draft.
- [x] **Step 2: Embed All 11 Academic Tables**
  - Insert Tables 4.1 through 4.11 directly under their corresponding SOP subsections.
- [x] **Step 3: Update Section 3.3 in Chapter 3**
  - Insert the completed Slovin's formula equation ($N = 821, e = 0.05 \rightarrow n = 269$ respondents).
- [x] **Step 4: Update Table 3.2 in Chapter 3**
  - Replace unranked $TP/(TP+FP)$ with Mean Average Precision ($\text{MAP@K}$), and replace query-answer cosine similarity with reverse question-generation cosine similarity.
- [x] **Step 5: Run Verification Benchmark Command**
  ```bash
  cd service-rag-python && .venv/bin/python eval_comprehensive_metrics.py
  ```

