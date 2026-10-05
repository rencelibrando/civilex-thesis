import re
from typing import List

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


def parse_article_numbers(query: str) -> List[str]:
    """
    Parses Civil Code article numbers from user queries, supporting single mentions,
    enumerations (e.g. 'article 667 and 445', 'Art. 667, 445 at 446'), comparisons,
    and shorthand notations. Filters to valid Philippine Civil Code (RA 386) article
    range (1 to 2270) and preserves mention order.
    """
    if not query:
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
    # (e.g. "667 and 445", "explain 667 vs 445", "667 at 445")
    # Only triggered if no prefix was found and query is free from currency/date markers
    if not results and not CURRENCY_OR_DATE_PATTERN.search(query):
        bare_chain = re.search(
            r'\b(\d{1,4})\s*(?:,\s*(?:and\s+|at\s+|saka\s+|&\s*)?|(?:and|&|at|saka|vs\.?|versus)\s*|,\s*)(\d{1,4})\b',
            query,
            re.IGNORECASE
        )
        if bare_chain:
            n1, n2 = bare_chain.group(1), bare_chain.group(2)
            if 1 <= int(n1) <= 2270 and 1 <= int(n2) <= 2270:
                results.extend([n1, n2])
                curr_pos = bare_chain.end()
                while curr_pos < len(query):
                    next_m = ARTICLE_SEP_PATTERN.match(query[curr_pos:])
                    if not next_m:
                        break
                    results.append(next_m.group(1))
                    curr_pos += next_m.end()

    # Deduplicate while preserving original order and enforcing 1 <= article_number <= 2270
    deduped: List[str] = []
    seen = set()
    for n in results:
        if n not in seen and 1 <= int(n) <= 2270:
            seen.add(n)
            deduped.append(n)

    return deduped


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


