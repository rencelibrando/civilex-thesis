"""
CIVIL-LEX: Neuro-Symbolic Hybrid Natural Language Inference (NLI) Engine
========================================================================
Production-grade hybrid verification engine combining white-box deterministic
symbolic logic rules with local neural inference (Gemma 4 E4B via LM Studio)
for verifying faithfulness of generated Philippine civil law answers against
retrieved statutory context.

Architecture:
    1. Atomic Proposition Decomposition — splits generated text into
       truth-evaluable legal assertions, pruning procedural headers.
    2. Deontic Modality & Polarity Parsing — identifies obligation (SHALL),
       permission (MAY), prohibition (CANNOT), and negation operators.
    3. Philippine Civil Law Synonym Dictionaries — maps canonical statutory
       equivalences (rescission ≡ resolution ≡ cancellation, etc.).
    4. Deterministic Symbolic Inference Rules:
       a. Statutory Anchor Validation (cited Art. X present in context?)
       b. Deontic / Polarity Contradiction Detection (Absolute Symbolic Veto)
       c. Asymmetric Lexical Containment (Fast-path Horn-clause entailment)
    5. Local Neural NLI Inference (Gemma in LM Studio):
       Evaluates semantic entailment, complex paraphrasing, and legal deductions
       for claims where symbolic rules are neutral or borderline.
    6. Hybrid Verdict Arbitration & Fusion:
       - Symbolic contradictions override neural predictions (Zero Tolerance).
       - Unsupported statutory anchors cap at neutral (Citation Defense).
       - Neural entailment upgrades valid semantic paraphrases.
       - Graceful degradation to pure symbolic rules if LM Studio is offline.
    7. Calibrated Faithfulness Score:
       Standard RAGAS: F_net = max(0, (|V_entailed| - |V_contradicted|) / |S_total|)
       Status = 'Grounded' if F_net >= 0.80 and |V_contradicted| == 0 else 'Unverified'
"""

from __future__ import annotations

import re
import json
import logging
from dataclasses import dataclass, field
from typing import List, Optional, Dict
import httpx

from core.config import LM_STUDIO_URL


# ---------------------------------------------------------------------------
# 1. DATA STRUCTURES
# ---------------------------------------------------------------------------

@dataclass
class ClaimVerdict:
    """Result of verifying a single atomic claim against context premises."""
    claim: str
    verdict: str        # 'entailed', 'neutral', 'contradicted'
    confidence: float   # 1.0 = entailed, 0.0 = neutral, -1.0 = contradicted
    matched_premise: str = ""
    rule_fired: str = ""  # Which symbolic rule or neural model triggered the verdict
    statutory_refs: List[str] = field(default_factory=list)
    verifier: str = "symbolic"  # 'symbolic', 'gemma_neural', or 'hybrid'
    rationale: str = ""


@dataclass
class FaithfulnessResult:
    """Aggregate faithfulness score for a generated answer."""
    score: float           # 0.0 – 1.0 (Standard RAGAS Net Faithfulness)
    score_percent: float   # 0.0 – 100.0
    status: str            # 'Grounded', 'Unverified', 'Out of Domain'
    claims_total: int
    claims_entailed: int
    claims_neutral: int
    claims_contradicted: int
    verdicts: List[ClaimVerdict] = field(default_factory=list)
    engine: str = "hybrid" # 'hybrid' (Gemma + Symbolic) or 'symbolic_fallback'
    score_weighted: float = 0.0 # Context-aware weighted score Option B


# ---------------------------------------------------------------------------
# 2. DEONTIC MODALITY & POLARITY LEXICON
# ---------------------------------------------------------------------------

# Obligation (□) — the obligor MUST / SHALL do something
_OBLIGATION_TOKENS = frozenset({
    'shall', 'must', 'required', 'obliged', 'obligated', 'duty',
    'mandatory', 'incumbent', 'responsible', 'bound', 'compelled',
    'directed', 'mandated', 'dapat', 'kailangan', 'obligado',
    'nararapat', 'tungkulin', 'pananagutan',
})

# Permission (◇) — the party MAY / CAN do something
_PERMISSION_TOKENS = frozenset({
    'may', 'can', 'entitled', 'allowed', 'permitted', 'option',
    'liberty', 'right', 'elect', 'choose', 'authorize', 'authorized',
    'empowered', 'privilege', 'maaari', 'maaaring', 'pwede',
    'pwedeng', 'karapatan', 'pahintulot',
})

# Prohibition (¬◇) — the party CANNOT / SHALL NOT do something
_PROHIBITION_TOKENS = frozenset({
    'cannot', 'shall not', 'must not', 'prohibited', 'barred',
    'disallowed', 'forbidden', 'void', 'ineffective', 'invalid',
    'inoperative', 'unenforceable', 'nullified', 'annulled',
    'impermissible', 'bawal', 'ipinagbabawal', 'di-maaari', 'di-pwede',
})

# Explicit negation operators (apply polarity inversion)
_NEGATION_TOKENS = frozenset({
    'not', 'no', 'neither', 'nor', 'never', 'without',
    'none', 'nothing', 'nowhere', 'lack', 'absent', 'fails',
    'failed', 'unable', 'inability', 'hindi', 'di', 'wala', 'walang',
})


# ---------------------------------------------------------------------------
# 3. PHILIPPINE CIVIL LAW SYNONYM DICTIONARIES (BILINGUAL EN / TL)
# ---------------------------------------------------------------------------
# Each key is a canonical concept ID; values are equivalent terms across
# English statutory text and Tagalog/Filipino legal discourse.

CIVIL_LEGAL_SYNONYMS: Dict[str, frozenset] = {
    # Obligations & Contracts
    'rescission': frozenset({
        'rescission', 'rescind', 'rescinded', 'resolution', 'resolve',
        'resolved', 'cancellation', 'cancel', 'cancelled', 'accion resolutoria',
        'extinguishment', 'extinguish', 'dissolution', 'dissolve', 'revoke',
        'revocation', 'annul', 'annulment', 'set aside', 'vitiate',
        'pagpapawalang-bisa', 'kanselasyon', 'pagbawi', 'resolusyon',
    }),
    'breach': frozenset({
        'breach', 'breached', 'violation', 'violated', 'non-compliance',
        'noncompliance', 'non-performance', 'nonperformance', 'infringement',
        'contravention', 'default', 'defaulted', 'failure to comply',
        'failure to perform', 'failed to comply', 'failed to perform',
        'non-fulfillment', 'nonfulfillment', 'contravene', 'contravening',
        'paglabag', 'lumabag', 'nilabag', 'pagsuway', 'di-pagtupad',
        'hindi pagtupad', 'kontrabensyon',
    }),
    'delay': frozenset({
        'delay', 'delayed', 'default', 'mora', 'mora solvendi',
        'mora accipiendi', 'late performance', 'failure to deliver',
        'failed to deliver', 'overdue', 'past due', 'delinquent',
        'delinquency', 'tardiness', 'untimely', 'incur in delay',
        'pagkaantala', 'antala', 'naantala', 'huli', 'pagkahuli',
    }),
    'obligation': frozenset({
        'obligation', 'obligations', 'duty', 'duties', 'liability',
        'liabilities', 'responsibility', 'responsibilities', 'undertaking',
        'covenant', 'stipulation', 'commitment', 'prestations',
        'obligasyon', 'tungkulin', 'pananagutan', 'responsibilidad',
    }),
    'reciprocal': frozenset({
        'reciprocal', 'bilateral', 'mutual', 'synallagmatic',
        'correlative', 'corresponding',
    }),
    'damages': frozenset({
        'damages', 'damage', 'actual damages', 'compensatory damages',
        'compensatory', 'moral damages', 'exemplary damages', 'temperate damages',
        'nominal damages', 'liquidated damages', 'indemnity', 'indemnification',
        'reparation', 'recompense', 'pecuniary loss', 'danyos', 'pinsala',
        'kabayaran sa pinsala',
    }),
    'payment': frozenset({
        'payment', 'pay', 'paid', 'performance', 'fulfillment', 'satisfaction',
        'delivery of money', 'sum of money', 'extinguishment by payment',
        'bayad', 'pagbabayad', 'binayaran', 'magbayad', 'pagtupad',
    }),
    'debt': frozenset({
        'debt', 'debts', 'loan', 'loans', 'borrower', 'lender', 'creditor',
        'debtor', 'mutuum', 'sum of money', 'money debt', 'principal',
        'utang', 'pagkakautang', 'pautang', 'bangko', 'bank',
    }),
    'fraud': frozenset({
        'fraud', 'fraudulent', 'dolo', 'deceit', 'pandaraya', 'panlilinlang',
        'daya',
    }),
    'negligence': frozenset({
        'negligence', 'fault', 'culpa', 'carelessness', 'kapabayaan',
        'pabaya',
    }),
    'liability': frozenset({
        'liability', 'liable', 'responsible', 'held liable', 'mananagot',
        'pananagutan',
    }),
    'interest': frozenset({
        'interest', 'legal interest', 'per annum', 'rate of interest',
        'interes', 'tubo',
    }),
    'demand': frozenset({
        'demand', 'demands', 'demanded', 'judicial demand', 'extrajudicial demand',
        'judicially', 'extrajudicially', 'singil', 'paniningil', 'habol',
    }),
    'contract': frozenset({
        'contract', 'contracts', 'agreement', 'loan agreement', 'kontrata',
        'kasunduan',
    }),
    'restitution': frozenset({
        'restitution', 'return', 'restore', 'restoration', 'mutual restitution',
        'mutual return', 'reimbursement', 'reimburse', 'refund', 'give back',
        'return of object', 'pagsasauli', 'ibalik',
    }),

    # Torts & Quasi-Delicts
    'quasi_delict': frozenset({
        'quasi-delict', 'quasi delict', 'quasidelict', 'tort', 'torts',
        'fault', 'negligence', 'culpa aquiliana', 'extra-contractual',
        'extracontractual', 'tortious', 'wrongful act', 'wrongful omission',
    }),
    'vicarious_liability': frozenset({
        'vicarious liability', 'vicarious', 'employer liability',
        'employer responsible', 'employer liable', 'respondeat superior',
        'imputed negligence', 'primary liability of employer',
    }),

    # Sales & Hidden Defects
    'hidden_defect': frozenset({
        'hidden defect', 'hidden defects', 'latent defect', 'latent defects',
        'redhibitory defect', 'redhibitory', 'accion redhibitoria',
        'quanti minoris', 'warranty against hidden defects', 'warranty',
        'factory defect', 'depekto',
    }),

    # Property & Accession
    'ownership': frozenset({
        'ownership', 'owner', 'proprietor', 'title', 'dominion',
        'possession', 'possessor', 'occupant', 'occupancy',
        'pagmamay-ari', 'may-ari', 'ari-arian',
    }),
    'good_faith': frozenset({
        'good faith', 'bona fide', 'in good faith', 'builder in good faith',
        'possessor in good faith',
    }),
    'bad_faith': frozenset({
        'bad faith', 'mala fide', 'in bad faith', 'builder in bad faith',
        'possessor in bad faith', 'fraudulent',
    }),

    # Succession & Wills
    'succession': frozenset({
        'succession', 'inheritance', 'heir', 'heirs', 'compulsory heir',
        'compulsory heirs', 'legitime', 'intestate', 'testate', 'testator',
        'will', 'testament', 'last will', 'decedent', 'estate',
        'mana', 'tagapagmana',
    }),

    # Family Law
    'psychological_incapacity': frozenset({
        'psychological incapacity', 'article 36', 'art 36',
        'nullity of marriage', 'void marriage', 'declaration of nullity',
    }),

    # Human Relations
    'abuse_of_right': frozenset({
        'abuse of right', 'abuse of rights', 'acts contra bonus mores',
        'good customs', 'public policy', 'unjust enrichment',
    }),
}

# ---------------------------------------------------------------------------
# 4. STOPWORDS & TOKEN EXTRACTION
# ---------------------------------------------------------------------------

_ENGLISH_STOPWORDS = frozenset({
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'under',
    'which', 'their', 'there', 'shall', 'would', 'could', 'about',
    'these', 'those', 'been', 'have', 'also', 'such', 'than',
    'into', 'upon', 'when', 'where', 'were', 'being', 'does',
    'each', 'will', 'more', 'case', 'code', 'article', 'civil',
    'republic', 'philippines', 'section', 'provision', 'provided',
})

_TAGALOG_STOPWORDS = frozenset({
    'mga', 'ang', 'sa', 'ng', 'na', 'ay', 'ito', 'kung', 'at', 'o',
    'mo', 'ko', 'inyong', 'para', 'dahil', 'upang', 'mula', 'nang',
    'bilang', 'mismo', 'hindi', 'nito', 'ninyo', 'nila', 'kami', 'tayo',
    'sila', 'kanila', 'kanya', 'namin', 'saan', 'kailan', 'paano', 'bakit',
    'sino', 'alin', 'ano', 'bawat', 'kapag', 'habang', 'bago', 'noon',
    'ngayon', 'dito', 'doon', 'diyan', 'ganito', 'ganyan', 'gayon', 'naman',
    'din', 'rin', 'pala', 'sana', 'yata', 'tulad', 'gaya', 'kahit',
    'subalit', 'ngunit', 'datapwat', 'samantala', 'artikulo', 'artikulong',
    'pangunahing', 'nagsasaad', 'sinumang', 'paraan', 'nilalaman', 'tumutukoy',
    'karaniwan', 'nakasaad', 'batay', 'kailangan', 'takdang', 'panahon',
    'tinutukoy', 'magsasagawa', 'patunayan', 'nagexist', 'kasama', 'anim',
    'porsyento', 'kada', 'taon', 'halaga', 'pera', 'nagkaroon', 'maliban',
    'kaso', 'sitwasyon', 'statutory', 'law', 'lahat', 'ibang', 'nagpapatibay',
    'mong', 'tuparin', 'maging', 'maaari', 'maaaring', 'pwede', 'pwedeng',
})

_ALL_STOPWORDS = _ENGLISH_STOPWORDS | _TAGALOG_STOPWORDS

# Build a reverse index: token -> set of canonical concept IDs
_TOKEN_TO_CONCEPTS: Dict[str, set] = {}
for _concept_id, _synonyms in CIVIL_LEGAL_SYNONYMS.items():
    for _syn in _synonyms:
        for _tok in _syn.lower().split():
            if len(_tok) > 2 and _tok not in _ALL_STOPWORDS:
                _TOKEN_TO_CONCEPTS.setdefault(_tok, set()).add(_concept_id)


# ---------------------------------------------------------------------------
# 5. HELPER FUNCTIONS
# ---------------------------------------------------------------------------

_ARTICLE_PATTERN = re.compile(
    r'(?:article|art\.?)\s*(?:no\.?\s*)?(\d+)',
    re.IGNORECASE,
)

_GR_PATTERN = re.compile(
    r'g\.?\s*r\.?\s*(?:no\.?\s*|nos\.?\s*)?([A-Za-z0-9\-]+)',
    re.IGNORECASE,
)

# Sentences that are conversational filler / discourse markers, not claims
_DISCOURSE_PREFIXES = (
    'in summary', 'in conclusion', 'to summarize', 'to conclude',
    'as mentioned', 'as stated', 'as discussed', 'based on the foregoing',
    'it is important to note', 'it should be noted', 'please note',
    'for your reference', 'i hope this helps', 'feel free to',
    'the following', 'below is', 'here is', 'here are',
    'yes', 'no', 'certainly', 'indeed', 'absolutely',
)

_LEGAL_ACTION_HEADER = re.compile(
    r'(?:legal action summary|governing civil code|competent court|'
    r'possible cause of action|pre-filing requirement|suggested follow-up|'
    r'follow-up inquiries|⚖️)',
    re.IGNORECASE,
)


def _normalize_text(text: str) -> str:
    """Lowercase and collapse whitespace."""
    return re.sub(r'\s+', ' ', text.lower().strip())


def _extract_article_ids(text: str) -> List[str]:
    """
    Extract all Civil Code Article number references as normalized IDs (e.g. 'RA386-ART1191').
    Strips retrieval slot metadata badges like [Statutory Article 2] first to prevent
    treating slot index 2 as Civil Code Article 2.
    """
    cleaned = re.sub(
        r'\[\s*(?:statutory\s+)?(?:article|jurisprudence|authority)\s+\d+\s*\]',
        '',
        text,
        flags=re.IGNORECASE,
    )
    matches = _ARTICLE_PATTERN.findall(cleaned)
    return [f"RA386-ART{m}" for m in matches]


def _extract_gr_numbers(text: str) -> List[str]:
    """Extract all G.R. No. references."""
    return _GR_PATTERN.findall(text)


def _has_negation_before(text_lower: str, target_start: int, window: int = 40) -> bool:
    """Check if any negation token appears within `window` chars before `target_start`."""
    search_region = text_lower[max(0, target_start - window):target_start]
    return any(neg in search_region for neg in (
        'not ', 'no ', 'cannot ', 'never ', 'without ', 'shall not ',
        'must not ', 'fails ', 'failed ', 'unable ',
        'hindi ', 'di ', 'walang ', 'wala ', 'bawal ',
    ))


def _get_legal_tokens(text: str) -> set:
    """Extract significant legal tokens (>2 chars, non-stopword) from text."""
    words = set(re.findall(r'\b[a-z]{3,}\b', text.lower()))
    return words - _ALL_STOPWORDS


def _classify_modality(text_lower: str) -> Optional[str]:
    """Identify the dominant deontic modality in a text fragment."""
    # Phrases like "shall not be necessary" express dispensation/permission, not prohibition
    if 'shall not be necessary' in text_lower or 'not necessary' in text_lower or 'need not' in text_lower:
        return 'permission'

    # Check prohibition first (compound negation + obligation)
    for tok in _PROHIBITION_TOKENS:
        if tok in text_lower:
            return 'prohibition'
    # Check for negation + permission = effective prohibition
    for perm_tok in _PERMISSION_TOKENS:
        idx = text_lower.find(perm_tok)
        if idx >= 0 and _has_negation_before(text_lower, idx):
            return 'prohibition'
    # Check obligation
    for tok in _OBLIGATION_TOKENS:
        pattern = r'\b' + re.escape(tok) + r'\b'
        if re.search(pattern, text_lower):
            return 'obligation'
    # Check permission
    for tok in _PERMISSION_TOKENS:
        # Avoid treating Tagalog existential 'may' ('may ibang', 'may kaso') as English modal 'may'
        if tok == 'may' and re.search(r'\bmay\s+(?:ibang|mga|utang|pananagutan|kaso|karapatan|nakasaad|bisa|halaga|pera)\b', text_lower):
            continue
        pattern = r'\b' + re.escape(tok) + r'\b'
        if re.search(pattern, text_lower):
            return 'permission'
    return None


def _has_polarity_inversion(claim_lower: str, premise_lower: str) -> bool:
    """
    Detect if a claim inverts the normative polarity of a premise.
    E.g., Premise: "may choose between fulfillment and rescission"
          Claim: "cannot rescind" or "is barred from rescission"
          Premise: "are liable for damages"
          Claim: "cannot be held liable" or "hindi mananagot"
    """
    claim_modality = _classify_modality(claim_lower)
    premise_modality = _classify_modality(premise_lower)

    if claim_modality and premise_modality:
        # Permission in premise + Prohibition in claim = contradiction
        if premise_modality == 'permission' and claim_modality == 'prohibition':
            return True
        # Obligation in premise + Prohibition in claim = contradiction
        if premise_modality == 'obligation' and claim_modality == 'prohibition':
            return True
        # Prohibition in premise + Permission/Obligation in claim = contradiction
        if premise_modality == 'prohibition' and claim_modality in ('permission', 'obligation'):
            return True

    # Direct negation targeting specific shared legal predicates
    direct_refutations = [
        (('not liable', 'no liability', 'exempt from liability', 'hindi mananagot', 'walang pananagutan', 'free from liability'),
         ('liable', 'liability', 'mananagot', 'pananagutan')),
        (('cannot rescind', 'no right to rescind', 'bawal mag-rescind', 'hindi pwedeng mag-rescind', 'barred from rescission'),
         ('rescind', 'rescission', 'resolution')),
        (('no delay', 'not in delay', 'walang delay', 'hindi naantala'),
         ('incur in delay', 'delay', 'mora')),
        (('not valid', 'void', 'invalid', 'walang bisa', 'ineffective'),
         ('valid', 'validity', 'binding', 'enforceable')),
        (('no interest', 'without interest', 'walang interes'),
         ('legal interest', 'payment of interest', 'with interest', 'produces interest')),
    ]
    for neg_patterns, pos_patterns in direct_refutations:
        claim_has_neg = any(p in claim_lower for p in neg_patterns)
        claim_has_pos = any(p in claim_lower for p in pos_patterns) and not claim_has_neg
        premise_has_neg = any(p in premise_lower for p in neg_patterns)
        premise_has_pos = any(p in premise_lower for p in pos_patterns) and not premise_has_neg

        if (claim_has_neg and premise_has_pos) or (claim_has_pos and premise_has_neg):
            return True

    return False


def _compute_lexical_coverage(claim_lower: str, premise_lower: str) -> float:
    """
    Asymmetric Jaccard-like containment: proportion of claim's legal tokens
    that are present in the premise. Uses bilingual synonym expansion.
    """
    claim_tokens = _get_legal_tokens(claim_lower)
    if not claim_tokens:
        return 0.0

    premise_tokens = _get_legal_tokens(premise_lower)

    # Expand premise tokens with bilingual synonym mappings
    expanded_premise = set(premise_tokens)
    for tok in premise_tokens:
        if tok in _TOKEN_TO_CONCEPTS:
            for concept_id in _TOKEN_TO_CONCEPTS[tok]:
                for s in CIVIL_LEGAL_SYNONYMS[concept_id]:
                    expanded_premise.update(s.lower().split())

    matched = 0
    for tok in claim_tokens:
        if tok in expanded_premise:
            matched += 1
        elif tok in _TOKEN_TO_CONCEPTS:
            for concept_id in _TOKEN_TO_CONCEPTS[tok]:
                if any(syn_word in premise_tokens for syn in CIVIL_LEGAL_SYNONYMS[concept_id] for syn_word in syn.lower().split()):
                    matched += 1
                    break

    return matched / len(claim_tokens)


# ---------------------------------------------------------------------------
# 6. ATOMIC PROPOSITION DECOMPOSITION
# ---------------------------------------------------------------------------

def decompose_claims(text: str) -> List[str]:
    """
    Decomposes a generated legal response into atomic, truth-evaluable
    propositions suitable for NLI verification.

    Strategy:
        1. Strip markdown formatting (headers, bullets, bold/italic markers).
        2. Protect abbreviations ('Art.', 'Sec.', 'G.R. No.') and ellipses from
           splitting prematurely.
        3. Split on sentence boundaries ([.!?\\n]) and legal clause delimiters.
        4. Discard discourse filler, structural headers, procedural court thresholds,
           and suggested follow-up questions.
        5. Retain meaningful legal assertions with length > 15 characters.
    """
    if not text or not text.strip():
        return []

    # Strip markdown formatting
    cleaned = re.sub(r'#{1,6}\s*', '', text)               # Headers
    cleaned = re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', cleaned)  # Bold/italic
    cleaned = re.sub(r'`([^`]+)`', r'\1', cleaned)         # Inline code
    cleaned = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', cleaned)  # Links
    cleaned = re.sub(r'[>\-•●]\s*', '', cleaned)           # Bullet/quote markers
    cleaned = re.sub(r'⚖️', '', cleaned)                   # Emoji markers

    # Protect abbreviations and ellipses before punctuation splitting
    cleaned = re.sub(r'\bArt\.\s*', 'Art_DOT_', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\bG\.R\.\s*No\.\s*', 'GR_NO_DOT_', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\bSec\.\s*', 'Sec_DOT_', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\bvs\.\s*', 'vs_DOT_', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\bNo\.\s*', 'No_DOT_', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\bet\s+al\.\s*', 'et_al_DOT_', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\.\.\.', '_ELLIPSIS_', cleaned)

    # Split into candidate sentences
    raw_fragments = re.split(r'(?<=[.!?])\s+|(?<=\n)\s*|\s*;\s*', cleaned)

    # Further split on legal clause coordinators when they create independent clauses
    expanded = []
    for frag in raw_fragments:
        sub_parts = re.split(r'\b(?:provided that|whereas)\b', frag, flags=re.IGNORECASE)
        expanded.extend(sub_parts)

    claims = []
    _STRUCTURAL_HEADER_RE = re.compile(
        r'^(?:governing statutory basis|statutory basis|application to facts|'
        r'legal action summary|competent court|possible cause of action|'
        r'pre-filing requirement|suggested follow-up|follow-up inquiries|'
        r'liability for breach of obligation|damages and interest|'
        r'governing civil code article|possible cause of action to file)',
        re.IGNORECASE
    )

    for frag in expanded:
        # Restore protected abbreviations
        frag = (frag.replace('Art_DOT_', 'Art. ')
                    .replace('GR_NO_DOT_', 'G.R. No. ')
                    .replace('Sec_DOT_', 'Sec. ')
                    .replace('vs_DOT_', 'vs. ')
                    .replace('No_DOT_', 'No. ')
                    .replace('et_al_DOT_', 'et al. ')
                    .replace('_ELLIPSIS_', '...'))
        frag = frag.strip()
        if len(frag) < 16:
            continue

        frag_lower = frag.lower().strip()

        # Skip follow-up suggestion questions
        if frag.endswith('?'):
            continue

        # Skip discourse filler
        if any(frag_lower.startswith(prefix) for prefix in _DISCOURSE_PREFIXES):
            continue

        # Skip structural section titles and Legal Action Summary bullet prefixes
        if _LEGAL_ACTION_HEADER.search(frag_lower) or _STRUCTURAL_HEADER_RE.search(frag_lower.rstrip(':')):
            continue

        # Skip lines ending with colon that are short subheaders
        if frag.endswith(':') and len(frag) < 45:
            continue

        # Skip purely procedural Court thresholds (MTC/RTC/Small Claims) that do not assert RA 386 articles
        if any(court_kw in frag_lower for court_kw in (
            'municipal trial court', 'regional trial court', 'barangay',
            'small claims court', 'family court', 'pre-filing requirement',
            'possible cause of action to file',
        )) and not _extract_article_ids(frag):
            continue

        # Skip lines that are purely citation references with no assertion
        if re.match(r'^[\[\(]?(?:art(?:icle)?\.?\s*\d+|g\.?\s*r\.?\s*no)', frag_lower) and len(frag) < 40:
            continue

        claims.append(frag)

    return claims


# ---------------------------------------------------------------------------
# 7. PER-CLAIM SYMBOLIC VERIFICATION
# ---------------------------------------------------------------------------

def _split_context_to_premises(context: str) -> List[str]:
    """Split context text into individual premise sentences."""
    if not context:
        return []
    sentences = re.split(r'(?<=[.!?])\s+|\n+', context)
    return [s.strip() for s in sentences if len(s.strip()) > 10]


def verify_claim_symbolic(
    claim: str,
    context_premises: List[str],
    context_article_ids: set,
) -> ClaimVerdict:
    """
    Evaluates a single atomic claim against context premises using
    symbolic logic, deontic modality analysis, and lexical containment.

    Rules (applied in priority order):
        Rule 1: Statutory Anchor Validation
        Rule 2: Deontic / Polarity Contradiction
        Rule 3: Polarity Inversion Contradiction
        Rule 4: Asymmetric Lexical Containment (Entailment)
    """
    claim_lower = _normalize_text(claim)
    claim_article_ids = set(_extract_article_ids(claim))

    # ── Rule 1: Statutory Anchor Validation ──
    # If the claim cites a specific Article and that Article is NOT in context
    if claim_article_ids:
        unsupported = claim_article_ids - context_article_ids
        if unsupported:
            return ClaimVerdict(
                claim=claim,
                verdict='neutral',
                confidence=0.0,
                rule_fired='R1_unsupported_statutory_anchor',
                statutory_refs=list(unsupported),
                matched_premise='',
            )

    # Find the best matching premise for this claim
    best_coverage = 0.0
    best_premise = ""

    for premise in context_premises:
        premise_lower = _normalize_text(premise)
        coverage = _compute_lexical_coverage(claim_lower, premise_lower)
        if coverage > best_coverage:
            best_coverage = coverage
            best_premise = premise

    best_premise_lower = _normalize_text(best_premise) if best_premise else ""

    # ── Rule 2 & 3: Deontic & Polarity Contradiction ──
    if best_premise and best_coverage >= 0.25:
        if _has_polarity_inversion(claim_lower, best_premise_lower):
            return ClaimVerdict(
                claim=claim,
                verdict='contradicted',
                confidence=-1.0,
                rule_fired='R2_deontic_polarity_contradiction',
                statutory_refs=list(claim_article_ids),
                matched_premise=best_premise[:200],
            )

    # ── Rule 4: Asymmetric Lexical Containment (Entailment) ──
    # Case A: Explicitly anchored to supported statutory articles with lexical backing
    if claim_article_ids and claim_article_ids <= context_article_ids:
        if best_coverage >= 0.35 or len(_get_legal_tokens(claim_lower)) <= 3:
            return ClaimVerdict(
                claim=claim,
                verdict='entailed',
                confidence=1.0,
                rule_fired='R4_lexical_containment_with_anchor',
                statutory_refs=list(claim_article_ids),
                matched_premise=best_premise[:200] if best_premise else '',
            )

    # Case B: General proposition with high lexical containment
    if best_coverage >= 0.45:
        return ClaimVerdict(
            claim=claim,
            verdict='entailed',
            confidence=1.0,
            rule_fired='R4_lexical_containment',
            statutory_refs=[],
            matched_premise=best_premise[:200] if best_premise else '',
        )

    # ── Default: Neutral ──
    return ClaimVerdict(
        claim=claim,
        verdict='neutral',
        confidence=0.0,
        rule_fired='R_default_neutral',
        statutory_refs=list(claim_article_ids),
        matched_premise=best_premise[:200] if best_premise else '',
    )


# ---------------------------------------------------------------------------
# 7. GEMMA NEURAL NLI VERIFIER (LM STUDIO ENDPOINT)
# ---------------------------------------------------------------------------

def _build_gemma_nli_prompt(claims_to_verify: List[tuple[int, str]], context_text: str) -> str:
    """Builds a batched NLI evaluation prompt for Gemma 4 (E4B) in LM Studio."""
    truncated_context = context_text[:5000].strip()
    claims_formatted = "\n".join([f"[{cid}] {claim}" for cid, claim in claims_to_verify])
    return (
        "You are an expert Philippine Civil Law Natural Language Inference (NLI) evaluator.\n"
        "Your role is to rigorously check whether legal assertions made in an answer are logically supported (entailed), contradicted, or neutral with respect to the provided statutory context premises.\n\n"
        "DEFINITIONS:\n"
        "- entailed: The premise directly supports or logically necessitates the claim (including valid legal paraphrases, statutory requisites, and direct applications of the statutory rule).\n"
        "- contradicted: The claim asserts a legal rule or factual conclusion that contradicts or inverts the premise (e.g., claiming a party cannot rescind when the premise permits it, or claiming no liability when the premise imposes it).\n"
        "- neutral: The premise neither proves nor disproves the claim (e.g., outside facts, unstated procedural steps, or assumptions not found in the premise).\n\n"
        f"STATUTORY CONTEXT PREMISES:\n{truncated_context}\n\n"
        f"LEGAL CLAIMS TO EVALUATE:\n{claims_formatted}\n\n"
        "TASK:\n"
        "Evaluate each claim against the premises. Output strictly valid JSON with a list of objects:\n"
        "[\n"
        '  {"id": <int>, "verdict": "entailed"|"neutral"|"contradicted", "reason": "<short 1-sentence reason>"}\n'
        "]"
    )


def _parse_gemma_nli_response(raw_text: str) -> Dict[int, dict]:
    """Parses JSON verdicts from Gemma output into a dictionary keyed by claim index."""
    results = {}
    if not raw_text or not raw_text.strip():
        return results

    text = raw_text.strip()
    # Strip markdown code block if present
    match = re.search(r'```(?:json)?\s*(\[\s*\{.*?\}\s*\])\s*```', text, re.DOTALL)
    if match:
        json_str = match.group(1)
    else:
        array_match = re.search(r'(\[\s*\{.*?\}\s*\])', text, re.DOTALL)
        json_str = array_match.group(1) if array_match else text

    try:
        data = json.loads(json_str)
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and 'id' in item and 'verdict' in item:
                    try:
                        cid = int(item['id'])
                        v = str(item['verdict']).lower().strip()
                        if v in ('entailed', 'neutral', 'contradicted'):
                            results[cid] = {
                                'verdict': v,
                                'reason': str(item.get('reason', '')).strip()
                            }
                    except (ValueError, TypeError):
                        continue
    except json.JSONDecodeError:
        logging.warning("Failed to parse Gemma NLI JSON response; falling back to symbolic verdicts.")

    return results


def verify_claims_gemma_sync(
    claims_to_verify: List[tuple[int, str]],
    context_text: str,
    timeout: float = 30.0,
) -> Dict[int, dict]:
    """Synchronously queries Gemma in LM Studio for batched NLI evaluation."""
    if not claims_to_verify:
        return {}

    url = f"{LM_STUDIO_URL.rstrip('/')}/chat/completions"
    prompt = _build_gemma_nli_prompt(claims_to_verify, context_text)

    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(
                url,
                json={
                    "model": "local-model",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.0,
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                raw_text = data["choices"][0]["message"]["content"]
                return _parse_gemma_nli_response(raw_text)
            else:
                logging.warning(f"LM Studio NLI HTTP {resp.status_code}: {resp.text[:100]}")
    except (httpx.ConnectError, httpx.TimeoutException) as e:
        logging.info(f"LM Studio unavailable for NLI ({type(e).__name__}); using symbolic fallback.")
    except Exception as e:
        logging.warning(f"Unexpected error calling LM Studio NLI: {type(e).__name__} - {e}")

    return {}


async def verify_claims_gemma_async(
    claims_to_verify: List[tuple[int, str]],
    context_text: str,
    timeout: float = 30.0,
) -> Dict[int, dict]:
    """Asynchronously queries Gemma in LM Studio for batched NLI evaluation."""
    if not claims_to_verify:
        return {}

    url = f"{LM_STUDIO_URL.rstrip('/')}/chat/completions"
    prompt = _build_gemma_nli_prompt(claims_to_verify, context_text)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                url,
                json={
                    "model": "local-model",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.0,
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                raw_text = data["choices"][0]["message"]["content"]
                return _parse_gemma_nli_response(raw_text)
            else:
                logging.warning(f"LM Studio NLI HTTP {resp.status_code}: {resp.text[:100]}")
    except (httpx.ConnectError, httpx.TimeoutException) as e:
        logging.info(f"LM Studio unavailable for NLI ({type(e).__name__}); using symbolic fallback.")
    except Exception as e:
        logging.warning(f"Unexpected error calling LM Studio NLI: {type(e).__name__} - {e}")

    return {}


# ---------------------------------------------------------------------------
# 8. HYBRID ARBITRATION & AGGREGATE FAITHFULNESS SCORING
# ---------------------------------------------------------------------------

def _arbitrate_hybrid_verdicts(
    verdicts: List[ClaimVerdict],
    gemma_results: Dict[int, dict],
) -> tuple[List[ClaimVerdict], str]:
    """
    Arbitrates between deterministic symbolic rules and Gemma neural verdicts.

    Arbitration Truth Table:
        1. Symbolic Contradiction (Rule 2) -> Absolute Veto (contradicted).
        2. Unsupported Statutory Anchor (Rule 1) -> Capped at neutral (cannot ground absent article).
        3. High Lexical Containment (Rule 4) -> Fast-path confirmed (entailed).
        4. Borderline / Neutral Symbolic Verdict -> Gemma verdict applied:
           - Gemma entailed -> Entailed (R_hybrid_gemma_entailment)
           - Gemma contradicted -> Contradicted (R_hybrid_gemma_contradiction)
           - Gemma neutral -> Neutral
    """
    engine_used = "hybrid" if gemma_results else "symbolic_fallback"

    for idx, v in enumerate(verdicts):
        # Rule 1: Symbolic contradiction is an absolute veto
        if v.verdict == 'contradicted' and v.rule_fired == 'R2_deontic_polarity_contradiction':
            continue

        # Rule 2: Unsupported statutory anchor cannot be upgraded to entailed
        if v.rule_fired == 'R1_unsupported_statutory_anchor':
            continue

        # Rule 3: High lexical containment fast-path
        if v.verdict == 'entailed':
            continue

        # Rule 4: Borderline / neutral claim checked by Gemma
        if idx in gemma_results:
            g_eval = gemma_results[idx]
            g_verdict = g_eval['verdict']
            g_reason = g_eval.get('reason', '')

            if g_verdict == 'entailed':
                v.verdict = 'entailed'
                v.confidence = 1.0
                v.rule_fired = 'R_hybrid_gemma_entailment'
                v.verifier = 'gemma_neural'
                v.rationale = g_reason
            elif g_verdict == 'contradicted':
                v.verdict = 'contradicted'
                v.confidence = -1.0
                v.rule_fired = 'R_hybrid_gemma_contradiction'
                v.verifier = 'gemma_neural'
                v.rationale = g_reason
            elif g_verdict == 'neutral':
                v.verifier = 'gemma_neural'
                v.rationale = g_reason

    return verdicts, engine_used


def _normalize_context_payload(context: str | list) -> tuple[str, set]:
    """Extracts concatenated text and article IDs from context string or chunk dict list."""
    if isinstance(context, list):
        context_text = "\n\n".join(
            c.get('content', '') if isinstance(c, dict) else str(c)
            for c in context
        )
        context_article_ids = set()
        for c in context:
            if isinstance(c, dict):
                pid = c.get('parent_id', '')
                if pid and pid.startswith('RA386-ART'):
                    context_article_ids.add(pid)
                context_article_ids.update(_extract_article_ids(c.get('content', '')))
    else:
        context_text = str(context)
        context_article_ids = set(_extract_article_ids(context_text))

    return context_text, context_article_ids


def _compute_faithfulness_result(
    verdicts: List[ClaimVerdict],
    engine: str,
) -> FaithfulnessResult:
    """Computes aggregate metrics from arbitrated claim verdicts."""
    n_total = len(verdicts)
    n_entailed = sum(1 for v in verdicts if v.verdict == 'entailed')
    n_neutral = sum(1 for v in verdicts if v.verdict == 'neutral')
    n_contradicted = sum(1 for v in verdicts if v.verdict == 'contradicted')

    # Primary: Standard RAGAS Net Faithfulness with contradiction penalty
    if n_total > 0:
        f_net = max(0.0, (n_entailed - n_contradicted) / n_total)
        # Context-aware weighted score Option B (partial credit 0.35 for neutral, 2x contradiction penalty)
        f_weighted = min(100.0, max(0.0, ((n_entailed + 0.35 * n_neutral - 2.0 * n_contradicted) / n_total) * 100.0))
    else:
        f_net = 0.0
        f_weighted = 0.0

    score_pct = round(f_net * 100.0, 1)

    # Status determination: Zero tolerance for contradictions
    if n_contradicted > 0:
        status = 'Unverified'
    elif score_pct >= 80.0:
        status = 'Grounded'
    else:
        status = 'Unverified'

    logging.info(
        f"NLI Faithfulness ({engine}): {score_pct}% ({status}) | "
        f"Claims: {n_total} total, {n_entailed} entailed, "
        f"{n_neutral} neutral, {n_contradicted} contradicted"
    )

    return FaithfulnessResult(
        score=f_net,
        score_percent=score_pct,
        status=status,
        claims_total=n_total,
        claims_entailed=n_entailed,
        claims_neutral=n_neutral,
        claims_contradicted=n_contradicted,
        verdicts=verdicts,
        engine=engine,
        score_weighted=round(f_weighted, 1),
    )


def score_faithfulness(
    answer: str,
    context: str | list,
    mode: str = "hybrid",
) -> FaithfulnessResult:
    """
    Synchronously evaluates the faithfulness of a generated answer against the retrieved context.

    Uses the Neuro-Symbolic Hybrid architecture:
        - Runs fast deterministic symbolic rules.
        - If mode == 'hybrid', queries Gemma in LM Studio for neutral/paraphrased claims.
        - Falls back gracefully to pure symbolic verdicts if LM Studio is offline.

    Args:
        answer: The full generated response text.
        context: Concatenated context string or list of chunk dicts.
        mode: 'hybrid' (Gemma + Symbolic) or 'symbolic' (pure deterministic rules).

    Returns:
        FaithfulnessResult with score, status, verdicts, and engine metadata.
    """
    if not answer or not answer.strip():
        return FaithfulnessResult(
            score=0.0, score_percent=0.0, status='Unverified',
            claims_total=0, claims_entailed=0, claims_neutral=0,
            claims_contradicted=0, verdicts=[], engine=mode,
        )

    context_text, context_article_ids = _normalize_context_payload(context)

    if not context_text or not context_text.strip():
        return FaithfulnessResult(
            score=0.0, score_percent=0.0, status='Unverified',
            claims_total=0, claims_entailed=0, claims_neutral=0,
            claims_contradicted=0, verdicts=[], engine=mode,
        )

    claims = decompose_claims(answer)
    if not claims:
        return FaithfulnessResult(
            score=1.0, score_percent=100.0, status='Grounded',
            claims_total=0, claims_entailed=0, claims_neutral=0,
            claims_contradicted=0, verdicts=[], engine=mode,
            score_weighted=100.0,
        )

    context_premises = _split_context_to_premises(context_text)

    # Step 1: Initial symbolic evaluation
    verdicts: List[ClaimVerdict] = []
    for claim in claims:
        v = verify_claim_symbolic(claim, context_premises, context_article_ids)
        verdicts.append(v)

    # Step 2: If hybrid mode, gather neutral claims for Gemma neural evaluation
    engine = "symbolic"
    if mode == "hybrid":
        neutral_candidates = [
            (idx, v.claim)
            for idx, v in enumerate(verdicts)
            if v.verdict == 'neutral' and v.rule_fired != 'R1_unsupported_statutory_anchor'
        ]
        if neutral_candidates:
            gemma_results = verify_claims_gemma_sync(neutral_candidates, context_text)
            verdicts, engine = _arbitrate_hybrid_verdicts(verdicts, gemma_results)

    return _compute_faithfulness_result(verdicts, engine)


async def score_faithfulness_async(
    answer: str,
    context: str | list,
    mode: str = "hybrid",
) -> FaithfulnessResult:
    """
    Asynchronously evaluates the faithfulness of a generated answer against the retrieved context.

    Non-blocking version for FastAPI streaming pipelines.
    """
    if not answer or not answer.strip():
        return FaithfulnessResult(
            score=0.0, score_percent=0.0, status='Unverified',
            claims_total=0, claims_entailed=0, claims_neutral=0,
            claims_contradicted=0, verdicts=[], engine=mode,
        )

    context_text, context_article_ids = _normalize_context_payload(context)

    if not context_text or not context_text.strip():
        return FaithfulnessResult(
            score=0.0, score_percent=0.0, status='Unverified',
            claims_total=0, claims_entailed=0, claims_neutral=0,
            claims_contradicted=0, verdicts=[], engine=mode,
        )

    claims = decompose_claims(answer)
    if not claims:
        return FaithfulnessResult(
            score=1.0, score_percent=100.0, status='Grounded',
            claims_total=0, claims_entailed=0, claims_neutral=0,
            claims_contradicted=0, verdicts=[], engine=mode,
            score_weighted=100.0,
        )

    context_premises = _split_context_to_premises(context_text)

    # Step 1: Initial symbolic evaluation
    verdicts: List[ClaimVerdict] = []
    for claim in claims:
        v = verify_claim_symbolic(claim, context_premises, context_article_ids)
        verdicts.append(v)

    # Step 2: If hybrid mode, gather neutral claims for async Gemma neural evaluation
    engine = "symbolic"
    if mode == "hybrid":
        neutral_candidates = [
            (idx, v.claim)
            for idx, v in enumerate(verdicts)
            if v.verdict == 'neutral' and v.rule_fired != 'R1_unsupported_statutory_anchor'
        ]
        if neutral_candidates:
            gemma_results = await verify_claims_gemma_async(neutral_candidates, context_text)
            verdicts, engine = _arbitrate_hybrid_verdicts(verdicts, gemma_results)

    return _compute_faithfulness_result(verdicts, engine)

