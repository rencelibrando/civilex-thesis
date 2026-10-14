import re
from typing import List, Optional

# Dispute keywords indicating an active dispute/litigation rather than a statutory inquiry
DISPUTE_PATTERNS = [
    r'\b(?:sue|suing|lawsuit|complaint|breached|breach|refused|demanded|damage|damages|accident|negligence|injury|injured|death|killed|hospital|debt|borrowed|loaned|foreclosure|ejectment|unlawful\s+detainer)\b',
    r'\b(?:kaso|ikaso|kakaso|idemanda|nagsampa|sinuntok|binugbog|nabangga|nasaktan|pinsala|danyos|utang|ayaw\s+magbayad|hindi\s+nagbayad|pinalayas|aksidente|pagkamatay)\b',
    r'\b(?:contractor|subcontractor|developer|tenant|landlord|employer|employee|buyer|seller|plaintiff|defendant)\b'
]

# Currency and date patterns to avoid misinterpreting amounts/years as bare article numbers
CURRENCY_OR_DATE_PATTERN = re.compile(
    r'(?:php|₱|peso|pesos|dollars?|\$|\bk\b|year|taon|months?|buwan|days?|araw|\b19\d\d\b|\b20\d\d\b)',
    re.IGNORECASE
)

# Prefix pattern matching article declarations in English and Tagalog, including abbreviations and typos (e.g. articl, artcle, atricle, artiklo)
ARTICLE_PREFIX_PATTERN = re.compile(
    r'(?:\bmga\s+)?(?:\b(?:art[a-z]*|atr[a-z]*)\.?|\bcivil\s+code(?:\s+articles?)?|\bra\s*386(?:\s+articles?)?)\s*(?:(?:no|nos|bilang)\b\.?)?\s*',
    re.IGNORECASE
)

# Chained delimiter pattern separating enumerated/compared article numbers
ARTICLE_SEP_PATTERN = re.compile(
    r'^\s*(?:,\s*(?:and\s+|at\s+|saka\s+|&\s*)?|'
    r'(?:and|&|at|saka|vs\.?|versus|laban\s+sa|to|\/|-)\s*|'
    r',\s*)'
    r'(?:(?:\bmga\s+)?(?:\b(?:art[a-z]*|atr[a-z]*)\.?|\bcivil\s+code|\bra\s*386)\s*(?:(?:no|nos|bilang)\b\.?)?\s*)?'
    r'(\d+)',
    re.IGNORECASE
)


EXTERNAL_STATUTE_MENTION_PATTERN = re.compile(
    r'\b(?:revised\s+penal\s+code|rpc|penal\s+code|labor\s+code|pd\s*442|p\.d\.\s*442|tax\s+code|national\s+internal\s+revenue\s+code|nirc|corporation\s+code|ra\s*11232|data\s+privacy\s+act|ra\s*10173)\b',
    re.IGNORECASE
)
CIVIL_CODE_MENTION_PATTERN = re.compile(
    r'\b(?:civil\s+code|ra\s*386|family\s+code|eo\s*209)\b',
    re.IGNORECASE
)


def parse_all_article_candidates(query: str) -> List[str]:
    # Extracts all article numbers referenced in query without 2270 bound limit
    if not query:
        return []

    # If query explicitly targets an external statute without Civil Code reference, skip
    if EXTERNAL_STATUTE_MENTION_PATTERN.search(query) and not CIVIL_CODE_MENTION_PATTERN.search(query):
        return []

    results: List[str] = []

    # 1. Primary search: Triggered by explicit article/codal prefixes
    for match in ARTICLE_PREFIX_PATTERN.finditer(query):
        start_idx = match.end()
        sub_text = query[start_idx:]
        num_match = re.match(r'^(\d+)', sub_text)
        if not num_match:
            continue
        first_num = num_match.group(1)
        results.append(first_num)
        curr_pos = num_match.end()

        # Follow delimiter chains (commas, 'and', 'at', 'vs', etc.)
        while curr_pos < len(sub_text):
            next_m = ARTICLE_SEP_PATTERN.match(sub_text[curr_pos:])
            if not next_m:
                break
            results.append(next_m.group(1))
            curr_pos += next_m.end()

    # 2. Fallback: Bare enumeration or comparison without repeating article prefix
    if not results and not CURRENCY_OR_DATE_PATTERN.search(query):
        bare_chain = re.search(
            r'\b(\d{1,4})\s*(?:,\s*(?:and\s+|at\s+|saka\s+|&\s*)?|(?:and|&|at|saka|vs\.?|versus)\s*|,\s*)(\d{1,4})\b',
            query,
            re.IGNORECASE
        )
        if bare_chain:
            n1, n2 = bare_chain.group(1), bare_chain.group(2)
            results.extend([n1, n2])
            curr_pos = bare_chain.end()
            while curr_pos < len(query):
                next_m = ARTICLE_SEP_PATTERN.match(query[curr_pos:])
                if not next_m:
                    break
                results.append(next_m.group(1))
                curr_pos += next_m.end()

    deduped: List[str] = []
    seen = set()
    for n in results:
        if n not in seen and 1 <= int(n):
            seen.add(n)
            deduped.append(n)

    return deduped


def parse_article_numbers(query: str) -> List[str]:
    # Returns valid Philippine Civil Code article numbers (1 to 2270)
    candidates = parse_all_article_candidates(query)
    return [n for n in candidates if 1 <= int(n) <= 2270]


def get_out_of_bounds_articles(query: str) -> List[str]:
    # Returns referenced article numbers that exceed 2270 (non-existent in Civil Code)
    candidates = parse_all_article_candidates(query)
    return [n for n in candidates if int(n) > 2270]


def is_dispute_query(query: str) -> bool:
    """
    Checks whether a query describes an active lawsuit, claim, injury, breach,
    or dispute rather than a conceptual or statutory inquiry.
    """
    if not query:
        return False
    q_lower = query.lower()
    return any(bool(re.search(p, q_lower)) for p in DISPUTE_PATTERNS)


def is_matching_article_id(pid: str, target_art_num: str) -> bool:
    """
    Checks if a parent_id (e.g. 'RA386-ART77' or 'RA386-ART77_c0') exactly matches 
    target_art_num ('77') without false substring collisions like 'RA386-ART778'.
    """
    if not pid or not target_art_num:
        return False
    m = re.search(r'ART(\d+)', pid)
    return bool(m and m.group(1) == str(target_art_num))


COMPOUND_INTENT_PATTERNS = [
    r'\b(?:and\s+also|can\s+you\s+(?:also\s+)?tell|tell\s+me\s+also|what\s+about|as\s+well\s+as|along\s+with|plus|additionally|in\s+addition|secondly|furthermore|moreover)\b',
    r'\b(?:at\s+saka|pati\s+na\s+rin|pwede\s+mo\s+rin\s+bang|sabihin\s+mo\s+rin|ano\s+naman\s+ang|paano\s+naman|bukod\s+dito|pakisabi\s+din|pakipaliwanag\s+din)\b',
    r'\b(?:give\s+(?:an?\s+)?example|magbigay\s+ng\s+halimbawa|sample\s+scenario|practical\s+application|how\s+does\s+it\s+apply|real[- ]life|halimbawa)\b',
    r'\b(?:total\s+articles?|how\s+many\s+articles?|ilan\s+ang\s+(?:total\s+)?(?:articles?|artikulo)|bilang\s+ng\s+artikulo|structure\s+of|mga\s+libro|books?\s+of)\b',
    r'\b(?:and|at)\s+(?:what|how|why|who|where|when|can|is|are|ano|paano|bakit|sino|nasaan|kailan|pwede|maaari)\b'
]


def is_compound_or_multi_intent_query(query: str) -> bool:
    """
    Detects if a query contains compound questions, multi-part intent,
    requests for examples, or combined statutory/structural inquiries.
    """
    if not query:
        return False
    q_lower = query.lower()
    if query.count('?') >= 2:
        return True
    return any(bool(re.search(p, q_lower)) for p in COMPOUND_INTENT_PATTERNS)


JURISPRUDENCE_PATTERNS = [
    r'(?:jurisprudence|jurisprudensya|\bscra\b|g\.?\s*r\.?\s*(?:no\.?|nos\.?)?\s*\d+)',
    r'\b(?:supreme\s+court|korte\s+suprema)\b',
    r'\b(?:landmark\s+cases?|court\s+cases?|related\s+cases?|relevant\s+cases?|cited\s+cases?|court\s+rulings?|court\s+decisions?|judicial\s+precedents?|legal\s+precedents?)\b',
    r'\b(?:mga\s+kaso\s+sa\s+korte(?:\s+suprema)?|desisyon\s+ng\s+korte(?:\s+suprema)?|hatol\s+ng\s+korte(?:\s+suprema)?|doktrina\s+ng\s+korte(?:\s+suprema)?)\b',
    r'\b(?:cases?\s+(?:on|about|interpreting|under|for|involving)|doctrines?\s+(?:on|about|under|of))\b',
]

EXCLUDE_CHARGE_PATTERNS = [
    r'\b(?:maging\s+kaso|kaso\s+ko|kaso\s+sa\s+akin|ikaso\s+(?:sa|ko)|anong\s+kaso|ano\s+ang\s+(?:mga\s+)?kaso|isampang\s+kaso|cases?\s+against\s+me|cases?\s+(?:can\s+be\s+)?filed|what\s+cases?\s+(?:can|could|will))\b',
    r'\b(?:in\s+case|in\s+cases?\s+of)\b',
]


def is_jurisprudence_query(query: str) -> bool:
    """
    Checks whether the query explicitly inquires about jurisprudence, Supreme Court
    decisions, case doctrines, rulings, or related cases interpreting the Civil Code.
    Excludes phrases referring to filing charges, causes of action, or conditional cases.
    """
    if not query:
        return False
    q_lower = query.lower()
    if any(re.search(p, q_lower) for p in EXCLUDE_CHARGE_PATTERNS) and not any(
        re.search(p, q_lower) for p in [r'\bsupreme\s+court\b', r'\bkorte\s+suprema\b', r'jurisprudenc', r'jurisprudens']
    ):
        return False
    return any(bool(re.search(p, q_lower)) for p in JURISPRUDENCE_PATTERNS)


FAMILY_CODE_PATTERNS = [
    r'\b(?:family\s+code|executive\s+order\s+(?:no\.?\s*)?209|eo\s*209|e\.o\.\s*209|f\.c\.|fc)\b',
    r'\b(?:marriage|marital|remarriage|annulment|nullity\s+of\s+marriage|presumptive\s+death|psychological\s+incapacity|legal\s+separation|family\s+home|conjugal\s+partnership|absolute\s+community|filiation|paternity|parental\s+authority|adoption|spousal\s+support)\b'
]


def detect_statute_mention(query: str) -> Optional[str]:
    if not query:
        return None
    q_lower = query.lower()
    has_fc = any(re.search(p, q_lower) for p in [r'\b(?:family\s+code|executive\s+order\s+(?:no\.?\s*)?209|eo\s*209|e\.o\.\s*209|f\.c\.|fc)\b'])
    has_cc = any(re.search(p, q_lower) for p in [r'\b(?:civil\s+code|republic\s+act\s+(?:no\.?\s*)?386|ra\s*386|r\.a\.\s*386|c\.c\.|cc)\b'])
    if has_fc and not has_cc:
        return "FC"
    if has_cc and not has_fc:
        return "CC"
    return None


def resolve_candidate_article_ids(query: str, art_nums: List[str]) -> List[str]:
    statute = detect_statute_mention(query)
    target_ids = []
    for n in art_nums:
        val = int(n)
        if statute == "FC":
            if 1 <= val <= 257:
                target_ids.append(f"EO209-ART{val}")
        elif statute == "CC":
            if 1 <= val <= 2270:
                target_ids.append(f"RA386-ART{val}")
        else:
            q_lower = query.lower() if query else ""
            has_fc_context = any(re.search(p, q_lower) for p in FAMILY_CODE_PATTERNS)
            if has_fc_context and 1 <= val <= 257:
                target_ids.append(f"EO209-ART{val}")
            if 1 <= val <= 2270:
                target_ids.append(f"RA386-ART{val}")
            if not has_fc_context and 1 <= val <= 257:
                target_ids.append(f"EO209-ART{val}")
    return target_ids




