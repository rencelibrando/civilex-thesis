import sys
import os

# Add parent directory to path so imports work
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.article_parser import is_compound_or_multi_intent_query, parse_article_numbers
from main import is_simple_lookup, compute_embedding, search_with_embedding

def test_compound_detection():
    print("Testing compound and multi-intent detection...")
    
    # Positive cases (should be recognized as compound/multi-intent)
    compound_cases = [
        "whats the article 532 all about and also can you tell me whats the total article in civil code",
        "ano ang artikulo 532 at saka ilang artikulo mayroon ang civil code",
        "can you explain article 532 and give an example",
        "what is article 1156 and how does it relate to contracts in general?",
        "article 532, and what are the duties of an agent?",
        "what is article 532? how many articles are there in total?",
        "explain article 532 plus tell me the 4 books of civil code",
        "ano ang sakop ng article 532 bukod dito ano ang mga aklat ng civil code",
    ]
    for q in compound_cases:
        assert is_compound_or_multi_intent_query(q) is True, f"Failed on: {q}"
        assert is_simple_lookup(q) is False, f"is_simple_lookup should be False for: {q}"
    print("✓ All compound cases correctly detected and prevented from simple_lookup short-circuit.")

    # Negative cases (should be recognized as single-article simple lookups)
    simple_cases = [
        "what is article 532",
        "article 532",
        "ano ang artikulo 532",
        "explain article 532",
        "art 532 civil code",
        "Artikulo 532 ng Civil Code",
    ]
    for q in simple_cases:
        assert is_compound_or_multi_intent_query(q) is False, f"Failed on simple: {q}"
        assert is_simple_lookup(q) is True, f"is_simple_lookup should be True for: {q}"
    print("✓ All simple single-article cases correctly detected as simple_lookup.")


def test_typo_article_parsing_and_retrieval():
    print("\nTesting typo-tolerant article extraction and retrieval...")
    typo_queries = [
        ("can you explain to me the articl 1029", "1029"),
        ("artcle 1029", "1029"),
        ("atricle 532", "532"),
        ("artiklo 1029", "1029"),
        ("art 1029", "1029"),
        ("articlee 1029", "1029"),
    ]
    for q, expected_art in typo_queries:
        articles = parse_article_numbers(q)
        assert expected_art in articles, f"Failed to extract {expected_art} from typo query: '{q}' (got {articles})"
    print("✓ All common article typo variations correctly parsed into article numbers.")

    # End-to-end retrieval for the user's exact query
    user_query = "can you explain to me the articl 1029"
    q_emb = compute_embedding(user_query)
    results = search_with_embedding(q_emb, user_query)
    has_art_1029 = any("ART1029" in str(r.get("parent_id", "")) for r in results)
    assert has_art_1029, f"Article 1029 missing from retrieved results for '{user_query}'!"

    in_context = [r for r in results if r.get("is_in_context") is not False]
    assert any("ART1029" in str(r.get("parent_id", "")) for r in in_context), (
        "Article 1029 was not placed in active context!"
    )
    print(f"✓ '{user_query}' successfully retrieved RA386-ART1029 into active context (suitability: {results[0].get('suitability_percent')}%).")


def test_retrieval_and_context_preservation():
    print("\nTesting retrieval and context preservation for compound query...")
    query = "whats the article 532 all about and also can you tell me whats the total article in civil code"
    q_emb = compute_embedding(query)
    results = search_with_embedding(q_emb, query)

    # Check that results contain Article 532
    has_art_532 = any(
        "ART532" in str(r.get("parent_id", "")) or "532" in str((r.get("metadata") or {}).get("article_number", ""))
        for r in results
    )
    assert has_art_532, "Article 532 chunk missing from retrieved results!"

    # Check that results contain structural chunks (e.g. RA386-STRUCTURE-AND-ARTICLES)
    has_structure = any(
        "STRUCTURE" in str(r.get("parent_id", "")) or "GENERAL-INFO" in str(r.get("parent_id", ""))
        for r in results
    )
    assert has_structure, "Structural chunks (RA386-STRUCTURE-AND-ARTICLES) missing from retrieved results!"

    # Check in-context items
    in_context = [r for r in results if r.get("is_in_context") is not False]
    print(f"Retrieved {len(results)} total citations, {len(in_context)} in active context.")
    for idx, item in enumerate(in_context, 1):
        print(f"  [{idx}] ID: {item.get('parent_id')} | Suitability: {item.get('suitability_percent')}% | In-Context: {item.get('is_in_context')}")

    # Both Article 532 and Structure must be in active context
    in_ctx_pids = [str(r.get("parent_id", "")) for r in in_context]
    assert any("ART532" in pid for pid in in_ctx_pids), "Article 532 not in active context!"
    assert any("STRUCTURE" in pid for pid in in_ctx_pids), "RA386-STRUCTURE-AND-ARTICLES not in active context!"

    print("✓ Both Article 532 and Civil Code structural chunks are preserved in active context!")


if __name__ == "__main__":
    test_compound_detection()
    test_typo_article_parsing_and_retrieval()
    test_retrieval_and_context_preservation()
    print("\n ALL MULTI-INTENT & TYPO VERIFICATION TESTS PASSED SUCCESSFULLY!")

