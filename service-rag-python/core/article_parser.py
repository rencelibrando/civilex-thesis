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


# General Register (G.R.) docket number pattern matching SC docket variations
GR_PATTERN = re.compile(
    r'(?:\bGR\b|\bG\s*\.\s*R\s*\.?)\s*(?:(?:Nos?|No|Number)\b\.?)?\s*([A-Za-z]?\s*[-–]?\s*\d+(?:[-–]\d+)?)',
    re.IGNORECASE
)

# Case title party pattern matching 'Party A vs. Party B'
CASE_VS_PATTERN = re.compile(
    r'\b([A-Z][a-zA-Z\s\.,\'-]+?)\s+(?:v\.?|vs\.?|versus|contra|laban\s+sa)\s+([A-Z][a-zA-Z\s\.,\'-]+)',
    re.IGNORECASE
)

CASE_TITLE_STOPWORDS = frozenset({
    'what', 'whats', 'why', 'whys', 'how', 'was', 'the', 'ruling', 'in', 'case', 'doctrine', 'of',
    'and', 'for', 'about', 'court', 'appeals', 'ca', 'republic', 'philippines', 'supreme', 'decision',
    'decision_date', 'ano', 'ang', 'hatol', 'korte', 'suprema', 'desisyon', 'ukol', 'sa', 'mga',
    'tell', 'me', 'summarize', 'summary', 'explain', 'held', 'hold', 'decided', 'can', 'cant', 'cannot',
    'could', 'would', 'search', 'searching', 'find', 'finding', 'look', 'lookup', 'though', 'through',
    'name', 'names', 'give', 'show', 'ask', 'asking', 'details', 'info', 'information', 'now', 'please',
    'paki', 'pakisabi', 'pakipaliwanag', 'anong', 'bakit', 'paano', 'kaso', 'ng', 'tungkol', 'titled',
    'versus', 'vs', 'contra', 'laban', 'regarding', 'concerning'
})

CONVERSATIONAL_PREFIX_PATTERN = re.compile(
    r'^(?:.*?\b(?:case\s+(?:of|titled|named|involving)|ruling\s+(?:in|of)|doctrine\s+(?:in|of|under)|decision\s+(?:in|of)|search\s+(?:for|through|though|the|name)?|whats?\s+(?:the)?|why\s+(?:is|it|cant|can\'t)?|tell\s+me\s+about|explain|give\s+me|hatol\s+sa|desisyon\s+sa|kaso\s+ng?|ano\s+ang|tungkol\s+sa)\s+)+',
    re.IGNORECASE
)


def parse_gr_numbers(text: str) -> List[str]:
    # Extracts clean G.R. docket numbers avoiding false matches and handling keyboard typos
    if not text:
        return []
    matches = GR_PATTERN.findall(text)
    clean_nums = []
    seen = set()
    for m in matches:
        cleaned = re.sub(r'\s+', '', m).strip()
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            clean_nums.append(cleaned)
            alt_zero = re.sub(r'[Oo]$', '0', cleaned)
            if alt_zero != cleaned and alt_zero not in seen:
                seen.add(alt_zero)
                clean_nums.append(alt_zero)
    extended_matches = re.findall(r'(?:\bGR\b|\bG\s*\.\s*R\s*\.?)\s*(?:(?:Nos?|No|Number)\b\.?)?\s*([A-Za-z]?\s*[-–]?\s*\d+[Oo])\b', text, re.IGNORECASE)
    for em in extended_matches:
        cleaned = re.sub(r'\s+', '', em).strip()
        as_zero = re.sub(r'[Oo]$', '0', cleaned)
        if as_zero not in seen:
            seen.add(as_zero)
            clean_nums.append(as_zero)
        stripped_l = re.sub(r'^[A-Za-z][-–]?', '', as_zero)
        if stripped_l and stripped_l not in seen:
            seen.add(stripped_l)
            clean_nums.append(stripped_l)
    return clean_nums


def extract_case_title_candidate(text: str) -> Optional[str]:
    # Extracts and cleans candidate case title like 'Party A vs. Party B' from conversational queries
    if not text:
        return None
    m = CASE_VS_PATTERN.search(text)
    if not m:
        return None
    side1 = m.group(1).strip()
    side2 = m.group(2).strip()
    side1_cleaned = CONVERSATIONAL_PREFIX_PATTERN.sub('', side1).strip()
    if not side1_cleaned:
        side1_cleaned = side1
    side2_cleaned = re.split(r'[\?\n;]', side2)[0].strip()
    if not side1_cleaned or not side2_cleaned:
        return None
    return f"{side1_cleaned} vs. {side2_cleaned}"


def extract_case_parties(text: str) -> List[str]:
    # Extracts significant party search terms from title patterns
    if not text:
        return []
    cand = extract_case_title_candidate(text)
    m = CASE_VS_PATTERN.search(cand) if cand else CASE_VS_PATTERN.search(text)
    if not m:
        return []
    terms = []
    for side in (m.group(1), m.group(2)):
        words = [w for w in re.split(r'\W+', side) if len(w) > 2 and w.lower() not in CASE_TITLE_STOPWORDS]
        if words:
            terms.extend(words[:2])
    return terms[:4]


JURISPRUDENCE_PATTERNS = [
    r'(?:jurisprudence|jurisprudensya|\bscra\b|(?:\bgr\b|\bg\s*\.\s*r\s*\.?)\s*(?:(?:nos?|no|number)\b\.?)?\s*[a-z]?\s*[-–]?\s*\d+)',
    r'\b(?:supreme\s+court|korte\s+suprema)\b',
    r'\b(?:landmark\s+cases?|court\s+cases?|related\s+cases?|relevant\s+cases?|cited\s+cases?|court\s+rulings?|court\s+decisions?|judicial\s+precedents?|legal\s+precedents?)\b',
    r'\b(?:mga\s+kaso\s+sa\s+korte(?:\s+suprema)?|desisyon\s+ng\s+korte(?:\s+suprema)?|hatol\s+ng\s+korte(?:\s+suprema)?|doktrina\s+ng\s+korte(?:\s+suprema)?)\b',
    r'\b(?:cases?\s+(?:on|about|interpreting|under|for|involving)|doctrines?\s+(?:on|about|under|of))\b',
    r'\b(?:v\.?|vs\.?|versus|contra|laban\s+sa)\s+[A-Z][a-zA-Z]',
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
    if parse_gr_numbers(query) or extract_case_parties(query):
        return True
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




