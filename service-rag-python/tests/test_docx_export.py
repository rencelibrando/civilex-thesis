import base64
import io
import unittest

import main as rag_main


TINY_PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


class TestLegalDocxExport(unittest.TestCase):
    def test_unilateral_signed_docx_export_succeeds(self):
        content = (
            "AFFIDAVIT OF LOSS\n\n"
            "KNOW ALL MEN BY THESE PRESENTS:\n\n"
            "I, JUAN DELA CRUZ, of legal age, hereby depose and state.\n\n"
            "_____________________________\n"
            "JUAN DELA CRUZ\n"
            "(Affiant)"
        )
        signatures = {
            "party_1": {
                "dataUrl": TINY_PNG_DATA_URL,
                "signerRole": "First Party / Signer",
                "signerName": "JUAN DELA CRUZ",
            }
        }
        doc = rag_main.generate_legal_docx("Affidavit of Loss", content, signatures=signatures)
        buf = io.BytesIO()
        doc.save(buf)
        data = buf.getvalue()
        self.assertTrue(data.startswith(b"PK\x03\x04"))
        self.assertGreater(len(data), 5000)

    def test_bilateral_signed_docx_export_succeeds(self):
        content = (
            "CONTRACT OF LEASE\n\n"
            "KNOW ALL MEN BY THESE PRESENTS:\n\n"
            "Lessor leases the premises to Lessee.\n\n"
            "_______________________     _______________________\n"
            "JUAN DELA CRUZ              PEDRO SANTOS\n"
            "(Lessor)                    (Lessee)"
        )
        signatures = {
            "party_1": {"dataUrl": TINY_PNG_DATA_URL},
            "party_2": {"dataUrl": TINY_PNG_DATA_URL},
        }
        doc = rag_main.generate_legal_docx("Contract of Lease", content, signatures=signatures)
        buf = io.BytesIO()
        doc.save(buf)
        self.assertTrue(buf.getvalue().startswith(b"PK\x03\x04"))
        self.assertGreater(len(base64.b64decode(TINY_PNG_DATA_URL.split(",", 1)[1])), 0)


if __name__ == "__main__":
    unittest.main()
