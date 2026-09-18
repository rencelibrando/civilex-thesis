# RAGAS Evaluation Metrics Report

## Overview
This document summarizes the findings from the custom RAGAS (Retrieval-Augmented Generation Assessment System) evaluation performed on the Philippine Civil Law (RA 386) RAG pipeline. 

The evaluation framework was recently refactored to implement standard RAGAS mathematical formulations, removing artificial score inflation and replacing it with robust, standardized metrics. The evaluation runs a live test against the local LLM endpoint (`LM_STUDIO_URL`).

## Benchmark Results (Latest Run)

| Metric | Score | Status | Description |
| :--- | :--- | :--- | :--- |
| **Context Precision** | ~1.00 | **PASS** | Measures if the most relevant chunks are ranked highest in the retrieved context. The dense retrieval setup is performing excellently at prioritizing correct statutory provisions. |
| **Context Recall** | ~1.00 | **PASS** | Measures if all necessary ground-truth information is retrieved. Achieves perfect recall based on structural Article ID matching (e.g., matching `RA386-ART116` against parent IDs). |
| **Answer Relevancy** | ~0.36 | **FAIL** | Measures how directly the generated answer addresses the input prompt. |
| **Faithfulness** | < 0.50 | **FAIL** | Measures if the generated answer is strictly grounded in the retrieved context without hallucination. |

---

## Detailed Analysis & Identified Flaws

### 1. Answer Relevancy (Score: ~0.36 - FAIL)
**The Problem:** 
The standard RAGAS Answer Relevancy metric uses an LLM to generate hypothetical questions from the generated answer, then calculates the cosine similarity between the embeddings of the *hypothetical questions* and the *original prompt*. 

Because the current system uses `sentence-transformers/stsb-xlm-r-multilingual`, there is a severe semantic gap between:
1. The **legal phrasing** output by the LLM (and thus the hypothetical questions it generates).
2. The **layman/conversational phrasing** used in the original user prompt.

The embedding model fails to recognize the semantic equivalence across this domain gap, resulting in unscaled cosine similarities hovering in the 0.40–0.60 range, which causes the metric to fail.

### 2. Faithfulness (Score: < 0.50 - FAIL)
**The Problem:**
Faithfulness relies on the LLM to perform Natural Language Inference (NLI) by decomposing the generated answer into discrete claims and verifying if each claim is explicitly supported by the context.
*   **LLM Capability:** The local LLM (running via LM Studio) struggles with the strict zero-shot classification required for claim verification, sometimes hallucinating claims or failing to output parsable verification schemas (Yes/No).
*   **Strict Grounding:** The model often introduces external legal knowledge or conversational filler that is not explicitly present in the retrieved chunk, which the strict evaluator correctly penalizes.

---

## Proposed Solutions

### For Answer Relevancy
1. **Domain-Adapted Embeddings:** Switch from `stsb-xlm-r-multilingual` to an embedding model fine-tuned for legal texts (e.g., `nlpaueb/legal-bert-base-uncased` or a domain-adapted sentence transformer).
2. **LLM-as-a-Judge Relevancy:** Bypass cosine similarity entirely for this metric and instead use the LLM to score relevancy on a scale of 0-1 (or 1-5) via a structured grading prompt. This mitigates the embedding model's cross-domain blindness.
3. **Prompt Translation:** Pre-process the user's conversational prompt into a formal legal query before calculating vector similarity against the hypothetical questions.

### For Faithfulness
1. **Enhance LLM Prompting:** Modify the claim verification system prompt to use Few-Shot prompting. Provide the LLM with exact examples of "Context", "Statement", and "Verdict: Yes/No" to stabilize its NLI capabilities.
2. **Use a Stronger Evaluator Model:** If the local LLM continues to fail at structural parsing, consider using a larger, more capable model (like Llama-3-70B or GPT-4o-mini) *strictly for the evaluation script*, while keeping the smaller local LLM for the actual generation pipeline.
3. **Constrain Generation (System Prompt):** Update the main RAG system prompt (`prompt_assembly.py` / `main.py`) to strictly enforce: *"Do not include any conversational filler. Answer ONLY using the facts provided in the context."* This reduces the number of unsupported claims the model generates.

## Conclusion
The retrieval stage of the RAG pipeline is structurally sound (passing Precision and Recall). The pipeline's current weaknesses lie in the evaluation step's embedding model limitations (Relevancy) and the local LLM's adherence to strict extraction (Faithfulness). Implementing the proposed solutions will bridge these gaps and yield a passing scorecard.
