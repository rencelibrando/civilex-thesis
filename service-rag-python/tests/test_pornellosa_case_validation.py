"""Regression tests validating the Segunda Pornellosa vs. Land Tenure Administration failure modes."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.jurisprudence_matcher import search_jurisprudence_cases
import main
from services import followups as followup_svc


class TestPornellosaCaseValidation(unittest.TestCase):
    QUERY = "explain to me the ncase of Segunda Pornellosa, et al. vs. Land Tenure Administration"

    def test_format_clean_gr_number_strips_fused_months_and_slash_artifacts(self):
        from core.jurisprudence_matcher import format_clean_gr_number

        self.assertEqual(format_clean_gr_number("G.R. No. L-14040January 31"), "G.R. No. L-14040")
        self.assertEqual(format_clean_gr_number("G.R. No. L-13134February 13"), "G.R. No. L-13134")
        self.assertEqual(format_clean_gr_number("G.R. No. 188289 August 20"), "G.R. No. 188289")
        self.assertEqual(format_clean_gr_number("G.R. No. 140836/G"), "G.R. No. 140836")
        self.assertEqual(format_clean_gr_number("G.R. Nos. 94188-89"), "G.R. Nos. 94188-89")
        self.assertEqual(format_clean_gr_number("A.M. OCA IPI No. 12-202-CA-J"), "A.M. OCA IPI No. 12-202-CA-J")

    def test_build_case_excerpt_preserves_head_facts_and_tail_sc_holding(self):
        long_text = (
            "G.R. No. L-14040 OPENING FACTS " + ("trial facts " * 500)
            + " FINAL SC HOLDING: Under Article 1358(1), the judgment under review is affirmed, with costs against the petitioners."
        )
        excerpt = main._build_case_excerpt(long_text, max_chars=2000)
        self.assertIn("OPENING FACTS", excerpt)
        self.assertIn("Article 1358(1)", excerpt)
        self.assertIn("judgment under review is affirmed", excerpt)

    def test_matcher_prunes_single_side_and_weak_secondary_hits_for_pornellosa(self):
        conn = main.get_db_connection()
        try:
            hits = search_jurisprudence_cases(conn, self.QUERY, max_results=4)
        finally:
            conn.close()
        uids = [h["case_uid"] for h in hits]
        self.assertEqual(uids, ["GR_L-14040JANUARY_1961"])

    def test_live_rag_retrieval_for_pornellosa_has_full_holding_art1358_and_no_art33_or_roa(self):
        emb = main.compute_embedding(self.QUERY)
        results = main.search_with_embedding(emb, self.QUERY, raw_query=self.QUERY)
        active = [r for r in results if r.get("is_in_context", True)]

        case_items = [r for r in active if r.get("parent_type") == "case"]
        art_items = [r for r in active if r.get("parent_type") == "article"]

        case_ids = [c["parent_id"] for c in case_items]
        art_ids = [a["parent_id"] for a in art_items]

        self.assertIn("GR_L-14040JANUARY_1961", case_ids)
        self.assertNotIn("GR_L-13134FEBRUARY_1960", case_ids)
        self.assertIn("RA386-ART1358", art_ids)
        self.assertNotIn("RA386-ART33", art_ids)

        pornellosa = next(c for c in case_items if c["parent_id"] == "GR_L-14040JANUARY_1961")
        self.assertEqual(pornellosa["metadata"]["gr_number"], "G.R. No. L-14040")
        self.assertIn("The judgment under review is affirmed", pornellosa["content"])
        self.assertIn("must appear in a public document", pornellosa["content"])
        self.assertIn("Article 1358(1)", pornellosa["content"])

    def test_followups_enforce_strict_english_on_english_case_query(self):
        self.assertEqual(followup_svc.detect_query_language(self.QUERY), "en")
        self.assertEqual(followup_svc.detect_query_language("Ano ang hatol sa kaso ni Segunda Pornellosa?"), "tl")

        msgs = followup_svc.build_messages(self.QUERY, "The Supreme Court affirmed the dismissal...")
        self.assertIn("ENGLISH ONLY", msgs[1]["content"])

        mixed_llm_output = (
            "Ano ang sinasabi ng batas sa mga kasong ganito?\n"
            "Paano ko mapapatunayan na ako ay bona fide purchaser?\n"
            "Why did the Supreme Court rule that Exhibit A could not transfer lot ownership?"
        )
        filtered = followup_svc.parse_followup_questions(mixed_llm_output, target_lang="en")
        self.assertEqual(
            filtered,
            ["Why did the Supreme Court rule that Exhibit A could not transfer lot ownership?"],
        )

    def test_nli_polarity_handles_negated_positive_phrases_and_word_boundaries(self):
        from services.nli import _has_polarity_inversion, decompose_claims, verify_claim_symbolic

        # Negated positive ("did not show a valid contract") must NOT invert against a premise containing "void" or "devoid".
        claim = (
            "The Court ruled that the petitioners failed to prove their right to compel sale "
            "because they did not show a valid contract or legal basis for such sale, "
            "and the deed of sale was insufficient as it lacked specific area and boundaries."
        )
        premise_prayer = (
            "An action to compel the Director of Lands to execute a deed of sale of a residential lot "
            "in favor of the petitioners upon payment of the purchase price of P1,505, "
            "to declare null and void a deed of sale of the lot executed by the then Minister."
        )
        self.assertFalse(_has_polarity_inversion(claim.lower(), premise_prayer.lower(), coverage=0.40))

        # Word boundary guard: "devoid" must NOT match "void".
        self.assertFalse(
            _has_polarity_inversion(
                "the contract is valid and binding between the parties.",
                "this piece of evidence is devoid of persuasive value.",
                coverage=0.30,
            )
        )

        # Genuine contradiction must STILL be caught!
        self.assertTrue(
            _has_polarity_inversion(
                "the injured party cannot rescind the obligation upon breach.",
                "the injured party may choose between fulfillment and the rescission of the obligation.",
                coverage=0.65,
            )
        )
        self.assertTrue(
            _has_polarity_inversion(
                "a contract entered into without consent is valid and binding.",
                "a contract entered into without consent is void and produces no effect.",
                coverage=0.65,
            )
        )

        # Full symbolic verification on the Pornellosa direct answer must be entailed (0 contradicted).
        pornellosa_premises = [
            premise_prayer,
            "Significantly, the plaintiffs cannot show a contract whereby the Rural Progress Administration has sold or promised to sell them a lot of two hundred square meters.",
            "In that document, however, the area of the lot on which San Jose's house stood had not been specified, nor had the boundaries thereof been mentioned.",
            "Now, for all the reasons stated above, we believe that the plaintiffs failed to establish their right to compel the Director of Lands to execute a deed of sale.",
        ]
        v = verify_claim_symbolic(claim, pornellosa_premises, {"RA386-ART1358"})
        self.assertEqual(v.verdict, "entailed")
        self.assertNotEqual(v.rule_fired, "R2_deontic_polarity_contradiction")

        # Structural heading "Practical Legal Implications" must be filtered out of decomposed claims.
        decomposed = decompose_claims("Practical Legal Implications\nRelated Supreme Court Jurisprudence & Doctrines\nUnder Article 1358, real rights over immovable property must appear in a public document.")
        self.assertEqual(len(decomposed), 1)
        self.assertIn("Article 1358", decomposed[0])


if __name__ == "__main__":
    unittest.main()
