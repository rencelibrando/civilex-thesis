import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from core.article_parser import parse_article_numbers
import main
from services import llm_client, memory as session_memory


class TestMemoryAndCitationIntegrity(unittest.TestCase):
    def test_parse_article_numbers_handles_bold_markdown_and_plural_ranges(self):
        self.assertEqual(
            parse_article_numbers(
                "Under Article **1654** and **Art. 1658**, the lessee has repair remedies.",
                allow_bare_numbers=False,
                strict_external_exclusion=False,
            ),
            ["1654", "1658"],
        )
        self.assertEqual(
            parse_article_numbers(
                "See Articles 1654-1658 of the Civil Code.",
                allow_bare_numbers=False,
                strict_external_exclusion=False,
            ),
            ["1654", "1655", "1656", "1657", "1658"],
        )
        self.assertEqual(
            parse_article_numbers(
                "Compare Article 1156 vs Article 1191.",
                allow_bare_numbers=False,
                strict_external_exclusion=False,
            ),
            ["1156", "1191"],
        )

    def test_resolve_history_dedupes_consecutive_user_turns_and_strips_greetings(self):
        raw_client = [
            {
                "role": "assistant",
                "content": "Hello. I am CIVIL-LEX, your AI Legal Assistant. How can I help you with Philippine Civil Law today?",
            },
            {"role": "user", "content": "Can I deduct repair costs from rent?"},
            {"role": "user", "content": "Can I deduct repair costs from rent?"},
        ]
        resolved = session_memory.resolve_history(raw_client, None)
        self.assertEqual(len(resolved), 1)
        self.assertEqual(resolved[0]["role"], "user")
        self.assertEqual(resolved[0]["content"], "Can I deduct repair costs from rent?")

        # DB history with legacy duplicated user messages must also collapse cleanly
        db_duped = [
            {"role": "assistant", "content": "Initial document review of Lease_Agreements.pdf under Article 1654."},
            {"role": "user", "content": "Can I deduct repair costs from rent?"},
            {"role": "user", "content": "Can I deduct repair costs from rent?"},
            {"role": "assistant", "content": "Under Article 1658 and Article 1663, remedies depend on urgency."},
        ]
        resolved_db = session_memory.resolve_history([], db_duped)
        self.assertEqual([m["role"] for m in resolved_db], ["assistant", "user", "assistant"])

    def test_build_llm_messages_compacts_verbose_assistant_history_and_pops_duplicates(self):
        verbose_turn1 = (
            "### Document Overview & Parties\n"
            "This is a residential lease agreement for a property in Minnesota between Lessor and Lessee.\n\n"
            "### Philippine Civil Code / Family Code Alignment\n"
            "> **Article 1654 (Republic Act No. 386 - Civil Code of the Philippines)**\n"
            "> *Book IV - OBLIGATIONS AND CONTRACTS > Title VIII.—LEASE*\n"
            ">\n"
            '> "The lessor is obliged: (1) To deliver the thing... (2) To make necessary repairs... '
            '(3) To maintain peaceful enjoyment."\n\n'
            "- **Lessor's Obligations**: Under Philippine law, the lessor must make necessary repairs. [Art. 1654]\n\n"
            "### Potential Legal Risks & Clauses to Watch\n"
            + ("The indemnification clause is overly broad and may be void against public policy. " * 30)
            + "\n\n---\n"
            "> ***Important Notice (Educational Legal Information)***: *This information is provided for general educational purposes.*"
        )
        history = [
            {"role": "assistant", "content": verbose_turn1},
            {"role": "user", "content": "Can I deduct repair costs from rent?"},
            {"role": "user", "content": "Can I deduct repair costs from rent?"},
        ]
        msgs = llm_client.build_llm_messages("SYS_PROMPT", "Can I deduct repair costs from rent?", history)
        self.assertEqual([m["role"] for m in msgs], ["system", "user", "assistant", "user"])
        self.assertEqual(msgs[-1]["content"], "Can I deduct repair costs from rent?")

        prior_assistant = msgs[2]["content"]
        # Compaction must strip boilerplate disclaimers and verbatim statutory quotes to prevent small-LLM parroting
        self.assertLessEqual(len(prior_assistant), 1000)
        self.assertNotIn("Important Notice (Educational Legal Information)", prior_assistant)
        self.assertNotIn("The lessor is obliged: (1) To deliver", prior_assistant)
        # Key factual anchor and cited article reference remain preserved
        self.assertIn("1654", prior_assistant)

    def test_build_llm_messages_drops_synthetic_greeting_on_new_non_doc_chat(self):
        history = [
            {
                "role": "assistant",
                "content": "Welcome back, Rence. I am CIVIL-LEX, your AI Legal Assistant.",
            }
        ]
        msgs = llm_client.build_llm_messages("SYS", "What is Article 1156?", history)
        self.assertEqual([m["role"] for m in msgs], ["system", "user"])
        self.assertEqual(msgs[-1]["content"], "What is Article 1156?")

    def test_build_contextual_query_prevents_cross_topic_drift(self):
        prior = [
            main.ChatMessage(role="user", content="What are the grounds for psychological incapacity under Article 36?"),
            main.ChatMessage(role="assistant", content="Under Article 36 of the Family Code, marriage is void for psychological incapacity."),
        ]
        # Switching to an unrelated standalone civil law question must NOT drag Article 36 into the search query
        switched = main.build_contextual_query("Can a tenant deduct repairs from rent?", prior, document_filename=None)
        self.assertNotIn("Article 36", switched)
        # True coreference follow-up MUST keep Article 36 anchor
        followup = main.build_contextual_query("What evidence is required to prove it?", prior, document_filename=None)
        self.assertIn("Article 36", followup)

    def test_prior_citations_preserve_statutes_above_six_doc_chunks(self):
        doc_id = "22222222-2222-4222-8222-222222222222"
        turn1_cits = [
            {
                "chunk_id": f"{doc_id}_c{i}",
                "parent_type": "user_document",
                "parent_id": doc_id,
                "content": f"Clause excerpt {i}",
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 91.0 - i * 0.5,
            }
            for i in range(6)
        ] + [
            {
                "chunk_id": "RA386-ART1654_c0",
                "parent_type": "article",
                "parent_id": "RA386-ART1654",
                "content": "The lessor is obliged to make all necessary repairs.",
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 87.5,
                "metadata": {"article_number": 1654},
            }
        ]
        merged = session_memory.merge_prior_citations(turn1_cits, [])
        pids = [c["parent_id"] for c in merged]
        self.assertIn("RA386-ART1654", pids)

    def test_reconcile_orders_cited_statutes_before_doc_chunks_and_reuses_prior_citations(self):
        doc_id = "22222222-2222-4222-8222-222222222222"
        existing = [
            {
                "chunk_id": "RA386-ART1662_c0",
                "parent_type": "article",
                "parent_id": "RA386-ART1662",
                "content": "Urgent repairs...",
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 89.6,
                "metadata": {"article_number": 1662},
            },
            {
                "chunk_id": f"{doc_id}_c0",
                "parent_type": "user_document",
                "parent_id": doc_id,
                "content": "Clause G Maintenance and Repair",
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 89.1,
            },
            {
                "chunk_id": f"{doc_id}_c1",
                "parent_type": "user_document",
                "parent_id": doc_id,
                "content": "Clause I Damage to Premises",
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 88.6,
            },
        ]
        prior_cits = [
            {
                "chunk_id": "RA386-ART1654_c0",
                "parent_type": "article",
                "parent_id": "RA386-ART1654",
                "content": "The lessor is obliged to make necessary repairs.",
                "is_in_context": True,
                "rank_status": "primary",
                "similarity": 0.85,
                "suitability_percent": 91.5,
                "metadata": {"article_number": 1654},
            }
        ]
        answer = "Under [Art. 1654] and [Art. 1662], the lessor must make necessary repairs."
        with patch("main.fetch_article_citations") as mock_fetch:
            reconciled = main.reconcile_response_citations(
                answer,
                existing,
                query="Can I deduct repair costs from rent?",
                document_id=doc_id,
                prior_citations=prior_cits,
            )

        # Article 1654 should be resolved from prior_citations without a blind DB refetch
        mock_fetch.assert_not_called()
        types = [c["parent_type"] for c in reconciled]
        # All cited statutory articles must appear ahead of uploaded document excerpts
        self.assertEqual(types[:2], ["article", "article"])
        self.assertEqual(types[2:], ["user_document", "user_document"])
        self.assertEqual(
            {c["parent_id"] for c in reconciled if c["parent_type"] == "article"},
            {"RA386-ART1654", "RA386-ART1662"},
        )

    def test_search_sse_retains_turn1_cited_article_when_retrieved_but_uncited_in_turn2(self):
        prior_cits = [
            {
                "chunk_id": "RA386-ART1654_c0",
                "parent_type": "article",
                "parent_id": "RA386-ART1654",
                "content": "Article 1654 text",
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 91.5,
                "display_suitability": 91.5,
                "metadata": {"article_number": 1654},
            }
        ]
        # Turn 2 retrieves BOTH Art 1654 (from Turn 1) and Art 1662, but Turn 2's text only cites Art 1662
        turn2_retrieved = [
            {
                "chunk_id": "RA386-ART1654_c0",
                "parent_type": "article",
                "parent_id": "RA386-ART1654",
                "content": "Article 1654 text",
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 92.0,
                "display_suitability": 92.0,
                "rank": 1,
                "metadata": {"article_number": 1654},
            },
            {
                "chunk_id": "RA386-ART1662_c0",
                "parent_type": "article",
                "parent_id": "RA386-ART1662",
                "content": "Article 1662 text",
                "is_in_context": True,
                "rank_status": "primary",
                "suitability_percent": 90.0,
                "display_suitability": 90.0,
                "rank": 2,
                "metadata": {"article_number": 1662},
            },
        ]

        captured_ctx_history = []
        captured_llm_history = []
        orig_build_ctx = main.build_contextual_query

        def _spy_build_ctx(q, hist, doc_fn=None):
            captured_ctx_history.append([(m.role, m.content) for m in (hist or [])])
            return orig_build_ctx(q, hist, doc_fn)

        async def _fake_stream(sys_prompt, uq, hist=None, **kwargs):
            captured_llm_history.append(list(hist or []))
            yield "### Direct Answer\nUnder [Art. 1662], if urgent repairs exceed forty days, rent is reduced proportionally."

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

        # Simulate DB returning Turn 1 before save, and Turn 1 + Turn 2 if reloaded after save
        db_calls = {"n": 0}

        def _fake_load_history(*args, **kwargs):
            db_calls["n"] += 1
            base = [
                {"role": "assistant", "content": "Initial lease review citing Article 1654."},
            ]
            if db_calls["n"] > 1:
                return base + [{"role": "user", "content": "What if urgent repairs take over 40 days?"}]
            return base

        with patch("main.session_memory.load_session_history", side_effect=_fake_load_history), \
             patch("main.session_memory.load_session_summary", return_value=None), \
             patch("main.session_memory.load_recent_citations", return_value=prior_cits), \
             patch("main.session_memory.save_user_message"), \
             patch("main.check_model_readiness", new=AsyncMock(return_value=(True, "ready"))), \
             patch("main.detect_ambiguity", new=AsyncMock(return_value=MagicMock(is_ambiguous=False, confidence=0.1))), \
             patch("main.build_contextual_query", side_effect=_spy_build_ctx), \
             patch("main.compute_embedding", return_value=[0.1] * 768), \
             patch("main.search_with_embedding", return_value=turn2_retrieved), \
             patch("main.generate_response_stream", side_effect=_fake_stream), \
             patch("main.nli_score_faithfulness_async", new=AsyncMock(return_value=fake_nli)), \
             patch("main.followup_svc.generate_followups", new=AsyncMock(return_value=[])), \
             patch("main.save_assistant_message_to_db"):
            client = TestClient(main.app)
            resp = client.post(
                "/search",
                json={
                    "query": "What if urgent repairs take over 40 days?",
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

        latest = [e["data"] for e in events if e.get("type") == "citations"][-1]
        accumulated = [e["data"] for e in events if e.get("type") == "accumulated_citations"][-1]

        # Latest shows Turn 2's cited article only; All Sources MUST still retain Turn 1's Article 1654!
        self.assertEqual([c["parent_id"] for c in latest], ["RA386-ART1662"])
        self.assertEqual([c["parent_id"] for c in accumulated], ["RA386-ART1662", "RA386-ART1654"])

        # History passed to contextual query rewriter and LLM must NOT be polluted by the just-persisted current query
        self.assertTrue(captured_ctx_history)
        for hist_snap in captured_ctx_history:
            self.assertEqual(len(hist_snap), 1)
            self.assertEqual(hist_snap[0][0], "assistant")
        self.assertEqual(len(captured_llm_history[0]), 1)
        self.assertEqual(captured_llm_history[0][0]["role"], "assistant")

    def test_maybe_refresh_summary_skips_llm_when_column_missing(self):
        import asyncio

        class _FakeConn:
            def cursor(self):
                return self

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def close(self):
                pass

        long_hist = [
            {"role": "user" if i % 2 == 0 else "assistant", "content": f"Turn {i} about lease obligations."}
            for i in range(8)
        ]
        self.assertTrue(session_memory.should_refresh_summary(len(long_hist)))
        with patch("services.memory.load_session_history", return_value=long_hist), \
             patch("services.memory._has_column", return_value=False), \
             patch("services.llm_client.call_chat_completion_async", new=AsyncMock(return_value="Summary")) as mock_llm:
            out = asyncio.run(
                session_memory.maybe_refresh_summary(
                    "11111111-1111-4111-8111-111111111111",
                    get_conn=lambda: _FakeConn(),
                )
            )
        self.assertIsNone(out)
        mock_llm.assert_not_called()

    def test_expand_legal_query_prioritizes_lease_repairs_without_ejectment_noise(self):
        expanded = main.expand_legal_query("Can I deduct repair costs from rent? (Lease Agreements)")
        self.assertIn("Article 1658", expanded)
        self.assertIn("Article 1663", expanded)
        self.assertNotIn("Article 1673", expanded)

        evict_expanded = main.expand_legal_query("Can a landlord evict a tenant without court process?")
        self.assertIn("Article 1673", evict_expanded)

    def test_ambiguity_bypasses_conceptual_followups_and_general_rule_questions(self):
        import asyncio
        from services import ambiguity

        with patch("services.llm_client.call_chat_completion_async", new=AsyncMock()) as mock_llm:
            res_followup = asyncio.run(
                ambiguity.detect_ambiguity(
                    "What are its essential elements?",
                    history=[
                        {"role": "user", "content": "What is Article 1156?"},
                        {"role": "assistant", "content": "Article 1156 defines an obligation."},
                    ],
                )
            )
            res_rule = asyncio.run(
                ambiguity.detect_ambiguity("Can a landlord evict a tenant without a court order?")
            )

        self.assertFalse(res_followup.is_ambiguous)
        self.assertFalse(res_rule.is_ambiguous)
        mock_llm.assert_not_called()

    def test_bold_article_references_bolds_prose_and_preserves_existing_bold_and_code(self):
        from core.article_parser import bold_article_references

        sample = (
            "### Statutory Grounding & Provisions\n"
            "> **Article 1654 (Republic Act No. 386 - Civil Code of the Philippines)**\n"
            "Under Article 1658 of the Civil Code, you can suspend rent. You may also seek rescission (Article 1659). "
            "If you breach Article 1657(2), the lessor may file ejectment under Article 1673 or [Art. 1654].\n"
            "- **Governing Civil Code / Family Code Article(s)**: Article 1654 (Republic Act No. 386), Article 1657 (RA 386)\n"
            "Inline `Article 1156` and partial Article **1191**."
        )
        formatted = bold_article_references(sample)
        self.assertIn("> **Article 1654 (Republic Act No. 386 - Civil Code of the Philippines)**", formatted)
        self.assertIn("Under **Article 1658** of the Civil Code", formatted)
        self.assertIn("(**Article 1659**)", formatted)
        self.assertIn("breach **Article 1657(2)**,", formatted)
        self.assertIn("under **Article 1673** or [**Art. 1654**].", formatted)
        self.assertIn("- **Governing Civil Code / Family Code Article(s)**: **Article 1654** (Republic Act No. 386), **Article 1657** (RA 386)", formatted)
        self.assertIn("`Article 1156`", formatted)
        self.assertIn("**Article 1191**", formatted)
        self.assertEqual(bold_article_references(formatted), formatted)


if __name__ == "__main__":
    unittest.main()
