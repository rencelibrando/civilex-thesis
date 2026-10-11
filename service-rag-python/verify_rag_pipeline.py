import os
import sys
import json

# Ensure service directory is in path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from main import app, domain_router, calibrate_suitability_score, rank_and_stratify_citations

client = TestClient(app)


def test_health():
    print("[1/5] Testing /health endpoint...")
    resp = client.get("/health")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    data = resp.json()
    assert data.get("status") in ("ok", "healthy"), f"Unexpected payload: {data}"
    print("      PASSED: /health returned 200 OK and healthy status.")


def test_domain_router():
    print("[2/5] Testing Semantic DomainRouter triage...")
    test_cases = [
        ("Article 1191 rescission of contract", "civil_law"),
        ("Hindi tinapos ng kontratista ang bahay kahit may bayad na", "civil_law"),
        ("Illegal dismissal by employer without separation pay at DOLE", "other_legal"),
        ("Paano magbayad ng withholding tax sa BIR", "other_legal"),
        ("Write a quicksort Python script", "non_legal"),
        ("What is the recipe for chicken adobo", "non_legal"),
    ]
    for q, expected in test_cases:
        res = domain_router.route(q)
        cat = res["category"]
        if expected == "civil_law":
            assert cat == "in_domain_civil", f"Failed for '{q}': expected in_domain_civil, got {cat}"
        elif expected == "other_legal":
            assert cat == "out_of_domain_legal", f"Failed for '{q}': expected out_of_domain_legal, got {cat}"
        elif expected == "non_legal":
            assert cat == "out_of_domain_non_legal", f"Failed for '{q}': expected out_of_domain_non_legal, got {cat}"
    print(f"      PASSED: DomainRouter correctly classified all {len(test_cases)} test cases.")


def test_calibrated_scoring():
    print("[3/5] Testing Calibrated Suitability Scoring...")
    exact_score = calibrate_suitability_score(0.85, is_exact=True, is_active=True)
    assert exact_score == 98.5, f"Exact match expected 98.5, got {exact_score}"

    high_sim = calibrate_suitability_score(0.85, is_exact=False, is_active=True)
    assert 85.0 <= high_sim <= 97.0, f"High similarity (0.85) expected [85, 97], got {high_sim}"

    mid_sim = calibrate_suitability_score(0.72, is_exact=False, is_active=True)
    assert 70.0 <= mid_sim < high_sim, f"Mid similarity expected < {high_sim}, got {mid_sim}"

    out_of_rank = calibrate_suitability_score(0.60, is_exact=False, is_active=False)
    assert out_of_rank <= 68.5, f"Out of rank expected <= 68.5, got {out_of_rank}"
    print(f"      PASSED: Calibrated scores (exact: {exact_score}%, high: {high_sim}%, mid: {mid_sim}%, out: {out_of_rank}%).")


def test_rank_and_stratify_citations():
    print("[4/5] Testing rank_and_stratify_citations monotonicity and stratification...")
    mock_items = [
        {"parent_type": "article", "parent_id": "RA386-ART1191", "similarity": 0.88, "rrf_score": 0.03},
        {"parent_type": "article", "parent_id": "RA386-ART1170", "similarity": 0.78, "rrf_score": 0.02},
        {"parent_type": "case", "parent_id": "CASE-123", "similarity": 0.65, "rrf_score": 0.01},
        {"parent_type": "article", "parent_id": "RA386-ART1385", "similarity": 0.52, "rrf_score": 0.005},
    ]
    ranked = rank_and_stratify_citations(mock_items, query="Article 1191 rescission", context_budget=2)
    assert len(ranked) == 4, f"Expected 4 items, got {len(ranked)}"
    assert ranked[0]["rank"] == 1
    assert ranked[0]["is_exact"] is True
    assert ranked[0]["suitability_percent"] == 98.5
    assert ranked[0]["is_in_context"] is True

    # Check monotonicity
    for i in range(len(ranked) - 1):
        assert ranked[i]["suitability_percent"] >= ranked[i + 1]["suitability_percent"], (
            f"Monotonicity violated: rank {i+1} ({ranked[i]['suitability_percent']}) < rank {i+2} ({ranked[i+1]['suitability_percent']})"
        )

    # Check that out of budget items have is_in_context False and <= 68.5%
    for item in ranked[2:]:
        assert item["is_in_context"] is False
        assert item["suitability_percent"] <= 68.5
    print("      PASSED: Monotonicity and stratification verified.")


def test_search_endpoint():
    print("[5/5] Testing /search endpoint with live PostgreSQL hybrid retrieval...")
    payload = {
        "query": "Article 1191 rescission breach of contract",
        "top_k": 5
    }
    resp = client.post("/search", json=payload)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    events = []
    citations = []
    for line in resp.text.split("\n"):
        line = line.strip()
        if line.startswith("data: "):
            try:
                ev = json.loads(line[6:].strip())
                events.append(ev)
                if ev.get("type") == "citations" and ev.get("data"):
                    citations = ev.get("data")
            except Exception:
                pass
    assert any(ev.get("type") == "status" for ev in events), f"Expected status events in SSE stream, got types: {[e.get('type') for e in events]}"
    assert any(ev.get("type") == "done" for ev in events), "Expected done event in SSE stream"
    assert len(citations) > 0, f"Expected citations in SSE stream, events: {[e.get('type') for e in events]}"
    top_hit = citations[0]
    assert "parent_id" in top_hit
    assert "suitability_percent" in top_hit
    assert "rank" in top_hit
    print(f"      PASSED: /search retrieved {len(citations)} citations via SSE stream. Top hit: {top_hit.get('parent_id')} ({top_hit.get('suitability_percent')}%)")


if __name__ == "__main__":
    print("=" * 60)
    print("Starting Autonomous RAG Pipeline Verification Suite")
    print("=" * 60)
    test_health()
    test_domain_router()
    test_calibrated_scoring()
    test_rank_and_stratify_citations()
    test_search_endpoint()
    print("=" * 60)
    print("ALL VERIFICATION CHECKS PASSED WITH ZERO ERRORS!")
    print("=" * 60)
