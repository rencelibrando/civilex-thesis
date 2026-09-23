import urllib.request
import json
from main import classify_query_intent

test_cases = [
    ("How do I make a chocolate cake?", "out_of_domain_non_legal"),
    ("Write a python function to sort a list", "out_of_domain_non_legal"),
    ("What are the criminal penalties for theft under the Revised Penal Code?", "out_of_domain_legal"),
    ("How much is the corporate income tax rate with BIR under the CREATE law?", "out_of_domain_legal"),
    ("What are the grounds for illegal dismissal with DOLE NLRC?", "out_of_domain_legal"),
    ("Under Article 1191, what are the remedies of the injured party?", "in_domain_civil"),
    ("What happens if the buyer defaults on installment payments for land under Maceda Law?", "in_domain_civil"),
    ("Nabangga ang kotse ko ng lasing na driver, ano ang pwede kong ikaso para sa danyos?", "in_domain_civil"),
    ("Sinuntok ako ng kapitbahay ko, pwede ba akong humingi ng danyos?", "in_domain_civil"),
    ("What are the exact statutory damages for quantum entanglement breach under RA 386?", "out_of_domain_non_legal")
]

print("=== PART 1: Intent Classification Unit Tests ===")
for q, expected in test_cases:
    res = classify_query_intent(q)
    cat = res["category"]
    print(f"[{cat == expected}] {q[:50]}... -> {cat}")
    assert cat == expected, f"Failed on {q}: got {res}"

print("\n=== PART 2: Live /search API End-to-End Stream Tests ===")

def query_search_endpoint(query_text):
    req = urllib.request.Request(
        "http://localhost:8000/search",
        data=json.dumps({"query": query_text, "history": []}).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    res = urllib.request.urlopen(req)
    events = []
    for line in res:
        line_str = line.decode("utf-8").strip()
        if line_str.startswith("data: "):
            try:
                events.append(json.loads(line_str[6:]))
            except Exception:
                pass
    return events

# Test 1: Python query (Out of Domain Non-Legal)
print("\n--- API Test: Python Coding Query ---")
e_python = query_search_endpoint("How do I write a Python function to sort a list?")
la_python = [e["data"] for e in e_python if e.get("type") == "legal_analytics"][-1]
cits_python = next(e["data"] for e in e_python if e.get("type") == "citations")
print("Python LA:", la_python)
print("Python Citations count:", len(cits_python))
assert la_python["is_out_of_domain"] is True
assert la_python["nli_score"] is None
assert la_python["domain_category"] == "non_legal"
assert len(cits_python) == 0

# Test 2: Tax query (Out of Domain Legal)
print("\n--- API Test: Tax Law Query ---")
e_tax = query_search_endpoint("How much is corporate income tax rate with the BIR under the CREATE law?")
la_tax = [e["data"] for e in e_tax if e.get("type") == "legal_analytics"][-1]
cits_tax = next(e["data"] for e in e_tax if e.get("type") == "citations")
print("Tax LA:", la_tax)
print("Tax Citations count:", len(cits_tax))
assert la_tax["is_out_of_domain"] is True
assert la_tax["nli_score"] is None
assert la_tax["domain_category"] == "other_legal"
assert "Tax" in la_tax["target_domain"]
assert len(cits_tax) == 0

# Test 3: In-Domain Civil Code (Article 1191)
print("\n--- API Test: Article 1191 Reciprocal Obligations ---")
e_civil = query_search_endpoint("Under Article 1191, what are the remedies of the injured party in reciprocal obligations?")
la_civil_init = [e["data"] for e in e_civil if e.get("type") == "legal_analytics"][0]
la_civil_final = [e["data"] for e in e_civil if e.get("type") == "legal_analytics"][-1]
cits_civil = next(e["data"] for e in e_civil if e.get("type") == "citations")
print("Civil LA Initial:", la_civil_init)
print("Civil LA Final:", la_civil_final)
print("Civil Citations count:", len(cits_civil))
assert la_civil_init.get("is_out_of_domain") is not True
assert len(cits_civil) > 0
if not la_civil_final.get("is_out_of_domain"):
    assert la_civil_final["nli_score"] is not None and isinstance(la_civil_final["nli_score"], (int, float))

# Test 4: Tagalog Quasi-Delict
print("\n--- API Test: Tagalog Quasi-Delict / Danyos ---")
e_tagalog = query_search_endpoint("Nabangga ang kotse ko ng lasing na driver, ano ang pwede kong ikaso para sa danyos?")
la_tagalog_init = [e["data"] for e in e_tagalog if e.get("type") == "legal_analytics"][0]
la_tagalog_final = [e["data"] for e in e_tagalog if e.get("type") == "legal_analytics"][-1]
cits_tagalog = next(e["data"] for e in e_tagalog if e.get("type") == "citations")
print("Tagalog LA Initial:", la_tagalog_init)
print("Tagalog LA Final:", la_tagalog_final)
print("Tagalog Citations count:", len(cits_tagalog))
assert la_tagalog_init.get("is_out_of_domain") is not True
assert len(cits_tagalog) > 0

print("\n🎉 ALL TESTS (UNIT + LIVE API ENDPOINT) PASSED WITH ZERO ERRORS!")
