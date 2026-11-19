import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from services import llm_client


class TestLlmHistoryAlternation(unittest.TestCase):
    def test_history_starting_with_assistant_prepends_user_anchor(self):
        msgs = llm_client.build_llm_messages(
            system_prompt="SYS",
            user_query="Who pays for roof repairs?",
            history=[{"role": "assistant", "content": "Initial document analysis of Lease."}],
        )
        roles = [m["role"] for m in msgs]
        self.assertEqual(roles, ["system", "user", "assistant", "user"])
        self.assertEqual(msgs[-1]["content"], "Who pays for roof repairs?")


class TestAutoAnalyzeRagPipeline(unittest.TestCase):
    def test_search_request_supports_auto_analyze_without_user_query(self):
        import main

        req = main.SearchRequest(
            query="",
            session_id="11111111-1111-4111-8111-111111111111",
            document_id="22222222-2222-4222-8222-222222222222",
            document_name="lease.pdf",
            auto_analyze=True,
        )
        self.assertTrue(req.auto_analyze)
        self.assertEqual(req.query, "")

    def test_auto_analyze_skips_save_user_message_and_streams_followups(self):
        import main
        from fastapi.testclient import TestClient

        doc_id = "22222222-2222-4222-8222-222222222222"
        sess_id = "11111111-1111-4111-8111-111111111111"

        class _DocCursor:
            def __init__(self):
                self._last = None

            def execute(self, sql, params=None):
                s = " ".join(sql.split()).lower()
                if "from user_documents" in s:
                    self._last = ("lease.pdf", "completed", None)
                elif "count(*)" in s:
                    self._last = (1,)
                elif "from document_chunks" in s:
                    self._last = [("This Contract of Lease between Lessor and Lessee sets monthly rent at P15,000.",)]
                else:
                    self._last = None

            def fetchone(self):
                return self._last

            def fetchall(self):
                return self._last or []

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        class _DocConn:
            def cursor(self, *args, **kwargs):
                return _DocCursor()

            def close(self):
                pass

        async def _fake_stream(*args, **kwargs):
            yield "### Summary & Direct Conclusion\nThis residential Contract of Lease complies with [Art. 1654]."

        fake_search_results = [
            {
                "chunk_id": f"{doc_id}_c0",
                "parent_type": "user_document",
                "parent_id": doc_id,
                "content": "Monthly rent is P15,000.",
                "similarity": 0.94,
                "suitability_percent": 94.0,
                "display_suitability": 94.0,
                "is_in_context": True,
                "rank": 1,
            },
            {
                "chunk_id": "RA386-ART1654_0",
                "parent_type": "article",
                "parent_id": "RA386-ART1654",
                "content": "Article 1654. The lessor is obliged to deliver the thing which is the object of the contract...",
                "metadata": {"article_id": "RA386-ART1654", "article_number": 1654, "hierarchy": {}},
                "similarity": 0.91,
                "suitability_percent": 91.0,
                "display_suitability": 91.0,
                "is_in_context": True,
                "rank": 2,
            },
        ]

        fake_nli = MagicMock(
            score_percent=92.0,
            score_net_percent=92.0,
            score_weighted=0.92,
            status="Grounded",
            claims_total=2,
            claims_entailed=2,
            claims_neutral=0,
            claims_contradicted=0,
            engine="symbolic",
        )

        with patch("main.get_db_connection", side_effect=lambda: _DocConn()), \
             patch("main.session_memory.load_session_history", return_value=[]), \
             patch("main.session_memory.load_session_summary", return_value=None), \
             patch("main.session_memory.load_recent_citations", return_value=[]), \
             patch("main.session_memory.save_user_message") as mock_save_user, \
             patch("main.check_model_readiness", new=AsyncMock(return_value=(True, "ready"))), \
             patch("main.compute_embedding", return_value=[0.1] * 768), \
             patch("main.search_with_embedding", return_value=fake_search_results) as mock_search_emb, \
             patch("main.generate_response_stream", side_effect=_fake_stream), \
             patch("main.nli_score_faithfulness_async", new=AsyncMock(return_value=fake_nli)), \
             patch("main.followup_svc.generate_followups", new=AsyncMock(return_value=["Who pays for major repairs?"])), \
             patch("main.save_assistant_message_to_db") as mock_save_assistant:
            client = TestClient(main.app)
            resp = client.post(
                "/search",
                json={
                    "query": "",
                    "session_id": sess_id,
                    "document_id": doc_id,
                    "document_name": "lease.pdf",
                    "auto_analyze": True,
                },
            )

        self.assertEqual(resp.status_code, 200)
        mock_save_user.assert_not_called()
        mock_save_assistant.assert_called_once()
        mock_search_emb.assert_called_once()

        events = []
        for block in resp.text.split("\n\n"):
            for line in block.splitlines():
                if line.startswith("data: "):
                    events.append(json.loads(line[6:]))

        event_types = [e.get("type") for e in events]
        self.assertIn("citations", event_types)
        self.assertIn("text", event_types)
        self.assertIn("follow_ups", event_types)
        self.assertIn("done", event_types)

    def test_followup_without_legal_keywords_still_fetches_civil_code_articles(self):
        import main

        doc_id = "22222222-2222-4222-8222-222222222222"

        class _FollowupCursor:
            def __init__(self):
                self._rows = []

            def execute(self, sql, params=None):
                s = " ".join(sql.split()).lower()
                if "from document_chunks" in s and "where parent_id = %s" in s:
                    self._rows = [{
                        "chunk_id": f"{doc_id}_c0",
                        "parent_type": "user_document",
                        "parent_id": doc_id,
                        "content": "CONTRACT OF LEASE between Lessor and Lessee for monthly rent PHP 15,000.",
                        "similarity": 0.91,
                        "rrf_score": 0.03,
                    }]
                elif "from document_chunks" in s and "article" in str(params):
                    self._rows = [{
                        "chunk_id": "RA386-ART1654_0",
                        "parent_type": "article",
                        "parent_id": "RA386-ART1654",
                        "content": "Article 1654. The lessor is obliged to make all necessary repairs.",
                        "similarity": 0.89,
                        "rrf_score": 0.02,
                    }]
                elif "from civil_code_articles" in s:
                    self._rows = [{"article_id": "RA386-ART1654", "article_number": 1654, "hierarchy": {}}]
                else:
                    self._rows = []

            def fetchall(self):
                return self._rows

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        class _FollowupConn:
            def cursor(self, *args, **kwargs):
                return _FollowupCursor()

            def close(self):
                pass

        with patch("main.get_db_connection", side_effect=lambda: _FollowupConn()), \
             patch("main.classify_document_domain", return_value={"category": "in_domain_civil", "target_domain": None}):
            res = main.search_with_embedding(
                [0.1] * 768,
                "Who pays for roof repairs?",
                document_id=doc_id,
                raw_query="Who pays for roof repairs?",
            )

        parent_types = {r.get("parent_type") for r in res}
        self.assertIn("user_document", parent_types)
        self.assertIn("article", parent_types)

    def test_document_followup_question_streams_cleanly(self):
        import main
        from fastapi.testclient import TestClient

        doc_id = "22222222-2222-4222-8222-222222222222"
        sess_id = "11111111-1111-4111-8111-111111111111"

        class _DocCursor:
            def __init__(self):
                self._last = None

            def execute(self, sql, params=None):
                s = " ".join(sql.split()).lower()
                if "from user_documents" in s:
                    self._last = ("lease.pdf", "completed", None)
                elif "count(*)" in s:
                    self._last = (1,)
                elif "from document_chunks" in s:
                    self._last = [("CONTRACT OF LEASE monthly rent PHP 15,000.",)]
                else:
                    self._last = None

            def fetchone(self):
                return self._last

            def fetchall(self):
                return self._last or []

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        class _DocConn:
            def cursor(self, *args, **kwargs):
                return _DocCursor()

            def close(self):
                pass

        async def _fake_stream(*args, **kwargs):
            yield "### Summary & Direct Conclusion\nUnder [Art. 1654], the lessor makes necessary repairs."

        fake_results = [{
            "chunk_id": "RA386-ART1654_0",
            "parent_type": "article",
            "parent_id": "RA386-ART1654",
            "content": "Article 1654.",
            "metadata": {"article_id": "RA386-ART1654", "article_number": 1654, "hierarchy": {}},
            "similarity": 0.91,
            "suitability_percent": 91.0,
            "display_suitability": 91.0,
            "is_in_context": True,
            "rank": 1,
        }]
        fake_nli = MagicMock(
            score_percent=95.0,
            score_net_percent=95.0,
            score_weighted=0.95,
            status="Grounded",
            claims_total=1,
            claims_entailed=1,
            claims_neutral=0,
            claims_contradicted=0,
            engine="symbolic",
        )

        with patch("main.get_db_connection", side_effect=lambda: _DocConn()), \
             patch("main.session_memory.load_session_history", return_value=[{"role": "assistant", "content": "Initial analysis."}]), \
             patch("main.session_memory.load_session_summary", return_value=None), \
             patch("main.session_memory.load_recent_citations", return_value=[]), \
             patch("main.session_memory.save_user_message") as mock_save_user, \
             patch("main.check_model_readiness", new=AsyncMock(return_value=(True, "ready"))), \
             patch("main.compute_embedding", return_value=[0.1] * 768), \
             patch("main.search_with_embedding", return_value=fake_results), \
             patch("main.generate_response_stream", side_effect=_fake_stream), \
             patch("main.nli_score_faithfulness_async", new=AsyncMock(return_value=fake_nli)), \
             patch("main.followup_svc.generate_followups", new=AsyncMock(return_value=["What if lessor refuses?"])), \
             patch("main.save_assistant_message_to_db"):
            client = TestClient(main.app)
            resp = client.post(
                "/search",
                json={
                    "query": "Who pays for roof repairs?",
                    "session_id": sess_id,
                    "document_id": doc_id,
                    "document_name": "lease.pdf",
                },
            )

        self.assertEqual(resp.status_code, 200)
        mock_save_user.assert_called_once()
        self.assertIn("Art. 1654", resp.text)


if __name__ == "__main__":
    unittest.main()
