"""In-memory normalized jurisprudence matcher for docket, acronym, Unicode, and party queries."""

import math
import re
import threading
import time
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Dict, FrozenSet, List, Optional, Set, Tuple

from core.article_parser import (
    expand_docket_range,
    extract_case_parties,
    parse_gr_numbers,
)

INDEX_TTL_SECONDS = 30 * 60

_MONTH_FUSED_RE = re.compile(
    r"(?<=[0-9A-Za-z-])(?:January|February|March|April|May|June|July|August|September|October|November|December)"
    r"\s*\d{0,2}(?:\s*,\s*\d{4})?"
)
_MONTH_DATE_RE = re.compile(
    r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)"
    r"\s+\d{1,2}(?:\s*,\s*\d{4})?\b",
    re.IGNORECASE,
)
_SIDE_SPLIT_RE = re.compile(
    r"\s+(?:vs?\.?|versus|contra|laban\s+sa)\s+|\s*vs\.(?=[A-Za-z\u00c0-\u024f])",
    re.IGNORECASE,
)
_DOCKET_HEADER_RE = re.compile(
    r"\b(?:G\.?\s*R\.?|A\.?\s*[MC]\.?|B\.?\s*M\.?|R-C\.?\s*A\.?)"
    r"(?:\s+OCA\s+IPI)?\s*(?:Nos?\.?)?\s*"
    r"((?:[A-Z]{1,4}-)?\d+(?:-[A-Z0-9]+)*)",
    re.IGNORECASE,
)
_DOCKET_SERIES_STRIP_RE = re.compile(
    r"\b(?:g\.\s*r\.|a\.\s*[mc]\.|b\.\s*m\.|r-c\.\s*a\.|c\.\s*a\.)(?:\s+oca\s+ipi)?(?:\s*nos?\.?)?"
    r"|\b(?:gr|am|ac|bm)(?=\s*\.|\s*nos?\.?(?:\s|$)|\s*[#:\-–=]|\s*[a-z]{0,3}-?\d|\s+[a-z]-?\d)",
    re.IGNORECASE,
)
_DOCKET_TITLE_PREFIX_RE = re.compile(r"^(?:g\.?\s*r\.?|a\.?\s*[mc]\.?|b\.?\s*m\.?)", re.IGNORECASE)

_STOP_WORDS: FrozenSet[str] = frozenset(
    {
        "of", "the", "and", "in", "on", "at", "to", "by", "for", "or", "an", "a",
        "et", "al", "etc", "vs", "v", "versus", "contra", "no", "nos", "hon",
        "what", "whats", "is", "was", "are", "were", "about", "explain", "tell",
        "me", "summarize", "summary", "ruling", "decision", "doctrine", "case",
        "cases", "held", "decided", "under", "from", "with", "regarding",
        "ano", "ang", "sa", "ng", "mga", "kaso", "hatol", "desisyon", "doktrina",
        "laban", "tungkol", "ukol", "paki", "pakipaliwanag", "find", "search",
    }
)

# Public/institutional boilerplate words that must never trigger a match without a distinctive party.
_PUBLIC_BOILERPLATE_TOKENS: FrozenSet[str] = frozenset(
    {
        "republic", "philippines", "philippine", "people", "court", "appeals",
        "supreme", "intermediate", "appellate", "regional", "trial", "municipal",
        "metropolitan", "ca", "sc", "rtc", "mtc", "rp", "honorable", "judge",
        "justice", "city", "province", "municipality", "government", "govt",
        "office", "commission", "board", "department", "dept", "secretary",
        "commissioner", "director", "spouses", "sps", "heirs", "hrs", "estate",
        "corporation", "corp", "company", "co", "incorporated", "inc",
        "association", "assn", "bank", "national", "natl", "development", "dev",
        "petitioner", "respondent", "plaintiff", "defendant", "branch", "br",
    }
)

TOKEN_ALIASES: Dict[str, Tuple[str, ...]] = {
    "sps": ("spouses",),
    "spouses": ("sps",),
    "hrs": ("heirs",),
    "heirs": ("hrs",),
    "corp": ("corporation",),
    "corporation": ("corp",),
    "inc": ("incorporated",),
    "incorporated": ("inc",),
    "co": ("company",),
    "company": ("co",),
    "assn": ("association",),
    "association": ("assn",),
    "mfg": ("manufacturing",),
    "manufacturing": ("mfg",),
    "dev": ("development",),
    "development": ("dev",),
    "govt": ("government",),
    "government": ("govt",),
    "natl": ("national",),
    "national": ("natl",),
    "intl": ("international",),
    "international": ("intl",),
    "phil": ("philippine", "philippines"),
    "philippine": ("phil",),
    "philippines": ("phil",),
    "dept": ("department",),
    "department": ("dept",),
    "br": ("branch",),
    "branch": ("br",),
    "atty": ("attorney",),
    "attorney": ("atty",),
    "hon": ("honorable",),
    "honorable": ("hon",),
    "ma": ("maria",),
    "maria": ("ma",),
    "sta": ("santa",),
    "santa": ("sta",),
    "sto": ("santo",),
    "santo": ("sto",),
    "st": ("saint", "street"),
}

PHRASE_ACRONYMS: Tuple[Tuple[str, str], ...] = (
    ("development bank of the philippines", "dbp"),
    ("philippine national bank", "pnb"),
    ("bank of the philippine islands", "bpi"),
    ("banco de oro", "bdo"),
    ("court of appeals", "ca"),
    ("supreme court", "sc"),
    ("regional trial court", "rtc"),
    ("metropolitan trial court", "mtc"),
    ("municipal trial court", "mtc"),
    ("republic of the philippines", "rp"),
    ("office of the solicitor general", "osg"),
    ("government service insurance system", "gsis"),
    ("social security system", "sss"),
    ("national labor relations commission", "nlrc"),
    ("securities and exchange commission", "sec"),
    ("bureau of internal revenue", "bir"),
    ("commission on elections", "comelec"),
    ("people of the philippines", "people"),
)


def strip_accents(text: str) -> str:
    nfd = unicodedata.normalize("NFD", str(text or ""))
    return "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")


def clean_text(text: str) -> str:
    s = strip_accents(text)
    s = re.sub(r"&amp;?", " & ", s, flags=re.IGNORECASE)
    s = re.sub(r"vs\.(?=[A-Za-z])", "vs. ", s, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", s).strip()


def tokenize_words(text: str) -> List[str]:
    cleaned = re.sub(r"[^a-z0-9]+", " ", clean_text(text).lower()).strip()
    return cleaned.split() if cleaned else []


def strip_dates_from_docket(raw: str) -> str:
    s = _MONTH_FUSED_RE.sub(" ", clean_text(raw))
    s = _MONTH_DATE_RE.sub(" ", s)
    s = re.sub(r"/[A-Za-z]\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def format_clean_gr_number(raw: str) -> str:
    """Return a display-clean docket string without fused month dates or slash artifacts."""
    cleaned = strip_dates_from_docket(raw)
    return cleaned.strip(" ,;:-")


def detect_docket_series(raw: str) -> Set[str]:
    s = str(raw or "").lower()
    series: Set[str] = set()
    if re.search(r"\bg\.\s*r\.|\bgr(?=\s*\.|\s*nos?\.?(?:\s|$)|\s*[#:\-–=]|\s*(?:[a-z]-)?\d)", s):
        series.add("GR")
    if re.search(r"\ba\.\s*m\.|\bam(?=\s*\.|\s*nos?\.?(?:\s|$)|\s*[#:\-–=]|\s*(?:[a-z]{1,4}-)?\d)", s):
        series.add("AM")
    if re.search(r"\ba\.\s*c\.|\bac(?=\s*\.|\s*nos?\.?(?:\s|$)|\s*[#:\-–=]|\s*(?:[a-z]{1,4}-)?\d)", s):
        series.add("AC")
    if re.search(r"\bb\.\s*m\.|\bbm(?=\s*\.|\s*nos?\.?(?:\s|$)|\s*[#:\-–=]|\s*(?:[a-z]{1,4}-)?\d)", s):
        series.add("BM")
    if re.search(r"\b(?:r-)?c\.\s*a\.", s):
        series.add("CA")
    return series


def extract_docket_signals(raw_text: str, *, is_query: bool = False) -> Tuple[Set[str], Set[str], Set[str]]:
    """Extract normalized (series, codes, numbers) from a docket header or user query."""
    cleaned = strip_dates_from_docket(raw_text)
    series = detect_docket_series(cleaned)
    codes: Set[str] = set()
    numbers: Set[str] = set()

    if is_query:
        for parsed_code in parse_gr_numbers(raw_text):
            low = parsed_code.lower()
            codes.add(low)
            joined = low.replace("-", "")
            codes.add(joined)
            num_core = re.sub(r"^[a-z]+-?|-?[a-z]+$", "", low).replace("-", "")
            if num_core:
                codes.add(num_core)
                numbers.add(num_core)
            for dg in re.findall(r"\d+", low):
                if len(dg) >= 3:
                    numbers.add(dg)
                    codes.add(dg)
        return series, codes, numbers

    body = _DOCKET_SERIES_STRIP_RE.sub(" ", cleaned)
    body = re.sub(r"\bno(?:s)?\.?\b", " ", body, flags=re.IGNORECASE)
    body = re.sub(r"\b([a-z]{1,4})\s+(\d{2,6}(?:\s*-\s*\d{1,6})?)\b", r"\1-\2", body, flags=re.IGNORECASE)
    body = re.sub(r"\s*-\s*", "-", body)

    for tok in re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)*", body.lower()):
        if not re.search(r"\d", tok):
            continue
        codes.add(tok)
        joined = tok.replace("-", "")
        if joined != tok:
            codes.add(joined)
        for expanded in expand_docket_range(tok):
            el = expanded.lower()
            codes.add(el)
            codes.add(el.replace("-", ""))
            if el.isdigit():
                numbers.add(el)
        num_core = re.sub(r"^[a-z]+-?|-?[a-z]+$", "", tok).replace("-", "")
        if num_core:
            codes.add(num_core)
            numbers.add(num_core)
        digit_groups = re.findall(r"\d+", tok)
        for dg in digit_groups:
            if len(dg) >= 3 or len(digit_groups) == 1:
                numbers.add(dg)
                codes.add(dg)

    return series, codes, numbers


def _levenshtein_bounded(a: str, b: str, max_dist: int) -> int:
    m, n = len(a), len(b)
    if abs(m - n) > max_dist:
        return max_dist + 1
    if m == 0:
        return n
    if n == 0:
        return m
    prev = list(range(n + 1))
    curr = [0] * (n + 1)
    for i in range(1, m + 1):
        curr[0] = i
        row_min = i
        ca = a[i - 1]
        for j in range(1, n + 1):
            cost = 0 if ca == b[j - 1] else 1
            val = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
            curr[j] = val
            if val < row_min:
                row_min = val
        if row_min > max_dist:
            return max_dist + 1
        prev, curr = curr, prev
    return prev[n]


@dataclass
class _SideData:
    tokens: FrozenSet[str]
    aliases: FrozenSet[str]


@dataclass
class _CaseEntry:
    case_uid: str
    title: str
    gr_number: str
    decision_date: str
    is_docket_title: bool
    title_text: str
    compact_title: str
    title_tokens: FrozenSet[str]
    alias_tokens: FrozenSet[str]
    left_side: Optional[_SideData]
    right_side: Optional[_SideData]
    series: FrozenSet[str]
    docket_codes: FrozenSet[str]
    docket_numbers: FrozenSet[str]


_QUERY_PREAMBLE_RE = re.compile(
    r"^(?:(?:please\s+|can\s+you\s+|could\s+you\s+)?"
    r"(?:what\s+(?:did|was|is)\s+|explain(?:\s+to\s+me)?\s+|summarize\s+|tell\s+me\s+about\s+|"
    r"ano\s+ang\s+|ipaliwanag\s+(?:ang\s+)?)"
    r"(?:(?:the|ng|sa)\s+)?"
    r"(?:(?:philippine\s+)?supreme\s+court\s+|sc\s+)?"
    r"(?:(?:n?case|ruling|decision|doctrine|holding|hatol|desisyon|kaso|rule|ruled|hold|held|decide|decided)\s+)*"
    r"(?:(?:of|in|on|about|sa|ni|ng)\s+)+)",
    re.IGNORECASE,
)


def _strip_query_preamble(side_text: str) -> str:
    """Remove leading conversational inquiry wrappers so 'Supreme Court' does not pollute left-party tokens."""
    stripped = _QUERY_PREAMBLE_RE.sub("", side_text.strip()).strip()
    return stripped or side_text


def _build_side_data(side_text: str) -> _SideData:
    words = tokenize_words(side_text)
    phrase = " ".join(words)
    aliases: Set[str] = set()
    for w in words:
        for exp in TOKEN_ALIASES.get(w, ()):
            aliases.add(exp)
    for full_phrase, acro in PHRASE_ACRONYMS:
        if full_phrase in phrase:
            aliases.add(acro)
    return _SideData(tokens=frozenset(words), aliases=frozenset(aliases))


@dataclass
class JurisprudenceIndex:
    entries: List[_CaseEntry]
    idf: Dict[str, float]
    vocab_by_len: Dict[int, List[str]]
    docket_to_indices: Dict[str, List[int]] = field(default_factory=dict)

    def _fuzzy_matches(self, token: str) -> List[Tuple[str, float]]:
        if len(token) < 4 or token.isdigit():
            return []
        max_dist = 2 if len(token) >= 7 else 1
        out: List[Tuple[str, float]] = []
        for length in range(max(3, len(token) - max_dist), len(token) + max_dist + 1):
            for cand in self.vocab_by_len.get(length, ()):
                if cand == token:
                    continue
                if cand[0] != token[0] and (len(cand) < 2 or len(token) < 2 or cand[1] != token[1]):
                    continue
                dist = _levenshtein_bounded(token, cand, max_dist)
                if dist <= max_dist:
                    out.append((cand, 0.65 if dist == 1 else 0.45))
        return out

    def _token_match(
        self,
        qt: str,
        fuzzy_map: Dict[str, List[Tuple[str, float]]],
        entry: _CaseEntry,
    ) -> Tuple[bool, bool, float, float]:
        tok_idf = self.idf.get(qt, 7.0 if len(qt) >= 6 else 4.5)
        if qt in entry.title_tokens:
            return True, True, tok_idf * 18.0, tok_idf
        if qt in entry.alias_tokens:
            return True, True, tok_idf * 16.0, tok_idf
        for alias in TOKEN_ALIASES.get(qt, ()):
            if alias in entry.title_tokens or alias in entry.alias_tokens:
                return True, True, tok_idf * 15.0, tok_idf
        if len(qt) >= 4:
            for tt in entry.title_tokens:
                if tt.startswith(qt):
                    ratio = min(1.0, len(qt) / len(tt))
                    return True, False, tok_idf * (10.0 + 5.0 * ratio), tok_idf
        for cand, weight in fuzzy_map.get(qt, ()):
            if cand in entry.title_tokens:
                f_idf = self.idf.get(cand, tok_idf)
                return True, False, f_idf * 13.0 * weight, f_idf
        return False, False, 0.0, 0.0

    @staticmethod
    def _side_has_token(side: Optional[_SideData], tok: str, fuzzy_map: Dict[str, List[Tuple[str, float]]]) -> bool:
        if side is None:
            return False
        if tok in side.tokens or tok in side.aliases:
            return True
        if any(a in side.tokens or a in side.aliases for a in TOKEN_ALIASES.get(tok, ())):
            return True
        if len(tok) >= 4 and any(st.startswith(tok) for st in side.tokens):
            return True
        return any(cand in side.tokens for cand, _ in fuzzy_map.get(tok, ()))

    def search(self, raw_query: str, max_results: int = 4) -> List[Dict[str, Any]]:
        query = str(raw_query or "").strip()
        if len(query) < 2:
            return []

        cleaned = clean_text(query)
        series, q_codes, q_numbers = extract_docket_signals(query, is_query=True)
        has_docket = bool(q_codes or q_numbers)

        sides = _SIDE_SPLIT_RE.split(cleaned)
        has_two_sides = len(sides) >= 2

        title_tokens: List[str] = []
        left_words: List[str] = []
        right_words: List[str] = []

        if has_two_sides:
            left_clean = _strip_query_preamble(sides[0])
            left_words = [w for w in tokenize_words(left_clean) if w not in _STOP_WORDS and not w.isdigit()]
            right_words = [w for w in tokenize_words(" ".join(sides[1:])) if w not in _STOP_WORDS and not w.isdigit()]
            # Drop conversational preamble words before the left party while preserving the party tail.
            if len(left_words) > 4:
                left_words = left_words[-4:]
            title_tokens = list(dict.fromkeys(left_words + right_words))
        else:
            single_parties = extract_case_parties(query)
            if single_parties:
                raw_sp = tokenize_words(" ".join(single_parties))
                title_tokens = [w for w in raw_sp if w not in _STOP_WORDS and not w.isdigit()]

        if not has_docket and not title_tokens:
            return []

        distinctive_tokens = [t for t in title_tokens if t not in _PUBLIC_BOILERPLATE_TOKENS]
        left_distinctive = [w for w in left_words if w not in _PUBLIC_BOILERPLATE_TOKENS]
        right_distinctive = [w for w in right_words if w not in _PUBLIC_BOILERPLATE_TOKENS]
        require_both_sides_if_found = has_two_sides and bool(left_distinctive) and bool(right_distinctive)
        min_single_idf = min(3.2, math.log(1.0 + len(self.entries) / 2.5)) if self.entries else 1.0

        fuzzy_map = {qt: self._fuzzy_matches(qt) for qt in title_tokens}

        # Fast-path candidate set when docket-only lookup is performed.
        if has_docket and not title_tokens:
            cand_indices: Set[int] = set()
            for code in q_codes | q_numbers:
                cand_indices.update(self.docket_to_indices.get(code, ()))
            candidates = [self.entries[i] for i in cand_indices] if cand_indices else self.entries
        else:
            candidates = self.entries

        scored: List[Tuple[float, bool, _CaseEntry]] = []
        phrase_text = " ".join(title_tokens)
        compact_query = "".join(title_tokens)

        for entry in candidates:
            score = 0.0
            docket_hit = False
            both_sides_matched = False

            if has_docket:
                best_docket = 0.0
                for qc in q_codes:
                    if qc in entry.docket_codes:
                        best_docket = max(best_docket, 1000.0)
                if best_docket < 900.0:
                    for qn in q_numbers:
                        if qn in entry.docket_numbers:
                            best_docket = max(best_docket, 880.0)
                if best_docket > 0.0:
                    docket_hit = True
                    if series:
                        best_docket += 160.0 if (series & entry.series) else -140.0
                    score += best_docket

            if title_tokens:
                matched_count = 0
                exact_count = 0
                distinctive_hits = 0
                max_distinctive_idf = 0.0
                token_score = 0.0

                for qt in title_tokens:
                    hit, is_exact, t_score, matched_idf = self._token_match(qt, fuzzy_map, entry)
                    if hit:
                        matched_count += 1
                        if is_exact:
                            exact_count += 1
                        token_score += t_score
                        if qt not in _PUBLIC_BOILERPLATE_TOKENS:
                            distinctive_hits += 1
                            max_distinctive_idf = max(max_distinctive_idf, matched_idf)

                # Public-party guard: never match boilerplate ("vs. Republic") when distinctive party missed.
                if not docket_hit:
                    if distinctive_tokens and distinctive_hits == 0:
                        continue
                    if not has_two_sides:
                        # Single-party queries must match distinctive high-IDF party name(s).
                        if distinctive_hits == 0 or max_distinctive_idf < min_single_idf:
                            continue
                        if len(distinctive_tokens) >= 2 and (distinctive_hits / len(distinctive_tokens)) < 0.6:
                            continue

                if matched_count > 0:
                    if len(phrase_text) >= 3 and phrase_text in entry.title_text:
                        score += 480.0
                        if entry.title_text.startswith(phrase_text):
                            score += 90.0
                    elif len(compact_query) >= 4 and compact_query in entry.compact_title:
                        score += 440.0

                    score += token_score
                    coverage = matched_count / len(title_tokens)
                    if matched_count == len(title_tokens):
                        score += 420.0 if len(title_tokens) >= 2 else 120.0
                        if exact_count == len(title_tokens):
                            score += 60.0
                    elif len(title_tokens) >= 2 and coverage >= 0.5:
                        score += 120.0 * coverage

                    if has_two_sides and entry.left_side and entry.right_side and left_words and right_words:
                        left_hit = any(self._side_has_token(entry.left_side, lw, fuzzy_map) for lw in left_words)
                        right_hit = any(self._side_has_token(entry.right_side, rw, fuzzy_map) for rw in right_words)
                        if left_hit and right_hit:
                            score += 320.0
                            both_sides_matched = True
                        else:
                            # Also accept swapped side ordering (e.g. "Molina vs. Republic").
                            swap_l = any(self._side_has_token(entry.right_side, lw, fuzzy_map) for lw in left_words)
                            swap_r = any(self._side_has_token(entry.left_side, rw, fuzzy_map) for rw in right_words)
                            if swap_l and swap_r:
                                score += 260.0
                                both_sides_matched = True

                    if not docket_hit and len(title_tokens) >= 2 and coverage < 0.5 and distinctive_hits == 0:
                        continue

            if score <= 0.0:
                continue
            if not entry.is_docket_title:
                score += 35.0
            scored.append((score, both_sides_matched, entry))

        scored.sort(key=lambda triple: triple[0], reverse=True)
        if not scored:
            return []

        # If a two-sided query with distinctive parties on both sides found two-sided match(es), prune single-side noise.
        if require_both_sides_if_found and any(flag for _, flag, _ in scored):
            scored = [item for item in scored if item[1]]

        # Prune weak tail candidates far below a dominant exact match so unrelated cases cannot pollute citations.
        top_score = scored[0][0]
        min_ratio = 0.72 if top_score >= 800.0 else 0.60
        scored = [item for item in scored if item[0] >= top_score * min_ratio]

        top = scored[:max_results]
        max_score = top[0][0] if top else 1.0
        results: List[Dict[str, Any]] = []
        for s, _, entry in top:
            # Map raw score cleanly into calibrated [0.90, 0.99] exact-match similarity band.
            norm_sim = round(min(0.99, 0.90 + 0.09 * (s / max(max_score, 1.0))), 3)
            results.append(
                {
                    "case_uid": entry.case_uid,
                    "title": entry.title,
                    "gr_number": format_clean_gr_number(entry.gr_number) or entry.gr_number,
                    "decision_date": entry.decision_date,
                    "match_score": round(s, 2),
                    "sim": norm_sim,
                }
            )
        return results


def build_jurisprudence_index(rows: List[Dict[str, Any]], header_map: Dict[str, str]) -> JurisprudenceIndex:
    doc_freq: Dict[str, int] = {}
    entries: List[_CaseEntry] = []
    docket_to_indices: Dict[str, List[int]] = {}

    for idx, row in enumerate(rows):
        uid = str(row.get("case_uid") or "")
        gr = str(row.get("gr_number") or "")
        title = str(row.get("title") or "")
        decision_date = str(row.get("decision_date") or "")

        cleaned_title = clean_text(title)
        title_words = tokenize_words(cleaned_title)
        title_text = " ".join(title_words)
        compact_title = "".join(title_words)
        all_tokens = frozenset(title_words)

        aliases: Set[str] = set()
        for w in title_words:
            for exp in TOKEN_ALIASES.get(w, ()):
                aliases.add(exp)
        for full_phrase, acro in PHRASE_ACRONYMS:
            if full_phrase in title_text:
                aliases.add(acro)

        for tok in all_tokens:
            doc_freq[tok] = doc_freq.get(tok, 0) + 1

        series, codes, numbers = extract_docket_signals(gr, is_query=False)
        is_docket_title = bool(_DOCKET_TITLE_PREFIX_RE.match(title.strip()))
        if is_docket_title:
            t_ser, t_codes, t_nums = extract_docket_signals(title, is_query=False)
            series |= t_ser
            codes |= t_codes
            numbers |= t_nums

        header_snippet = header_map.get(uid)
        if header_snippet:
            for m in _DOCKET_HEADER_RE.finditer(header_snippet):
                h_ser, h_codes, h_nums = extract_docket_signals(m.group(0), is_query=False)
                series |= h_ser
                codes |= h_codes
                numbers |= h_nums

        for code in codes | numbers:
            docket_to_indices.setdefault(code, []).append(idx)

        sides = _SIDE_SPLIT_RE.split(cleaned_title)
        left_side = _build_side_data(sides[0]) if len(sides) >= 2 else None
        right_side = _build_side_data(" ".join(sides[1:])) if len(sides) >= 2 else None

        entries.append(
            _CaseEntry(
                case_uid=uid,
                title=title,
                gr_number=gr,
                decision_date=decision_date,
                is_docket_title=is_docket_title,
                title_text=title_text,
                compact_title=compact_title,
                title_tokens=all_tokens,
                alias_tokens=frozenset(aliases),
                left_side=left_side,
                right_side=right_side,
                series=frozenset(series),
                docket_codes=frozenset(codes),
                docket_numbers=frozenset(numbers),
            )
        )

    total_docs = max(len(entries), 1)
    idf = {tok: math.log(1.0 + total_docs / (1.0 + df)) for tok, df in doc_freq.items()}
    vocab_by_len: Dict[int, List[str]] = {}
    for tok in doc_freq:
        if len(tok) >= 3 and not tok.isdigit():
            vocab_by_len.setdefault(len(tok), []).append(tok)

    return JurisprudenceIndex(
        entries=entries,
        idf=idf,
        vocab_by_len=vocab_by_len,
        docket_to_indices=docket_to_indices,
    )


_cache_lock = threading.Lock()
_cached_index: Optional[JurisprudenceIndex] = None
_cache_expires_at: float = 0.0


def invalidate_jurisprudence_index_cache() -> None:
    global _cached_index, _cache_expires_at
    with _cache_lock:
        _cached_index = None
        _cache_expires_at = 0.0


def get_jurisprudence_index(conn) -> JurisprudenceIndex:
    global _cached_index, _cache_expires_at
    now = time.monotonic()
    if _cached_index is not None and now < _cache_expires_at:
        return _cached_index

    with _cache_lock:
        now = time.monotonic()
        if _cached_index is not None and now < _cache_expires_at:
            return _cached_index

        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT case_uid, COALESCE(gr_number, ''), COALESCE(title, ''), COALESCE(decision_date, '')
                FROM jurisprudence_cases
                """
            )
            rows = [
                {
                    "case_uid": r[0],
                    "gr_number": r[1],
                    "title": r[2],
                    "decision_date": r[3],
                }
                for r in cur.fetchall()
            ]
            # Hydrate header snippets only for any rows still lacking digits in gr_number.
            cur.execute(
                """
                SELECT case_uid, LEFT(COALESCE(NULLIF(content_summary, 'Summary unavailable.'), full_text, ''), 300)
                FROM jurisprudence_cases
                WHERE gr_number IS NULL OR gr_number !~ '[0-9]'
                """
            )
            header_map = {r[0]: r[1] for r in cur.fetchall() if r[1]}

        _cached_index = build_jurisprudence_index(rows, header_map)
        _cache_expires_at = time.monotonic() + INDEX_TTL_SECONDS
        return _cached_index


def search_jurisprudence_cases(conn, raw_query: str, max_results: int = 4) -> List[Dict[str, Any]]:
    """Search jurisprudence cases by normalized docket, consolidated range, acronym, Unicode, or party."""
    index = get_jurisprudence_index(conn)
    return index.search(raw_query, max_results=max_results)
