import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main
from services.nli import _normalize_context_payload, verify_claim_symbolic


class TestPhase4RetrievalAndNli(unittest.TestCase):
    def test_jurisprudence_matcher_handles_dockets_acronyms_unicode_and_public_party_guard(self):
        from core.jurisprudence_matcher import JurisprudenceIndex, build_jurisprudence_index

        sample_rows = [
            {
                "case_uid": "GR_108763_1997",
                "gr_number": "G.R. No. 108763February 13",
                "title": "Republic of the Philippines vs. Court of Appeals and Roridel Olaviano Molina",
                "decision_date": "February 13, 1997",
            },
            {
                "case_uid": "GR_99999_1995",
                "gr_number": "G.R. No. 99999",
                "title": "Juan Cruz vs. Republic",
                "decision_date": "March 1, 1995",
            },
            {
                "case_uid": "GR_173441_2009",
                "gr_number": "G.R. No. 173441",
                "title": "Spouses Quirong vs. Development Bank of the Philippines",
                "decision_date": "December 3, 2009",
            },
            {
                "case_uid": "GR_132529_2001",
                "gr_number": "G.R. No. 132529",
                "title": "Susan Nicdao Cariño vs. Susan Yee Cariño",
                "decision_date": "February 2, 2001",
            },
            {
                "case_uid": "GR_119190_1997",
                "gr_number": "G.R. No. 119190January 16",
                "title": "Chi Ming Tsoi vs. Court of Appeals",
                "decision_date": "January 16, 1997",
            },
            {
                "case_uid": "GR_S_1992_8",
                "gr_number": "G.R. Nos. 94188-89",
                "title": "People of the Philippines vs. Manuel Batis",
                "decision_date": "December 17, 1992",
            },
            {
                "case_uid": "GR_L-1892AUGUST_1949",
                "gr_number": "G.R. No. L-1892August 16",
                "title": "Test Case L-1892 vs. Sample Party",
                "decision_date": "August 16, 1949",
            },
            {
                "case_uid": "GR_196359_2021",
                "gr_number": "G.R. No. 196359",
                "title": "Rosanna L. Tan-Andal vs. Mario Victor M. Andal",
                "decision_date": "May 11, 2021",
            },
        ]
        idx: JurisprudenceIndex = build_jurisprudence_index(sample_rows, {})

        # Public-party guard: Republic vs. Molina MUST return Molina, NOT Juan Cruz vs. Republic
        molina_hits = idx.search("Republic vs. Molina", max_results=3)
        self.assertEqual([h["case_uid"] for h in molina_hits], ["GR_108763_1997"])

        # Acronym + alias: sps quirong vs dbp
        dbp_hits = idx.search("sps. quirong vs dbp", max_results=3)
        self.assertEqual(dbp_hits[0]["case_uid"], "GR_173441_2009")

        # Accent-insensitive Unicode match
        carino_hits = idx.search("carino vs carino", max_results=3)
        self.assertEqual(carino_hits[0]["case_uid"], "GR_132529_2001")

        # Single-party / doctrine queries without "vs."
        tsoi_hits = idx.search("chi ming tsoi case", max_results=3)
        self.assertEqual(tsoi_hits[0]["case_uid"], "GR_119190_1997")

        andal_hits = idx.search("ruling in tan-andal", max_results=3)
        self.assertEqual(andal_hits[0]["case_uid"], "GR_196359_2021")

        # Consolidated range second docket number
        batis_hits = idx.search("94189", max_results=3)
        self.assertEqual(batis_hits[0]["case_uid"], "GR_S_1992_8")

        # Fused-month L-series docket
        l_hits = idx.search("gr l 1892", max_results=3)
        self.assertEqual(l_hits[0]["case_uid"], "GR_L-1892AUGUST_1949")

        # Non-case statutory query must NOT match random cases
        self.assertEqual(idx.search("Article 1191 rescission of contract", max_results=3), [])

    def test_fused_month_and_consolidated_gr_reconciliation(self):
        self.assertEqual(main._normalize_gr_token("G.R. No. L-1892August 16"), "L1892")
        self.assertEqual(main._normalize_gr_token("G.R. No. 119190January 16"), "119190")
        self.assertEqual(main._normalize_gr_token("G.R. No. 140836/G"), "140836")

        cit_fused = {
            "parent_type": "case",
            "parent_id": "GR_L-1892AUGUST_1949",
            "metadata": {
                "gr_number": "G.R. No. L-1892August 16",
                "title": "Sample Petitioner vs. Sample Respondent",
            },
        }
        self.assertTrue(main._is_case_cited_in_text(cit_fused, "In G.R. No. L-1892, the Court held...", {"L1892", "1892"}))
        self.assertTrue(main._is_case_cited_in_text(cit_fused, "Under G.R. No. 1892...", {"1892"}))

        cit_range = {
            "parent_type": "case",
            "parent_id": "GR_S_1992_8",
            "metadata": {
                "gr_number": "G.R. Nos. 94188-89",
                "title": "People of the Philippines vs. Manuel Batis",
            },
        }
        self.assertTrue(main._is_case_cited_in_text(cit_range, "In G.R. No. 94189...", {"94189"}))

    def test_multi_chunk_article_collapse_takes_max_similarity(self):
        rows = [
            {"chunk_id": "EO209-ART45_c0", "parent_type": "article", "parent_id": "EO209-ART45", "content": "chunk 0", "similarity": 0.91},
            {"chunk_id": "EO209-ART45_c1", "parent_type": "article", "parent_id": "EO209-ART45", "content": "chunk 1", "similarity": 0.77},
        ]
        collapsed = main._collapse_article_chunk_rows(rows)
        self.assertIn("EO209-ART45", collapsed)
        self.assertEqual(collapsed["EO209-ART45"]["chunk_id"], "EO209-ART45_c0")
        self.assertAlmostEqual(collapsed["EO209-ART45"]["similarity"], 0.91, places=4)

    def test_nli_dual_code_statutory_anchor_supports_eo209_without_false_veto(self):
        # Context contains EO209-ART36 chunk WITHOUT an inline "Article 36" string in content
        context_chunks = [
            {
                "parent_type": "article",
                "parent_id": "EO209-ART36",
                "content": (
                    "A marriage contracted by any party who, at the time of the celebration, "
                    "was psychologically incapacitated to comply with the essential marital obligations "
                    "of marriage, shall likewise be void even if such incapacity becomes manifest only "
                    "after its solemnization."
                ),
            }
        ]
        ctx_text, ctx_ids = _normalize_context_payload(context_chunks)
        self.assertIn("EO209-ART36", ctx_ids)
        self.assertIn("RA386-ART36", ctx_ids)

        verdict = verify_claim_symbolic(
            "Under Article 36 of the Family Code, a marriage contracted by a party who was psychologically incapacitated to comply with essential marital obligations is void.",
            [ctx_text],
            ctx_ids,
        )
        self.assertNotEqual(verdict.rule_fired, "R1_unsupported_statutory_anchor")
        self.assertEqual(verdict.verdict, "entailed")

        # Contrast: without RA386-ART36 registered, Rule 1 would veto this claim.
        vetoed = verify_claim_symbolic(
            "Under Article 36 of the Family Code, a marriage contracted by a party who was psychologically incapacitated to comply with essential marital obligations is void.",
            [ctx_text],
            {"EO209-ART36"},
        )
        self.assertEqual(vetoed.rule_fired, "R1_unsupported_statutory_anchor")


if __name__ == "__main__":
    unittest.main()
