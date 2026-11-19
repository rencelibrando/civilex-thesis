import unittest
import numpy as np

from services.domain_router import (
    CIVIL_LAW_DOC_PATTERNS,
    NON_CIVIL_LEGAL_DOC_DOMAINS,
    DomainRouter,
    classify_document_domain,
)


class _StubEmbedder:
    """Deterministic unit-test embedder mapping text cues to orthogonal topic axes."""

    def _vec(self, text: str) -> np.ndarray:
        t = text.lower()
        # Axis 0: civil, Axis 1: labor, Axis 2: criminal, Axis 3: non-legal
        v = np.array([0.05, 0.05, 0.05, 0.05], dtype=float)
        if any(k in t for k in ("contract", "promissory", "lease", "borrowed", "repay", "utang", "hiram", "upa", "mana", "danyos", "inheritance", "property", "damages", "civil")):
            v[0] += 1.0
        if any(k in t for k in ("labor", "dole", "nlrc", "dismissal", "wage", "overtime", "sena")):
            v[1] += 1.0
        if any(k in t for k in ("criminal", "homicide", "murder", "theft", "police", "prosecutor", "warrant", "estafa")):
            v[2] += 1.0
        if any(k in t for k in ("quicksort", "python", "react", "recipe", "cookies", "adobo", "quadratic", "weather", "kerberos", "javascript", "css")):
            v[3] += 1.0
        norm = np.linalg.norm(v)
        return v / norm if norm > 0 else v

    def encode(self, texts, normalize_embeddings=True, show_progress_bar=False):
        if isinstance(texts, str):
            return self._vec(texts)
        return np.stack([self._vec(t) for t in texts])


class TestDocumentDomainClassification(unittest.TestCase):
    def test_constants_exported_from_domain_router(self):
        self.assertTrue(len(CIVIL_LAW_DOC_PATTERNS) > 0)
        self.assertTrue(len(NON_CIVIL_LEGAL_DOC_DOMAINS) >= 6)

    def test_formal_civil_documents_pass(self):
        lease = (
            "CONTRACT OF LEASE\n"
            "KNOW ALL MEN BY THESE PRESENTS:\n"
            "This Contract of Lease is made between LESSOR Juan Dela Cruz and LESSEE Maria Santos "
            "for monthly rent of PHP 15,000 with security deposit."
        )
        res = classify_document_domain(lease, "contract_of_lease.pdf")
        self.assertEqual(res["category"], "in_domain_civil")

        will = (
            "LAST WILL AND TESTAMENT\n"
            "I, Roberto Reyes, of legal age, execute this notarial will designating my compulsory heirs "
            "and their legitime under the Civil Code of the Philippines."
        )
        res_will = classify_document_domain(will, "last_will.docx")
        self.assertEqual(res_will["category"], "in_domain_civil")

    def test_informal_english_and_tagalog_civil_notes_pass(self):
        router = DomainRouter(_StubEmbedder())

        informal_en = (
            "I borrowed PHP 12,000 in cash from my friend Maria Santos on October 1, 2026. "
            "I promise to repay the full amount on or before December 15, 2026. Signed: Juan Cruz."
        )
        res_en = classify_document_domain(informal_en, "note.txt", router=router)
        self.assertEqual(res_en["category"], "in_domain_civil")

        informal_tl_loan = (
            "Ako si Juan Dela Cruz ay nanghiram kay Pedro Reyes ng sampung libong piso (P10,000). "
            "Nangangako akong babayaran ito sa loob ng tatlong buwan."
        )
        res_tl = classify_document_domain(informal_tl_loan, "kasulatan.txt", router=router)
        self.assertEqual(res_tl["category"], "in_domain_civil")

        informal_tl_lease = (
            "Patunay ng pagbabayad ng renta sa paupahan. Nagbigay si Ana ng isang buwang advance at deposit "
            "para sa inuupahang kwarto sa halagang P4,500 kada buwan."
        )
        res_lease = classify_document_domain(informal_tl_lease, "resibo_upa.jpg", router=router)
        self.assertEqual(res_lease["category"], "in_domain_civil")

        informal_tl_damages = (
            "Usapan namin ni Mark matapos mabangga ang aking motorsiklo. Magbabayad siya ng danyos at "
            "gastos sa pagpapagawa ng nasirang sasakyan."
        )
        res_dmg = classify_document_domain(informal_tl_damages, "usapan.png", router=router)
        self.assertEqual(res_dmg["category"], "in_domain_civil")

    def test_non_civil_legal_documents_rejected_with_domain(self):
        criminal = (
            "REPUBLIC OF THE PHILIPPINES\n"
            "OFFICE OF THE CITY PROSECUTOR\n"
            "COMPLAINT-AFFIDAVIT FOR QUALIFIED THEFT\n"
            "Pursuant to the Revised Penal Code (Act No. 3815), respondent is charged with criminal theft."
        )
        res_crim = classify_document_domain(criminal, "complaint.pdf")
        self.assertEqual(res_crim["category"], "out_of_domain_legal")
        self.assertIn("Criminal", res_crim["target_domain"])

        labor = (
            "NATIONAL LABOR RELATIONS COMMISSION (NLRC)\n"
            "COMPLAINT FOR ILLEGAL DISMISSAL AND BACKWAGES\n"
            "Under the Labor Code of the Philippines (PD 442) and DOLE SEnA rules, complainant seeks separation pay."
        )
        res_lab = classify_document_domain(labor, "nlrc_case.pdf")
        self.assertEqual(res_lab["category"], "out_of_domain_legal")
        self.assertIn("Labor", res_lab["target_domain"])

        tax = (
            "BUREAU OF INTERNAL REVENUE\n"
            "PRELIMINARY ASSESSMENT NOTICE (PAN)\n"
            "Deficiency Value-Added Tax (VAT) and Income Tax assessment under the NIRC (RA 8424) and TRAIN Law."
        )
        res_tax = classify_document_domain(tax, "bir_pan.pdf")
        self.assertEqual(res_tax["category"], "out_of_domain_legal")
        self.assertIn("Tax", res_tax["target_domain"])

        privacy = (
            "NATIONAL PRIVACY COMMISSION\n"
            "PERSONAL DATA BREACH NOTIFICATION\n"
            "Submitted pursuant to the Data Privacy Act of 2012 (RA 10173) by the Personal Information Controller."
        )
        res_priv = classify_document_domain(privacy, "breach_notice.docx")
        self.assertEqual(res_priv["category"], "out_of_domain_legal")
        self.assertIn("Privacy", res_priv["target_domain"])

        corp = (
            "ARTICLES OF INCORPORATION OF ACME CORP.\n"
            "Filed with the Securities and Exchange Commission (SEC) under the Revised Corporation Code (RA 11232)."
        )
        res_corp = classify_document_domain(corp, "aoi.pdf")
        self.assertEqual(res_corp["category"], "out_of_domain_legal")
        self.assertIn("Corporate", res_corp["target_domain"])

        ip = (
            "INTELLECTUAL PROPERTY OFFICE OF THE PHILIPPINES (IPOPHL)\n"
            "TRADEMARK REGISTRATION APPLICATION under RA 8293 (IP Code)."
        )
        res_ip = classify_document_domain(ip, "trademark.pdf")
        self.assertEqual(res_ip["category"], "out_of_domain_legal")
        self.assertIn("Intellectual Property", res_ip["target_domain"])

    def test_non_legal_documents_rejected(self):
        router = DomainRouter(_StubEmbedder())

        code_doc = (
            "def quicksort(arr):\n"
            "    if len(arr) <= 1: return arr\n"
            "    pivot = arr[0]\n"
            "    # CSS property section layout and React component state\n"
        )
        self.assertEqual(classify_document_domain(code_doc, "algo.txt", router=router)["category"], "out_of_domain_non_legal")

        recipe = (
            "Chocolate Chip Cookies Recipe: Mix butter, sugar, flour, and eggs. "
            "Bake for 12 minutes at 350F until golden brown."
        )
        self.assertEqual(classify_document_domain(recipe, "cookies.txt", router=router)["category"], "out_of_domain_non_legal")

        kerberos = (
            "Kerberos Authentication Protocol Overview: Key Distribution Center (KDC) issues Ticket Granting Tickets "
            "using symmetric encryption and timestamps."
        )
        self.assertEqual(classify_document_domain(kerberos, "kerberos_notes.pdf", router=router)["category"], "out_of_domain_non_legal")

    def test_civil_document_with_incidental_tax_or_estafa_mention_remains_civil(self):
        lease_with_tax = (
            "CONTRACT OF LEASE\n"
            "Between LESSOR Pedro Santos and LESSEE Ana Cruz. Monthly rent is PHP 20,000. "
            "Lessee shall pay utility bills and withholding tax applicable to the lease."
        )
        res = classify_document_domain(lease_with_tax, "lease.pdf")
        self.assertEqual(res["category"], "in_domain_civil")

    def test_semantic_router_resolves_borderline_informal_note(self):
        router = DomainRouter(_StubEmbedder())
        borderline = "We agreed in writing on the inheritance share and damages for the broken property."
        res = classify_document_domain(borderline, "family_note.txt", router=router)
        self.assertEqual(res["category"], "in_domain_civil")


if __name__ == "__main__":
    unittest.main()
