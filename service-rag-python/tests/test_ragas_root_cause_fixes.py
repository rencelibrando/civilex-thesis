"""Regression tests for retrieval expansion hijacking, structural gating, Carino ranking, Art. 41 NLI, and GR-03 spoof."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.jurisprudence_matcher import search_jurisprudence_cases
import main
from services.nli import _has_polarity_inversion, score_faithfulness


class TestRagasRootCauseFixes(unittest.TestCase):
    def test_nli_unless_if_statutory_exception_is_not_contradiction(self):
        art41_premise = (
            "A marriage contracted by any person during subsistence of a previous marriage shall be "
            "null and void, unless before the celebration of the subsequent marriage, the prior spouse "
            "had been absent for four consecutive years and the spouse present has a well-founded belief "
            "that the absent spouse was already dead."
        )
        exception_claim = (
            "Under Article 41 of the Family Code, a subsequent marriage is valid if the prior spouse "
            "has been absent for four consecutive years and the spouse present has a well-founded belief "
            "that the absent spouse is already dead."
        )
        self.assertFalse(_has_polarity_inversion(exception_claim.lower(), art41_premise.lower(), coverage=0.60))

        res = score_faithfulness(
            exception_claim,
            [{"parent_id": "EO209-ART41", "content": art41_premise}],
            mode="symbolic",
        )
        self.assertEqual(res.claims_contradicted, 0)
        self.assertEqual(res.claims_entailed, 1)

        # Unconditional contradiction against Art. 41 must still be flagged.
        bad_claim = "A marriage contracted during subsistence of a previous marriage is always valid and binding."
        self.assertTrue(_has_polarity_inversion(bad_claim.lower(), art41_premise.lower(), coverage=0.60))

    def test_nli_without_prejudice_and_without_fault_before_delay_do_not_false_contradict(self):
        from services.nli import _classify_modality

        # Art. 1262 verbatim paraphrase: "without fault ... and before delay" must not invert against ", and before he has incurred in delay".
        claim_1262 = (
            "Under Article 1262 of the Civil Code, if an obligation consists in the delivery of a determinate thing "
            "that is lost or destroyed by fortuitous event without fault of the debtor and before delay, "
            "the obligation is extinguished."
        )
        premise_1262 = (
            "An obligation which consists in the delivery of a determinate thing shall be extinguished if it should "
            "be lost or destroyed without the fault of the debtor, and before he has incurred in delay."
        )
        self.assertFalse(_has_polarity_inversion(claim_1262.lower(), premise_1262.lower(), coverage=0.91))

        # Art. 1191 par. 4: "without prejudice to the rights of third persons" is preservation, not prohibition.
        claim_1191 = (
            "This right does not affect third persons who have already acquired rights over the property "
            "under Articles 1385 and 1388, or under the Mortgage Law."
        )
        premise_1191 = (
            "This is understood to be without prejudice to the rights of third persons who have acquired the thing, "
            "in accordance with articles 1385 and 1388 and the Mortgage Law."
        )
        self.assertEqual(_classify_modality(premise_1191.lower()), "permission")
        self.assertFalse(_has_polarity_inversion(claim_1191.lower(), premise_1191.lower(), coverage=0.63))

        # Word boundary in _classify_modality: "voidable" and "avoid" must not classify as prohibition ("void").
        self.assertNotEqual(_classify_modality("a voidable contract may be ratified to avoid litigation."), "prohibition")

    def test_jurisprudence_matcher_strips_question_preamble_so_carino_vs_carino_ranks_first(self):
        conn = main.get_db_connection()
        try:
            hits = search_jurisprudence_cases(conn, "What did the Supreme Court rule in carino vs carino?", max_results=3)
        finally:
            conn.close()
        self.assertTrue(hits)
        self.assertEqual(hits[0]["case_uid"], "GR_132529FEBRUARY_2001")
        self.assertEqual(len(hits), 1)

    def test_domain_router_blocks_adversarial_science_ra386_spoof_while_allowing_real_civil_queries(self):
        spoof = main.classify_query_intent(
            "What are the exact statutory damages for quantum entanglement breach under RA 386?"
        )
        self.assertEqual(spoof["category"], "out_of_domain_non_legal")

        legit = main.classify_query_intent("What are the damages for breach of contract under RA 386?")
        self.assertEqual(legit["category"], "in_domain_civil")

    def test_retrieval_fixes_eliminate_expansion_hijacking_and_structural_overload(self):
        cases = [
            (
                "My spouse abandoned our family immediately after marriage and exhibits chronic psychological incapacity to perform essential marital obligations. Can the marriage be declared void?",
                ["EO209-ART36"],
            ),
            (
                "May utang ako sa kaibigan pero tinatakot niya akong ipapakulong at pinapahiya sa social media. Ano ang saklaw ng Civil Code tungkol sa utang at pananakot?",
                ["RA386-ART1953", "RA386-ART19", "RA386-ART21"],
            ),
            (
                "Namatay ang tatay ko at nakalimutan ako sa kanyang testamento bilang anak. Ano ang karapatan ko sa mana?",
                ["RA386-ART777", "RA386-ART854", "RA386-ART886"],
            ),
            (
                "My lender put a clause in our real estate mortgage contract stating that ownership of my house automatically transfers to the lender if I fail to pay on time. Is pactum commissorium valid?",
                ["RA386-ART2088"],
            ),
            (
                "A typhoon destroyed the specific warehouse and goods before delivery without any negligence on the seller's part. Is the obligor still liable under fortuitous event rules?",
                ["RA386-ART1174"],
            ),
            (
                "Pinaalis ako agad ng nagpapaupa nang walang abiso at ayaw ayusin ang sira sa paupahang bahay kahit nagbabayad ako ng upa. Ano ang karapatan ko sa batas?",
                ["RA386-ART1654", "RA386-ART1673"],
            ),
            (
                "The contractor failed to complete construction within the agreed period despite receiving full advance payment. Can I cancel the contract and demand my money back with damages?",
                ["RA386-ART1191", "RA386-ART1170"],
            ),
            (
                "A friend borrowed ₱150,000 via a promissory note due last month. He refuses to pay despite several verbal reminders. What are my remedies under the Civil Code?",
                ["RA386-ART1953", "RA386-ART1170", "RA386-ART2209"],
            ),
            (
                "A delivery truck hit my parked car while the driver was speeding. Can I claim damages from both the driver and the delivery company that employed him?",
                ["RA386-ART2176", "RA386-ART2180"],
            ),
            (
                "My siblings and I inherited an undivided parcel of land as co-owners, and I want to divide my share now. Can a co-owner demand partition of co-owned property?",
                ["RA386-ART484", "RA386-ART494"],
            ),
        ]
        for query, expected_ids in cases:
            with self.subTest(query=query[:50]):
                chunks = main.embed_and_search(query)
                active_ids = [
                    c.get("parent_id")
                    for c in chunks
                    if c.get("is_in_context") is not False
                ]
                for eid in expected_ids:
                    self.assertIn(eid, active_ids, f"Missing {eid} in active={active_ids} for query={query!r}")

    def test_true_structural_overview_query_still_returns_codal_structure(self):
        chunks = main.embed_and_search("Ano ang saklaw ng Civil Code at ilan ang kabuuang artikulo nito?")
        active_ids = [c.get("parent_id") for c in chunks if c.get("is_in_context") is not False]
        self.assertIn("RA386-STRUCTURE-AND-ARTICLES", active_ids)


if __name__ == "__main__":
    unittest.main()
