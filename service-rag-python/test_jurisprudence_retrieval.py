import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import embed_and_search

test_queries = [
    {
        "query": "What was the ruling in Chi Ming Tsoi vs. Court of Appeals, G.R. No. 119190?",
        "expected_uid": "GR_119190JANUARY_1997",
        "expected_title": "Chi Ming Tsoi",
    },
    {
        "query": "Doctrine in Santos vs. Court of Appeals, G.R. No. 112019",
        "expected_uid": "GR_112019JANUARY_1995",
        "expected_title": "Santos",
    },
    {
        "query": "Silverio vs. Republic, G.R. No. 174689",
        "expected_uid": "GR_174689_2007",
        "expected_title": "Silverio",
    },
    {
        "query": "G.R. No. 119190",
        "expected_uid": "GR_119190JANUARY_1997",
        "expected_title": "Chi Ming Tsoi",
    },
    {
        "query": "Gregorio Lobete vs. Carlos Sundiam, G.R. No. L-38278",
        "expected_uid": "GR_L-38278JUNE_1983",
        "expected_title": "Lobete",
    },
]

def main():
    print("Testing Jurisprudence Retrieval for Exact Case Titles & G.R. Numbers...\n")
    all_passed = True

    for item in test_queries:
        q = item["query"]
        expected_uid = item["expected_uid"]
        expected_title = item["expected_title"]

        print(f"--- Query: '{q}' ---")
        citations = embed_and_search(query=q)

        if not citations:
            print("FAILED: No citations returned.")
            all_passed = False
            continue

        top_hit = citations[0]
        parent_id = top_hit.get("parent_id", "")
        meta = top_hit.get("metadata") or {}
        title = meta.get("title") or top_hit.get("title", "")
        rank = top_hit.get("rank", -1)
        is_exact = top_hit.get("is_exact", False)
        suitability = top_hit.get("suitability_percent", 0.0)
        is_in_context = top_hit.get("is_in_context", False)

        print(f"  Top Hit: {parent_id}")
        print(f"  Title: {title}")
        print(f"  Rank: {rank}, is_exact: {is_exact}, suitability: {suitability}%, is_in_context: {is_in_context}")

        # Assertions
        matched_uid = (parent_id == expected_uid)
        matched_title = (expected_title.lower() in title.lower())
        is_exact_valid = (is_exact is True)
        suitability_valid = (suitability >= 98.0)
        in_context_valid = (is_in_context is True)
        rank_1_valid = (rank == 1)

        if matched_uid and is_exact_valid and suitability_valid and in_context_valid and rank_1_valid:
            print(f"  PASSED: Rank #1 exact case matched: {parent_id} ({suitability}%)\n")
        else:
            print("  FAILED:")
            print(f"    Expected UID: {expected_uid}, Got: {parent_id} (match={matched_uid})")
            print(f"    Title match: {matched_title}")
            print(f"    Rank==1: {rank_1_valid}")
            print(f"    is_exact==True: {is_exact_valid}")
            print(f"    suitability>=98: {suitability_valid}")
            print(f"    is_in_context==True: {in_context_valid}\n")
            all_passed = False

    if all_passed:
        print("ALL JURISPRUDENCE RETRIEVAL TESTS PASSED SUCCESSFULLY!")
        sys.exit(0)
    else:
        print("SOME TESTS FAILED.")
        sys.exit(1)

if __name__ == "__main__":
    main()
