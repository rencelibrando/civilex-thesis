import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from parse_family_code import clean_article_text


class TestPhase2CorpusAndDbRepairs(unittest.TestCase):
    def test_clean_article_text_preserves_numbered_clauses_and_strips_source_notes(self):
        art2_raw = (
            "No marriage shall be valid, unless these essential requisites are present:\n\n"
            "(1) Legal capacity of the contracting parties who must be a male and a female; and\n\n"
            "(2) Consent freely given in the presence of the solemnizing officer. (53a)"
        )
        cleaned = clean_article_text(art2_raw)
        self.assertIn("(1) Legal capacity of the contracting parties", cleaned)
        self.assertIn("(2) Consent freely given in the presence of the solemnizing officer.", cleaned)
        self.assertFalse(cleaned.endswith("(53a)"))

    def test_clean_article_text_preserves_art26_foreign_divorce_paragraph(self):
        art26_raw = (
            "All marriages solemnized outside the Philippines, in accordance with the laws in force "
            "in the country where they were solemnized, and valid there as such, shall also be valid "
            "in this country, except those prohibited under Articles 35 (1), (4), (5) and (6), 36, 37 and 38.\n\n"
            "Where a marriage between a Filipino citizen and a foreigner is validly celebrated and a divorce "
            "is thereafter validly obtained abroad by the alien spouse capacitating him or her to remarry, "
            "the Filipino spouse shall have capacity to remarry under Philippine law. (As amended by Executive Order 227)"
        )
        cleaned = clean_article_text(art26_raw)
        self.assertIn("Articles 35 (1), (4), (5) and (6), 36, 37 and 38.", cleaned)
        self.assertIn("the Filipino spouse shall have capacity to remarry under Philippine law.", cleaned)
        self.assertNotIn("Executive Order 227", cleaned)

    def test_clean_article_text_handles_pd603_and_nested_source_notes(self):
        art189_raw = (
            "Adoption shall have the following effects:\n\n"
            "(1) For civil purposes, the adopted shall be deemed to be a legitimate child.\n"
            "(3) The adopted shall remain an intestate heir of his parents. (39(1)a, (3)a, PD 603)"
        )
        cleaned = clean_article_text(art189_raw)
        self.assertIn("(1) For civil purposes", cleaned)
        self.assertIn("(3) The adopted shall remain an intestate heir of his parents.", cleaned)
        self.assertNotIn("PD 603", cleaned)

        art221_raw = (
            "Parents and other persons exercising parental authority shall be civilly liable "
            "for the injuries and damages caused by the acts or omissions of their unemancipated "
            "children living in their company and under their parental authority. (2180(2)a and (4)a )"
        )
        cleaned_221 = clean_article_text(art221_raw)
        self.assertIn("under their parental authority.", cleaned_221)
        self.assertNotIn("2180", cleaned_221)

    def test_extract_docket_from_case_text_handles_consolidated_and_am_headers(self):
        from repair_rag_corpus_and_db import extract_docket_from_case_text

        self.assertEqual(
            extract_docket_from_case_text(
                "G.R. No. 94188 Manila SECOND DIVISION G.R. Nos. 94188-89 December 17, 1992 PEOPLE",
                "",
            ),
            "G.R. Nos. 94188-89",
        )
        self.assertEqual(
            extract_docket_from_case_text(
                "G.R. No. L-11519 and L-11520 Republic of the Philippines SUPREME COURT Manila EN BANC G.R. Nos. L-11519 and L-11520 April 30, 1958",
                "",
            ),
            "G.R. Nos. L-11519 and L-11520",
        )
        self.assertEqual(
            extract_docket_from_case_text(
                "A.M. OCA IPI No. 12-202-CA-J Republic of the Philippines SUPREME COURT",
                "",
            ),
            "A.M. OCA IPI No. 12-202-CA-J",
        )
        self.assertEqual(
            extract_docket_from_case_text(
                "Summary unavailable.",
                "Republic of the Philippines SUPREME COURT G.R. Nos. L-4891-92 March 29, 1954",
            ),
            "G.R. Nos. L-4891-92",
        )

    def test_extract_family_code_articles_from_case_is_accurate(self):
        from repair_rag_corpus_and_db import extract_family_code_articles_from_case

        sample = (
            "The petition invokes Article 36 of the Family Code on psychological incapacity, "
            "as well as Articles 147 and 148 of the Family Code on property relations. "
            "See also Family Code, Art. 26. "
            "Unlike Article 200 of the Revised Penal Code, this is a civil action."
        )
        found = extract_family_code_articles_from_case(sample)
        self.assertEqual(found, {26, 36, 147, 148})


if __name__ == "__main__":
    unittest.main()
