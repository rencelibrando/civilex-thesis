import unittest
from unittest.mock import patch

import numpy as np

from services import document as doc_service


class _FakeResponse:
    def __init__(self, content: bytes):
        self.content = content

    def raise_for_status(self):
        return None


class _FakeCursor:
    def __init__(self, executed):
        self.executed = executed

    def execute(self, sql, params=None):
        self.executed.append((sql.strip(), params))

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _FakeConn:
    def __init__(self, executed):
        self.executed = executed
        self.committed = False
        self.closed = False

    def cursor(self):
        return _FakeCursor(self.executed)

    def commit(self):
        self.committed = True

    def close(self):
        self.closed = True


class _FakeEmbedder:
    def encode(self, texts, batch_size=16, normalize_embeddings=True, show_progress_bar=False):
        if isinstance(texts, str):
            return np.ones(4, dtype=float) / 2.0
        return np.ones((len(texts), 4), dtype=float) / 2.0


class TestUploadTimeDomainRejection(unittest.TestCase):
    def test_non_legal_document_is_rejected_without_embedding(self):
        executed = []
        payload = (
            b"def quicksort(arr):\n"
            b"    if len(arr) <= 1:\n"
            b"        return arr\n"
            b"    pivot = arr[0]\n"
            b"    return quicksort([x for x in arr[1:] if x < pivot]) + [pivot]\n"
        )

        with patch("services.document.httpx.get", return_value=_FakeResponse(payload)), \
             patch("services.document.psycopg2.connect", side_effect=lambda *a, **k: _FakeConn(executed)), \
             patch("services.document.get_model") as mock_get_model, \
             patch("services.document.get_shared_domain_router", return_value=None):
            doc_service.extract_and_process_document("http://example.test/algo.txt", "doc-1", "algo.txt")
            mock_get_model.assert_not_called()

        sql_blob = "\n".join(sql for sql, _ in executed)
        self.assertIn("DELETE FROM document_chunks", sql_blob)
        rejection_updates = [
            (sql, params)
            for sql, params in executed
            if "UPDATE user_documents" in sql and "rejected_unrelated" in sql
        ]
        self.assertTrue(rejection_updates, f"Expected rejected_unrelated update, got: {executed}")
        self.assertIn("extracted_text = NULL", rejection_updates[-1][0])
        self.assertIn("Civil Code", rejection_updates[-1][1][0])

    def test_non_civil_legal_document_is_rejected_with_domain_explanation(self):
        executed = []
        payload = (
            b"NATIONAL LABOR RELATIONS COMMISSION (NLRC)\n"
            b"COMPLAINT FOR ILLEGAL DISMISSAL AND SEPARATION PAY\n"
            b"Under the Labor Code of the Philippines (PD 442) and DOLE rules.\n"
        )

        with patch("services.document.httpx.get", return_value=_FakeResponse(payload)), \
             patch("services.document.psycopg2.connect", side_effect=lambda *a, **k: _FakeConn(executed)), \
             patch("services.document.get_model") as mock_get_model, \
             patch("services.document.get_shared_domain_router", return_value=None):
            doc_service.extract_and_process_document("http://example.test/nlrc.txt", "doc-2", "nlrc.txt")
            mock_get_model.assert_not_called()

        rejection_updates = [
            (sql, params)
            for sql, params in executed
            if "UPDATE user_documents" in sql and "rejected_unrelated" in sql
        ]
        self.assertTrue(rejection_updates)
        self.assertIn("Labor", rejection_updates[-1][1][0])
        self.assertIn("extracted_text = NULL", rejection_updates[-1][0])

    def test_valid_civil_document_proceeds_to_chunking_and_completion(self):
        executed = []
        payload = (
            b"CONTRACT OF LEASE\n"
            b"This Contract of Lease is entered into by LESSOR Maria Santos and LESSEE Juan Cruz "
            b"for residential premises at PHP 15,000 monthly rent under the Civil Code of the Philippines.\n"
        )

        with patch("services.document.httpx.get", return_value=_FakeResponse(payload)), \
             patch("services.document.psycopg2.connect", side_effect=lambda *a, **k: _FakeConn(executed)), \
             patch("services.document.get_model", return_value=_FakeEmbedder()), \
             patch("services.document.get_shared_domain_router", return_value=None), \
             patch("psycopg2.extras.execute_values") as mock_exec_values:
            doc_service.extract_and_process_document("http://example.test/lease.txt", "doc-3", "lease.txt")
            mock_exec_values.assert_called_once()

        completed_updates = [
            (sql, params)
            for sql, params in executed
            if "UPDATE user_documents" in sql and "status = 'completed'" in sql
        ]
        self.assertTrue(completed_updates, f"Expected completed update, got: {executed}")

        # Verify granular monotonic progress milestones (18 -> 28 -> 45 -> 55 -> 65 -> 95 -> 100)
        progress_values = []
        for sql, params in executed:
            if "UPDATE user_documents" in sql and "progress = %s" in sql and params:
                for p in params:
                    if isinstance(p, int):
                        progress_values.append(p)
            elif "status = 'completed', progress = 100" in sql:
                progress_values.append(100)
        self.assertEqual(progress_values, [18, 28, 45, 55, 65, 95, 100])


if __name__ == "__main__":
    unittest.main()
