#!/usr/bin/env python3
"""
CIVIL-LEX: ISO/IEC 25010 Automated Evaluation Benchmark
Evaluates the RAG framework against ISO 25010 Software Product Quality criteria:
1. Performance Efficiency:
   - Query embedding latency
   - Hybrid retrieval latency
   - Total retrieval pipeline time
2. Functional Suitability & Reliability:
   - Statutory recall (Presence of governing Civil Code articles)
   - NLI Groundedness / Entailment scores
   - Suitability percentage calculation
"""

import os
import time
import statistics
import psycopg2
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

load_dotenv(override=True)

# Import the production RAG pipeline and symbolic NLI engine
from main import embed_and_search
from services.nli import score_faithfulness
from eval_ragas import llm_generate_response

POSTGRES_DB_URL = os.getenv("POSTGRES_DB_URL", "postgresql://postgres:postgres@localhost:54322/postgres")
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "sentence-transformers/stsb-xlm-r-multilingual")

BENCHMARK_SCENARIOS = [
    {
        "id": "SCENARIO-01",
        "category": "Contracts & Rescission",
        "query": "The contractor failed to complete construction within the agreed period despite receiving full payment. Can I cancel the contract and demand my money back with damages?",
        "expected_articles": ["RA386-ART1191", "RA386-ART1170", "RA386-ART1169"],
        "expected_court": "RTC or MTC depending on RA 11576 threshold",
        "action": "Action for Judicial Rescission with Damages"
    },
    {
        "id": "SCENARIO-02",
        "category": "Torts & Quasi-Delict",
        "query": "A delivery truck hit my parked car while the driver was speeding. Can I claim damages from both the driver and the company that employed him?",
        "expected_articles": ["RA386-ART2176", "RA386-ART2180", "RA386-ART2199"],
        "expected_court": "MTC or RTC under RA 11576",
        "action": "Action for Damages based on Quasi-Delict"
    },
    {
        "id": "SCENARIO-03",
        "category": "Sales & Hidden Defects",
        "query": "I bought a vehicle from a dealership that broke down three days later due to a factory engine defect. Can I return it for a refund?",
        "expected_articles": ["RA386-ART1561", "RA386-ART1567", "RA386-ART1566"],
        "expected_court": "DTI or Regular Court under RA 11576",
        "action": "Accion Redhibitoria / Rescission of Sale"
    },
    {
        "id": "SCENARIO-04",
        "category": "Family Law & Nullity",
        "query": "My spouse abandoned our family immediately after marriage and has severe narcissism and chronic inability to perform marital obligations.",
        "expected_articles": ["RA386-ART36"],
        "expected_court": "Family Court (RA 8369)",
        "action": "Petition for Declaration of Absolute Nullity"
    },
    {
        "id": "SCENARIO-05",
        "category": "Obligations & Delay",
        "query": "A friend borrowed ₱150,000 via a promissory note due last month. He refuses to pay despite several verbal reminders. What court should I file in?",
        "expected_articles": ["RA386-ART1169", "RA386-ART1231"],
        "expected_court": "Small Claims Court / MTC (RA 11576)",
        "action": "Small Claims Action for Collection of Sum of Money"
    },
]

def run_benchmark():
    print("=" * 70)
    print("CIVIL-LEX ISO/IEC 25010 TECHNICAL EVALUATION SUITE")
    print("=" * 70)

    print("\n[Stage 1] Initializing Embedding Model...")
    t0 = time.perf_counter()
    embedder = SentenceTransformer(EMBEDDING_MODEL_NAME)
    model_load_time = time.perf_counter() - t0
    print(f"Embedding model loaded in {model_load_time:.2f}s")

    print("\n[Stage 2] Connecting to Database...")
    conn = psycopg2.connect(POSTGRES_DB_URL)
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM civil_code_articles;")
        art_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM jurisprudence_cases;")
        case_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM document_chunks;")
        chunk_count = cur.fetchone()[0]
    print(f"Verified Corpus: {art_count} Articles | {case_count} Cases | {chunk_count} Chunks")

    embedding_latencies = []
    retrieval_latencies = []
    statutory_recalls = []
    nli_entailment_scores = []
    total_contradicted = 0
    total_claims = 0

    print("\n[Stage 3] Executing Scenario Benchmarks...")
    print("-" * 70)

    for scenario in BENCHMARK_SCENARIOS:
        q_id = scenario["id"]
        query = scenario["query"]
        expected = scenario["expected_articles"]

        # Measure Embedding + Retrieval via production hybrid pipeline
        t_start_emb = time.perf_counter()
        _q_emb = embedder.encode(query, normalize_embeddings=True).tolist()
        t_emb = (time.perf_counter() - t_start_emb) * 1000  # in ms
        embedding_latencies.append(t_emb)

        t_start_ret = time.perf_counter()
        retrieved_chunks = embed_and_search(query)
        t_ret = (time.perf_counter() - t_start_ret) * 1000  # in ms
        retrieval_latencies.append(t_ret)

        retrieved_ids = [r.get('parent_id', '') for r in retrieved_chunks]
        top_display = max([float(r.get('display_suitability', 0)) for r in retrieved_chunks], default=0.0)

        # Statutory Recall
        matched_hits = [e for e in expected if any(e in rid for rid in retrieved_ids)]
        recall = len(matched_hits) / len(expected) if expected else 1.0
        statutory_recalls.append(recall)

        # Generate response via production pipeline, then run real hybrid NLI
        actual_response = llm_generate_response(query, retrieved_chunks)
        nli_result = score_faithfulness(actual_response, retrieved_chunks, mode="hybrid")
        nli_score = nli_result.score_percent
        nli_entailment_scores.append(nli_score)
        total_contradicted += nli_result.claims_contradicted
        total_claims += nli_result.claims_total

        print(f"[{q_id}] {scenario['category']}")
        print(f"  • Embedding Time:   {t_emb:.2f} ms")
        print(f"  • Retrieval Time:   {t_ret:.2f} ms")
        print(f"  • Top Display Suit: {top_display:.1f}%")
        print(f"  • Statutory Recall: {recall * 100:.1f}% (Hits: {matched_hits})")
        print(f"  • NLI Faithfulness: {nli_score:.1f}% ({nli_result.status}, Engine: {nli_result.engine})")
        print(f"  • Claims: {nli_result.claims_entailed}/{nli_result.claims_total} entailed, "
              f"{nli_result.claims_contradicted} contradicted\n")

    conn.close()

    # Summary Report
    avg_emb = statistics.mean(embedding_latencies)
    avg_ret = statistics.mean(retrieval_latencies)
    avg_recall = statistics.mean(statutory_recalls) * 100
    avg_nli = statistics.mean(nli_entailment_scores)
    hallucination_rate = (total_contradicted / total_claims * 100) if total_claims > 0 else 0.0

    print("=" * 70)
    print("ISO/IEC 25010 SUMMARY REPORT FOR DEFENSE MANUSCRIPT")
    print("=" * 70)
    print("1. Performance Efficiency:")
    print(f"   - Average Query Embedding Latency:    {avg_emb:.2f} ms")
    print(f"   - Average Hybrid Retrieval Latency:   {avg_ret:.2f} ms")
    print(f"   - Total Retrieval Pipeline Time:      {avg_emb + avg_ret:.2f} ms")
    print("2. Functional Suitability:")
    print(f"   - Statutory Provision Recall:         {avg_recall:.1f}%")
    print("3. Reliability & Explainability:")
    print(f"   - Average NLI Faithfulness Score:     {avg_nli:.1f}%")
    print(f"   - Hallucination Rate:                 {hallucination_rate:.1f}% ({total_contradicted}/{total_claims} claims contradicted)")
    grounded_pct = sum(1 for s in nli_entailment_scores if s >= 80.0) / len(nli_entailment_scores) * 100 if nli_entailment_scores else 0
    print(f"   - NLI Grounding Rate:                 {grounded_pct:.1f}% of scenarios grounded")
    print("=" * 70)

if __name__ == "__main__":
    run_benchmark()
