#!/usr/bin/env python3
"""
Parser for The Family Code of the Philippines (Executive Order No. 209).
Transforms FAMILY-CODE-EO-209.txt into service-rag-python/data/family_code_rag.jsonl
following the exact schema of civil_code_rag.jsonl.
"""

import os
import re
import json
from typing import List, Dict, Any

ROMAN_TO_INT = {
    "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6,
    "VII": 7, "VIII": 8, "IX": 9, "X": 10, "XI": 11, "XII": 12
}

HUB_ARTICLES = {
    1, 2, 3, 4, 7, 26, 35, 36, 37, 38, 40, 41, 45, 55, 68,
    74, 75, 88, 91, 92, 105, 106, 147, 148, 150, 152, 153,
    164, 165, 172, 175, 176, 195, 211, 218, 219, 254, 256
}

TOPIC_MAP = {
    1: ["marriage", "marriage_requisites", "marriage_contract", "solemnization", "marriage_license", "void_marriages", "annulment", "presumptive_death", "psychological_incapacity"],
    2: ["legal_separation", "grounds_legal_separation", "cooling_off_period", "spousal_separation", "marital_disputes"],
    3: ["rights_and_obligations", "husband_and_wife", "mutual_fidelity", "mutual_respect", "family_domicile"],
    4: ["property_relations", "marriage_settlements", "absolute_community", "conjugal_partnership", "separation_of_property", "unions_without_marriage", "cohabitation"],
    5: ["the_family", "family_home", "family_institution", "family_relations", "family_suit_compromise"],
    6: ["paternity_and_filiation", "legitimate_children", "proof_of_filiation", "illegitimate_children", "legitimated_children"],
    7: ["adoption", "domestic_adoption", "adopter_qualifications", "child_welfare"],
    8: ["support", "support_between_spouses", "support_of_children", "obligation_to_support", "alimony"],
    9: ["parental_authority", "patria_potestas", "child_custody", "substitute_parental_authority", "special_parental_authority", "school_liability"],
    10: ["emancipation", "age_of_majority", "termination_parental_authority"],
    11: ["summary_judicial_proceedings", "summary_procedure", "separation_in_fact", "incidents_parental_authority"],
    12: ["final_provisions", "repealing_clause", "retroactivity", "effectivity", "vested_rights"]
}


def clean_article_text(raw_text: str) -> str:
    # Remove trailing historical source notes like (52a), (n), (142a), (2180(2)a and (4)a )
    cleaned = re.sub(r'\s*\((?:\d+[a-z]?|\b[nRa-z]+\b|\d+\([^\)]+\)[a-z]?|[0-9a-zA-Z\s,\.\(\)]+)\)\s*$', '', raw_text.strip(), flags=re.MULTILINE)
    # Normalize multiple newlines and spaces
    cleaned = re.sub(r'[ \t]+', ' ', cleaned)
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
    return cleaned.strip()


def extract_cross_references(text: str) -> List[str]:
    # Match Article/Articles numbers
    matches = re.findall(r'\b(?:Art(?:icle)?s?\.?|Articles?)\s*([0-9]+(?:\s*(?:,|and|to)\s*[0-9]+)*)', text, re.IGNORECASE)
    cites = []
    for m in matches:
        nums = re.findall(r'\b\d+\b', m)
        for n in nums:
            val = int(n)
            if 1 <= val <= 257:
                ref_id = f"EO209-ART{val}"
                if ref_id not in cites:
                    cites.append(ref_id)
            elif 1 <= val <= 2270:
                # Potential civil code cite
                ref_id = f"RA386-ART{val}"
                if ref_id not in cites:
                    cites.append(ref_id)
    return cites


def chunk_article(article_id: str, art_num: int, path_prefix: str, text: str) -> List[Dict[str, Any]]:
    # Split very long articles into paragraphs if exceeding 1200 characters
    if len(text) <= 1200:
        return [{
            "chunk_id": f"{article_id}_c0",
            "text": f"Art. {art_num} ({path_prefix}): {text}",
            "chunk_type": "full"
        }]

    # Paragraph-based chunking
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if len(paragraphs) <= 1:
        # Try single newline splits
        paragraphs = [p.strip() for p in text.split("\n") if p.strip()]

    chunks = []
    current_chunk = []
    current_len = 0
    c_idx = 0

    for p in paragraphs:
        if current_len + len(p) > 900 and current_chunk:
            combined = "\n\n".join(current_chunk)
            chunks.append({
                "chunk_id": f"{article_id}_c{c_idx}",
                "text": f"Art. {art_num} ({path_prefix}): {combined}",
                "chunk_type": "passage"
            })
            c_idx += 1
            current_chunk = [p]
            current_len = len(p)
        else:
            current_chunk.append(p)
            current_len += len(p)

    if current_chunk:
        combined = "\n\n".join(current_chunk)
        chunks.append({
            "chunk_id": f"{article_id}_c{c_idx}",
            "text": f"Art. {art_num} ({path_prefix}): {combined}",
            "chunk_type": "passage"
        })

    return chunks


def parse_family_code(source_file: str, output_file: str):
    print(f"Reading Family Code text from {source_file}...")
    with open(source_file, "r", encoding="utf-8") as f:
        lines = f.readlines()

    # Pre-parse structure
    # State tracking
    current_title_num = None
    current_title_name = None
    current_chapter_num = None
    current_chapter_name = None
    current_section_num = None
    current_section_name = None

    articles_data = []

    i = 0
    total_lines = len(lines)

    current_article_num = None
    current_article_lines = []

    def save_current_article():
        nonlocal current_article_num, current_article_lines
        if current_article_num is None or not current_article_lines:
            return

        raw_text = "".join(current_article_lines).strip()
        # Clean leading 'Art. X. ' or 'Article X. '
        m = re.match(r'^(?:Art(?:icle)?\.\s*|Article\s+)\d+\.?\s*(.*)$', raw_text, re.DOTALL | re.IGNORECASE)
        body_text = m.group(1).strip() if m else raw_text
        text_clean = clean_article_text(body_text)

        art_id = f"EO209-ART{current_article_num}"

        # Build path
        path_parts = []
        if current_title_name:
            path_parts.append(current_title_name)
        if current_chapter_name:
            path_parts.append(current_chapter_name)
        if current_section_name:
            path_parts.append(current_section_name)
        path_parts.append(f"Art. {current_article_num}")
        path_str = " > ".join(path_parts)

        prefix_str = f"{current_title_name or ''}, {current_chapter_name or current_title_name or ''}".strip(", ")

        # Legal topics
        topics = list(TOPIC_MAP.get(current_title_num, ["family_law", "family_code"]))
        if current_article_num in (41, 42, 43, 44):
            topics.extend(["presumptive_death", "remarriage", "absence", "subsequent_marriage"])
        if current_article_num in (35, 36, 37, 38, 40):
            topics.extend(["void_marriages", "nullity_of_marriage", "psychological_incapacity"])
        if current_article_num in (147, 148):
            topics.extend(["common_law_spouses", "cohabitation", "unions_without_marriage"])

        topics = list(dict.fromkeys(topics))

        # Keywords
        kw = ["family_code", "executive_order_209", f"article_{current_article_num}"]
        if current_title_name:
            kw.extend([w.lower() for w in re.findall(r'\b[A-Za-z]{4,}\b', current_title_name)])
        if current_chapter_name:
            kw.extend([w.lower() for w in re.findall(r'\b[A-Za-z]{4,}\b', current_chapter_name)])
        kw = list(dict.fromkeys(kw))[:15]

        # Cross references
        cites = extract_cross_references(raw_text)

        chunks = chunk_article(art_id, current_article_num, prefix_str, text_clean)

        record = {
            "article_id": art_id,
            "article_number": current_article_num,
            "law_title": "Executive Order No. 209, s. 1987",
            "act_name": "The Family Code of the Philippines",
            "hierarchy": {
                "book": 1,
                "book_name": "THE FAMILY CODE OF THE PHILIPPINES (EXECUTIVE ORDER NO. 209)",
                "title": current_title_num,
                "title_name": current_title_name,
                "chapter": current_chapter_num,
                "chapter_name": current_chapter_name,
                "section": current_section_num,
                "section_name": current_section_name
            },
            "path": path_str,
            "text": body_text,
            "text_clean": text_clean,
            "legal_topics": topics,
            "keywords": kw,
            "cross_references": {
                "cites": cites,
                "cited_by": []
            },
            "jurisprudence_linkage": {
                "total_citations": 0,
                "cases": []
            },
            "is_hub": current_article_num in HUB_ARTICLES,
            "chunks": chunks,
            "source_url": "https://www.officialgazette.gov.ph/1987/07/06/executive-order-no-209-s-1987/"
        }
        articles_data.append(record)
        current_article_lines = []

    while i < total_lines:
        line = lines[i]
        line_s = line.strip()

        # Check TITLE
        m_title = re.match(r'^TITLE\s+([IVXLCDM]+)\b', line_s)
        if m_title:
            save_current_article()
            current_article_num = None
            current_title_num = ROMAN_TO_INT.get(m_title.group(1))
            # Next line or two might be the title name
            current_title_name = line_s
            j = i + 1
            while j < total_lines and not lines[j].strip():
                j += 1
            if j < total_lines:
                cand = lines[j].strip()
                if cand and not re.match(r'^(?:Chapter|Section|Art|TITLE)', cand):
                    current_title_name = f"{line_s} - {cand}"
                    i = j
            current_chapter_num = None
            current_chapter_name = None
            current_section_num = None
            current_section_name = None
            i += 1
            continue

        # Check Chapter
        m_chap = re.match(r'^Chapter\s+(\d+)\.?(.*)', line_s)
        if m_chap:
            save_current_article()
            current_article_num = None
            current_chapter_num = int(m_chap.group(1))
            chap_title = m_chap.group(2).strip(" .:-")
            current_chapter_name = f"Chapter {current_chapter_num}" + (f" - {chap_title}" if chap_title else "")
            current_section_num = None
            current_section_name = None
            i += 1
            continue

        # Check Section
        m_sec = re.match(r'^Section\s+(\d+)\.?(.*)', line_s)
        if m_sec:
            save_current_article()
            current_article_num = None
            current_section_num = int(m_sec.group(1))
            sec_title = m_sec.group(2).strip(" .:-")
            current_section_name = f"Section {current_section_num}" + (f" - {sec_title}" if sec_title else "")
            i += 1
            continue

        # Check Article start
        m_art = re.match(r'^(?:Art(?:icle)?\.\s*|Article\s+)(\d+)\.\s*(.*)', line_s)
        if m_art:
            save_current_article()
            current_article_num = int(m_art.group(1))
            current_article_lines = [line]
            i += 1
            continue

        # Check for signatures or end of code after Art. 257
        if current_article_num == 257 and re.match(r'^(?:Done in the City|President of the Philippines|\(Sgd\.\)|By the President)', line_s):
            save_current_article()
            current_article_num = None
            break

        if current_article_num is not None:
            current_article_lines.append(line)

        i += 1

    # Save last article if any
    save_current_article()

    print(f"Parsed {len(articles_data)} articles from {source_file}!")

    # Sort strictly by article number
    articles_data.sort(key=lambda x: x["article_number"])

    # Verification of completeness
    parsed_nums = [a["article_number"] for a in articles_data]
    missing = [n for n in range(1, 258) if n not in parsed_nums]
    if missing:
        print(f"WARNING: Missing articles: {missing}")
    else:
        print("SUCCESS: Articles 1 through 257 are 100% complete and sequential!")

    overview_records = [
        {
            "article_id": "EO209-GENERAL-INFO",
            "article_number": 0,
            "law_title": "Executive Order No. 209, s. 1987",
            "act_name": "The Family Code of the Philippines",
            "hierarchy": {
                "book": 1,
                "book_name": "THE FAMILY CODE OF THE PHILIPPINES (EXECUTIVE ORDER NO. 209)",
                "title": 0,
                "title_name": "GENERAL OVERVIEW & FOUNDATIONAL PRINCIPLES",
                "chapter": 1,
                "chapter_name": "NATURE, ENACTMENT, EFFECTIVITY AND SCOPE",
                "section": None,
                "section_name": None
            },
            "path": "THE FAMILY CODE > GENERAL OVERVIEW > NATURE, ENACTMENT, EFFECTIVITY AND SCOPE",
            "text": "Executive Order No. 209, s. 1987, officially titled \"The Family Code of the Philippines,\" was promulgated on July 6, 1987 by President Corazon C. Aquino and took effect on August 3, 1988, one year after publication in the Official Gazette. The Family Code comprehensively modernized Philippine family law, directly amending and replacing Book I (Persons and Family Relations) of Republic Act No. 386 (the Civil Code of the Philippines), specifically superseding Articles 52 through 353 and Articles 356 through 363. The Family Code governs the essential and formal requisites of marriage, legal separation, rights and obligations between husband and wife, property relations (instituting Absolute Community of Property as the default property regime for marriages celebrated on or after August 3, 1988), the family as an inviolable social institution, the family home, paternity and filiation, adoption, support, parental authority, and summary judicial proceedings.",
            "text_clean": "Executive Order No. 209, s. 1987, officially titled \"The Family Code of the Philippines,\" was promulgated on July 6, 1987 by President Corazon C. Aquino and took effect on August 3, 1988, one year after publication in the Official Gazette. The Family Code comprehensively modernized Philippine family law, directly amending and replacing Book I (Persons and Family Relations) of Republic Act No. 386 (the Civil Code of the Philippines), specifically superseding Articles 52 through 353 and Articles 356 through 363. The Family Code governs the essential and formal requisites of marriage, legal separation, rights and obligations between husband and wife, property relations (instituting Absolute Community of Property as the default property regime for marriages celebrated on or after August 3, 1988), the family as an inviolable social institution, the family home, paternity and filiation, adoption, support, parental authority, and summary judicial proceedings.",
            "legal_topics": ["family_code_overview", "executive_order_209", "enactment", "effectivity", "civil_code_amendment", "repealing_clause"],
            "keywords": ["family_code", "executive_order_209", "eo_209", "corazon_aquino", "august_3_1988", "july_6_1987", "book_i_civil_code", "overview"],
            "cross_references": {"cites": ["EO209-ART1", "EO209-ART254", "EO209-ART256"], "cited_by": []},
            "jurisprudence_linkage": {"total_citations": 0, "cases": []},
            "is_hub": True,
            "chunks": [{
                "chunk_id": "EO209-GENERAL-INFO_c0",
                "text": "General Information on The Family Code of the Philippines (Executive Order No. 209): Signed by President Corazon C. Aquino on July 6, 1987, and effective August 3, 1988, the Family Code modernized Philippine family relations law, replacing Articles 52-353 and 356-363 of Book I of the Civil Code (RA 386). It governs marriage requisites, nullity, property relations, family home, filiation, adoption, support, and parental authority.",
                "chunk_type": "full"
            }],
            "source_url": "https://www.officialgazette.gov.ph/1987/07/06/executive-order-no-209-s-1987/"
        },
        {
            "article_id": "EO209-STRUCTURE-AND-ARTICLES",
            "article_number": 0,
            "law_title": "Executive Order No. 209, s. 1987",
            "act_name": "The Family Code of the Philippines",
            "hierarchy": {
                "book": 1,
                "book_name": "THE FAMILY CODE OF THE PHILIPPINES (EXECUTIVE ORDER NO. 209)",
                "title": 0,
                "title_name": "CODIFIED STRUCTURE AND TOTAL ARTICLES",
                "chapter": 2,
                "chapter_name": "CODAL BREAKDOWN: 257 ARTICLES ACROSS 12 TITLES",
                "section": None,
                "section_name": None
            },
            "path": "THE FAMILY CODE > CODIFIED STRUCTURE > CODAL BREAKDOWN: 257 ARTICLES ACROSS 12 TITLES",
            "text": "Total Articles and Codified Structure of The Family Code of the Philippines (Executive Order No. 209): The Family Code contains exactly 257 articles (Article 1 to Article 257), organized into twelve (12) statutory Titles: (1) Title I - Marriage (Articles 1-54: requisites, solemnization, void and voidable marriages, psychological incapacity Art. 36, presumptive death Art. 41); (2) Title II - Legal Separation (Articles 55-67); (3) Title III - Rights and Obligations Between Husband and Wife (Articles 68-73); (4) Title IV - Property Relations Between Husband and Wife (Articles 74-148: Absolute Community, Conjugal Partnership of Gains, cohabitation unions Arts. 147-148); (5) Title V - The Family (Articles 149-162: family home Arts. 152-162); (6) Title VI - Paternity and Filiation (Articles 163-182: legitimate and illegitimate children); (7) Title VII - Adoption (Articles 183-193); (8) Title VIII - Support (Articles 194-208); (9) Title IX - Parental Authority (Articles 209-233); (10) Title X - Emancipation and Age of Majority (Articles 234-237, amended by RA 6809); (11) Title XI - Summary Judicial Proceedings in the Family Law (Articles 238-253); (12) Title XII - Final Provisions (Articles 254-257). Total articles: 257.",
            "text_clean": "Total Articles and Codified Structure of The Family Code of the Philippines (Executive Order No. 209): The Family Code contains exactly 257 articles (Article 1 to Article 257), organized into twelve (12) statutory Titles: (1) Title I - Marriage (Articles 1-54: requisites, solemnization, void and voidable marriages, psychological incapacity Art. 36, presumptive death Art. 41); (2) Title II - Legal Separation (Articles 55-67); (3) Title III - Rights and Obligations Between Husband and Wife (Articles 68-73); (4) Title IV - Property Relations Between Husband and Wife (Articles 74-148: Absolute Community, Conjugal Partnership of Gains, cohabitation unions Arts. 147-148); (5) Title V - The Family (Articles 149-162: family home Arts. 152-162); (6) Title VI - Paternity and Filiation (Articles 163-182: legitimate and illegitimate children); (7) Title VII - Adoption (Articles 183-193); (8) Title VIII - Support (Articles 194-208); (9) Title IX - Parental Authority (Articles 209-233); (10) Title X - Emancipation and Age of Majority (Articles 234-237, amended by RA 6809); (11) Title XI - Summary Judicial Proceedings in the Family Law (Articles 238-253); (12) Title XII - Final Provisions (Articles 254-257). Total articles: 257.",
            "legal_topics": ["family_code_structure", "total_articles", "article_count", "family_code_titles", "codal_breakdown"],
            "keywords": ["family_code", "257_articles", "total_articles", "structure", "twelve_titles", "marriage", "legal_separation", "property_relations", "filiation", "support", "parental_authority"],
            "cross_references": {"cites": ["EO209-ART1", "EO209-ART257"], "cited_by": []},
            "jurisprudence_linkage": {"total_citations": 0, "cases": []},
            "is_hub": True,
            "chunks": [{
                "chunk_id": "EO209-STRUCTURE-AND-ARTICLES_c0",
                "text": "Total Articles and Codified Structure of The Family Code of the Philippines (Executive Order No. 209): The Family Code consists of exactly 257 articles arranged into 12 Titles: Title I (Marriage, Arts. 1-54), Title II (Legal Separation, Arts. 55-67), Title III (Husband & Wife Obligations, Arts. 68-73), Title IV (Property Relations, Arts. 74-148), Title V (The Family & Family Home, Arts. 149-162), Title VI (Filiation, Arts. 163-182), Title VII (Adoption, Arts. 183-193), Title VIII (Support, Arts. 194-208), Title IX (Parental Authority, Arts. 209-233), Title X (Emancipation, Arts. 234-237), Title XI (Summary Proceedings, Arts. 238-253), Title XII (Final Provisions, Arts. 254-257). Total articles: 257.",
                "chunk_type": "full"
            }],
            "source_url": "https://www.officialgazette.gov.ph/1987/07/06/executive-order-no-209-s-1987/"
        },
        {
            "article_id": "EO209-PREAMBLE-AND-ENACTMENT",
            "article_number": 0,
            "law_title": "Executive Order No. 209, s. 1987",
            "act_name": "The Family Code of the Philippines",
            "hierarchy": {
                "book": 1,
                "book_name": "THE FAMILY CODE OF THE PHILIPPINES (EXECUTIVE ORDER NO. 209)",
                "title": 0,
                "title_name": "PREAMBLE AND PRESIDENTIAL ENACTMENT",
                "chapter": 3,
                "chapter_name": "EXECUTIVE ORDER NO. 209 PROMULGATION TEXT",
                "section": None,
                "section_name": None
            },
            "path": "THE FAMILY CODE > PREAMBLE AND PRESIDENTIAL ENACTMENT > EXECUTIVE ORDER NO. 209 PROMULGATION TEXT",
            "text": "Official Gazette of the Republic of the Philippines. Executive Order No. 209, s. 1987. Signed on July 6, 1987. Malacañang, Manila. By the President of the Philippines. EXECUTIVE ORDER NO. 209: THE FAMILY CODE OF THE PHILIPPINES. \"I, CORAZON C. AQUINO, President of the Philippines, by virtue of the powers vested in me by the Constitution, do hereby order and promulgate the Family Code of the Philippines, as follows: Title I - Marriage...\"",
            "text_clean": "Official Gazette of the Republic of the Philippines. Executive Order No. 209, s. 1987. Signed on July 6, 1987. Malacañang, Manila. By the President of the Philippines. EXECUTIVE ORDER NO. 209: THE FAMILY CODE OF THE PHILIPPINES. \"I, CORAZON C. AQUINO, President of the Philippines, by virtue of the powers vested in me by the Constitution, do hereby order and promulgate the Family Code of the Philippines, as follows: Title I - Marriage...\"",
            "legal_topics": ["preamble", "enactment", "official_gazette", "promulgation"],
            "keywords": ["preamble", "official_gazette", "corazon_aquino", "malacanang", "executive_order_209"],
            "cross_references": {"cites": ["EO209-ART1"], "cited_by": []},
            "jurisprudence_linkage": {"total_citations": 0, "cases": []},
            "is_hub": True,
            "chunks": [{
                "chunk_id": "EO209-PREAMBLE-AND-ENACTMENT_c0",
                "text": "Executive Order No. 209 Preamble and Enactment: Promulgated on July 6, 1987 by President Corazon C. Aquino under the Constitution as The Family Code of the Philippines, establishing the modern codified family law system of the Republic of the Philippines.",
                "chunk_type": "full"
            }],
            "source_url": "https://www.officialgazette.gov.ph/1987/07/06/executive-order-no-209-s-1987/"
        }
    ]
    all_records = overview_records + articles_data

    # Ensure output directory exists
    os.makedirs(os.path.dirname(os.path.abspath(output_file)), exist_ok=True)

    print(f"Writing {len(all_records)} records to {output_file}...")
    with open(output_file, "w", encoding="utf-8") as out_f:
        for item in all_records:
            out_f.write(json.dumps(item, ensure_ascii=False) + "\n")

    print(f"File created successfully: {output_file}")


if __name__ == "__main__":
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src = os.path.join(base_dir, "FAMILY-CODE-EO-209.txt")
    dst = os.path.join(base_dir, "service-rag-python", "data", "family_code_rag.jsonl")
    parse_family_code(src, dst)
