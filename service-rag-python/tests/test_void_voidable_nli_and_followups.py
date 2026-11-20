"""Regression tests for void vs. voidable contract retrieval, NLI double negation, and reasoning leakage."""

import asyncio
import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main
from services import followups as followup_svc
from services.llm_client import call_chat_completion_async
from services.nli import (
    _has_polarity_inversion,
    decompose_claims,
    score_faithfulness,
    verify_claim_symbolic,
)


class TestVoidVoidableNliAndFollowups(unittest.TestCase):
    QUERY = "Explain the distinction between void and voidable contracts under civil law."

    ART_1330 = (
        "Art. 1330 (BOOK IV - OBLIGATIONS AND CONTRACTS, TITLE II.—CONTRACTS, "
        "CH 2 - ESSENTIAL REQUISITES OF CONTRACTS, SEC 1.—Consent): "
        "A contract where consent is given through mistake, violence, intimidation, "
        "undue influence, or fraud is voidable."
    )
    ART_1390 = (
        "The following contracts are voidable or annullable, even though there may have been "
        "no damage to the contracting parties: (1) Those where one of the parties is incapable "
        "of giving consent to a contract; (2) Those where the consent is vitiated by mistake, "
        "violence, intimidation, undue influence or fraud. These contracts are binding, unless "
        "they are annulled by a proper action in court. They are susceptible of ratification."
    )
    ART_1409 = (
        "The following contracts are inexistent and void from the beginning: "
        "(1) Those whose cause, object or purpose is contrary to law, morals, good customs, "
        "public order or public policy; (2) Those which are absolutely simulated or fictitious; "
        "(3) Those whose cause or object did not exist at the time of the transaction. "
        "These contracts cannot be ratified."
    )

    def test_nli_double_negation_does_not_flag_false_contradiction(self):
        premise = "These contracts are binding, unless they are annulled by a proper action in court."
        non_contradicting_claims = [
            "It means the contract can be canceled by a proper court action, but it doesn't mean it is automatically invalid forever!",
            "It means the contract can be canceled by a proper court action, but it doesn’t mean it is automatically invalid forever!",
            "A voidable contract does not automatically become void or invalid without court action.",
            "A voidable contract is neither void nor invalid until annulled by a court.",
            "Such a contract is not invalid on its face and remains binding until annulled.",
        ]
        for claim in non_contradicting_claims:
            with self.subTest(claim=claim):
                self.assertFalse(
                    _has_polarity_inversion(claim.lower(), premise.lower(), coverage=0.45),
                    f"False polarity inversion on double-negated claim: {claim}",
                )
                verdict = verify_claim_symbolic(claim, [premise], {"RA386-ART1390"})
                self.assertNotEqual(verdict.verdict, "contradicted")

    def test_nli_disjoint_contract_defect_categories_prevent_cross_category_false_contradiction(self):
        art1390_binding = "These contracts are binding, unless they are annulled by a proper action in court."

        # Void contract rule must not falsely contradict Art. 1390's voidable-contract binding rule.
        self.assertFalse(
            _has_polarity_inversion(
                "a void contract is invalid and not binding.",
                art1390_binding.lower(),
                coverage=0.45,
            )
        )
        # Voidable contract rule must not falsely contradict Art. 1409's void-contract rule.
        self.assertFalse(
            _has_polarity_inversion(
                "a voidable contract is valid from the beginning until annulled.",
                self.ART_1409.lower(),
                coverage=0.45,
            )
        )

        # Genuine same-category and generic contradictions must still be caught.
        self.assertTrue(
            _has_polarity_inversion(
                "a void contract is valid and binding from the beginning.",
                self.ART_1409.lower(),
                coverage=0.50,
            )
        )
        self.assertTrue(
            _has_polarity_inversion(
                "a voidable contract is automatically invalid and void even before annulment.",
                art1390_binding.lower(),
                coverage=0.45,
            )
        )
        self.assertTrue(
            _has_polarity_inversion(
                "a contract entered into without consent is valid and binding.",
                "a contract entered into without consent is void and produces no effect.",
                coverage=0.65,
            )
        )
        self.assertTrue(
            _has_polarity_inversion(
                "the injured party cannot rescind the obligation upon breach.",
                "the injured party may choose between fulfillment and the rescission of the obligation.",
                coverage=0.65,
            )
        )

    def test_nli_full_pasted_void_voidable_answer_has_zero_false_contradictions(self):
        answer = (
            "### Direct Answer & Legal Conclusion\n"
            "Simply put, a void contract never legally existed from the start. "
            "A voidable contract looks real, but one of the people involved had a problem—like being tricked or forced—"
            "so they have the right to ask a judge to cancel it later on.\n\n"
            "### Governing Statutory Basis\n"
            f'"{self.ART_1330}"\n\n'
            f'"{self.ART_1390}"\n\n'
            "### Legal Analysis & Application\n"
            "The law is very clear about this: if your agreement falls under certain conditions—"
            "like you were tricked, or someone wasn't legally capable of signing it—it becomes voidable [Art. 1390]. "
            "It means the contract can be canceled by a proper court action, but it doesn't mean it is automatically invalid forever!\n\n"
            "Free Legal Help: If you cannot afford a private lawyer, please seek assistance from the Public Attorney's Office (PAO)."
        )
        citations = [
            {"parent_id": "RA386-ART1330", "content": self.ART_1330},
            {"parent_id": "RA386-ART1390", "content": self.ART_1390},
        ]
        result = score_faithfulness(answer, citations, mode="symbolic")
        self.assertEqual(result.claims_contradicted, 0)

        decomposed = decompose_claims(answer)
        self.assertFalse(any("Public Attorney's Office" in c for c in decomposed))

    def test_void_vs_voidable_query_expansion_and_live_retrieval_include_art1409_and_art1390(self):
        expanded_en = main.expand_legal_query(self.QUERY)
        self.assertIn("Article 1409", expanded_en)
        self.assertIn("Article 1390", expanded_en)
        self.assertIn("Article 1330", expanded_en)

        expanded_tl = main.expand_legal_query("Ano ang pagkakaiba ng void at voidable na kontrata?")
        self.assertIn("Article 1409", expanded_tl)
        self.assertIn("Article 1390", expanded_tl)

        # Marriage queries must NOT expand to Civil Code void-contract Art. 1409.
        expanded_marriage = main.expand_legal_query("What are the grounds for a void marriage under the Family Code?")
        self.assertNotIn("Article 1409", expanded_marriage)

        # Annulment of contract must NOT expand to Family Code marriage/custody articles.
        expanded_annul_contract = main.expand_legal_query("How do I file for annulment of a voidable contract?")
        self.assertIn("Article 1390", expanded_annul_contract)
        self.assertNotIn("child custody", expanded_annul_contract)

        emb = main.compute_embedding(expanded_en)
        results = main.search_with_embedding(emb, expanded_en, raw_query=self.QUERY)
        active_article_ids = [
            r.get("parent_id")
            for r in results
            if r.get("parent_type") == "article" and r.get("is_in_context") is not False
        ]
        self.assertIn("RA386-ART1409", active_article_ids)
        self.assertIn("RA386-ART1390", active_article_ids)
        self.assertIn("RA386-ART1330", active_article_ids)

    def test_followups_reject_thinking_process_and_llm_client_does_not_leak_reasoning_content(self):
        leaked_cot = (
            "Thinking Process:\n\n"
            "1. **Analyze the Request:** The user asked for a distinction between *void* and *voidable* "
            "contracts under civil law. The assistant provided a basic explanation.\n"
            "2. **Draft Follow-ups:** Ensure English only.\n"
        )
        self.assertEqual(followup_svc.parse_followup_questions(leaked_cot, target_lang="en"), [])

        think_wrapped = (
            "<think>\nThinking Process:\n1. Analyze the request.\n</think>\n"
            "How do I prove a contract is void from the beginning?\n"
            "What is the deadline to file an action to annul a voidable contract?\n"
            "Can a void contract still be ratified later?"
        )
        parsed = followup_svc.parse_followup_questions(think_wrapped, target_lang="en")
        self.assertEqual(
            parsed,
            [
                "How do I prove a contract is void from the beginning?",
                "What is the deadline to file an action to annul a voidable contract?",
                "Can a void contract still be ratified later?",
            ],
        )

        # call_chat_completion_async must not fall back to reasoning_content by default and must pass reasoning_effort.
        fake_response = MagicMock()
        fake_response.raise_for_status = MagicMock()
        fake_response.json.return_value = {
            "choices": [
                {
                    "message": {
                        "content": "",
                        "reasoning_content": "Thinking Process:\n1. **Analyze the Request:** ...",
                    }
                }
            ]
        }
        fake_client = MagicMock()
        fake_client.post = AsyncMock(return_value=fake_response)

        with patch("services.llm_client.get_async_client", return_value=fake_client):
            out = asyncio.run(
                call_chat_completion_async(
                    messages=[{"role": "user", "content": "suggest followups"}],
                    max_tokens=300,
                    reasoning_effort="none",
                )
            )

        self.assertEqual(out, "")
        sent_payload = fake_client.post.call_args.kwargs["json"]
        self.assertEqual(sent_payload.get("reasoning_effort"), "none")


if __name__ == "__main__":
    unittest.main()
