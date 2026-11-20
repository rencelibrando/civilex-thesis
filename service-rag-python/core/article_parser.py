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

# Prefix pattern matching statutory article declarations in English, Tagalog, and abbreviations
ARTICLE_PREFIX_PATTERN = re.compile(
    r'(?:\bmga\s+)?(?:'
    r'\b(?:art(?:icles?|ilces?|iles?|cles?|icels?|cls?|ikulos?|s)?|atr(?:icles?|cles?|ikulos?|s)?)\.?|'
    r'\bprobisyon(?:\s+(?:blg|bilang|no)\.?)?|'
    r'\bcivil\s+code(?:\s+(?:articles?|arts?\.?|sec(?:tion)?\.?))?|'
    r'\bfamily\s+code(?:\s+(?:articles?|arts?\.?|sec(?:tion)?\.?))?|'
    r'\br\.?a\.?\s*(?:no\.?\s*)?386(?:\s+(?:articles?|arts?\.?|sec(?:tion)?\.?))?|'
    r'\be\.?o\.?\s*(?:no\.?\s*)?209(?:\s+(?:articles?|arts?\.?|sec(?:tion)?\.?))?|'
    r'\bkodigo\s+sibil(?:\s+(?:artikulo|articles?|arts?\.?))?|'
    r'\bbatas\s+sibil(?:\s+(?:artikulo|articles?|arts?\.?))?|'
    r'\b(?:fc|cc)(?:\s+(?:articles?|arts?\.?|sec(?:tion)?\.?))?'
    r')\s*(?:(?:no|nos|bilang|blg)\b\.?)?\s*[#:\-–=]?\s*[*_]{0,3}\s*',
    re.IGNORECASE
)

# Chained delimiter pattern separating enumerated/compared/ranged article numbers
ARTICLE_SEP_PATTERN = re.compile(
    r'^[*_]{0,3}\s*'
    r'(?P<sep>,\s*(?:and\s+|at\s+|saka\s+|&\s*)?|'
    r'(?:and|&|at|saka|vs\.?|versus|laban\s+sa|to|hanggang|\/|-|–)\s*|'
    r',\s*)'
    r'[*_]{0,3}\s*'
    r'(?:(?:\bmga\s+)?(?:'
    r'\b(?:art(?:icles?|ilces?|iles?|cles?|icels?|cls?|ikulos?|s)?|atr(?:icles?|cles?|ikulos?|s)?)\.?|'
    r'\bprobisyon|\bcivil\s+code|\bfamily\s+code|\br\.?a\.?\s*(?:no\.?\s*)?386|\be\.?o\.?\s*(?:no\.?\s*)?209|'
    r'\bkodigo\s+sibil|\bbatas\s+sibil|\bfc\b|\bcc\b'
    r')\s*(?:(?:no|nos|bilang|blg)\b\.?)?\s*[#:\-–=]?\s*[*_]{0,3}\s*)?'
    r'(?P<num>\d+)',
    re.IGNORECASE
)

# Postfix pattern matching "<num> (of the |ng |sa |under )?(civil code|family code|ra 386|eo 209|fc|cc)"
ARTICLE_POSTFIX_PATTERN = re.compile(
    r'(?<![\d.])\b(\d{1,4})\b\s*'
    r'(?:(?:of\s+(?:the\s+)?|ng\s+|sa\s+|in\s+(?:the\s+)?|under\s+(?:the\s+)?))?'
    r'(?:civil\s+code|family\s+code|r\.?a\.?\s*(?:no\.?\s*)?386|e\.?o\.?\s*(?:no\.?\s*)?209|'
    r'kodigo\s+sibil|batas\s+sibil|f\.?c\.?|c\.?c\.?)\b',
    re.IGNORECASE
)

_POSTFIX_STATUTE_GUARD_RE = re.compile(
    r'(?:\b(?:executive\s+order|e\.?\s*o\.?|republic\s+act|r\.?\s*a\.?|act|order|'
    r'presidential\s+decree|p\.?\s*d\.?|batas\s+pambansa|b\.?\s*p\.?|'
    r'g\.?\s*r\.?|a\.?\s*[mc]\.?|b\.?\s*m\.?)\s*(?:nos?\.?\s*)?)$',
    re.IGNORECASE
)
_ENACTMENT_YEAR_SET = frozenset({1949, 1950, 1987, 1988})
_THOUSANDS_ARTICLE_RE = re.compile(r'(?<![\d,.])\b([12]),(\d{3})\b(?![\d,])')
_PRE_CURRENCY_RE = re.compile(r'(?:php|₱|\$|pesos?|usd)\s*$', re.IGNORECASE)
_POST_CURRENCY_RE = re.compile(r'^\s*(?:pesos?|php|dollars?|usd)\b', re.IGNORECASE)
_BARE_INQUIRY_CUE_RE = re.compile(
    r'\b(?:what\s+is|what\'?s|explain|define|meaning\s+of|tell\s+me\s+about|about|'
    r'ano\s+ang|anong|ipaliwanag|ibig\s+sabihin|tungkol\s+sa|sakop\s+ng|'
    r'(?:cases?|decisions?|rulings?|jurisprudence)\s+(?:for|on|under|about|related\s+to|applying|interpreting|citing)|'
    r'mga\s+kaso\s+sa|hatol\s+sa|desisyon\s+sa|doktrina\s+sa)\b',
    re.IGNORECASE
)
_MONETARY_CONTEXT_RE = re.compile(
    r'\b(?:owes?|owed|borrowed|loan(?:ed)?|paid|pay(?:ment)?|worth|cost|price|salary|rent|'
    r'utang|bayad|halaga|suweldo|upa|fine|penalty|php|pesos?|dollars?)\b|₱|\$',
    re.IGNORECASE
)
_STANDALONE_NUMBER_RE = re.compile(r'^\s*#?\s*(\d{1,4})\s*\??\s*$')

_RANGE_SEP_PATTERN = re.compile(r'^(?:to|hanggang|-|–)$', re.IGNORECASE)


def _normalize_thousands_commas(text: str) -> str:
    # Convert formatted 4-digit article numbers like "1,191" to "1191" unless in currency context.
    def _repl(match: re.Match) -> str:
        before = text[max(0, match.start() - 12):match.start()]
        after = text[match.end():min(len(text), match.end() + 12)]
        if _PRE_CURRENCY_RE.search(before) or _POST_CURRENCY_RE.search(after):
            return match.group(0)
        val = int(match.group(1) + match.group(2))
        if 1000 <= val <= 2270:
            return f"{match.group(1)}{match.group(2)}"
        return match.group(0)

    return _THOUSANDS_ARTICLE_RE.sub(_repl, text)


EXTERNAL_STATUTE_MENTION_PATTERN = re.compile(
    r'\b(?:revised\s+penal\s+code|rpc|penal\s+code|labor\s+code|pd\s*442|p\.d\.\s*442|tax\s+code|national\s+internal\s+revenue\s+code|nirc|corporation\s+code|ra\s*11232|data\s+privacy\s+act|ra\s*10173)\b',
    re.IGNORECASE
)
EXTERNAL_STATUTE_ARTICLE_SPAN_PATTERN = re.compile(
    r'(?:'
    r'(?:\bmga\s+)?\b(?:articles?|arts?\.?|artikulo)\s*\d+(?:\s*(?:,|and|at|to|hanggang|-|–)\s*\d+)*\s*(?:of\s+(?:the\s+)?|ng\s+|under\s+(?:the\s+)?)(?:revised\s+penal\s+code|rpc|penal\s+code|labor\s+code|pd\s*442|p\.d\.\s*442|tax\s+code|national\s+internal\s+revenue\s+code|nirc|corporation\s+code|ra\s*11232|data\s+privacy\s+act|ra\s*10173|rules\s+of\s+court)\b'
    r'|'
    r'\b(?:revised\s+penal\s+code|rpc|penal\s+code|labor\s+code|nirc|tax\s+code|corporation\s+code)\s*\(\s*(?:mga\s+)?(?:articles?|arts?\.?|artikulo)\s*\d+[^)]*\)'
    r'|'
    r'\b(?:articles?|arts?\.?|artikulo)\s*\d+\s+(?:rpc|nirc|pd\s*442)\b'
    r')',
    re.IGNORECASE,
)
CIVIL_CODE_MENTION_PATTERN = re.compile(
    r'\b(?:civil\s+code|ra\s*386|family\s+code|eo\s*209|kodigo\s+sibil|batas\s+sibil)\b',
    re.IGNORECASE
)


def parse_all_article_candidates(
    query: str,
    *,
    allow_bare_numbers: bool = True,
    strict_external_exclusion: bool = True,
) -> List[str]:
    # Extracts all Civil/Family Code article numbers referenced in text without 2270 bound limit
    if not query:
        return []

    if strict_external_exclusion and EXTERNAL_STATUTE_MENTION_PATTERN.search(query) and not CIVIL_CODE_MENTION_PATTERN.search(query):
        return []

    # Strip article spans explicitly bound to external codes (e.g. "Art. 100 of the Revised Penal Code")
    cleaned_query = EXTERNAL_STATUTE_ARTICLE_SPAN_PATTERN.sub(' ', query)
    cleaned_query = _normalize_thousands_commas(cleaned_query)

    results: List[str] = []

    for match in ARTICLE_PREFIX_PATTERN.finditer(cleaned_query):
        start_idx = match.end()
        sub_text = cleaned_query[start_idx:]
        num_match = re.match(r'^(\d+)', sub_text)
        if not num_match:
            continue
        first_num = num_match.group(1)
        results.append(first_num)
        prev_num = int(first_num)
        curr_pos = num_match.end()

        while curr_pos < len(sub_text):
            next_m = ARTICLE_SEP_PATTERN.match(sub_text[curr_pos:])
            if not next_m:
                break
            sep_str = (next_m.group('sep') or '').strip()
            next_num_str = next_m.group('num')
            next_num = int(next_num_str)
            if _RANGE_SEP_PATTERN.match(sep_str) and prev_num < next_num and (next_num - prev_num) <= 10:
                for val in range(prev_num + 1, next_num + 1):
                    results.append(str(val))
            else:
                results.append(next_num_str)
            prev_num = next_num
            curr_pos += next_m.end()

    # Match postfix statute references such as "36 family code" or "1191 of the civil code"
    for match in ARTICLE_POSTFIX_PATTERN.finditer(cleaned_query):
        num_str = match.group(1)
        val = int(num_str)
        before = cleaned_query[max(0, match.start() - 32):match.start()]
        if _POSTFIX_STATUTE_GUARD_RE.search(before):
            continue
        if val in _ENACTMENT_YEAR_SET and not re.search(r'\b(?:art(?:icle)?s?|artikulo|sec(?:tion)?|probisyon)\b\s*$', before, re.IGNORECASE):
            continue
        if 1900 <= val <= 2099 and re.search(r'\b(?:in|since|s\.|dated|decided|enacted|year)\s*$', before, re.IGNORECASE):
            continue
        results.append(num_str)

    # Fallback: bare enumeration, standalone number, or inquiry cue (disabled when parsing model answers)
    if allow_bare_numbers and not results and not CURRENCY_OR_DATE_PATTERN.search(cleaned_query) and not parse_gr_numbers(cleaned_query):
        bare_chain = re.search(
            r'\b(\d{1,4})\s*(?:,\s*(?:and\s+|at\s+|saka\s+|&\s*)?|(?:and|&|at|saka|vs\.?|versus)\s*|,\s*)(\d{1,4})\b',
            cleaned_query,
            re.IGNORECASE
        )
        if bare_chain:
            n1, n2 = bare_chain.group(1), bare_chain.group(2)
            results.extend([n1, n2])
            curr_pos = bare_chain.end()
            while curr_pos < len(cleaned_query):
                next_m = ARTICLE_SEP_PATTERN.match(cleaned_query[curr_pos:])
                if not next_m:
                    break
                results.append(next_m.group('num'))
                curr_pos += next_m.end()
        else:
            standalone = _STANDALONE_NUMBER_RE.match(cleaned_query)
            if standalone:
                val = int(standalone.group(1))
                if 1 <= val <= 2270:
                    results.append(standalone.group(1))
            elif (
                _BARE_INQUIRY_CUE_RE.search(cleaned_query)
                and not _MONETARY_CONTEXT_RE.search(cleaned_query)
            ):
                bare_nums = re.findall(r'(?<![\d.])\b(\d{1,4})\b(?![\d.])', cleaned_query)
                if len(bare_nums) == 1:
                    val = int(bare_nums[0])
                    if 1 <= val <= 2270 and not (1900 <= val <= 2099):
                        results.append(bare_nums[0])

    deduped: List[str] = []
    seen = set()
    for n in results:
        if n not in seen and 1 <= int(n):
            seen.add(n)
            deduped.append(n)

    return deduped


def parse_article_numbers(
    query: str,
    *,
    allow_bare_numbers: bool = True,
    strict_external_exclusion: bool = True,
) -> List[str]:
    # Returns valid Philippine Civil Code article numbers (1 to 2270)
    candidates = parse_all_article_candidates(
        query,
        allow_bare_numbers=allow_bare_numbers,
        strict_external_exclusion=strict_external_exclusion,
    )
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


# General Register (G.R.) docket pattern supporting fused, symbol-delimited, L-series, and range forms
GR_PATTERN = re.compile(
    r'(?:\bG\s*\.\s*R\s*\.?|\bGR(?=(?:\s*\.|\s*(?:Nos?|No|Number)\b|\s*[#:\-–=]|\s*[A-Za-z]\s*[-–]?\s*\d|\s*\d)))'
    r'\s*(?:(?:Nos?|No|Number)\b\.?)?\s*[#:\-–=]?\s*'
    r'([A-Za-z]\s*[-–]?\s*\d+(?:[-–]\d+)?[Oo]?|\d+(?:[-–]\d+)?[Oo]?)',
    re.IGNORECASE
)

_L_SERIES_PATTERN = re.compile(
    r'\b(L\s*[-–]\s*\d{3,6}(?:[-–]\d{1,6})?|L\d{4,6})\b',
    re.IGNORECASE
)

_ADMIN_DOCKET_DOTTED_PATTERN = re.compile(
    r'\b(A\.\s*[MC]\.|B\.\s*M\.)\s*(?:OCA\s+IPI\s+)?(?:(?:Nos?|No)\b\.?)?\s*[#:\-–=]?\s*'
    r'((?:[A-Za-z]{1,4}[-–])?\d+(?:[-–][A-Za-z0-9]+)*)',
    re.IGNORECASE
)

_ADMIN_DOCKET_PLAIN_PATTERN = re.compile(
    r'\b(AM|AC|BM)\s*(?:'
    r'(?:(?:Nos?|No)\b\.?\s*[#:\-–=]?\s*|[#:\-–=]\s*)((?:[A-Za-z]{1,4}[-–])?\d+(?:[-–][A-Za-z0-9]+)*)'
    r'|([A-Za-z]{1,4}[-–]\d+(?:[-–][A-Za-z0-9]+)*)'
    r')',
    re.IGNORECASE
)

_ADMIN_STANDALONE_PATTERN = re.compile(
    r'^\s*(AM|AC|BM)\s+(\d{3,6}(?:[-–][A-Za-z0-9]+)*)\s*\??\s*$',
    re.IGNORECASE
)

_BARE_GR_STANDALONE_PATTERN = re.compile(r'^\s*#?\s*(\d{5,6}(?:[-–]\d{1,6})?)\s*\??\s*$')
_BARE_GR_CUED_PATTERN = re.compile(
    r'\b(?:case|docket|sc|supreme\s+court|ruling|decision|kaso|hatol|find|lookup|search|what\s+is|explain)\s*(?:no\.?\s*|#\s*)?(\d{5,6}(?:[-–]\d{1,6})?)\b',
    re.IGNORECASE
)

# Unicode-aware case title pattern matching 'Party A vs. Party B' (supports Cariño, Osmeña, Peña)
_UNICODE_PARTY_CHAR = r'[^\W\d_]'
CASE_VS_PATTERN = re.compile(
    rf'(?<!\w)({_UNICODE_PARTY_CHAR}[\w\u00c0-\u024f\s\.,\'-]+?)\s+'
    rf'(?:v\.?|vs\.?|versus|contra|laban\s+sa)\s+'
    rf'({_UNICODE_PARTY_CHAR}[\w\u00c0-\u024f\s\.,\'-]+)',
    re.IGNORECASE | re.UNICODE
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

# Generic legal topic words excluded from single-party case name extraction
_GENERIC_LEGAL_CONCEPT_WORDS = frozenset({
    'psychological', 'incapacity', 'breach', 'contract', 'contracts', 'annulment', 'nullity',
    'marriage', 'divorce', 'property', 'lease', 'sale', 'loan', 'damages', 'obligation', 'obligations',
    'civil', 'family', 'code', 'article', 'articles', 'artikulo', 'statute', 'law', 'legal',
    'separation', 'support', 'custody', 'adoption', 'estoppel', 'prescription', 'negligence', 'fraud',
    'possession', 'ownership', 'donation', 'succession', 'mortgage', 'pledge', 'trust', 'agency',
    'partnership', 'quasi', 'delict', 'tort', 'criminal', 'labor', 'tax', 'constitutional',
    'administrative', 'commercial', 'corporate', 'remedial', 'evidence', 'jurisdiction',
    'landmark', 'related', 'relevant', 'cited', 'philippine', 'res', 'judicata', 'laches',
    'mora', 'rescission', 'resolution', 'indemnity', 'interest', 'rent', 'eviction', 'ejectment',
    'foreclosure', 'redemption', 'easement', 'usufruct', 'partition', 'filiation', 'paternity',
    'emancipation', 'parental', 'authority', 'conjugal', 'community', 'cohabitation', 'bigamy',
    'void', 'voidable', 'valid', 'invalid', 'applying', 'interpreting', 'under', 'from', 'with',
    'that', 'this', 'these', 'those', 'their', 'here', 'there', 'into', 'over', 'before', 'after',
    'against', 'between', 'without', 'within', 'during', 'filed', 'file', 'sue', 'suing', 'lawsuit',
    'sample', 'example', 'sc', 'gr', 'eo', 'ra', 'fc', 'cc',
    'non-payment', 'nonpayment', 'payment', 'default', 'death', 'delay', 'loss', 'injury',
    'accident', 'termination', 'cancellation', 'violation', 'repair', 'repairs', 'improvement',
    'improvements', 'debt', 'debts', 'refund', 'deposit',
})

# Exclude conditional "in case of ..." so it never triggers single-party case lookup.
_SINGLE_PARTY_PRE_PATTERN = re.compile(
    rf'(?<!\bin\s)\b(?:ruling|decision|doctrine|case)\s+(?:in|of)\s+(?:the\s+)?'
    rf'({_UNICODE_PARTY_CHAR}[\w\u00c0-\u024f\'-]+(?:\s+{_UNICODE_PARTY_CHAR}[\w\u00c0-\u024f\'-]+){{0,3}})',
    re.IGNORECASE | re.UNICODE
)

_SINGLE_PARTY_POST_PATTERN = re.compile(
    rf'(?:^|[\s,:;\(])({_UNICODE_PARTY_CHAR}[\w\u00c0-\u024f\'-]+(?:\s+{_UNICODE_PARTY_CHAR}[\w\u00c0-\u024f\'-]+){{0,3}})\s+'
    rf'(?:case|doctrine|ruling|decision)\b',
    re.IGNORECASE | re.UNICODE
)

CONVERSATIONAL_PREFIX_PATTERN = re.compile(
    r'^(?:.*?\b(?:case\s+(?:of|titled|named|involving)|ruling\s+(?:in|of)|doctrine\s+(?:in|of|under)|decision\s+(?:in|of)|search\s+(?:for|through|though|the|name)?|whats?\s+(?:the)?|why\s+(?:is|it|cant|can\'t)?|tell\s+me\s+about|explain|give\s+me|hatol\s+sa|desisyon\s+sa|kaso\s+ng?|ano\s+ang|tungkol\s+sa)\s+)+',
    re.IGNORECASE
)


def expand_docket_range(raw_code: str) -> List[str]:
    # Normalizes a docket code and expands consolidated numeric ranges like 94188-89 or L-11319-20.
    code = re.sub(r'[–—]', '-', raw_code or '')
    code = re.sub(r'\s+', '', code).strip('-').upper()
    if not code:
        return []

    code = re.sub(r'[O]$', '0', code)
    out: List[str] = []

    def _add(val: str) -> None:
        v = val.strip('-')
        if v and v not in out:
            out.append(v)

    # Normalize L-series prefix into both hyphenated ("L-1892") and compact ("L1892") + core ("1892")
    l_match = re.match(r'^([A-Z])-?(\d{3,6})(?:-(\d{1,6}))?$', code)
    if l_match:
        letter, start_str, end_raw = l_match.group(1), l_match.group(2), l_match.group(3)
        if end_raw:
            _add(f"{letter}-{start_str}-{end_raw}")
            start_num = int(start_str)
            end_str = (start_str[:len(start_str) - len(end_raw)] + end_raw) if len(end_raw) < len(start_str) else end_raw
            end_num = int(end_str)
            if start_num < end_num and (end_num - start_num) <= 10:
                for n in range(start_num, end_num + 1):
                    _add(f"{letter}-{n}")
                    _add(f"{letter}{n}")
                    _add(str(n))
            else:
                _add(f"{letter}-{start_str}")
                _add(start_str)
        else:
            _add(f"{letter}-{start_str}")
            _add(f"{letter}{start_str}")
            _add(start_str)
        return out

    # Plain numeric consolidated range like 94188-89 or 159561-62
    num_range = re.match(r'^(\d{3,6})-(\d{1,6})$', code)
    if num_range:
        start_str, end_raw = num_range.group(1), num_range.group(2)
        _add(f"{start_str}-{end_raw}")
        start_num = int(start_str)
        end_str = (start_str[:len(start_str) - len(end_raw)] + end_raw) if len(end_raw) < len(start_str) else end_raw
        end_num = int(end_str)
        if start_num < end_num and (end_num - start_num) <= 10:
            for n in range(start_num, end_num + 1):
                _add(str(n))
        else:
            _add(start_str)
        return out

    _add(code)
    return out


def parse_gr_numbers(text: str) -> List[str]:
    # Extracts clean G.R., L-series, A.M./A.C./B.M., and bare 5-6 digit docket numbers
    if not text:
        return []
    clean_nums: List[str] = []
    seen = set()

    def _emit(code: str) -> None:
        for item in expand_docket_range(code):
            if item not in seen:
                seen.add(item)
                clean_nums.append(item)

    for m in GR_PATTERN.findall(text):
        _emit(m)

    for m in _L_SERIES_PATTERN.findall(text):
        _emit(m)

    for m in _ADMIN_DOCKET_DOTTED_PATTERN.finditer(text):
        code = re.sub(r'[–—]', '-', m.group(2)).upper().strip('-')
        if code and code not in seen:
            seen.add(code)
            clean_nums.append(code)

    for m in _ADMIN_DOCKET_PLAIN_PATTERN.finditer(text):
        raw_code = m.group(2) or m.group(3) or ''
        code = re.sub(r'[–—]', '-', raw_code).upper().strip('-')
        if code and code not in seen:
            seen.add(code)
            clean_nums.append(code)

    standalone_admin = _ADMIN_STANDALONE_PATTERN.match(text)
    if standalone_admin:
        code = re.sub(r'[–—]', '-', standalone_admin.group(2)).upper().strip('-')
        if code and code not in seen:
            seen.add(code)
            clean_nums.append(code)

    # Bare 5-6 digit G.R. numbers only when standalone or paired with case/docket cues outside monetary context
    if not clean_nums and not _MONETARY_CONTEXT_RE.search(text):
        bare_only = _BARE_GR_STANDALONE_PATTERN.match(text)
        if bare_only:
            _emit(bare_only.group(1))
        else:
            for m in _BARE_GR_CUED_PATTERN.findall(text):
                _emit(m)

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


def _filter_single_party_tokens(phrase: str) -> List[str]:
    cleaned = CONVERSATIONAL_PREFIX_PATTERN.sub('', phrase).strip()
    raw_tokens = re.findall(rf'{_UNICODE_PARTY_CHAR}[\w\u00c0-\u024f\'-]*', cleaned, re.UNICODE)
    out: List[str] = []
    for tok in raw_tokens:
        low = tok.lower().strip("'-")
        if len(low) < 3 or low in CASE_TITLE_STOPWORDS or low in _GENERIC_LEGAL_CONCEPT_WORDS:
            continue
        out.append(tok.strip("'-"))
    return out


def extract_case_parties(text: str) -> List[str]:
    # Extracts significant party search terms from two-sided ("vs.") and single-party doctrine queries
    if not text:
        return []
    cand = extract_case_title_candidate(text)
    m = CASE_VS_PATTERN.search(cand) if cand else CASE_VS_PATTERN.search(text)
    if m:
        terms = []
        for side in (m.group(1), m.group(2)):
            words = [
                w for w in re.findall(rf'{_UNICODE_PARTY_CHAR}[\w\u00c0-\u024f\'-]*', side, re.UNICODE)
                if len(w) > 2 and w.lower() not in CASE_TITLE_STOPWORDS
            ]
            if words:
                terms.extend(words[:2])
        return terms[:4]

    # Single-party or doctrine-named queries (e.g. "chi ming tsoi case", "ruling in tan-andal", "molina doctrine")
    for pat in (_SINGLE_PARTY_PRE_PATTERN, _SINGLE_PARTY_POST_PATTERN):
        for match in pat.finditer(text):
            tokens = _filter_single_party_tokens(match.group(1))
            if tokens:
                return tokens[:3]
    return []


JURISPRUDENCE_PATTERNS = [
    r'(?:jurisprudenc[a-z]*|jurisprudens[a-z]*|\bscra\b|(?:\bgr\b|\bg\s*\.\s*r\s*\.?)\s*(?:(?:nos?|no|number)\b\.?)?\s*[#:\-–=]?\s*[a-z]?\s*[-–]?\s*\d+)',
    r'\b(?:supreme\s+court|korte\s+suprema)\b',
    r'\b(?:sc\s+(?:cases?|decisions?|rulings?|jurisprudence))\b',
    r'\b(?:landmark\s+cases?|court\s+cases?|related\s+cases?|relevant\s+cases?|cited\s+cases?|court\s+rulings?|court\s+decisions?|judicial\s+precedents?|legal\s+precedents?)\b',
    r'\b(?:mga\s+kaso\s+sa\s+korte(?:\s+suprema)?|desisyon\s+ng\s+korte(?:\s+suprema)?|hatol\s+ng\s+korte(?:\s+suprema)?|doktrina\s+ng\s+korte(?:\s+suprema)?)\b',
    r'\b(?:mga\s+)?(?:kaso|hatol|desisyon|doktrina|jurisprudensya)\s+(?:sa|ng|ukol\s+sa|tungkol\s+sa|para\s+sa|kaugnay\s+ng|sa\s+ilalim\s+ng)\s+(?:art|artikulo|article|civil\s+code|family\s+code|eo\s*209|ra\s*386|korte|\d)',
    r'\b(?:cases?\s+(?:related\s+to|relevant\s+to|connected\s+to|pertaining\s+to|referring\s+to|on|about|interpreting|under|for|involving|regarding|concerning|discussing|citing|applying)|doctrines?\s+(?:on|about|under|of|in|related\s+to)|(?:rulings?|decisions?)\s+(?:in|of|on|about|for|under|applying|interpreting|citing|related\s+to))\b',
    rf'\b(?:v\.?|vs\.?|versus|contra|laban\s+sa)\s+{_UNICODE_PARTY_CHAR}',
]

EXCLUDE_CHARGE_PATTERNS = [
    r'\b(?:maging\s+kaso|kaso\s+ko|kaso\s+sa\s+akin|ikaso\s+(?:sa|ko)|anong\s+kaso|isampang\s+kaso|kaso\s+na\s+pwede(?:ng)?\s+(?:isampa|ikaso)|cases?\s+against\s+me|cases?\s+(?:can\s+be\s+)?filed|what\s+cases?\s+(?:can|could|will))\b',
    r'\b(?:in\s+case|in\s+cases?\s+of)\b',
]

_TAGALOG_STATUTE_CASE_OVERRIDE = re.compile(
    r'\b(?:mga\s+)?(?:kaso|hatol|desisyon|doktrina|jurisprudensya)\s+(?:sa|ng|ukol\s+sa|tungkol\s+sa|para\s+sa|kaugnay\s+ng|sa\s+ilalim\s+ng)\s+(?:art|artikulo|article|civil\s+code|family\s+code|eo\s*209|ra\s*386|\d)',
    re.IGNORECASE
)


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
    if _TAGALOG_STATUTE_CASE_OVERRIDE.search(q_lower):
        return True
    if any(re.search(p, q_lower) for p in EXCLUDE_CHARGE_PATTERNS) and not any(
        re.search(p, q_lower) for p in [r'\bsupreme\s+court\b', r'\bkorte\s+suprema\b', r'jurisprudenc', r'jurisprudens']
    ):
        return False
    return any(bool(re.search(p, q_lower)) for p in JURISPRUDENCE_PATTERNS)


FAMILY_CODE_PATTERNS = [
    r'\b(?:family\s+code|executive\s+order\s+(?:no\.?\s*)?209|eo\s*209|e\.o\.\s*209|f\.c\.|fc)\b',
    r'\b(?:marriage|marital|remarriage|divorce|annulment|nullity\s+of\s+marriage|presumptive\s+death|psychological\s+incapacity|legal\s+separation|incestuous|bigamous|family\s+home|conjugal\s+partnership|absolute\s+community|filiation|paternity|parental\s+authority|adoption|spousal\s+support)\b'
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


_PARTIAL_BOLD_PREFIX_RE = re.compile(
    r'\*\*((?:Articles?|Arts?\.?|Artikulo))\*\*\s*((?:Nos?\.?\s*)?\d{1,4}[A-Za-z]?(?:\([0-9A-Za-z]+\))*)',
    re.IGNORECASE,
)
_PARTIAL_BOLD_NUMBER_RE = re.compile(
    r'\b((?:Articles?|Arts?\.?|Artikulo)(?:\s+Nos?\.?)?)\s+\*\*(\d{1,4}[A-Za-z]?(?:\([0-9A-Za-z]+\))*)\*\*',
    re.IGNORECASE,
)
_PROTECTED_MARKDOWN_SPAN_RE = re.compile(
    r'(\*\*[^\n*]+?\*\*|`[^`\n]+`|\[[^\]]+\]\([^)]+\))'
)
_PLAIN_ARTICLE_REF_RE = re.compile(
    r'\b((?:Articles?|Arts?\.?|Artikulo)\s+(?:Nos?\.?\s*)?\d{1,4}[A-Za-z]?(?:\([0-9A-Za-z]+\))*'
    r'(?:\s*(?:[-–]|to|hanggang)\s*\d{1,4}[A-Za-z]?(?:\([0-9A-Za-z]+\))*'
    r'|\s+(?:and|at|or|&)\s+(?:(?:Articles?|Arts?\.?|Artikulo)\s+)?\d{1,4}[A-Za-z]?(?:\([0-9A-Za-z]+\))*)?)'
    r'(?![0-9A-Za-z])',
    re.IGNORECASE,
)


def bold_article_references(text: str) -> str:
    # Wraps statutory article references in Markdown bold while preserving existing bold spans, headings, and code
    if not text:
        return text

    out_lines: List[str] = []
    in_fence = False

    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            out_lines.append(line)
            continue
        if in_fence or re.match(r'^\s*#{1,6}\s', line):
            out_lines.append(line)
            continue

        normalized = _PARTIAL_BOLD_PREFIX_RE.sub(r'**\1 \2**', line)
        normalized = _PARTIAL_BOLD_NUMBER_RE.sub(r'**\1 \2**', normalized)

        parts = _PROTECTED_MARKDOWN_SPAN_RE.split(normalized)
        for idx in range(0, len(parts), 2):
            if parts[idx]:
                parts[idx] = _PLAIN_ARTICLE_REF_RE.sub(r'**\1**', parts[idx])
        out_lines.append("".join(parts))

    return "\n".join(out_lines)





