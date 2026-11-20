import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from core.article_parser import parse_article_numbers
import main


class TestCitationAnswerAlignment(unittest.TestCase):
    def assertStrictlyDecreasingUnique(self, items):
        scores = [c["suitability_percent"] for c in items]
        self.assertEqual(len(scores), len(set(scores)), f"Duplicate scores: {scores}")
        for idx in range(len(scores) - 1):
            self.assertGreater(scores[idx], scores[idx + 1], f"Not strictly decreasing: {scores}")

    def test_parse_article_numbers_answer_mode_blocks_bare_numbers_and_external_statutes(self):
        # Answer without Article prefix must never extract bare numbers as Civil Code articles
        self.assertEqual(
            parse_article_numbers(
                "Please prepare 1 and 2 copies of the demand letter before filing.",
                allow_bare_numbers=False,
                strict_external_exclusion=False,
            ),
            [],
        )
        # Tagalog answer mentioning Revised Penal Code disclaimer still extracts Civil Code articles
        tl_answer = (
            "Ang pisikal na pananakit ay may aspetong kriminal sa ilalim ng Revised Penal Code, "
            "ngunit sa ilalim ng [Art. 2176] at Artikulo 33 maaari kang humingi ng danyos."
        )
        self.assertEqual(
            parse_article_numbers(
                tl_answer,
                allow_bare_numbers=False,
                strict_external_exclusion=False,
            ),
            ["2176", "33"],
        )
        # Article explicitly attributed to Revised Penal Code or Labor Code must not be extracted
        mixed_external = (
            "Civil liability ex delicto is mentioned in Article 100 of the Revised Penal Code "
            "and Art. 297 of the Labor Code, while independent civil action is under [Art. 33]."
        )
        self.assertEqual(
            parse_article_numbers(
                mixed_external,
                allow_bare_numbers=False,
                strict_external_exclusion=False,
            ),
            ["33"],
        )

    def test_rank_and_stratify_ignores_expansion_articles_as_exact(self):
        items = [
            {"parent_type": "article", "parent_id": "RA386-ART1191", "similarity": 0.87, "rrf_score": 0.032},
            {"parent_type": "article", "parent_id": "RA386-ART1458", "similarity": 0.76, "rrf_score": 0.012, "is_expansion_candidate": True},
            {"parent_type": "article", "parent_id": "RA386-ART1482", "similarity": 0.72, "rrf_score": 0.012, "is_expansion_candidate": True},
            {"parent_type": "article", "parent_id": "RA386-ART1170", "similarity": 0.85, "rrf_score": 0.028},
        ]
        expanded_q = (
            "Article 1191 rescission breach of contract "
            "(Philippine legal context: contract of sale Article 1458 earnest money Article 1482 rescission Article 1191)"
        )
        ranked = main.rank_and_stratify_citations(items, query=expanded_q, context_budget=5)
        self.assertEqual(ranked[0]["parent_id"], "RA386-ART1191")
        self.assertTrue(ranked[0]["is_exact"])
        art1458 = next(c for c in ranked if c["parent_id"] == "RA386-ART1458")
        art1482 = next(c for c in ranked if c["parent_id"] == "RA386-ART1482")
        self.assertFalse(art1458.get("is_exact", False))
        self.assertFalse(art1482.get("is_exact", False))
        # High-similarity Article 1170 must outrank low-similarity expansion articles
        self.assertEqual(ranked[1]["parent_id"], "RA386-ART1170")

    def test_rank_and_stratify_default_precision_budget_and_gap_pruning(self):
        items = [
            {"parent_type": "article", "parent_id": f"RA386-ART{1156 + i}", "similarity": round(0.88 - i * 0.01, 3), "rrf_score": round(0.032 - i * 0.002, 4)}
            for i in range(6)
        ] + [
            # Weak tangential article with large similarity drop
            {"parent_type": "article", "parent_id": "RA386-ART900", "similarity": 0.65, "rrf_score": 0.010},
            {"parent_type": "case", "parent_id": "GR_173441", "similarity": 0.86, "rrf_score": 0.05, "is_linked_jurisprudence": True, "metadata": {"gr_number": "G.R. No. 173441", "title": "Quirong v. DBP"}},
            {"parent_type": "case", "parent_id": "GR_200001", "similarity": 0.80, "rrf_score": 0.04, "is_linked_jurisprudence": True, "metadata": {"gr_number": "G.R. No. 200001", "title": "Santos v. Cruz"}},
        ]
        # Default context_budget should be focused (<= 5), retaining top statutes + linked case
        ranked = main.rank_and_stratify_citations(items, query="breach of reciprocal contract obligations")
        active = [c for c in ranked if c.get("is_in_context") is True]
        self.assertLessEqual(len(active), 5)
        active_articles = [c for c in active if c["parent_type"] == "article"]
        active_cases = [c for c in active if c["parent_type"] == "case"]
        self.assertTrue(1 <= len(active_articles) <= 4)
        self.assertGreaterEqual(len(active_cases), 1)
        art900 = next(c for c in ranked if c["parent_id"] == "RA386-ART900")
        self.assertFalse(art900["is_in_context"])

    def test_reconcile_bidirectional_prunes_uncited_articles_and_adds_missing(self):
        existing = [
            {"parent_type": "article", "parent_id": "RA386-ART1156", "is_in_context": True, "rank_status": "primary", "suitability_percent": 98.5, "metadata": {"article_number": 1156}},
            {"parent_type": "article", "parent_id": "RA386-ART1157", "is_in_context": True, "rank_status": "primary", "suitability_percent": 95.0, "metadata": {"article_number": 1157}},
            {"parent_type": "article", "parent_id": "RA386-ART1191", "is_in_context": True, "rank_status": "primary", "suitability_percent": 92.0, "metadata": {"article_number": 1191}},
            {"parent_type": "article", "parent_id": "RA386-ART1170", "is_in_context": True, "rank_status": "primary", "suitability_percent": 89.0, "metadata": {"article_number": 1170}},
        ]
        fetched_missing = [
            {"parent_type": "article", "parent_id": "RA386-ART1385", "is_in_context": True, "rank_status": "primary", "suitability_percent": 98.5, "metadata": {"article_number": 1385}},
        ]
        answer = (
            "### Direct Answer\n"
            "Under Article 1156 and [Art. 1191], non-compliance allows rescission, "
            "and Article 1385 requires mutual restitution."
        )
        with patch("main.fetch_article_citations", return_value=fetched_missing) as mock_fetch:
            reconciled = main.reconcile_response_citations(answer, existing)

        self.assertEqual(
            [c["parent_id"] for c in reconciled],
            ["RA386-ART1156", "RA386-ART1191", "RA386-ART1385"],
        )
        self.assertStrictlyDecreasingUnique(reconciled)
        mock_fetch.assert_called_once()
        # Only missing article 1385 should be fetched
        self.assertEqual(mock_fetch.call_args[0][0], [1385])

    def test_reconcile_family_code_vs_civil_code_disambiguation(self):
        existing = [
            {
                "parent_type": "article",
                "parent_id": "EO209-ART36",
                "is_exact": True,
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 98.5,
                "metadata": {"article_number": 36, "hierarchy": {"book_name": "THE FAMILY CODE OF THE PHILIPPINES (EXECUTIVE ORDER NO. 209)"}},
            },
            {
                "parent_type": "article",
                "parent_id": "RA386-ART36",
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 86.0,
                "metadata": {"article_number": 36, "hierarchy": {"book_name": "BOOK I - PERSONS"}},
            },
        ]
        answer = (
            "Under Article 36 of the Family Code (Executive Order No. 209), a marriage contracted "
            "by a party with psychological incapacity is void ab initio."
        )
        with patch("main.fetch_article_citations", return_value=[]) as mock_fetch:
            reconciled = main.reconcile_response_citations(
                answer,
                existing,
                query="What is Article 36 of the Family Code?",
            )
        self.assertEqual([c["parent_id"] for c in reconciled], ["EO209-ART36"])
        mock_fetch.assert_not_called()

    def test_reconcile_case_matching_by_gr_and_distinctive_title_prunes_uncited(self):
        existing = [
            {
                "parent_type": "article",
                "parent_id": "RA386-ART1191",
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 98.5,
                "metadata": {"article_number": 1191},
            },
            {
                "parent_type": "case",
                "parent_id": "GR_173441_2009",
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 94.0,
                "metadata": {"gr_number": "G.R. No. 173441", "title": "Heirs of Sofia Quirong vs. Development Bank of the Philippines"},
            },
            {
                "parent_type": "case",
                "parent_id": "GR_196359_2021",
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 91.0,
                "metadata": {"gr_number": "G.R. No. 196359", "title": "Rosanna L. Tan-Andal vs. Mario Victor M. Andal"},
            },
            {
                "parent_type": "case",
                "parent_id": "GR_1734_1950",
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 88.0,
                "metadata": {"gr_number": "G.R. No. 1734", "title": "Pedro Mendoza vs. Juan Bautista"},
            },
            {
                "parent_type": "case",
                "parent_id": "GR_999999_2020",
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 85.0,
                "metadata": {"gr_number": "G.R. No. 999999", "title": "Uncited Party vs. Republic of the Philippines"},
            },
        ]
        answer = (
            "Under [Art. 1191], the Supreme Court ruled in G.R. No. 173441 that rescission applies "
            "to reciprocal obligations. Similarly, in Tan-Andal v. Andal, the Court clarified evidentiary standards."
        )
        reconciled = main.reconcile_response_citations(answer, existing)
        # GR_1734 must NOT falsely match G.R. No. 173441; GR_999999 must be pruned
        self.assertEqual(
            [c["parent_id"] for c in reconciled],
            ["RA386-ART1191", "GR_173441_2009", "GR_196359_2021"],
        )
        self.assertStrictlyDecreasingUnique(reconciled)

    def test_reconcile_retains_active_user_document_excerpts_and_prunes_uncited_articles(self):
        doc_id = "22222222-2222-4222-8222-222222222222"
        existing = [
            {"chunk_id": f"{doc_id}_c0", "parent_type": "user_document", "parent_id": doc_id, "is_in_context": True, "rank_status": "primary", "suitability_percent": 94.0},
            {"chunk_id": f"{doc_id}_c9", "parent_type": "user_document", "parent_id": doc_id, "is_in_context": False, "rank_status": "out_of_rank", "suitability_percent": 62.0},
            {"parent_type": "article", "parent_id": "RA386-ART1654", "is_in_context": True, "rank_status": "primary", "suitability_percent": 91.0, "metadata": {"article_number": 1654}},
            {"parent_type": "article", "parent_id": "RA386-ART1687", "is_in_context": True, "rank_status": "primary", "suitability_percent": 87.0, "metadata": {"article_number": 1687}},
        ]
        answer = "The Lease Contract obligates the lessor to keep the premises habitable under [Art. 1654]."
        reconciled = main.reconcile_response_citations(answer, existing, document_id=doc_id)
        self.assertEqual(
            [c.get("chunk_id") or c.get("parent_id") for c in reconciled],
            ["RA386-ART1654", f"{doc_id}_c0"],
        )

    def test_reconcile_safety_fallback_and_oor_promotion(self):
        existing = [
            {"parent_type": "article", "parent_id": "RA386-ART1191", "is_in_context": True, "rank_status": "primary", "suitability_percent": 98.5, "metadata": {"article_number": 1191}},
            {"parent_type": "article", "parent_id": "RA386-ART1170", "is_in_context": True, "rank_status": "primary", "suitability_percent": 92.0, "metadata": {"article_number": 1170}},
            {"parent_type": "article", "parent_id": "RA386-ART1385", "is_in_context": False, "rank_status": "out_of_rank", "suitability_percent": 65.0, "metadata": {"article_number": 1385}},
        ]
        # Zero explicit articles mentioned in in-domain answer -> keep only #1 primary authority
        fallback = main.reconcile_response_citations("General legal explanation without article numbers.", existing)
        self.assertEqual([c["parent_id"] for c in fallback], ["RA386-ART1191"])

        # Out-of-domain empty existing + zero mentions -> []
        self.assertEqual(main.reconcile_response_citations("This is outside Civil Code scope.", []), [])

        # Out-of-rank candidate explicitly cited in answer -> promoted without DB refetch AND recalibrated above OOR cap
        existing_with_sim = [
            {"parent_type": "article", "parent_id": "RA386-ART1191", "is_in_context": True, "rank_status": "primary", "similarity": 0.90, "suitability_percent": 98.5, "metadata": {"article_number": 1191}},
            {"parent_type": "article", "parent_id": "RA386-ART1170", "is_in_context": True, "rank_status": "primary", "similarity": 0.86, "suitability_percent": 92.0, "metadata": {"article_number": 1170}},
            {"parent_type": "article", "parent_id": "RA386-ART1385", "is_in_context": False, "rank_status": "out_of_rank", "similarity": 0.84, "rrf_score": 0.02, "suitability_percent": 65.0, "metadata": {"article_number": 1385}},
        ]
        with patch("main.fetch_article_citations") as mock_fetch:
            promoted = main.reconcile_response_citations(
                "Rescission under Article 1191 triggers mutual restitution under Article 1385.",
                existing_with_sim,
            )
        mock_fetch.assert_not_called()
        self.assertEqual([c["parent_id"] for c in promoted], ["RA386-ART1191", "RA386-ART1385"])
        self.assertTrue(all(c["is_in_context"] is True and c["rank_status"] == "primary" for c in promoted))
        self.assertGreater(promoted[1]["suitability_percent"], 72.0)
        self.assertStrictlyDecreasingUnique(promoted)

    def test_search_sse_prunes_uncited_articles_and_syncs_accumulated(self):
        retrieved = [
            {"chunk_id": "RA386-ART2176_0", "parent_type": "article", "parent_id": "RA386-ART2176", "content": "Article 2176.", "is_in_context": True, "rank_status": "primary", "suitability_percent": 95.0, "display_suitability": 95.0, "rank": 1, "metadata": {"article_number": 2176}},
            {"chunk_id": "RA386-ART2180_0", "parent_type": "article", "parent_id": "RA386-ART2180", "content": "Article 2180.", "is_in_context": True, "rank_status": "primary", "suitability_percent": 92.0, "display_suitability": 92.0, "rank": 2, "metadata": {"article_number": 2180}},
            {"chunk_id": "RA386-ART2199_0", "parent_type": "article", "parent_id": "RA386-ART2199", "content": "Article 2199.", "is_in_context": True, "rank_status": "primary", "suitability_percent": 89.0, "display_suitability": 89.0, "rank": 3, "metadata": {"article_number": 2199}},
            {"chunk_id": "RA386-ART2206_0", "parent_type": "article", "parent_id": "RA386-ART2206", "content": "Article 2206.", "is_in_context": True, "rank_status": "primary", "suitability_percent": 86.0, "display_suitability": 86.0, "rank": 4, "metadata": {"article_number": 2206}},
            {"chunk_id": "GR_123456_0", "parent_type": "case", "parent_id": "GR_123456", "content": "Case doctrine", "is_in_context": True, "rank_status": "primary", "suitability_percent": 84.0, "display_suitability": 84.0, "rank": 5, "metadata": {"gr_number": "G.R. No. 123456", "title": "Reyes vs. Transport Corp."}},
        ]

        async def _fake_stream(*args, **kwargs):
            yield "### Direct Answer\nUnder [Art. 2176] and [Art. 2180], both the negligent driver and employer are liable."

        fake_nli = MagicMock(
            score_percent=94.0,
            score_net_percent=94.0,
            score_weighted=94.0,
            status="Grounded",
            claims_total=2,
            claims_entailed=2,
            claims_neutral=0,
            claims_contradicted=0,
            engine="symbolic",
        )

        with patch("main.session_memory.load_session_history", return_value=[]), \
             patch("main.session_memory.load_session_summary", return_value=None), \
             patch("main.session_memory.load_recent_citations", return_value=[]), \
             patch("main.session_memory.save_user_message"), \
             patch("main.check_model_readiness", new=AsyncMock(return_value=(True, "ready"))), \
             patch("main.detect_ambiguity", new=AsyncMock(return_value=MagicMock(is_ambiguous=False, confidence=0.1))), \
             patch("main.compute_embedding", return_value=[0.1] * 768), \
             patch("main.search_with_embedding", return_value=retrieved), \
             patch("main.generate_response_stream", side_effect=_fake_stream), \
             patch("main.nli_score_faithfulness_async", new=AsyncMock(return_value=fake_nli)), \
             patch("main.followup_svc.generate_followups", new=AsyncMock(return_value=[])), \
             patch("main.save_assistant_message_to_db") as mock_save:
            client = TestClient(main.app)
            resp = client.post(
                "/search",
                json={"query": "A delivery truck hit my parked car while speeding. Can I sue the driver and company?"},
            )

        self.assertEqual(resp.status_code, 200)
        events = []
        for block in resp.text.split("\n\n"):
            for line in block.splitlines():
                if line.startswith("data: "):
                    events.append(json.loads(line[6:]))

        latest = [e["data"] for e in events if e.get("type") == "citations"][-1]
        accumulated = [e["data"] for e in events if e.get("type") == "accumulated_citations"][-1]
        self.assertEqual([c["parent_id"] for c in latest], ["RA386-ART2176", "RA386-ART2180"])
        self.assertEqual([c["parent_id"] for c in accumulated], ["RA386-ART2176", "RA386-ART2180"])
        self.assertStrictlyDecreasingUnique(latest)
        # Saved DB citations must match the pruned reconciled list
        saved_cits = mock_save.call_args[0][2]
        self.assertEqual([c["parent_id"] for c in saved_cits], ["RA386-ART2176", "RA386-ART2180"])


if __name__ == "__main__":
    unittest.main()
