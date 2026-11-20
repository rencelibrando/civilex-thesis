"""Unit tests for the expanded CIVIL-LEX RAGAS evaluation suite metrics and integrity guards."""

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import eval_ragas


class TestEvalRagasMetrics(unittest.TestCase):
    def test_dataset_coverage_spans_guardrails_slices_and_bilingual_scenarios(self):
        self.assertGreaterEqual(len(eval_ragas.GUARDRAIL_TEST_CASES), 12)
        self.assertGreaterEqual(len(eval_ragas.IN_DOMAIN_BENCHMARK_CASES), 25)

        slices = {sc["slice"] for sc in eval_ragas.IN_DOMAIN_BENCHMARK_CASES}
        self.assertGreaterEqual(len(slices), 8)
        langs = {sc["language"] for sc in eval_ragas.IN_DOMAIN_BENCHMARK_CASES}
        self.assertEqual(langs, {"en", "tl"})

        # Ensure every scenario has unique ID and non-empty query, ground_truth, and expected targets.
        ids = [sc["id"] for sc in eval_ragas.IN_DOMAIN_BENCHMARK_CASES]
        self.assertEqual(len(ids), len(set(ids)))
        for sc in eval_ragas.IN_DOMAIN_BENCHMARK_CASES:
            targets = list(sc.get("expected_articles", [])) + list(sc.get("expected_cases", []))
            self.assertTrue(targets, f"Scenario {sc['id']} has no expected targets")
            self.assertTrue(sc["ground_truth"].strip(), f"Scenario {sc['id']} missing ground_truth")

    def test_active_only_recall_and_precision_ignore_out_of_rank_chunks(self):
        chunks = [
            {"parent_id": "RA386-ART1330", "is_in_context": True, "rank_status": "primary"},
            {"parent_id": "RA386-ART1390", "is_in_context": True, "rank_status": "primary"},
            {"parent_id": "RA386-ART1420", "is_in_context": True, "rank_status": "primary"},
            {"parent_id": "RA386-ART1409", "is_in_context": False, "rank_status": "out_of_rank"},
        ]
        targets = ["RA386-ART1409", "RA386-ART1390"]

        self.assertAlmostEqual(
            eval_ragas.calculate_context_recall(chunks, targets, active_only=True),
            0.5,
            places=4,
        )
        self.assertAlmostEqual(
            eval_ragas.calculate_context_recall(chunks, targets, active_only=False),
            1.0,
            places=4,
        )
        # Rank 2 hit in active list -> MAP = (1 / 2) / 1 = 0.5
        self.assertAlmostEqual(
            eval_ragas.calculate_context_precision(chunks, targets, active_only=True),
            0.5,
            places=4,
        )

    def test_match_article_id_blocks_substring_collisions_and_supports_cases(self):
        self.assertFalse(eval_ragas.match_article_id("RA386-ART116", "RA386-ART1169"))
        self.assertTrue(eval_ragas.match_article_id("RA386-ART1191", "RA386-ART1191"))
        self.assertTrue(eval_ragas.match_article_id("EO209-ART45", "EO209-ART45_c0"))
        self.assertTrue(eval_ragas.match_article_id("GR_L-14040JANUARY_1961", "GR_L-14040JANUARY_1961"))

    def test_llm_generate_response_returns_none_when_offline_and_fallback_disabled(self):
        with patch("eval_ragas.call_chat_completion_sync", return_value=None):
            out = eval_ragas.llm_generate_response(
                "Explain Article 1191",
                [{"parent_id": "RA386-ART1191", "parent_type": "article", "content": "Art 1191 text"}],
                allow_fallback=False,
            )
        self.assertIsNone(out)

    def test_bootstrap_ci_is_deterministic_and_bounded(self):
        lo, hi = eval_ragas.bootstrap_ci([1.0, 0.5, 1.0, 0.75, 1.0])
        self.assertLessEqual(0.0, lo)
        self.assertLessEqual(lo, hi)
        self.assertLessEqual(hi, 1.0)
        self.assertEqual((lo, hi), eval_ragas.bootstrap_ci([1.0, 0.5, 1.0, 0.75, 1.0]))


if __name__ == "__main__":
    unittest.main()
