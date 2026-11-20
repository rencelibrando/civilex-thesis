#!/usr/bin/env python3
"""Deterministic Arize-style & ML-best-practices slice evaluator for CIVIL-LEX retrieval."""

import argparse
import json
import os
import random
import statistics
import sys
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.article_parser import parse_article_numbers, parse_gr_numbers
from core.jurisprudence_matcher import search_jurisprudence_cases
import main


@dataclass(frozen=True)
class GoldenExample:
    example_id: str
    slice_name: str
    query: str
    expected_article_id: Optional[str] = None
    expected_case_uid: Optional[str] = None
    required_substring: Optional[str] = None
    expect_linked_cases: bool = False
    expect_no_article_parse: bool = False
    expect_no_case_exact: bool = False


GOLDEN_DATASET: List[GoldenExample] = [
    # Slice 1: Non-standard Civil Code formats
    GoldenExample("cc-01", "civil_nonstandard", "art#1191", expected_article_id="RA386-ART1191"),
    GoldenExample("cc-02", "civil_nonstandard", "art 1,191", expected_article_id="RA386-ART1191"),
    GoldenExample("cc-03", "civil_nonstandard", "art: 2,176", expected_article_id="RA386-ART2176"),
    GoldenExample("cc-04", "civil_nonstandard", "1191 of the civil code", expected_article_id="RA386-ART1191"),
    GoldenExample("cc-05", "civil_nonstandard", "ano ang 2176", expected_article_id="RA386-ART2176"),
    GoldenExample("cc-06", "civil_nonstandard", "kodigo sibil 1159", expected_article_id="RA386-ART1159"),
    GoldenExample("cc-07", "civil_nonstandard", "probisyon 1170", expected_article_id="RA386-ART1170"),
    # Slice 2: Non-standard Family Code formats + repaired clauses
    GoldenExample("fc-01", "family_code_repaired", "36 family code", expected_article_id="EO209-ART36"),
    GoldenExample("fc-02", "family_code_repaired", "eo 209 36", expected_article_id="EO209-ART36"),
    GoldenExample("fc-03", "family_code_repaired", "sec 36 family code", expected_article_id="EO209-ART36"),
    GoldenExample("fc-04", "family_code_repaired", "Article 2 Family Code", expected_article_id="EO209-ART2", required_substring="(2) Consent freely given"),
    GoldenExample("fc-05", "family_code_repaired", "Article 3 Family Code", expected_article_id="EO209-ART3", required_substring="(3) A marriage ceremony"),
    GoldenExample("fc-06", "family_code_repaired", "Article 26 foreign divorce", expected_article_id="EO209-ART26", required_substring="capacity to remarry under Philippine law"),
    GoldenExample("fc-07", "family_code_repaired", "Article 102 Family Code", expected_article_id="EO209-ART102", required_substring="(6)"),
    # Slice 3: Multi-chunk canonical completeness
    GoldenExample("mc-01", "multi_chunk_completeness", "Article 45 of the Family Code", expected_article_id="EO209-ART45", required_substring="(1)"),
    GoldenExample("mc-02", "multi_chunk_completeness", "Article 45 of the Family Code grounds", expected_article_id="EO209-ART45", required_substring="(6)"),
    GoldenExample("mc-03", "multi_chunk_completeness", "Article 32 Civil Code", expected_article_id="RA386-ART32", required_substring="(19)"),
    GoldenExample("mc-04", "multi_chunk_completeness", "Article 1032 Civil Code", expected_article_id="RA386-ART1032", required_substring="(8)"),
    GoldenExample("mc-05", "multi_chunk_completeness", "Article 2208 Civil Code", expected_article_id="RA386-ART2208", required_substring="(11)"),
    # Slice 4: Docket, L-series, A.M., and repaired consolidated ranges
    GoldenExample("dk-01", "docket_and_ranges", "gr188289", expected_case_uid="GR_188289_2014"),
    GoldenExample("dk-02", "docket_and_ranges", "gr#188289", expected_case_uid="GR_188289_2014"),
    GoldenExample("dk-03", "docket_and_ranges", "gr-188289", expected_case_uid="GR_188289_2014"),
    GoldenExample("dk-04", "docket_and_ranges", "gr l 1892", expected_case_uid="GR_L-1892AUGUST_1949"),
    GoldenExample("dk-05", "docket_and_ranges", "94188", expected_case_uid="GR_S_1992_8"),
    GoldenExample("dk-06", "docket_and_ranges", "94189", expected_case_uid="GR_S_1992_8"),
    GoldenExample("dk-07", "docket_and_ranges", "159562", expected_case_uid="GR_S_2012_6"),
    GoldenExample("dk-08", "docket_and_ranges", "A.M. OCA IPI No. 12-202-CA-J", expected_case_uid="GR_UNKNOWN_2013"),
    # Slice 5: Acronym, Unicode, single-party, and public-party guard
    GoldenExample("pt-01", "party_and_acronyms", "sps. quirong vs dbp", expected_case_uid="GR_173441_2009"),
    GoldenExample("pt-02", "party_and_acronyms", "quirong vs dbp", expected_case_uid="GR_173441_2009"),
    GoldenExample("pt-03", "party_and_acronyms", "Cariño vs. Cariño", expected_case_uid="GR_132529FEBRUARY_2001"),
    GoldenExample("pt-04", "party_and_acronyms", "carino vs carino", expected_case_uid="GR_132529FEBRUARY_2001"),
    GoldenExample("pt-05", "party_and_acronyms", "chi ming tsoi case", expected_case_uid="GR_119190JANUARY_1997"),
    GoldenExample(
        "pt-06",
        "party_and_acronyms",
        "explain to me the ncase of Segunda Pornellosa, et al. vs. Land Tenure Administration",
        expected_article_id="RA386-ART1358",
        expected_case_uid="GR_L-14040JANUARY_1961",
    ),
    # Slice 6: Bilingual Graph-Augmented Jurisprudence & false-positive guards
    GoldenExample("gr-01", "graph_and_guards", "jurisprudence on article 36 of the family code", expected_article_id="EO209-ART36", expect_linked_cases=True),
    GoldenExample("gr-02", "graph_and_guards", "mga kaso sa art 1191", expected_article_id="RA386-ART1191", expect_linked_cases=True),
    GoldenExample("gr-03", "graph_and_guards", "ano ang mga hatol sa article 41 family code", expected_article_id="EO209-ART41", expect_linked_cases=True),
    GoldenExample("gr-04", "graph_and_guards", "cases related to article 26 family code", expected_article_id="EO209-ART26", expect_linked_cases=True),
    GoldenExample("gr-05", "graph_and_guards", "sc decisions applying 2176", expected_article_id="RA386-ART2176", expect_linked_cases=True),
    GoldenExample("gr-06", "graph_and_guards", "worth 1,500 pesos", expect_no_article_parse=True, expect_no_case_exact=True),
    GoldenExample("gr-07", "graph_and_guards", "decided in 1995", expect_no_article_parse=True, expect_no_case_exact=True),
    GoldenExample("gr-08", "graph_and_guards", "Executive Order No. 209 Family Code", expect_no_article_parse=True, expect_no_case_exact=True),
    # Slice 7: Comparative statutory concepts (void vs voidable contracts)
    GoldenExample("cp-01", "comparative_concepts", "Explain the distinction between void and voidable contracts under civil law.", expected_article_id="RA386-ART1409"),
    GoldenExample("cp-02", "comparative_concepts", "Explain the distinction between void and voidable contracts under civil law.", expected_article_id="RA386-ART1390"),
]


def bootstrap_ci(values: List[float], n_boot: int = 1000, seed: int = 42) -> Tuple[float, float]:
    """Compute a 95% nonparametric bootstrap confidence interval."""
    if not values:
        return 0.0, 0.0
    rng = random.Random(seed)
    n = len(values)
    means = sorted(
        sum(values[rng.randrange(n)] for _ in range(n)) / n
        for _ in range(n_boot)
    )
    lo = means[int(0.025 * n_boot)]
    hi = means[min(n_boot - 1, int(0.975 * n_boot))]
    return round(lo, 4), round(hi, 4)


def evaluate_example(conn, ex: GoldenExample) -> Dict[str, Any]:
    t0 = time.perf_counter()
    passed = True
    reasons: List[str] = []
    retrieved_ids: List[str] = []

    if ex.expect_no_article_parse or ex.expect_no_case_exact:
        parsed_arts = parse_article_numbers(ex.query)
        parsed_grs = parse_gr_numbers(ex.query)
        exact_cases = search_jurisprudence_cases(conn, ex.query, max_results=3)
        if ex.expect_no_article_parse and parsed_arts:
            passed = False
            reasons.append(f"false_article_parse={parsed_arts}")
        if ex.expect_no_case_exact and (parsed_grs or exact_cases):
            passed = False
            reasons.append(f"false_case_match=gr:{parsed_grs},cases:{len(exact_cases)}")
    else:
        search_q = main.expand_legal_query(ex.query)
        emb = main.compute_embedding(search_q)
        results = main.search_with_embedding(emb, search_q, raw_query=ex.query)
        active = [r for r in results if r.get("is_in_context", True)]
        retrieved_ids = [str(r.get("parent_id") or "") for r in active]

        if ex.expected_article_id:
            art_hit = next((r for r in active if r.get("parent_id") == ex.expected_article_id), None)
            if art_hit is None:
                passed = False
                reasons.append(f"missing_article:{ex.expected_article_id}")
            elif ex.required_substring and ex.required_substring not in str(art_hit.get("content") or ""):
                passed = False
                reasons.append(f"missing_clause:{ex.required_substring}")

        if ex.expected_case_uid:
            case_hit = next((r for r in active if r.get("parent_id") == ex.expected_case_uid), None)
            if case_hit is None:
                passed = False
                reasons.append(f"missing_case:{ex.expected_case_uid}")

        if ex.expect_linked_cases:
            cases = [r for r in active if r.get("parent_type") == "case"]
            if not cases:
                passed = False
                reasons.append("missing_linked_cases")

    latency_ms = round((time.perf_counter() - t0) * 1000.0, 1)
    return {
        "example_id": ex.example_id,
        "slice": ex.slice_name,
        "query": ex.query,
        "output": json.dumps({"retrieved_ids": retrieved_ids[:6], "reasons": reasons}),
        "label": "pass" if passed else "fail",
        "score": 1.0 if passed else 0.0,
        "latency_ms": latency_ms,
        "reasons": reasons,
    }


def main_cli() -> None:
    parser = argparse.ArgumentParser(description="Run slice-based live RAG retrieval evaluation")
    parser.add_argument("--export-json", type=str, default="", help="Optional path for Arize-compatible experiment JSON")
    args = parser.parse_args()

    conn = main.get_db_connection()
    try:
        runs = [evaluate_example(conn, ex) for ex in GOLDEN_DATASET]
    finally:
        conn.close()

    scores = [r["score"] for r in runs]
    latencies = [r["latency_ms"] for r in runs]
    overall = round(sum(scores) / len(scores), 4)
    ci_lo, ci_hi = bootstrap_ci(scores)

    print(f"Golden Retrieval Evaluation (n={len(runs)} live PostgreSQL queries)")
    print(f"Overall Pass Rate: {overall * 100:.1f}% (95% bootstrap CI: [{ci_lo * 100:.1f}%, {ci_hi * 100:.1f}%])")
    print(f"Median Latency: {statistics.median(latencies):.1f} ms | P95 Latency: {sorted(latencies)[int(0.95 * len(latencies))]:.1f} ms")
    print("")
    print("Per-Slice Breakdown:")
    slices: Dict[str, List[Dict[str, Any]]] = {}
    for r in runs:
        slices.setdefault(r["slice"], []).append(r)

    for slice_name, items in slices.items():
        s_pass = sum(int(i["score"]) for i in items)
        s_med = statistics.median(i["latency_ms"] for i in items)
        print(f"  {slice_name:26s}: {s_pass:2d}/{len(items):2d} ({s_pass / len(items) * 100:5.1f}%) | median {s_med:6.1f} ms")
        for fail_item in items:
            if fail_item["score"] < 1.0:
                print(f"    FAIL [{fail_item['example_id']}] {fail_item['query']!r} -> {fail_item['reasons']} | got={fail_item['output']}")

    if args.export_json:
        with open(args.export_json, "w", encoding="utf-8") as f:
            json.dump(runs, f, indent=2, ensure_ascii=False)
        print(f"\nExported evaluation runs to {args.export_json}")

    if any(r["score"] < 1.0 for r in runs):
        sys.exit(1)


if __name__ == "__main__":
    main_cli()
