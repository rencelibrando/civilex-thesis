# CIVIL-LEX RAG Pipeline Architectural Diagnosis & Implementation Plan

**Target System:** `civilex-thesis` (Philippine Civil Code RAG & Simplification Engine)  
**Primary Focus:** Plain-language simplification for Filipino citizens, bilingual (English & Tagalog) grounding, 3-way domain triage, and eliminating fragile keyword/regex expansions.

---

## 1. Executive Summary: Is the Implementation Standard or Overengineered?

### Direct Verdict
**The current implementation is heavily overengineered, brittle, and overfitted to benchmark test cases.**

While the conceptual vision (hybrid retrieval + statutory civil primacy + citizen simplification + factual verification) is well-aligned with legal NLP thesis goals, the codebase has accumulated over **500 lines of regex rules, 40+ keyword stem lists, hardcoded score boosts, and manual query expansions** trying to compensate for weaknesses in the underlying ML models.

### The Root Cause: The Asymmetric Cross-Lingual & Lexical Gap

```
┌────────────────────────────────────────────────────────────────────────┐
│                        THE ROOT MISMATCH                               │
├─────────────────────────────────────┬──────────────────────────────────┤
│           User Query Space          │       Corpus Knowledge Space     │
├─────────────────────────────────────┼──────────────────────────────────┤
│ - Ordinary Filipino citizens        │ - Enacted in 1949/1950 (RA 386)  │
│ - Colloquial Tagalog / Taglish      │ - 100% Formal Statutory English  │
│ - Layman terms ("bawiin ang pera",  │ - Technical Latin/Spanish terms  │
│   "nabangga ng truck", "utang")     │   ("rescission", "quasi-delict", │
│                                     │   "mutuum", "mora solvendi")     │
└─────────────────────────────────────┴──────────────────────────────────┘
                                   │
              Legacy Embedding: stsb-xlm-r-multilingual
         (Trained on sentence similarity, NOT legal retrieval)
                                   │
                                   ▼
        FAILED to match layman queries to statutory provisions!
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│               THE HEURISTIC TRAP (OVERENGINEERING)                     │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Regex expansions (PHILIPPINE_LEGAL_EXPANSIONS): Forcibly appends    │
│    "Art 1191 Art 1170 rescission breach" whenever "contractor" appears │
│ 2. Monolithic Regex Guardrails (NON_LEGAL_PATTERNS, 150+ lines)        │
│ 3. Score Cookbooks (key_legal_stems +3.0, +15 for "utang", etc.)       │
│ 4. Cosmetic Suitability Math (98.5% - count*0.5, 68.0% - out_idx*0.5)  │
│ 5. Post-gen Regex Surgery (collapse_duplicate_statute_blocks)          │
└────────────────────────────────────────────────────────────────────────┘
```

Because the legacy bi-encoder (`stsb-xlm-r-multilingual`) could not bridge this gap, developers had to write manual regex rules to append legal English keywords to the user's queries. Every time a new test failed in `eval_ragas.py`, more strings were added to the lists.

---

## 2. Comprehensive Pipeline Audit

### A. Intent Gating & Boundary Guardrails (`main.py` lines 607–972)
* **What exists:**
  - `classify_query_intent` & `classify_document_domain` using monolithic regex arrays:
    - `NON_LEGAL_PATTERNS`: 150+ lines matching Python, C++, physics, cooking, pop culture, weather, gadgets.
    - `NON_CIVIL_LEGAL_DOMAINS`: Regexes for Tax (NIRC/BIR), Labor (DOLE/NLRC), Criminal (RPC), Corporate (SEC), IP (IPOPHL).
    - `CIVIL_LAW_POSITIVE_PATTERNS`: Regexes for Civil Code concepts.
    - Hardcoded regex exceptions like `is_commercial_tech_contract` looking for `developer`, `freelancer`.
* **Why it is overengineered & flawed:**
  - **Fragile & Easy to Break:** A user asking *"Magkano bayad-pinsala kapag sinira ang website ko?"* risks getting rejected as non-legal tech.
  - **Literal Test-Case Overfitting:** Patterns verbatim match queries from `eval_ragas.py` (e.g. `"sort a list of numbers"`, `"CREATE Act and how to compute input VAT"`).
  - **Maintenance Trap:** As users ask new queries, the list of keywords must expand endlessly.

### B. Query Expansion & Retrieval (`main.py` lines 493–605, 1144–1250, 1793–2217)
* **What exists:**
  - `expand_legal_query`: Scans regex tuples in `PHILIPPINE_LEGAL_EXPANSIONS` and appends strings like `"Art 1191 Art 1170 delay mora damages"` directly into the query.
  - Bi-Encoder: `sentence-transformers/stsb-xlm-r-multilingual` (768-dim, 2020 STS-B benchmark).
  - PostgreSQL FTS: Tokenizes in Python by `\W+`, joins with `' OR '`, and matches with `websearch_to_tsquery('simple')` against a column generated via `to_tsvector('english')`.
  - Static Companion Graph: `STATUTORY_COMPANION_GRAPH` hardcodes 35+ article ID lists in Python.
* **Why it is overengineered & flawed:**
  - **Query Pollution:** Forcing 10+ legal keywords into a colloquial sentence distorts the semantic embedding.
  - **Weak Cross-Lingual Recall:** `stsb-xlm-r` was trained to score sentence similarity pairs, not asymmetric colloquial query-to-statute retrieval.
  - **FTS Language Mismatch:** Tagalog search words cannot match English statutory stems.

### C. Re-Ranking & Citation Stratification (`main.py` lines 1469–1785)
* **What exists:**
  - `rank_and_stratify_citations` (316 lines of code).
  - `calculate_sort_score`:
    - `1000.0 + suitability` for exact matches.
    - `(rrf * 100.0) + (base_sim * 10.0)`.
    - `+10.0` for companion articles.
    - `+30.0` for articles vs `+5.0` for cases.
    - `+3.0` for each hit in `key_legal_stems` (40+ hardcoded keywords).
    - `+15.0` for `"promissory"` or `"interes"`.
    - `+25.0` for `"dayuhan"`, `"foreigner"`, `"alien"`.
  - Synthetic Suitability Math: Formulas like `98.5 - active_statute_count * 0.5` and `75.0 + ((base_sim - 0.55) / 0.45) * 18.0` create artificial percentages for the frontend.
* **Why it is overengineered & flawed:**
  - **Heuristic Juggling:** Point additions mask retrieval errors instead of ranking real relevance.
  - **Deceptive Metrics:** The UI displays `98.5%` or `94.0%` suitability, but these are hand-tuned numbers, not calibrated probabilities.

### D. Context Injection & System Prompts (`main.py` lines 2599–3403)
* **What exists:**
  - 5 fragmented system prompt branches: Document Analysis, False-Premise Distractor, Jurisprudence Synthesis, Simple Lookup, and 3-Way Triage.
  - Post-generation regex cleaner `collapse_duplicate_statute_blocks` to delete duplicate quotes generated by the model.
* **Why it is overengineered & flawed:**
  - **Prompt Sprawl:** Repeating persona rules, language directives, and markdown instructions across 5 separate prompts causes maintenance bloat and inconsistencies.
  - **Treating Symptoms, Not Causes:** If the model duplicates quotes, fixing the system prompt and few-shot formatting is standard; regex parsing after generation indicates poor prompt calibration.

### E. Faithfulness & NLI Verification Engine (`services/nli.py`)
* **What exists:**
  - 1,383 lines of code (60 KB) with deontic modality dictionaries (`shall`, `must`, `dapat`, `bawal`), polarity parsing, Philippine legal synonym dictionaries, and fallback to local Gemma.
  - `is_refusal_or_out_of_scope`: 30+ regex patterns to detect if the LLM outputted a refusal so citations can be stripped.
* **Why it is overengineered & flawed:**
  - **Brittle Symbolic Rules:** Handcrafting deontic grammar for Tagalog and English fails on conversational nuances.
  - **High Latency:** Running atomic claim extraction + secondary Gemma calls on every single query causes long response times on consumer GPUs.

### F. Datasets & Fine-Tuning Distribution
* **What exists:**
  - `civil_code_rag.jsonl`: 2,270 articles in English.
  - `jurisprudence_chunks.jsonl`: 351,076 case chunks in English.
  - `train_clean_ragas.jsonl`: 4,351 examples (2,879 simplification, 1,472 RAG grounded).
  - Out of 4,351 training examples, fewer than 20 teach redirection to other legal branches, and almost none teach refusal of non-legal queries!
* **Why it is overengineered & flawed:**
  - **Severe Imbalance:** Because the fine-tuned model was never trained on out-of-domain refusals or non-civil redirections, the model tries to answer everything as Civil Code! This forced `main.py` to intercept all queries with regexes.
  - **English-Only Corpus:** Chunks lack Tagalog anchor tokens, making cross-lingual retrieval difficult without regex translation.

---

## 3. Comparison: Overengineered vs. Modern Standard Legal RAG

| Pipeline Component | Current Implementation | Modern Standard Legal RAG |
|---|---|---|
| **Domain Gating & Triage** | 150+ lines of regex (`NON_LEGAL_PATTERNS`, `NON_CIVIL_LEGAL_DOMAINS`) | Semantic Embedding Router or Lightweight LLM JSON Classifier |
| **Query Expansion** | Handcrafted dictionary (`PHILIPPINE_LEGAL_EXPANSIONS`) appending strings | SOTA Cross-Lingual Bi-Encoder OR LLM Query Reformulation (HyDE) |
| **Dense Embedder** | `stsb-xlm-r-multilingual` (2020 sentence similarity model) | `BAAI/bge-m3` (Dense + Sparse + Multi-Vector in 100+ languages) |
| **Full-Text Search (FTS)** | Python regex split + `websearch_to_tsquery('simple')` vs English tsvector | PostgreSQL pg_trgm (trigram) or BM25 index supporting Filipino & English |
| **Re-Ranking** | 300 lines of heuristic math + `key_legal_stems` bonus + hardcoded percentages | Cross-Encoder Reranker (`bge-reranker-v2-m3` or FlashRank) |
| **Context Assembly** | 5 branched prompt strings + regex deduplicators | Unified modular prompt template with structured slots |
| **Response Format** | Post-generation regex stripping of duplicate blocks | Instruction-tuned model with strict markdown output schemas |
| **Factuality / NLI** | 1,380-line hybrid deontic/synonym symbolics + Gemma | Multi-lingual NLI cross-encoder or structured RAGAS LLM-as-a-judge |
| **Training Data Balance** | 99% in-domain Civil Code, <0.5% redirection/refusal | Balanced: 85% In-Domain Simplification, 10% Redirection, 5% Refusal |

---

## 4. Proposed Solution & Implementation Plan (Without Word Lists)

The objective is to replace the **500+ lines of brittle regexes and keyword expansion lists** with **modern, simple machine learning components**.

```
Target Pipeline:
User Query ──► [Semantic Router (3-Way Triage)]
                     ├──► Non-Legal ────────► Fast Polite Refusal (No Retrieval)
                     ├──► Non-Civil Law ────► Fast Statutory Redirection (DOLE/RPC/BIR)
                     └──► Civil Law
                            │
                            ▼
                     [Dense + Sparse Hybrid Retrieval: BGE-M3]
                            │
                            ▼
                     [Cross-Encoder Re-Ranking: BGE-Reranker-v2-M3]
                            │ (Outputs true normalized 0.0 - 1.0 relevance)
                            ▼
                     [Unified Citizen-Centric System Prompt]
                            │
                            ▼
                     [Fine-Tuned LLM (Gemma 4)]: Grounded, Simplified Plain Language
```

---

### Step 1: Replace Regex Gating with a Semantic Embedding Router

**Why it solves the problem:** No keyword lists needed. Any phrasing, typo, or language is handled by semantic vector proximity.

#### How to Implement:
Pre-compute embedding centroids for 3 distinct anchor sets:
1. **Civil Law Anchors:** 40 representative questions covering contracts, loans, property, boundary disputes, wills, marriage, and torts in English and Tagalog.
2. **Other Philippine Law Anchors:** 25 representative questions covering Labor/DOLE, Criminal/RPC/arrest, Tax/BIR/NIRC, Corporate/SEC, IP/trademark.
3. **Non-Legal Anchors:** 25 representative questions covering coding, math, physics, cooking, pop culture, weather, general chat.

```python
# Semantic Router (Clean, zero regex word lists)
class DomainRouter:
    def __init__(self, embedder):
        self.embedder = embedder
        self.civil_centroid = np.mean(embedder.encode(CIVIL_ANCHORS), axis=0)
        self.other_law_centroid = np.mean(embedder.encode(OTHER_LAW_ANCHORS), axis=0)
        self.non_legal_centroid = np.mean(embedder.encode(NON_LEGAL_ANCHORS), axis=0)

    def route(self, query: str) -> str:
        # Explicit article citations (e.g. "Article 1191") always route to civil law
        if parse_article_numbers(query):
            return "civil_law"
            
        q_vec = self.embedder.encode(query)
        sim_civil = cosine_sim(q_vec, self.civil_centroid)
        sim_other = cosine_sim(q_vec, self.other_law_centroid)
        sim_non_legal = cosine_sim(q_vec, self.non_legal_centroid)

        if sim_non_legal > max(sim_civil, sim_other) + 0.05:
            return "non_legal"
        if sim_other > sim_civil:
            return "other_law"
        return "civil_law"
```

---

### Step 2: Upgrade Retrieval to BGE-M3 (Eliminating `PHILIPPINE_LEGAL_EXPANSIONS`)

**Why it solves the problem:**  
`BAAI/bge-m3` was trained specifically for asymmetric cross-lingual retrieval. It naturally maps a colloquial Tagalog question (*"Hindi tinapos ng kontratista ang bahay kahit may advance payment"*) directly to the English statutory chunk (*"Article 1191: Reciprocal obligations, rescission with damages"*).

#### Action Items:
1. **Update `service-rag-python/core/config.py`:**
   ```python
   EMBEDDING_MODEL_NAME = "BAAI/bge-m3"  # 1024-dim, dense + sparse multi-lingual
   ```
2. **Bilingual Corpus Chunk Augmentation:**
   In `civil_code_rag.jsonl`, augment each article chunk with:
   - Original Statutory English text
   - A 2-sentence plain Tagalog summary generated once using an LLM.
   *(Example for Art. 1191: "Kapag ang isang panig ay hindi tumupad sa kanyang obligasyon, ang kabilang panig ay may karapatang kanselahin ang kontrata at humingi ng bayad-pinsala.")*
3. **Delete `PHILIPPINE_LEGAL_EXPANSIONS`:**
   Remove lines 493–605 in `main.py`. The retriever no longer needs artificial string injections.

---

### Step 3: Integrate Cross-Encoder Re-Ranking (Eliminating `key_legal_stems`)

**Why it solves the problem:**  
Instead of 300 lines of point additions (`score += 15 for 'promissory'`, `score += 25 for 'foreigner'`), a cross-encoder scores the joint relationship `(Query, Passage)` using full cross-attention.

```python
from sentence_transformers import CrossEncoder

reranker = CrossEncoder("BAAI/bge-reranker-v2-m3")

def rerank_citations(query: str, candidate_chunks: list, top_k: int = 5):
    pairs = [[query, chunk["content"]] for chunk in candidate_chunks]
    logits = reranker.predict(pairs)
    
    for chunk, logit in zip(candidate_chunks, logits):
        # Sigmoid calibration: maps logit to a true probability (0.0 to 1.0)
        prob = 1.0 / (1.0 + np.exp(-logit))
        chunk["relevance_score"] = float(prob)
        chunk["suitability_percent"] = round(prob * 100, 1)

    candidate_chunks.sort(key=lambda x: x["relevance_score"], reverse=True)
    return candidate_chunks[:top_k]
```
- Completely removes `key_legal_stems`, `STATUTORY_COMPANION_GRAPH`, and score-cooking heuristics.
- Delivers authentic, calibrated suitability percentages to the frontend.

---

### Step 4: Streamline to a Single Unified System Prompt

**Why it solves the problem:**  
Replaces 5 scattered prompt branches with a single modular prompt that directly instructs the model to simplify legal terms for normal citizens and follow strict unilingual output.

#### Unified Master Prompt:
```markdown
You are CIVIL-LEX, a specialized Philippine Legal Assistant.
Your primary mission is to simplify the Philippine Civil Code (RA 386) and civil jurisprudence for ordinary Filipino citizens who have no legal background.

LANGUAGE DIRECTIVE:
- If the user query is in English: respond entirely in clear, simple everyday English.
- If the user query is in Tagalog/Filipino: respond entirely in natural, simplified Tagalog.
- STRICT UNILINGUAL RULE: Never mix languages (strictly NO Taglish).

EXPLANATION GUIDELINES FOR CITIZENS:
1. Simplify legal jargon: Whenever you use a legal term (e.g. quasi-delict, rescission, moral damages, default), immediately explain what it means in plain everyday words beside it.
2. Grounding: Rely strictly on the articles and cases provided in CONTEXT. Always retain bracketed statutory citations (e.g., [Art. 1191]).
3. Response Structure:
   ### Summary & Direct Conclusion
   [1-2 clear, direct sentences answering the citizen's question in plain language]

   ### Governing Statutory Basis & Meaning
   [Quote the governing article from CONTEXT once, followed by a simple bullet breakdown of what it requires]

   ### Supreme Court Doctrines (if cases are in CONTEXT)
   [Case Title, G.R. No., and 1-2 simple sentences explaining the court's ruling]

   ### Practical Next Steps
   [Concrete, actionable advice in plain language: Barangay Conciliation, Small Claims, or Trial Court]

CONTEXT:
{context_str}
```

---

### Step 5: Augment the SFT Training Dataset

**Why it solves the problem:**  
Teaching the model boundary behavior directly in the weights is standard ML practice; using regexes to prevent out-of-domain answers is an anti-pattern.

#### Recommended Dataset Balance (~5,000 samples):
1. **70% In-Domain Simplification (EN & TL):**
   - Lay citizen questions -> Simplified plain-language explanations with statutory citations.
2. **15% Jurisprudence Integration:**
   - Real factual scenarios grounded on landmark Supreme Court cases.
3. **10% Specialized Legal Redirection:**
   - Queries on pure labor, crime, or tax -> Model naturally redirects to DOLE, Revised Penal Code, or BIR without external regexes.
4. **5% Non-Legal Refusal:**
   - Queries on coding, math, recipes, pop culture -> Model cleanly and politely declines, stating its focus on Philippine Civil Law.

---

## 5. Summary of Benefits

1. **Elimination of Keyword Lists:** Zero ongoing maintenance of regex patterns, keyword expansions, or stem lists.
2. **True Cross-Lingual Power:** Tagalog and English queries are retrieved with equal accuracy using modern multilingual bi-encoders and cross-encoders.
3. **Authentic Relevance Metrics:** The UI displays true calibrated probabilities from the re-ranker rather than artificial formula-derived percentages.
4. **Clean Code Hygiene:** Shrinks `main.py` by over 1,500 lines, improving maintainability, testability, and inference performance.

---

## 6. Step-by-Step Technical Execution Guide

### Part A: Embedder Migration Workflow (Switching to BAAI/bge-m3)

When switching to a modern embedder such as `BAAI/bge-m3`, vector dimensions increase from 768 to 1024. All vectors stored in PostgreSQL must be migrated and recomputed.

#### Step 1: PostgreSQL Schema & Dimension Migration
Execute the following SQL commands in your PostgreSQL / Supabase SQL console:

```sql
-- 1. Drop the existing HNSW vector index (indexes are tied to specific vector dimensions)
DROP INDEX IF EXISTS vector_idx;

-- 2. Update the column dimension in document_chunks
-- Option A: Truncate and rebuild cleanly (Recommended)
TRUNCATE TABLE document_chunks;
ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(1024);

-- Option B: In-place migration without deleting metadata
-- ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(1024);
-- UPDATE document_chunks SET embedding = NULL;

-- 3. Recreate the HNSW index for cosine distance on the new 1024-dimension space
CREATE INDEX vector_idx 
ON document_chunks USING hnsw (embedding vector_cosine_ops);
```

#### Step 2: Codebase Schema Updates
Update DDL definitions across the Python codebase to reflect `vector(1024)`:
1. [services/ingestion_service.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/services/ingestion_service.py#L92):
   Change line 92 from `embedding VECTOR(768)` to `embedding VECTOR(1024)`.
2. [create_rpc.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/create_rpc.py#L20):
   Change line 20 from `query_embedding vector(768)` to `query_embedding vector(1024)`.

#### Step 3: Model Configuration Updates
Update configuration variables and model defaults:
1. In `service-rag-python/.env`:
   ```bash
   EMBEDDING_MODEL_NAME=BAAI/bge-m3
   ```
2. In [core/config.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/core/config.py) and [main.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/main.py#L87):
   ```python
   embedder = SentenceTransformer(os.getenv("EMBEDDING_MODEL_NAME", "BAAI/bge-m3"))
   ```
3. In [embed_articles_only.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/embed_articles_only.py#L18), [search.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/search.py#L16), and [services/document.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/services/document.py#L28):
   Update the fallback string from `"sentence-transformers/stsb-xlm-r-multilingual"` to `"BAAI/bge-m3"`.

#### Step 4: Re-Embedding Corpus Chunks
Run the ingestion scripts to generate the new vectors:

```bash
cd service-rag-python

# 1. Re-embed Civil Code statutory articles only (2,270 articles, ~1-2 minutes):
python embed_articles_only.py

# 2. Re-embed the entire corpus (articles + 351,000 jurisprudence chunks):
python ingest.py --stage vectors --batch-size 250
```

---

### Part B: Dataset Augmentation & Model Retraining Workflow

#### Step 1: JSONL Chat Format Specification
Training data must follow the JSON Lines format expected by [finetune/finetune_gemma4.py](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/finetune/finetune_gemma4.py):

```json
{
  "id": "NEW-REDIRECT-001",
  "track": "redirection",
  "language": "fil",
  "messages": [
    {
      "role": "system",
      "content": "You are CIVIL-LEX, a specialized Philippine Legal Assistant dedicated exclusively to the Philippine Civil Code (Republic Act No. 386). If a query falls under another specialized branch of Philippine law, explain the boundary and redirect the user to the proper governing code and agency."
    },
    {
      "role": "user",
      "content": "Pinaalis ako sa trabaho nang walang abiso at walang separation pay. Pwede ko ba idemanda ang boss ko sa Civil Code?"
    },
    {
      "role": "assistant",
      "content": "Ang inyong katanungan ay hindi saklaw ng Philippine Civil Code (RA 386), kundi ng Philippine Labor Law sa ilalim ng Presidential Decree No. 442 (Labor Code of the Philippines).\n\nPara sa illegal dismissal at statutory separation pay, ang tamang ahensya na may hurisdiksyon ay ang Department of Labor and Employment (DOLE) o ang National Labor Relations Commission (NLRC) sa pamamagitan ng Single Entry Approach (SEnA)."
    }
  ],
  "metadata": {
    "target_domain": "Labor Law",
    "governing_agency": "DOLE / NLRC"
  }
}
```

#### Step 2: Stratified Train/Validation Split & Merge Script
Create `service-rag-python/data/training/merge_datasets.py` to prevent data leakage and maintain an 85/15 train/eval split:

```python
import json
import random
from pathlib import Path

random.seed(3407)

TRAIN_DIR = Path("data/training")
OLD_TRAIN = TRAIN_DIR / "train_clean_ragas.jsonl"
OLD_EVAL = TRAIN_DIR / "eval_ragas_clean.jsonl"
NEW_DATA = TRAIN_DIR / "new_samples.jsonl"

OUT_TRAIN = TRAIN_DIR / "train_augmented.jsonl"
OUT_EVAL = TRAIN_DIR / "eval_augmented.jsonl"

with open(NEW_DATA, "r", encoding="utf-8") as f:
    new_records = [json.loads(line) for line in f if line.strip()]

random.shuffle(new_records)
split_idx = int(len(new_records) * 0.85)
new_train = new_records[:split_idx]
new_eval = new_records[split_idx:]

print(f"Loaded {len(new_records)} new samples: {len(new_train)} train, {len(new_eval)} eval.")

with open(OUT_TRAIN, "w", encoding="utf-8") as out_f:
    with open(OLD_TRAIN, "r", encoding="utf-8") as in_f:
        for line in in_f:
            if line.strip():
                out_f.write(line.strip() + "\n")
    for record in new_train:
        out_f.write(json.dumps(record, ensure_ascii=False) + "\n")

with open(OUT_EVAL, "w", encoding="utf-8") as out_f:
    with open(OLD_EVAL, "r", encoding="utf-8") as in_f:
        for line in in_f:
            if line.strip():
                out_f.write(line.strip() + "\n")
    for record in new_eval:
        out_f.write(json.dumps(record, ensure_ascii=False) + "\n")

print(f"Merged datasets saved to {OUT_TRAIN} and {OUT_EVAL}.")
```

#### Step 3: Updating Configuration in config.yaml
Update [finetune/config.yaml](file:///home/rence/github_repos/github-repositories-NS/civilex-thesis/service-rag-python/finetune/config.yaml#L44-L46) to point to the augmented files:

```yaml
dataset:
  train_file: "train_augmented.jsonl"
  eval_file: "eval_augmented.jsonl"
```

#### Step 4: Retraining, Weight Merging, & GGUF Export
Execute the fine-tuning and deployment commands:

```bash
cd service-rag-python/finetune

# 1. Run LoRA SFT training using Gemma 4 / Gemma 2
python finetune_gemma4.py --config config.yaml

# 2. Merge LoRA adapter into base weights
python merge_lora.py \
  --base google/gemma-4-E4B-it \
  --lora ./output/gemma-4-e4b-civil-code-lora \
  --out ./output/gemma-4-e4b-merged

# 3. Export to GGUF format for LM Studio local inference
python export_gguf.py \
  --model ./output/gemma-4-e4b-merged \
  --out ./output/civilex-gemma4-q4_k_m.gguf \
  --quant q4_k_m
```

