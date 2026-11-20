import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.article_parser import (
    extract_case_parties,
    extract_case_title_candidate,
    is_jurisprudence_query,
    parse_article_numbers,
    parse_gr_numbers,
)


class TestPhase3ParserOverhaul(unittest.TestCase):
    def test_article_thousands_comma_vs_comma_list(self):
        self.assertEqual(parse_article_numbers("Art 1,191"), ["1191"])
        self.assertEqual(parse_article_numbers("Article 2,176"), ["2176"])
        self.assertEqual(parse_article_numbers("Art. 1,191 and 2,176"), ["1191", "2176"])
        self.assertEqual(parse_article_numbers("Art. 1, 191"), ["1", "191"])
        self.assertEqual(parse_article_numbers("worth 1,500 pesos"), [])
        self.assertEqual(parse_article_numbers("PHP 1,200 debt"), [])

    def test_article_symbol_delimiters_and_bilingual_prefixes(self):
        self.assertEqual(parse_article_numbers("art#1191"), ["1191"])
        self.assertEqual(parse_article_numbers("art # 1191"), ["1191"])
        self.assertEqual(parse_article_numbers("article #1191"), ["1191"])
        self.assertEqual(parse_article_numbers("art-1191"), ["1191"])
        self.assertEqual(parse_article_numbers("art: 1191"), ["1191"])
        self.assertEqual(parse_article_numbers("art=1191"), ["1191"])
        self.assertEqual(parse_article_numbers("eo 209 36"), ["36"])
        self.assertEqual(parse_article_numbers("e.o. 209 36"), ["36"])
        self.assertEqual(parse_article_numbers("family code 36"), ["36"])
        self.assertEqual(parse_article_numbers("fc 36"), ["36"])
        self.assertEqual(parse_article_numbers("cc 1191"), ["1191"])
        self.assertEqual(parse_article_numbers("kodigo sibil 1191"), ["1191"])
        self.assertEqual(parse_article_numbers("batas sibil 1191"), ["1191"])
        self.assertEqual(parse_article_numbers("probisyon 1191"), ["1191"])
        self.assertEqual(parse_article_numbers("sec 36 family code"), ["36"])
        self.assertEqual(parse_article_numbers("section 1191 civil code"), ["1191"])

    def test_article_postfix_statute_mentions_and_year_guards(self):
        self.assertEqual(parse_article_numbers("36 family code"), ["36"])
        self.assertEqual(parse_article_numbers("36 of the family code"), ["36"])
        self.assertEqual(parse_article_numbers("36 ng family code"), ["36"])
        self.assertEqual(parse_article_numbers("1191 civil code"), ["1191"])
        self.assertEqual(parse_article_numbers("1191 of the civil code"), ["1191"])
        self.assertEqual(parse_article_numbers("1191 ng civil code"), ["1191"])
        self.assertEqual(parse_article_numbers("jurisprudence on 36 family code"), ["36"])
        self.assertEqual(parse_article_numbers("1953 civil code"), ["1953"])
        self.assertEqual(parse_article_numbers("Executive Order No. 209 Family Code"), [])
        self.assertEqual(parse_article_numbers("Republic Act 386 Civil Code"), [])
        self.assertEqual(parse_article_numbers("1987 Family Code effectivity"), [])

    def test_single_bare_article_numbers_and_false_positive_guards(self):
        self.assertEqual(parse_article_numbers("1191"), ["1191"])
        self.assertEqual(parse_article_numbers("#1191"), ["1191"])
        self.assertEqual(parse_article_numbers("what is 1191?"), ["1191"])
        self.assertEqual(parse_article_numbers("explain 2176"), ["2176"])
        self.assertEqual(parse_article_numbers("ano ang 1191"), ["1191"])
        self.assertEqual(parse_article_numbers("cases for 1191"), ["1191"])
        self.assertEqual(parse_article_numbers("sc decisions applying 2176"), ["2176"])
        self.assertEqual(parse_article_numbers("decided in 1995"), [])
        self.assertEqual(parse_article_numbers("G.R. No. 188289"), [])
        self.assertEqual(parse_article_numbers("worth 1500 pesos"), [])
        self.assertEqual(parse_article_numbers("I borrowed 1500 from my neighbor"), [])
        self.assertEqual(parse_article_numbers("Section 5 of the Lease Agreement", allow_bare_numbers=False), [])

    def test_flexible_gr_dockets_l_series_am_and_ranges(self):
        self.assertIn("188289", parse_gr_numbers("gr188289"))
        self.assertIn("188289", parse_gr_numbers("gr#188289"))
        self.assertIn("188289", parse_gr_numbers("gr-188289"))
        self.assertNotIn("-188289", parse_gr_numbers("gr-188289"))
        self.assertIn("188289", parse_gr_numbers("g.r 188289"))
        self.assertIn("188289", parse_gr_numbers("gr: 188289"))

        l_res = parse_gr_numbers("gr l 1892")
        self.assertIn("L-1892", l_res)
        self.assertIn("1892", l_res)

        self.assertIn("L-1892", parse_gr_numbers("l-1892"))
        self.assertIn("1892", parse_gr_numbers("l1892"))

        range_res = parse_gr_numbers("G.R. Nos. 94188-89")
        self.assertIn("94188", range_res)
        self.assertIn("94189", range_res)

        l_range = parse_gr_numbers("G.R. No. L-11319-20")
        self.assertIn("L-11319", l_range)
        self.assertIn("L-11320", l_range)
        self.assertIn("11319", l_range)
        self.assertIn("11320", l_range)

        self.assertTrue(any("1037" in d for d in parse_gr_numbers("A.M. No. 1037")))
        self.assertTrue(any("RTJ-93-978" in d.upper() for d in parse_gr_numbers("A.M. No. RTJ-93-978")))
        self.assertTrue(any("4585" in d for d in parse_gr_numbers("A.C. No. 4585")))
        self.assertTrue(any("850" in d for d in parse_gr_numbers("B.M. No. 850")))
        self.assertEqual(parse_gr_numbers("I am 25 years old"), [])

        self.assertIn("188289", parse_gr_numbers("188289"))
        self.assertIn("188289", parse_gr_numbers("case 188289"))
        self.assertIn("188289", parse_gr_numbers("docket 188289"))
        self.assertEqual(parse_gr_numbers("I owe him 50000 pesos"), [])
        self.assertEqual(parse_gr_numbers("He borrowed 150000 from me"), [])

    def test_unicode_case_parties_single_party_and_bilingual_jurisprudence_intent(self):
        self.assertEqual(extract_case_title_candidate("Cariño vs. Cariño"), "Cariño vs. Cariño")
        self.assertIn("Cariño", extract_case_parties("Cariño vs. Cariño"))
        self.assertIn("Osmeña", extract_case_parties("Osmeña vs. Rodriguez"))

        self.assertTrue(any(p.lower() == "tsoi" for p in extract_case_parties("chi ming tsoi case")))
        self.assertTrue(any("tan-andal" in p.lower() or "andal" in p.lower() for p in extract_case_parties("ruling in tan-andal")))
        self.assertTrue(any(p.lower() == "molina" for p in extract_case_parties("molina doctrine")))
        self.assertTrue(any(p.lower() == "noveras" for p in extract_case_parties("noveras case")))
        self.assertEqual(extract_case_parties("psychological incapacity case"), [])
        self.assertEqual(extract_case_parties("breach of contract case"), [])

        for q in (
            "mga kaso sa art 1191",
            "ano ang mga kaso sa art 1191",
            "ano ang mga hatol sa article 36",
            "desisyon sa art 1191",
            "doktrina sa article 36",
            "sc decisions applying 2176",
            "ruling in tan-andal",
            "chi ming tsoi case",
            "molina doctrine",
            "Cariño vs. Cariño",
        ):
            self.assertTrue(is_jurisprudence_query(q), f"Expected True for {q!r}")

        for q in (
            "anong kaso ang pwede ikaso sa akin",
            "ano ang kaso na pwede isampa sa kanya",
            "in case of breach of contract",
            "explain article 1191",
        ):
            self.assertFalse(is_jurisprudence_query(q), f"Expected False for {q!r}")


if __name__ == "__main__":
    unittest.main()
