"""Comprehensive 60+ edge-case and multi-scenario test suite for CIVIL-LEX RAG."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.article_parser import (
    extract_case_parties,
    extract_case_title_candidate,
    is_jurisprudence_query,
    parse_article_numbers,
    parse_gr_numbers,
    resolve_candidate_article_ids,
)
from core.jurisprudence_matcher import search_jurisprudence_cases
import main
from services.nli import _normalize_context_payload, verify_claim_symbolic


class TestNonStandardArticleEdgeCases(unittest.TestCase):
    def test_thirty_plus_non_standard_article_formats(self):
        cases = [
            ("art#1191", ["1191"]),
            ("art # 1191", ["1191"]),
            ("article #1191", ["1191"]),
            ("art-1191", ["1191"]),
            ("art: 1191", ["1191"]),
            ("art=1191", ["1191"]),
            ("Art 1,191", ["1191"]),
            ("Article 2,176", ["2176"]),
            ("Art. 1,191 and 2,176", ["1191", "2176"]),
            ("Art. 1, 191", ["1", "191"]),
            ("artilce 99", ["99"]),
            ("artcle 1159", ["1159"]),
            ("atr 1170", ["1170"]),
            ("arts 147 and 148", ["147", "148"]),
            ("artikulo 1191", ["1191"]),
            ("artikulo # 36", ["36"]),
            ("mga artikulo 1191 at 1170", ["1191", "1170"]),
            ("probisyon 1191", ["1191"]),
            ("eo 209 36", ["36"]),
            ("e.o. 209 36", ["36"]),
            ("family code 36", ["36"]),
            ("fc 36", ["36"]),
            ("cc 1191", ["1191"]),
            ("ra 386 1191", ["1191"]),
            ("kodigo sibil 1191", ["1191"]),
            ("batas sibil 1191", ["1191"]),
            ("sec 36 family code", ["36"]),
            ("section 1191 civil code", ["1191"]),
            ("36 family code", ["36"]),
            ("36 of the family code", ["36"]),
            ("36 ng family code", ["36"]),
            ("1191 civil code", ["1191"]),
            ("1191 of the civil code", ["1191"]),
            ("1191 ng civil code", ["1191"]),
            ("1191", ["1191"]),
            ("#2176", ["2176"]),
            ("what is 1191?", ["1191"]),
            ("explain 2176", ["2176"]),
            ("ano ang 1191", ["1191"]),
            ("cases for 1191", ["1191"]),
            ("Art. 1156 to 1158", ["1156", "1157", "1158"]),
            ("Articles 445 vs 415", ["445", "415"]),
        ]
        for query, expected in cases:
            with self.subTest(query=query):
                self.assertEqual(parse_article_numbers(query), expected)

    def test_article_false_positive_guards(self):
        negatives = [
            "decided in 1995",
            "G.R. No. 188289",
            "gr188289",
            "worth 1,500 pesos",
            "worth 1500 pesos",
            "PHP 1,200",
            "I borrowed 1500 from my friend",
            "Executive Order No. 209 Family Code",
            "Republic Act 386 Civil Code",
            "1987 Family Code",
            "Article 248 of the Revised Penal Code",
            "Art. 297 of the Labor Code",
        ]
        for query in negatives:
            with self.subTest(query=query):
                self.assertEqual(parse_article_numbers(query), [])

    def test_dual_code_candidate_resolution_prioritizes_family_code_for_divorce_and_marriage(self):
        self.assertEqual(resolve_candidate_article_ids("Article 26 foreign divorce", ["26"])[0], "EO209-ART26")
        self.assertEqual(resolve_candidate_article_ids("36 family code", ["36"]), ["EO209-ART36"])
        self.assertEqual(resolve_candidate_article_ids("Article 36 civil code", ["36"]), ["RA386-ART36"])


class TestNonStandardJurisprudenceEdgeCases(unittest.TestCase):
    def test_docket_parsing_variants_and_ranges(self):
        docket_checks = [
            ("gr188289", "188289"),
            ("gr#188289", "188289"),
            ("gr-188289", "188289"),
            ("gr: 188289", "188289"),
            ("g.r 188289", "188289"),
            ("G.R. No. 188289", "188289"),
            ("gr l 1892", "L-1892"),
            ("gr l-1892", "1892"),
            ("l-1892", "L-1892"),
            ("l1892", "1892"),
            ("G.R. Nos. 94188-89", "94189"),
            ("G.R. No. L-11319-20", "L-11320"),
            ("G.R. Nos. 159561-62", "159562"),
            ("A.M. No. 1037", "1037"),
            ("A.M. No. RTJ-93-978", "RTJ-93-978"),
            ("A.M. OCA IPI No. 12-202-CA-J", "12-202-CA-J"),
            ("A.C. No. 4585", "4585"),
            ("B.M. No. 850", "850"),
            ("188289", "188289"),
            ("case 188289", "188289"),
            ("docket 188289", "188289"),
            ("sc 188289", "188289"),
        ]
        for query, expected_token in docket_checks:
            with self.subTest(query=query):
                parsed = parse_gr_numbers(query)
                self.assertIn(expected_token, parsed, f"{expected_token!r} missing from {parsed!r}")

        self.assertEqual(parse_gr_numbers("I am 25 years old"), [])
        self.assertEqual(parse_gr_numbers("He owes me 50000 pesos"), [])
        self.assertEqual(parse_gr_numbers("Article 1191"), [])

    def test_unicode_and_bilingual_jurisprudence_detection(self):
        self.assertEqual(extract_case_title_candidate("Cariño vs. Cariño"), "Cariño vs. Cariño")
        self.assertIn("Cariño", extract_case_parties("Cariño vs. Cariño"))
        self.assertIn("Osmeña", extract_case_parties("Osmeña vs. Rodriguez"))
        self.assertIn("Peña", extract_case_parties("Peña vs. Court of Appeals"))

        positive_queries = [
            "mga kaso sa art 1191",
            "ano ang mga kaso sa art 1191",
            "ano ang mga hatol sa article 36",
            "desisyon sa art 1191",
            "doktrina sa article 36",
            "sc decisions applying 2176",
            "rulings interpreting article 1191",
            "chi ming tsoi case",
            "ruling in tan-andal",
            "molina doctrine",
            "noveras case",
        ]
        for q in positive_queries:
            with self.subTest(query=q):
                self.assertTrue(is_jurisprudence_query(q))

        negative_queries = [
            "anong kaso ang pwede ikaso sa akin",
            "ano ang kaso na pwede isampa sa kanya",
            "in case of non-payment of rent",
            "what is article 1191",
            "ano ang ibig sabihin ng article 36",
        ]
        for q in negative_queries:
            with self.subTest(query=q):
                self.assertFalse(is_jurisprudence_query(q))

    def test_reconciliation_fused_months_ranges_and_accents(self):
        self.assertEqual(main._normalize_gr_token("G.R. No. L-1892August 16"), "L1892")
        self.assertEqual(main._normalize_gr_token("G.R. No. 119190January 16"), "119190")
        self.assertEqual(main._normalize_gr_token("G.R. No. 140836/G"), "140836")

        cit_accent = {
            "parent_type": "case",
            "parent_id": "GR_132529FEBRUARY_2001",
            "metadata": {
                "gr_number": "G.R. No. 132529February 2",
                "title": "Susan Nicdao Cariño vs. Susan Yee Cariño",
            },
        }
        self.assertTrue(
            main._is_case_cited_in_text(cit_accent, "In Carino vs. Carino, the Supreme Court held...", set())
        )
        self.assertTrue(
            main._is_case_cited_in_text(cit_accent, "Under G.R. No. 132529...", {"132529"})
        )


class TestLiveDatabaseRetrievalScenarios(unittest.TestCase):
    """End-to-end live PostgreSQL (:54322) verification across Civil Code, Family Code, and Jurisprudence."""

    def test_repaired_family_code_articles_are_complete_in_db(self):
        expected_clauses = {
            "EO209-ART2": "(2) Consent freely given",
            "EO209-ART3": "(3) A marriage ceremony",
            "EO209-ART4": "civilly, criminally and administratively liable",
            "EO209-ART26": "capacity to remarry under Philippine law",
            "EO209-ART37": "(2) Between brothers and sisters",
            "EO209-ART46": "grounds for action for the annulment of marriage",
            "EO209-ART102": "(6)",
            "EO209-ART129": "(9)",
        }
        conn = main.get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT article_id, content FROM civil_code_articles WHERE article_id = ANY(%s)",
                    (list(expected_clauses.keys()),),
                )
                rows = dict(cur.fetchall())
        finally:
            conn.close()

        for aid, needle in expected_clauses.items():
            with self.subTest(article_id=aid):
                self.assertIn(needle, rows.get(aid, ""))

    def test_multi_chunk_articles_return_full_canonical_text(self):
        multi_chunk_checks = [
            ("Article 32 Civil Code", "RA386-ART32", "(19)"),
            ("Article 45 of the Family Code", "EO209-ART45", "(1)"),
            ("Article 45 of the Family Code", "EO209-ART45", "(6)"),
            ("Article 1032 Civil Code", "RA386-ART1032", "(8)"),
            ("Article 2208 Civil Code", "RA386-ART2208", "(11)"),
        ]
        for query, expected_id, clause in multi_chunk_checks:
            with self.subTest(query=query, clause=clause):
                emb = main.compute_embedding(query)
                res = main.search_with_embedding(emb, query, raw_query=query)
                hit = next((r for r in res if r.get("parent_id") == expected_id), None)
                self.assertIsNotNone(hit, f"Expected {expected_id} for {query!r}")
                self.assertIn(clause, hit.get("content", ""))

    def test_live_jurisprudence_matcher_non_standard_queries(self):
        conn = main.get_db_connection()
        try:
            expectations = [
                ("gr188289", "GR_188289_2014"),
                ("gr#188289", "GR_188289_2014"),
                ("gr-188289", "GR_188289_2014"),
                ("gr l 1892", "GR_L-1892AUGUST_1949"),
                ("94188", "GR_S_1992_8"),
                ("94189", "GR_S_1992_8"),
                ("159562", "GR_S_2012_6"),
                ("A.M. OCA IPI No. 12-202-CA-J", "GR_UNKNOWN_2013"),
                ("sps. quirong vs dbp", "GR_173441_2009"),
                ("quirong vs dbp", "GR_173441_2009"),
                ("Cariño vs. Cariño", "GR_132529FEBRUARY_2001"),
                ("carino vs carino", "GR_132529FEBRUARY_2001"),
                ("chi ming tsoi case", "GR_119190JANUARY_1997"),
            ]
            for query, expected_uid in expectations:
                with self.subTest(query=query):
                    hits = search_jurisprudence_cases(conn, query, max_results=3)
                    self.assertTrue(hits, f"No matches for {query!r}")
                    self.assertEqual(hits[0]["case_uid"], expected_uid)

            # Public-party guard on live 11,879-case index: all matches for "Republic vs. Molina" must contain Molina.
            molina_hits = search_jurisprudence_cases(conn, "Republic vs. Molina", max_results=3)
            self.assertTrue(molina_hits)
            for hit in molina_hits:
                self.assertIn("molina", hit["title"].lower())
        finally:
            conn.close()

    def test_live_end_to_end_rag_retrieval_for_family_and_civil_code_scenarios(self):
        scenarios = [
            ("art#1191", "RA386-ART1191", False),
            ("art 1,191", "RA386-ART1191", False),
            ("36 family code", "EO209-ART36", False),
            ("ano ang 2176", "RA386-ART2176", False),
            ("Article 26 foreign divorce", "EO209-ART26", False),
            ("jurisprudence on article 36 of the family code", "EO209-ART36", True),
            ("mga kaso sa art 1191", "RA386-ART1191", True),
            ("ano ang mga hatol sa article 41 family code", "EO209-ART41", True),
        ]
        for query, expected_art, expect_cases in scenarios:
            with self.subTest(query=query):
                emb = main.compute_embedding(query)
                res = main.search_with_embedding(emb, query, raw_query=query)
                active = [r for r in res if r.get("is_in_context", True)]
                art_ids = [r["parent_id"] for r in active if r.get("parent_type") == "article"]
                self.assertIn(expected_art, art_ids, f"Missing {expected_art} in {art_ids}")
                if expect_cases:
                    cases = [r for r in active if r.get("parent_type") == "case"]
                    self.assertGreater(len(cases), 0, f"Expected linked cases for {query!r}")

    def test_nli_verifies_repaired_family_code_art26_claim(self):
        conn = main.get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT content FROM civil_code_articles WHERE article_id = 'EO209-ART26'")
                content = cur.fetchone()[0]
        finally:
            conn.close()

        ctx_text, ctx_ids = _normalize_context_payload(
            [{"parent_type": "article", "parent_id": "EO209-ART26", "content": content}]
        )
        verdict = verify_claim_symbolic(
            "Under Article 26 of the Family Code, where a marriage between a Filipino citizen and a foreigner is validly celebrated and a divorce is validly obtained abroad by the alien spouse capacitating remarriage, the Filipino spouse has capacity to remarry under Philippine law.",
            [ctx_text],
            ctx_ids,
        )
        self.assertEqual(verdict.verdict, "entailed")
        self.assertNotEqual(verdict.rule_fired, "R1_unsupported_statutory_anchor")


if __name__ == "__main__":
    unittest.main()
