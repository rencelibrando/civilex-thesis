import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

import main


class TestCitationCalibrationAndRanking(unittest.TestCase):
    def assertStrictlyDecreasingUnique(self, items):
        scores = [c["suitability_percent"] for c in items]
        self.assertEqual(len(scores), len(set(scores)), f"Duplicate scores found: {scores}")
        for idx in range(len(scores) - 1):
            self.assertGreater(
                scores[idx],
                scores[idx + 1],
                f"Scores not strictly decreasing at index {idx}: {scores}",
            )
        for item in items:
            self.assertEqual(item["suitability_percent"], item["display_suitability"])
            self.assertGreaterEqual(item["suitability_percent"], 1.0)

    def test_calibrate_suitability_exact_differentiation_and_compat(self):
        self.assertEqual(
            main.calibrate_suitability_score(0.85, is_exact=True, is_active=True),
            98.5,
        )
        exact_scores = [
            main.calibrate_suitability_score(0.85, is_exact=True, is_active=True, exact_rank=i)
            for i in range(4)
        ]
        self.assertEqual(len(exact_scores), len(set(exact_scores)))
        for idx in range(len(exact_scores) - 1):
            self.assertGreater(exact_scores[idx], exact_scores[idx + 1])

        inactive_exact = main.calibrate_suitability_score(0.85, is_exact=True, is_active=False, exact_rank=0)
        self.assertLessEqual(inactive_exact, 68.5)

        high_sim = main.calibrate_suitability_score(0.85, is_exact=False, is_active=True)
        mid_sim = main.calibrate_suitability_score(0.72, is_exact=False, is_active=True)
        self.assertTrue(85.0 <= high_sim <= 97.0)
        self.assertTrue(70.0 <= mid_sim < high_sim)

    def test_multi_article_comparison_unique_descending_scores(self):
        mock_items = [
            {
                "parent_type": "article",
                "parent_id": "RA386-ART1156",
                "content": "Article 1156. An obligation is a juridical necessity...",
                "is_exact": True,
                "exact_order": 0,
                "similarity": 0.90,
                "rrf_score": 0.032,
                "metadata": {"article_id": "RA386-ART1156", "article_number": 1156},
            },
            {
                "parent_type": "article",
                "parent_id": "RA386-ART1157",
                "content": "Article 1157. Obligations arise from law, contracts...",
                "is_exact": True,
                "exact_order": 1,
                "similarity": 0.89,
                "rrf_score": 0.031,
                "metadata": {"article_id": "RA386-ART1157", "article_number": 1157},
            },
            {
                "parent_type": "article",
                "parent_id": "RA386-ART1191",
                "content": "Article 1191. The power to rescind obligations is implied...",
                "is_exact": True,
                "exact_order": 2,
                "similarity": 0.88,
                "rrf_score": 0.030,
                "metadata": {"article_id": "RA386-ART1191", "article_number": 1191},
            },
            {
                "parent_type": "article",
                "parent_id": "RA386-ART1170",
                "content": "Article 1170. Those who in the performance of their obligations...",
                "similarity": 0.82,
                "rrf_score": 0.020,
                "metadata": {"article_id": "RA386-ART1170", "article_number": 1170},
            },
        ]
        ranked = main.rank_and_stratify_citations(
            mock_items,
            query="Compare Article 1156, Article 1157, and Article 1191",
            context_budget=3,
        )
        self.assertEqual(len(ranked), 4)
        self.assertStrictlyDecreasingUnique(ranked)
        self.assertEqual(ranked[0]["parent_id"], "RA386-ART1156")
        self.assertEqual(ranked[0]["suitability_percent"], 98.5)
        self.assertLess(ranked[1]["suitability_percent"], 98.5)
        self.assertLess(ranked[2]["suitability_percent"], ranked[1]["suitability_percent"])
        self.assertFalse(ranked[3]["is_in_context"])
        self.assertLessEqual(ranked[3]["suitability_percent"], 68.5)

    def test_flat_plateau_and_rrf_inversion_produce_unique_scores(self):
        # Mirrors historical plateau where lower-ranked items had higher raw similarity than rank 1
        mock_items = [
            {"parent_type": "article", "parent_id": "RA386-ART1636", "similarity": 0.82, "rrf_score": 0.045},
            {"parent_type": "article", "parent_id": "RA386-ART1403", "similarity": 0.88, "rrf_score": 0.030},
            {"parent_type": "article", "parent_id": "RA386-ART1360", "similarity": 0.87, "rrf_score": 0.028},
            {"parent_type": "article", "parent_id": "EO209-ART83", "similarity": 0.86, "rrf_score": 0.025},
            {"parent_type": "article", "parent_id": "RA386-ART1814", "similarity": 0.85, "rrf_score": 0.022},
            {"parent_type": "article", "parent_id": "RA386-ART1830", "similarity": 0.84, "rrf_score": 0.020},
            {"parent_type": "article", "parent_id": "RA386-ART1865", "similarity": 0.83, "rrf_score": 0.018},
        ]
        ranked = main.rank_and_stratify_citations(
            mock_items,
            query="invalid oral sales agreement",
            context_budget=10,
        )
        self.assertStrictlyDecreasingUnique(ranked)
        self.assertTrue(all(c["is_in_context"] for c in ranked))

    def test_family_code_exact_match_and_civil_code_disambiguation(self):
        mock_items = [
            {"parent_type": "article", "parent_id": "EO209-ART36", "similarity": 0.86, "rrf_score": 0.02},
            {"parent_type": "article", "parent_id": "RA386-ART36", "similarity": 0.84, "rrf_score": 0.02},
        ]
        ranked = main.rank_and_stratify_citations(
            mock_items,
            query="What is Article 36 of the Family Code?",
            context_budget=5,
        )
        self.assertEqual(ranked[0]["parent_id"], "EO209-ART36")
        self.assertTrue(ranked[0]["is_exact"])
        self.assertFalse(ranked[1].get("is_exact", False))
        self.assertStrictlyDecreasingUnique(ranked)

    def test_jurisprudence_active_cases_not_depressed_by_oor_statutes(self):
        mock_items = [
            {"parent_type": "article", "parent_id": "RA386-ART1191", "is_exact": True, "similarity": 0.90, "rrf_score": 0.03},
            {"parent_type": "article", "parent_id": "RA386-ART1170", "similarity": 0.85, "rrf_score": 0.025},
            {"parent_type": "case", "parent_id": "GR_1001", "similarity": 0.82, "rrf_score": 0.020, "metadata": {"gr_number": "G.R. No. 1001"}},
            {"parent_type": "case", "parent_id": "GR_1002", "similarity": 0.80, "rrf_score": 0.018, "metadata": {"gr_number": "G.R. No. 1002"}},
        ]
        ranked = main.rank_and_stratify_citations(
            mock_items,
            query="Supreme Court jurisprudence on Article 1191 rescission",
            context_budget=6,
        )
        self.assertStrictlyDecreasingUnique(ranked)
        active = [c for c in ranked if c["is_in_context"]]
        oor = [c for c in ranked if not c["is_in_context"]]
        self.assertTrue(len(active) >= 2 and len(oor) >= 1)
        # All active items appear before out-of-rank items and stay above out-of-rank cap
        self.assertEqual(ranked[: len(active)], active)
        self.assertTrue(all(c["suitability_percent"] > 68.5 for c in active))
        self.assertTrue(all(c["suitability_percent"] <= 68.5 for c in oor))

    def test_reconcile_response_citations_keeps_unique_descending_and_order(self):
        existing = [
            {
                "parent_type": "article",
                "parent_id": "RA386-ART1191",
                "is_exact": True,
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 98.5,
                "display_suitability": 98.5,
                "rank": 1,
                "metadata": {"article_number": 1191},
            },
            {
                "parent_type": "case",
                "parent_id": "GR_9999",
                "is_in_context": False,
                "rank_status": "out_of_rank",
                "suitability_percent": 65.0,
                "display_suitability": 65.0,
                "rank": 2,
                "metadata": {"gr_number": "G.R. No. 9999"},
            },
        ]
        fetched = [
            {
                "parent_type": "article",
                "parent_id": "RA386-ART1385",
                "is_exact": True,
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 98.5,
                "display_suitability": 98.5,
                "metadata": {"article_number": 1385},
            },
            {
                "parent_type": "article",
                "parent_id": "RA386-ART1170",
                "is_exact": True,
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 98.0,
                "display_suitability": 98.0,
                "metadata": {"article_number": 1170},
            },
        ]
        with patch("main.fetch_article_citations", return_value=fetched):
            reconciled = main.reconcile_response_citations(
                "Under Article 1191, Article 1385, and Article 1170, rescission carries mutual restitution.",
                existing,
            )
        self.assertEqual(
            [c["parent_id"] for c in reconciled],
            ["RA386-ART1191", "RA386-ART1385", "RA386-ART1170"],
        )
        self.assertStrictlyDecreasingUnique(reconciled)
        self.assertEqual(reconciled[0]["suitability_percent"], 98.5)
        self.assertLess(reconciled[1]["suitability_percent"], 98.5)
        self.assertLess(reconciled[2]["suitability_percent"], reconciled[1]["suitability_percent"])

    def test_enforce_unique_does_not_mutate_input_and_handles_long_lists(self):
        original = [
            {"parent_id": f"RA386-ART{100 + i}", "suitability_percent": 98.5, "is_in_context": i < 15}
            for i in range(30)
        ]
        deduped = main.enforce_unique_decreasing_suitability(original)
        self.assertEqual(original[1]["suitability_percent"], 98.5)
        self.assertStrictlyDecreasingUnique(deduped)
        self.assertEqual([c["rank"] for c in deduped], list(range(1, 31)))

    def test_search_sse_hides_out_of_rank_in_citations_and_accumulated_multi_turn(self):
        prior_cits = [
            {
                "chunk_id": "RA386-ART1156_0",
                "parent_type": "article",
                "parent_id": "RA386-ART1156",
                "content": "Article 1156. An obligation is a juridical necessity...",
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 98.5,
                "display_suitability": 98.5,
                "metadata": {"article_number": 1156},
            },
            {
                "chunk_id": "RA386-ART999_0",
                "parent_type": "article",
                "parent_id": "RA386-ART999",
                "content": "Article 999 legacy out of rank",
                "is_in_context": False,
                "rank_status": "out_of_rank",
                "suitability_percent": 61.0,
                "display_suitability": 61.0,
                "metadata": {"article_number": 999},
            },
        ]
        turn2_results = [
            {
                "chunk_id": "RA386-ART1191_0",
                "parent_type": "article",
                "parent_id": "RA386-ART1191",
                "content": "Article 1191. The power to rescind obligations is implied...",
                "is_exact": True,
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 98.5,
                "display_suitability": 98.5,
                "rank": 1,
                "metadata": {"article_number": 1191},
            },
            {
                "chunk_id": "RA386-ART1170_0",
                "parent_type": "article",
                "parent_id": "RA386-ART1170",
                "content": "Article 1170 out of rank candidate",
                "is_in_context": False,
                "rank_status": "out_of_rank",
                "suitability_percent": 65.0,
                "display_suitability": 65.0,
                "rank": 2,
                "metadata": {"article_number": 1170},
            },
        ]

        async def _fake_stream(*args, **kwargs):
            yield "### Direct Answer\nUnder [Art. 1191], the injured party may rescind a reciprocal obligation."

        fake_nli = MagicMock(
            score_percent=95.0,
            score_net_percent=95.0,
            score_weighted=95.0,
            status="Grounded",
            claims_total=1,
            claims_entailed=1,
            claims_neutral=0,
            claims_contradicted=0,
            engine="symbolic",
        )

        with patch("main.session_memory.load_session_history", return_value=[
                 {"role": "user", "content": "What is Article 1156?"},
                 {"role": "assistant", "content": "Under Article 1156, an obligation is a juridical necessity."},
             ]), \
             patch("main.session_memory.load_session_summary", return_value=None), \
             patch("main.session_memory.load_recent_citations", return_value=prior_cits), \
             patch("main.session_memory.save_user_message"), \
             patch("main.check_model_readiness", new=AsyncMock(return_value=(True, "ready"))), \
             patch("main.detect_ambiguity", new=AsyncMock(return_value=MagicMock(is_ambiguous=False, confidence=0.1))), \
             patch("main.compute_embedding", return_value=[0.1] * 768), \
             patch("main.search_with_embedding", return_value=turn2_results), \
             patch("main.generate_response_stream", side_effect=_fake_stream), \
             patch("main.nli_score_faithfulness_async", new=AsyncMock(return_value=fake_nli)), \
             patch("main.followup_svc.generate_followups", new=AsyncMock(return_value=[])), \
             patch("main.save_assistant_message_to_db"):
            client = TestClient(main.app)
            resp = client.post(
                "/search",
                json={
                    "query": "My contractor breached our reciprocal agreement under Article 1191",
                    "session_id": "11111111-1111-4111-8111-111111111111",
                    "prior_citations": prior_cits,
                },
            )

        self.assertEqual(resp.status_code, 200)
        events = []
        for block in resp.text.split("\n\n"):
            for line in block.splitlines():
                if line.startswith("data: "):
                    events.append(json.loads(line[6:]))

        cit_events = [e["data"] for e in events if e.get("type") == "citations"]
        acc_events = [e["data"] for e in events if e.get("type") == "accumulated_citations"]
        self.assertTrue(cit_events)
        self.assertTrue(acc_events)

        latest = cit_events[-1]
        accumulated = acc_events[-1]

        # Zero out_of_rank citations in either Latest or All Sources streams
        for c in latest + accumulated:
            self.assertNotEqual(c.get("is_in_context"), False, f"Out-of-rank leaked: {c}")
            self.assertNotEqual(c.get("rank_status"), "out_of_rank", f"Out-of-rank status leaked: {c}")

        self.assertEqual([c["parent_id"] for c in latest], ["RA386-ART1191"])
        # Active prior turn authority (Art. 1156) stays retained in All Sources without being stamped out_of_rank
        self.assertEqual([c["parent_id"] for c in accumulated], ["RA386-ART1191", "RA386-ART1156"])
        self.assertStrictlyDecreasingUnique(accumulated)


if __name__ == "__main__":
    unittest.main()
