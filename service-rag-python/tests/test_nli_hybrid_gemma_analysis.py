"""TDD tests for neuro-symbolic NLI contradiction fixes and Gemma score analysis."""

import asyncio
import json
import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main
from services.nli import (
    _has_polarity_inversion,
    _split_context_to_premises,
    score_faithfulness,
    score_faithfulness_async,
    verify_claim_symbolic,
)


class TestNliHybridAndGemmaAnalysis(unittest.TestCase):
    def test_split_context_to_premises_splits_sentences_ending_in_quotes(self):
        text = (
            'The lessor is entitled to rescind for "lack of payment of the price stipulated." '
            'The special stipulation "that failure shall automatically annul" is not incompatible '
            "with the lessor's above right to rescind."
        )
        premises = _split_context_to_premises(text)
        self.assertEqual(len(premises), 2)
        self.assertIn("lack of payment", premises[0])
        self.assertIn("not incompatible", premises[1])

    def test_litotes_not_incompatible_does_not_trigger_polarity_inversion(self):
        claim = (
            "Oo, may karapatan kang mag-rescission o pagpapawalang-bisa ng isang kontrata "
            "kung ang kabilang panig ay lumabag sa kanilang mga obligasyon."
        )
        premise = (
            'The special stipulation between the parties "that failure shall automatically annul" '
            "is not incompatible with the lessor's above right to rescind the lease."
        )
        self.assertFalse(_has_polarity_inversion(claim.lower(), premise.lower(), coverage=0.40))

    def test_source_aware_symbolic_nli_prevents_case_facts_overriding_art1174_exception(self):
        citations = [
            {
                "parent_type": "article",
                "parent_id": "RA386-ART1174",
                "content": (
                    "Except in cases expressly specified by the law, or when it is otherwise declared "
                    "by stipulation, or when the nature of the obligation requires the assumption of risk, "
                    "no person shall be responsible for those events which could not be foreseen, or which, "
                    "though foreseen, were inevitable."
                ),
            },
            {
                "parent_type": "case",
                "parent_id": "GR_L-21263APRIL_1965",
                "content": (
                    "[Supporting Case Doctrine for RA386-ART1174] Lawyers Cooperative vs. Tabora: "
                    "It is true that in the contract entered into between the parties the seller agreed "
                    "that ownership shall remain with it until full payment, but such stipulation cannot "
                    "make the seller liable in case of loss."
                ),
            },
        ]
        claim = (
            "Under Article 1174, if a contract contains an express stipulation making the seller liable "
            "for fortuitous events, the seller may still be liable despite the typhoon."
        )
        res = score_faithfulness(claim, citations, mode="symbolic")
        self.assertEqual(res.claims_contradicted, 0)
        self.assertEqual(res.claims_entailed, 1)

        # Even verify_claim_symbolic without source metadata must respect lower-overlap case-fact guard.
        v_plain = verify_claim_symbolic(
            claim,
            [citations[0]["content"], citations[1]["content"]],
            {"RA386-ART1174"},
        )
        self.assertNotEqual(v_plain.verdict, "contradicted")

    def test_hybrid_nli_adjudicates_tentative_r2_and_passes_reasoning_effort_none(self):
        premise = "He may also seek rescission, even after he has chosen fulfillment, if the latter should become impossible."
        claim = "However, the buyer cannot seek rescission even if fulfillment becomes impossible."
        citations = [{"parent_type": "article", "parent_id": "RA386-ART1191", "content": premise}]

        # Case 1: Gemma evaluates tentative R2 + provides score analysis, overturning false positive.
        gemma_override = json.dumps({
            "verdicts": [
                {
                    "id": 0,
                    "verdict": "entailed",
                    "reason": "The claim explains restoration impossibility under Article 1385.",
                }
            ],
            "analysis": "1 of 1 claims is supported by the cited Civil Code provisions with zero contradictions.",
        })
        with patch("services.llm_client.call_chat_completion_sync", return_value=gemma_override) as mock_llm:
            res_resolved = score_faithfulness(claim, citations, mode="hybrid")

        self.assertEqual(res_resolved.engine, "hybrid")
        self.assertEqual(res_resolved.claims_contradicted, 0)
        self.assertEqual(res_resolved.claims_entailed, 1)
        self.assertIn("1 of 1 claims", res_resolved.analysis)
        self.assertEqual(mock_llm.call_args.kwargs.get("reasoning_effort"), "none")
        self.assertFalse(mock_llm.call_args.kwargs.get("allow_reasoning_fallback"))

        # Case 2: Both symbolic R2 and Gemma agree it contradicts -> confirmed hybrid contradiction.
        gemma_confirm = json.dumps({
            "verdicts": [
                {
                    "id": 0,
                    "verdict": "contradicted",
                    "reason": "Article 1191 explicitly permits rescission even after fulfillment when fulfillment becomes impossible.",
                }
            ],
            "analysis": "Contradiction detected: the response denies rescission where Article 1191 permits it.",
        })
        with patch("services.llm_client.call_chat_completion_sync", return_value=gemma_confirm):
            res_confirmed = score_faithfulness(claim, citations, mode="hybrid")

        self.assertEqual(res_confirmed.engine, "hybrid")
        self.assertEqual(res_confirmed.claims_contradicted, 1)
        self.assertEqual(res_confirmed.verdicts[0].rule_fired, "R_hybrid_confirmed_contradiction")
        self.assertEqual(res_confirmed.verdicts[0].verifier, "hybrid")
        self.assertIn("Contradiction detected", res_confirmed.analysis)

    def test_hybrid_nli_runs_gemma_score_analysis_even_when_all_claims_pass_symbolic(self):
        premise = "Article 1191: The power to rescind obligations is implied in reciprocal ones, in case one of the obligors should not comply with what is incumbent upon him."
        answer = "Under Article 1191, the power to rescind obligations is implied in reciprocal ones when one obligor fails to comply."
        citations = [{"parent_type": "article", "parent_id": "RA386-ART1191", "content": premise}]

        review_json = json.dumps({
            "verdicts": [
                {"id": 0, "verdict": "entailed", "reason": "Matches Article 1191 verbatim."}
            ],
            "analysis": "The response accurately states the implied right of rescission under Article 1191 (100% grounded).",
        })
        with patch("services.llm_client.call_chat_completion_sync", return_value=review_json) as mock_llm:
            res = score_faithfulness(answer, citations, mode="hybrid")

        mock_llm.assert_called_once()
        self.assertEqual(res.engine, "hybrid")
        self.assertEqual(res.score_percent, 100.0)
        self.assertEqual(res.claims_contradicted, 0)
        self.assertIn("Article 1191", res.analysis)

        # Async path + offline fallback preservation
        with patch("services.llm_client.call_chat_completion_async", new=AsyncMock(return_value=None)):
            res_offline = asyncio.run(score_faithfulness_async(answer, citations, mode="hybrid"))
        self.assertEqual(res_offline.engine, "symbolic_fallback")
        self.assertEqual(res_offline.score_percent, 100.0)
        self.assertTrue(res_offline.analysis)

    def test_hybrid_nli_blocks_false_gemma_neural_contradiction_on_conditional_exception(self):
        premise = "Except when declared by stipulation, no person shall be responsible for fortuitous events."
        claim = "Under Article 1174, if a contract has a stipulation assuming fortuitous risk, the obligor is responsible despite a typhoon."
        citations = [{"parent_type": "article", "parent_id": "RA386-ART1174", "content": premise}]

        false_contradiction = json.dumps({
            "verdicts": [
                {"id": 0, "verdict": "contradicted", "reason": "Mentions typhoon not in text."}
            ],
            "analysis": "Summary note.",
        })
        with patch("services.llm_client.call_chat_completion_sync", return_value=false_contradiction):
            res = score_faithfulness(claim, citations, mode="hybrid")

        self.assertEqual(res.claims_contradicted, 0)

    def test_search_sse_emits_nli_analysis_and_verdict_breakdown_in_legal_analytics(self):
        retrieved = [
            {
                "chunk_id": "RA386-ART1191_0",
                "parent_type": "article",
                "parent_id": "RA386-ART1191",
                "content": "Article 1191 text.",
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 96.0,
                "display_suitability": 96.0,
                "rank": 1,
                "metadata": {"article_number": 1191},
            }
        ]

        async def _fake_stream(*args, **kwargs):
            yield "### Direct Answer\nUnder [Art. 1191], rescission is implied in reciprocal obligations."

        fake_verdict = MagicMock(
            claim="Under Art. 1191, rescission is implied in reciprocal obligations.",
            verdict="entailed",
            rule_fired="R4_lexical_containment_with_anchor",
            verifier="hybrid",
            rationale="Matches Article 1191.",
        )
        fake_nli = MagicMock(
            score_percent=100.0,
            score_net_percent=100.0,
            score_weighted=100.0,
            status="Grounded",
            claims_total=1,
            claims_entailed=1,
            claims_neutral=0,
            claims_contradicted=0,
            engine="hybrid",
            analysis="Gemma NLI confirms all 1 claim is directly entailed by Article 1191.",
            verdicts=[fake_verdict],
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
             patch("main.save_assistant_message_to_db"):
            client = TestClient(main.app)
            resp = client.post(
                "/search",
                json={"query": "Can I rescind a reciprocal contract for non-compliance under Art. 1191?"},
            )

        self.assertEqual(resp.status_code, 200)
        analytics_events = []
        for block in resp.text.split("\n\n"):
            for line in block.splitlines():
                if line.startswith("data: "):
                    evt = json.loads(line[6:])
                    if evt.get("type") == "legal_analytics":
                        analytics_events.append(evt["data"])

        final_analytics = analytics_events[-1]
        self.assertEqual(final_analytics["nli_engine"], "hybrid")
        self.assertIn("Gemma NLI confirms", final_analytics.get("nli_analysis", ""))
        self.assertEqual(len(final_analytics.get("nli_verdicts", [])), 1)
        self.assertEqual(final_analytics["nli_verdicts"][0]["verdict"], "entailed")


if __name__ == "__main__":
    unittest.main()
