"""
CIVIL-LEX: Neuro-Symbolic Hybrid Natural Language Inference (NLI) Engine
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
       Standard RAGAS: F = |V_entailed| / |S_total| (primary)
       Diagnostic-only: F_net = max(0, (|V_entailed| - |V_contradicted|) / |S_total|)
       Status = 'Grounded' if F >= 0.80 and |V_contradicted| == 0 else 'Unverified'
"""

from __future__ import annotations

import re
import json
import logging
from dataclasses import dataclass, field
from typing import List, Optional, Dict
from core.article_parser import parse_gr_numbers



# 1. DATA STRUCTURES

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
    score: float           # 0.0 – 1.0 (Standard RAGAS Faithfulness = entailed/total)
    score_percent: float   # 0.0 – 100.0
    status: str            # 'Grounded', 'Unverified', 'Out of Domain'
    claims_total: int
    claims_entailed: int
    claims_neutral: int
    claims_contradicted: int
    verdicts: List[ClaimVerdict] = field(default_factory=list)
    engine: str = "hybrid" # 'hybrid' (Gemma + Symbolic), 'symbolic', or 'symbolic_fallback'
    score_weighted: float = 0.0 # Context-aware weighted score Option B
    score_net: float = 0.0         # 0.0 – 1.0 diagnostic: (entailed-contradicted)/total, floored at 0
    score_net_percent: float = 0.0 # 0.0 – 100.0 diagnostic counterpart of score_net
    analysis: str = ""             # Gemma or deterministic summary analyzing the response score


# 2. DEONTIC MODALITY & POLARITY LEXICON

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


# 3. PHILIPPINE CIVIL LAW SYNONYM DICTIONARIES (BILINGUAL EN / TL)
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

    # Codal Structure & General Civil Law
    'codal_structure': frozenset({
        'structure', 'books', 'preliminary title', 'aklat', 'balangkas', 'istruktura',
        'four books', 'apat na aklat', 'preliminary', 'codified',
    }),
    'persons_family': frozenset({
        'persons', 'personality', 'marriage', 'family', 'relations', 'pagkatao',
        'personalidad', 'kasal', 'pampamilya', 'family relations', 'ugnayang pampamilya',
    }),
    'property_law': frozenset({
        'property', 'ownership', 'modifications', 'easements', 'nuisance',
        'ari-arian', 'pagmamay-ari', 'co-ownership',
    }),
    'animals_pets': frozenset({
        'animals', 'animal', 'pet', 'pets', 'hayop', 'mga hayop',
        'animal houses', 'breeding places', 'pigeon-houses', 'beehives', 'fish ponds',
        'alagang hayop', 'alaga', 'kulungan ng hayop', 'wild animals', 'tame animals',
    }),
    'obligations_contracts': frozenset({
        'obligations', 'contracts', 'sales', 'lease', 'agency', 'loan',
        'obligasyon', 'kontrata', 'pananagutan', 'danyos',
    }),
    'total_count': frozenset({
        'total articles', '2270', '2,270', 'bilang', 'kabuuang', 'articles', 'artikulo',
    }),

    # Lease & Tenancy
    'lease_tenancy': frozenset({
        'lease', 'leases', 'leased', 'lessor', 'lessee', 'tenant', 'landlord',
        'rent', 'rental', 'sublease', 'sublessee', 'ejectment', 'unlawful detainer',
        'upahan', 'upa', 'nangungupahan', 'nagpapaupa', 'paupahan', 'paalisin',
    }),

    # Co-ownership & Partition
    'co_ownership': frozenset({
        'co-ownership', 'co-owner', 'co-owners', 'undivided share', 'partition',
        'pro indiviso', 'partisyon', 'kabahagi', 'kasamang may-ari', 'hati', 'paghahati',
    }),

    # Easements & Servitudes
    'easement_servitude': frozenset({
        'easement', 'easements', 'servitude', 'servitudes', 'dominant estate',
        'servient estate', 'right of way', 'servidumbre', 'daanan', 'karapatan sa daan',
        'drainage', 'lateral support', 'subjacent support', 'light and view',
    }),

    # Usufruct
    'usufruct_rights': frozenset({
        'usufruct', 'usufructuary', 'nude owner', 'naked owner', 'fruits',
        'pakinabang', 'usufructo', 'tamasa',
    }),

    # Donation & Revocation
    'donation_revocation': frozenset({
        'donation', 'donations', 'donor', 'donee', 'gift', 'ingratitude',
        'revocation of donation', 'donasyon', 'nagkaloob', 'pinagkalooban', 'kaloob',
    }),

    # Mortgage, Pledge & Antichresis
    'mortgage_pledge': frozenset({
        'mortgage', 'mortgages', 'pledge', 'pledges', 'antichresis', 'foreclosure',
        'extrajudicial foreclosure', 'collateral', 'pactum commissorium', 'sangla',
        'pagsasangla', 'nakasangla', 'remata', 'pagka-remata', 'subasta',
    }),

    # Agency & Representation
    'agency_representation': frozenset({
        'agency', 'agent', 'principal', 'power of attorney', 'special power of attorney',
        'spa', 'mandate', 'attorney-in-fact', 'kinatawan', 'ahente', 'kapangyarihan',
    }),

    # Compromise & Settlement
    'compromise_settlement': frozenset({
        'compromise', 'settlement', 'amicable settlement', 'compromise agreement',
        'waiver', 'quitclaim', 'pagkakasundo', 'areglo', 'kasunduan sa pag-aareglo',
        'katarungang pambarangay',
    }),

    # Support & Maintenance
    'support_maintenance': frozenset({
        'support', 'spousal support', 'child support', 'support pendente lite',
        'maintenance', 'sustento', 'suporta', 'pagkain at suporta',
    }),

    # Prescription & Laches
    'prescriptive_period': frozenset({
        'prescription', 'prescriptive period', 'statute of limitations', 'laches',
        'extinctive prescription', 'acquisitive prescription', 'preskripsyon',
        'lipas ng panahon', 'nakalipas',
    }),

    # Solidary & Joint Obligations
    'solidary_joint': frozenset({
        'solidary', 'joint', 'joint and solidary', 'in solidum', 'mancomunada',
        'solidaria', 'solidary liability', 'joint liability', 'kanya-kanyang bayad',
        'sama-samang pananagutan',
    }),

    # Fortuitous Event / Force Majeure
    'fortuitous_event': frozenset({
        'fortuitous event', 'force majeure', 'caso fortuito', 'act of god',
        'unforeseen event', 'inevitable event', 'kalamidad', 'di-inaasahang pangyayari',
    }),

    # Quasi-Contract & Unjust Enrichment
    'quasi_contract': frozenset({
        'quasi-contract', 'quasi contract', 'solutio indebiti', 'negotiorum gestio',
        'unjust enrichment', 'pagsasauli ng labis na bayad', 'maling bayad',
    }),
}

# 4. STOPWORDS & TOKEN EXTRACTION

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


# 5. HELPER FUNCTIONS

_ARTICLE_PATTERN = re.compile(
    r'(?:mga\s+)?(?:articles?|arts?\.?|artikulo)\s*(?:no\.?\s*|nos\.?\s*)?(\d+)(?:\s*(?:-|to|hanggang)\s*(\d+))?',
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
    r'follow-up inquiries)',
    re.IGNORECASE,
)


def _normalize_text(text: str) -> str:
    """Lowercase, normalize curly quotes/apostrophes, and collapse whitespace."""
    normalized = text.replace('\u2019', "'").replace('\u2018', "'")
    return re.sub(r'\s+', ' ', normalized.lower().strip())


def _extract_article_ids(text: str) -> List[str]:
    """
    Extract all Civil Code Article number references as normalized IDs (e.g. 'RA386-ART1191').
    Strips retrieval slot metadata badges like [Statutory Article 2] first to prevent
    treating slot index 2 as Civil Code Article 2.
    Supports singular, plural, Tagalog, and ranges (e.g., Articles 1-36, Articles 1 to 2270).
    """
    cleaned = re.sub(
        r'\[\s*(?:statutory\s+)?(?:article|jurisprudence|authority)\s+\d+\s*\]',
        '',
        text,
        flags=re.IGNORECASE,
    )
    # Strip non-civil code article references to prevent misattributing them as RA 386 Civil Code articles
    cleaned = re.sub(
        r'(?:revised\s+penal\s+code|rpc|penal\s+code|labor\s+code|tax\s+code|nirc)\s*[\(\[]?\s*(?:mga\s+)?(?:articles?|arts?\.?|artikulo)\s*\d+[^\]\)]*[\)\]]?',
        '',
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r'(?:mga\s+)?(?:articles?|arts?\.?|artikulo)\s*\d+(?:\s*(?:to|hanggang|-)\s*\d+)?\s*(?:ng|of\s+the)\s+(?:revised\s+penal\s+code|rpc|penal\s+code|labor\s+code|tax\s+code|nirc)',
        '',
        cleaned,
        flags=re.IGNORECASE,
    )
    article_ids = set()
    for m in _ARTICLE_PATTERN.finditer(cleaned):
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else start
        if end >= start and (end - start) <= 60:
            for n in range(start, end + 1):
                article_ids.add(f"RA386-ART{n}")
        else:
            article_ids.add(f"RA386-ART{start}")
            if m.group(2):
                article_ids.add(f"RA386-ART{end}")
    return sorted(list(article_ids))


def _extract_gr_numbers(text: str) -> List[str]:
    # Extracts all G.R. No. references using canonical parser
    return parse_gr_numbers(text)


_MATRIX_NEGATION_BRIDGE_RE = re.compile(
    r"\b(?:does\s+not|doesn't|do\s+not|don't|did\s+not|didn't|cannot|can't|"
    r"will\s+not|won't|would\s+not|wouldn't|never|not)\s+"
    r"(?:(?:automatically|necessarily|inherently)\s+)?"
    r"(?:mean|imply|make|render|become)\b"
)


_LITOTES_NORMALIZERS = (
    (re.compile(r'\bnot\s+incompatible\b'), 'compatible'),
    (re.compile(r'\bnot\s+inconsistent\b'), 'consistent'),
    (re.compile(r'\bnot\s+inapplicable\b'), 'applicable'),
    (re.compile(r'\bnot\s+unlawful\b'), 'lawful'),
    (re.compile(r'\bnot\s+illegal\b'), 'legal'),
    (re.compile(r'\bnot\s+invalid\b'), 'valid'),
    (re.compile(r'\bnot\s+void\b'), 'valid'),
    (re.compile(r'\bnot\s+impossible\b'), 'possible'),
    (re.compile(r'\bnot\s+prohibited\b'), 'permitted'),
    (re.compile(r'\bnot\s+barred\b'), 'permitted'),
    (re.compile(r'\bnot\s+only\s+because\b'), 'because'),
    (re.compile(r'\bwithout\s+prejudice\b'), 'preserving'),
)


def _has_negation_before(text_lower: str, target_start: int, window: int = 40) -> bool:
    """Check if any negation token scopes over the predicate within `window` chars before `target_start`."""
    search_region = text_lower[max(0, target_start - window):target_start].replace('\u2019', "'").replace('\u2018', "'")
    for pattern, repl in _LITOTES_NORMALIZERS:
        search_region = pattern.sub(repl, search_region)
    clause_region = re.split(
        r'[.;?!,]|\b(?:but|however|whereas|although|though|ngunit|pero)\b'
        r'|\band\s+(?:before|after|until|unless|when|if)\b',
        search_region,
    )[-1]
    # Matrix negation verbs ("doesn't mean it is...", "does not automatically become...") scope over complement copulas.
    if _MATRIX_NEGATION_BRIDGE_RE.search(clause_region):
        return True
    # Otherwise limit negation scope to the current predicate so subject modifiers ("without consent is valid") stay positive.
    clause_tail = re.split(
        r'\b(?:is|are|was|were|remains?|becomes?)\s+(?!not\b|no\b|never\b|neither\b)',
        clause_region,
    )[-1]
    return any(neg in clause_tail for neg in (
        'not ', 'no ', 'cannot ', "can't ", 'never ', 'without ', 'neither ', 'nor ',
        'shall not ', 'must not ', 'did not ', "didn't ", 'does not ', "doesn't ",
        'do not ', "don't ", "isn't ", "aren't ", "wasn't ", "weren't ",
        "won't ", "wouldn't ", "couldn't ", "shouldn't ",
        'fails ', 'failed ', 'unable ', 'lacked ', 'lacks ', 'lack of ',
        'hindi ', 'di ', 'walang ', 'wala ', 'bawal ',
    ))


def _get_legal_tokens(text: str) -> set:
    """Extract significant legal tokens (>1 char alphanumeric, non-stopword) from text."""
    words = set(re.findall(r'\b[a-z0-9]{2,}\b', text.lower()))
    return words - _ALL_STOPWORDS


def _classify_modality(text_lower: str) -> Optional[str]:
    """Identify the dominant deontic modality in a text fragment."""
    # Phrases like "shall not be necessary" or "without prejudice" express dispensation/preservation, not prohibition.
    if (
        'shall not be necessary' in text_lower
        or 'not necessary' in text_lower
        or 'need not' in text_lower
        or 'without prejudice' in text_lower
    ):
        return 'permission'

    # Check prohibition first using word boundaries so "void" never matches "voidable" or "avoid".
    for tok in _PROHIBITION_TOKENS:
        if re.search(r'\b' + re.escape(tok) + r'\b', text_lower):
            return 'prohibition'
    # Check for negation + permission = effective prohibition (word-boundary matched).
    for perm_tok in _PERMISSION_TOKENS:
        for m in re.finditer(r'\b' + re.escape(perm_tok) + r'\b', text_lower):
            if _has_negation_before(text_lower, m.start()):
                return 'prohibition'
    # Check obligation
    for tok in _OBLIGATION_TOKENS:
        pattern = r'\b' + re.escape(tok) + r'\b'
        if re.search(pattern, text_lower):
            return 'obligation'
    # Check permission
    for tok in _PERMISSION_TOKENS:
        # Avoid treating Tagalog existential 'may' ('may ibang', 'may kaso', 'may kabuuang') as English modal 'may'
        if tok == 'may':
            if any(t_m in text_lower for t_m in (' ang ', ' ng ', ' sa ', ' mga ', ' ay ', ' na ', ' para ', ' mula ', ' ito ', ' at ')):
                continue
            if re.search(r'\bmay\s+(?:ibang|mga|utang|pananagutan|kaso|karapatan|nakasaad|bisa|halaga|pera|kabuuang|apat|tatlong|dalawang|isang)\b', text_lower):
                continue
        pattern = r'\b' + re.escape(tok) + r'\b'
        if re.search(pattern, text_lower):
            return 'permission'
    return None


def _extract_contract_defect_categories(text_lower: str) -> set[str]:
    """Identify mutually exclusive Book IV defective-contract categories referenced in a clause."""
    cats: set[str] = set()
    if re.search(r'\b(?:voidable|annullable)\b', text_lower) or 'unless they are annulled' in text_lower:
        cats.add('voidable')
    if (
        re.search(r'\b(?:void|inexistent)\s+(?:and\s+(?:void|inexistent)\s+)?(?:contracts?|agreements?)\b', text_lower)
        or re.search(r'\bcontracts?\s+(?:are|is)\s+(?:inexistent\s+and\s+)?void\b', text_lower)
    ):
        cats.add('void')
    if re.search(r'\brescissible\b', text_lower):
        cats.add('rescissible')
    if re.search(r'\bunenforceable\b', text_lower):
        cats.add('unenforceable')
    return cats


def _has_polarity_inversion(claim_lower: str, premise_lower: str, coverage: float = 0.0) -> bool:
    """
    Detect if a claim inverts the normative polarity of a premise.
    E.g., Premise: "may choose between fulfillment and rescission"
          Claim: "cannot rescind" or "is barred from rescission"
          Premise: "are liable for damages"
          Claim: "cannot be held liable" or "hindi mananagot"
    """
    # Do not cross-collide disjoint defective-contract categories (e.g. a rule on void contracts vs Art. 1390 on voidable contracts).
    claim_cats = _extract_contract_defect_categories(claim_lower)
    premise_cats = _extract_contract_defect_categories(premise_lower)
    if claim_cats and premise_cats and not (claim_cats & premise_cats):
        return False

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
        (('not liable for damages', 'cannot claim damages', 'walang danyos', 'no damages', 'free from damages'),
         ('liable for damages', 'entitled to damages', 'may danyos', 'award of damages', 'indemnity for damages')),
        (('no obligation to return', 'need not return', 'cannot recover', 'hindi na kailangang ibalik', 'walang pagsasauli'),
         ('mutual restitution', 'duty to return', 'obligation to return', 'must return', 'ibalik ang natanggap')),
        (('prescribed', 'barred by prescription', 'action has prescribed', 'lipas na ang panahon', 'walang karapatang maghabol dahil lumipas na'),
         ('within prescriptive period', 'action has not prescribed', 'timely filed', 'hindi pa lipas ang panahon')),
        (('no obligation to support', 'exempt from support', 'not entitled to support', 'walang karapatan sa sustento', 'hindi obligado magsustento'),
         ('obliged to support', 'duty to support', 'entitled to support', 'karapatan sa sustento', 'dapat magsustento')),
    ]
    _ATTRIBUTIVE_SUBJECT_LABEL_RE = re.compile(
        r'^\s+(?:and\s+(?:void|inexistent)\s+)?(?:contracts?|agreements?|deeds?|sales?|obligations?|marriages?)\b[^.;?!,]*\b(?:is|are|was|were|remains?|becomes?)\b'
    )

    def _classify_refutation_polarity(text_lower: str, neg_pats: tuple, pos_pats: tuple) -> tuple[bool, bool]:
        has_neg = False
        has_pos = False
        for p in neg_pats:
            for m in re.finditer(r'\b' + re.escape(p) + r'\b', text_lower):
                # Skip attributive subject labels ("a void contract is valid...") so the subject adjective does not mask a positive predicate.
                if p in ('void', 'invalid') and _ATTRIBUTIVE_SUBJECT_LABEL_RE.match(text_lower[m.end():]):
                    continue
                if _has_negation_before(text_lower, m.start(), window=50):
                    has_pos = True
                else:
                    has_neg = True
        for p in pos_pats:
            for m in re.finditer(r'\b' + re.escape(p) + r'\b', text_lower):
                if _has_negation_before(text_lower, m.start(), window=50):
                    has_neg = True
                else:
                    has_pos = True
        return has_neg, (has_pos and not has_neg)

    _PREMISE_EXCEPTION_RE = re.compile(r'\b(?:unless|except|save\s+when|provided\s+(?:that|however))\b')
    _CLAIM_CONDITIONAL_RE = re.compile(r'\b(?:if|when|provided|unless|except|until|as\s+long\s+as|kapag|kung|maliban)\b')
    premise_has_exception = bool(_PREMISE_EXCEPTION_RE.search(premise_lower))
    claim_is_conditional = bool(_CLAIM_CONDITIONAL_RE.search(claim_lower))

    for neg_patterns, pos_patterns in direct_refutations:
        claim_has_neg, claim_has_pos = _classify_refutation_polarity(claim_lower, neg_patterns, pos_patterns)
        premise_has_neg, premise_has_pos = _classify_refutation_polarity(premise_lower, neg_patterns, pos_patterns)

        if (claim_has_neg and premise_has_pos) or (claim_has_pos and premise_has_neg):
            # Guard against double-recovery proviso ("cannot recover damages twice") falsely refuting general damages claims
            if 'twice' in premise_lower and 'twice' not in claim_lower:
                continue
            # Guard against statutory-exception contrapositives ("void unless Q" == "valid if Q", e.g., Art. 41 / Art. 1390).
            if premise_has_exception and claim_is_conditional:
                continue
            return True

    # Subordinate or conditional provisos ("cannot recover damages twice", "though the property shall not be delivered till...")
    # must not trigger coarse deontic inversion against general permission/obligation claims unless the claim addresses that qualifier
    if any(q_tok in premise_lower and q_tok not in claim_lower for q_tok in ('twice', 'though ', 'although ', 'unless ', 'except ', 'until ', 'till ')):
        return False

    # Coarse deontic modality inversion requires high predicate overlap (>= 0.60) so unrelated statutory clauses do not collide
    if coverage < 0.60:
        return False

    claim_modality = _classify_modality(claim_lower)
    premise_modality = _classify_modality(premise_lower)

    if claim_modality and premise_modality:
        if premise_modality == 'permission' and claim_modality == 'prohibition':
            return True
        if premise_modality == 'obligation' and claim_modality == 'prohibition':
            return True
        if premise_modality == 'prohibition' and claim_modality in ('permission', 'obligation'):
            has_perm_in_premise = any(
                bool(re.search(r'\b' + re.escape(tok) + r'\b', premise_lower))
                for tok in _PERMISSION_TOKENS
                if tok != 'may' or not any(t_m in premise_lower for t_m in (' ang ', ' ng ', ' sa '))
            )
            if not has_perm_in_premise:
                return True

    return False


def _get_expanded_premise_tokens(premise_lower: str) -> set:
    """
    Legal tokens of a premise expanded with bilingual synonym mappings.
    Shared by single-premise and union coverage so both use identical semantics.
    """
    premise_tokens = _get_legal_tokens(premise_lower)
    expanded = set(premise_tokens)
    for tok in premise_tokens:
        if tok in _TOKEN_TO_CONCEPTS:
            for concept_id in _TOKEN_TO_CONCEPTS[tok]:
                for s in CIVIL_LEGAL_SYNONYMS[concept_id]:
                    expanded.update(s.lower().split())
    return expanded


def _compute_union_coverage(
    claim_lower: str,
    premise_lowers: List[str],
    top_k: int = 3,
) -> tuple[float, List[str]]:
    """
    Union-aware entailment coverage: ranks premises by single-premise lexical
    coverage, takes the top-k relevant ones, and measures the fraction of the
    claim's legal tokens covered by the UNION of their expanded tokens.

    A claim whose evidence spans several premises (e.g. requisites listed
    across article paragraphs) can thus be entailed even when no single
    premise alone passes the gate. Returns (coverage, relevant_premises).
    Claim-side synonym fallback mirrors _compute_lexical_coverage.
    """
    claim_tokens = _get_legal_tokens(claim_lower)
    if not claim_tokens or not premise_lowers:
        return 0.0, []

    ranked = sorted(
        ((_compute_lexical_coverage(claim_lower, p), p) for p in premise_lowers),
        key=lambda t: t[0],
        reverse=True,
    )
    relevant = [p for cov, p in ranked[:top_k] if cov > 0.0]
    if not relevant:
        return 0.0, []

    union_expanded: set = set()
    union_raw: set = set()
    for p in relevant:
        union_expanded |= _get_expanded_premise_tokens(p)
        union_raw |= _get_legal_tokens(p)

    matched = 0
    for tok in claim_tokens:
        if tok in union_expanded:
            matched += 1
        elif tok in _TOKEN_TO_CONCEPTS:
            for concept_id in _TOKEN_TO_CONCEPTS[tok]:
                if any(syn_word in union_raw for syn in CIVIL_LEGAL_SYNONYMS[concept_id] for syn_word in syn.lower().split()):
                    matched += 1
                    break

    return matched / len(claim_tokens), relevant


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
    expanded_premise = _get_expanded_premise_tokens(premise_lower)

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


# 6. ATOMIC PROPOSITION DECOMPOSITION
def decompose_claims(text: str) -> List[str]:
    """
    Decomposes a generated legal response into atomic, truth-evaluable
    propositions suitable for NLI verification.

    Strategy:
        1. Drop structural Markdown headers (###  Direct Answer...) and breadcrumb navigation lines.
        2. Strip markdown formatting (bold/italic markers, links, code, and leading bullets/quotes).
        3. Protect abbreviations ('Art.', 'Arts.', 'Artikulo', 'Sec.', 'Secs.', 'G.R. No.', 'No.') from splitting prematurely.
        4. Split on sentence boundaries ([.!?\n]) and legal clause delimiters.
        5. Discard discourse filler, structural headers, procedural court thresholds,
           and suggested follow-up questions.
        6. Retain meaningful legal assertions with length > 15 characters.
    """
    if not text or not text.strip():
        return []

    lines = []
    for line in text.splitlines():
        l_strip = line.strip()
        # Skip markdown headers entirely so header titles are not evaluated as substantive claims
        if re.match(r'^#{1,6}\s*', l_strip):
            continue
        # Skip TOC/breadcrumb navigation paths like "> GENERAL OVERVIEW > CODIFIED STRUCTURE..."
        if '>' in l_strip and any(kw in l_strip for kw in ('PRELIMINARY', 'BOOK', 'TITLE', 'CHAPTER', 'PRINCIPLES', 'CODIFIED')):
            continue
        lines.append(line)

    cleaned = '\n'.join(lines)
    cleaned = re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', cleaned)  # Bold/italic
    cleaned = re.sub(r'`([^`]+)`', r'\1', cleaned)         # Inline code
    cleaned = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', cleaned)  # Links
    cleaned = re.sub(r'(?m)^[>\s*•●\-]+\s*', '', cleaned)   # Leading bullet/quote markers only
    cleaned = re.sub(r'[\U00010000-\U0010ffff]', '', cleaned)  # Strip unicode emoji characters

    # Protect abbreviations and ellipses before punctuation splitting
    cleaned = re.sub(r'\bArts?\.\s*', 'Art_DOT_', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\bArtikulo\s*', 'Artikulo_SPACE_', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\bSecs?\.\s*', 'Sec_DOT_', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\bG\.R\.\s*Nos?\.\s*', 'GR_NO_DOT_', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\bvs\.\s*', 'vs_DOT_', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\bNos?\.\s*', 'No_DOT_', cleaned, flags=re.IGNORECASE)
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
    seen_normalized: set = set()
    _STRUCTURAL_HEADER_RE = re.compile(
        r'^(?:direct answer|legal conclusion|governing statutory basis|statutory basis|'
        r'related supreme court jurisprudence(?:\s*&\s*doctrines)?|practical legal implications|'
        r'application to facts|legal analysis|legal action summary|key statutory requisites|'
        r'requisites & elements|competent court|possible cause of action|'
        r'pre-filing requirement|suggested follow-up|follow-up inquiries|'
        r'liability for breach of obligation|damages and interest|'
        r'governing civil code article|possible cause of action to file|'
        r'halimbawa sa totoong buhay|real-life practical example|practical example)',
        re.IGNORECASE
    )

    for frag in expanded:
        # Restore protected abbreviations
        frag = (frag.replace('Art_DOT_', 'Art. ')
                    .replace('Artikulo_SPACE_', 'Artikulo ')
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
        if frag.endswith(':') and len(frag) < 50:
            continue

        # Skip purely procedural Court thresholds (MTC/RTC/Small Claims) that do not assert RA 386 articles
        if any(court_kw in frag_lower for court_kw in (
            'municipal trial court', 'regional trial court', 'barangay',
            'small claims court', 'family court', 'pre-filing requirement',
            'possible cause of action to file',
        )) and not _extract_article_ids(frag):
            continue

        # Skip extra-statutory procedural boilerplate (Katarungang Pambarangay,
        # forum-shopping certification, filing/docket fees, notarization) that
        # carries no Civil Code assertion and would otherwise inflate the
        # claim count with neutral filler that drags the score down.
        if any(proc_kw in frag_lower for proc_kw in (
            'katarungang pambarangay', 'lupon tagapamayapa', 'lupon',
            'forum shopping', 'non-forum', 'certificate against',
            'verification and certification', 'certification and',
            'filing fee', 'docket fee', 'legal fee', 'indigent',
            'pauper litigant', 'notar', 'affidavit of',
            'conciliation proceeding', 'mediation proceeding',
            'free legal help', "public attorney's office", 'public attorney',
        )) and not _extract_article_ids(frag):
            continue

        # Skip assistant self-identification / greeting / help-offer boilerplate
        # ("I am CIVIL-LEX, your Philippine Civil Law assistant", "I can help
        # you understand your rights...", "Hello! ...") that carries no Civil
        # Code assertion and would otherwise inflate the claim count with
        # neutral filler that drags the score down. Guarded by the
        # no-article-anchor condition so a greeting that actually asserts an
        # article (e.g. "Hello, under Article 77...") is still scored.
        if (any(intro_kw in frag_lower for intro_kw in (
            'i am civil', "i'm civil", 'ako si civil', 'civil-lex', 'civil-ex',
            'law assistant', 'ai assistant', 'language model',
            'no law degree required', 'no law degree needed',
            'i can help you', 'how can i help', 'how may i help',
            'what legal question', 'feel free to ask', 'let me know if',
            'paano kita matutulungan', 'anong katanungan', 'may maitutulong',
            'just ask', 'happy to help',
        )) or (frag_lower.startswith(
            ('hello', 'hi,', 'hi ', 'kumusta', 'magandang ')
        ) and any(offer_kw in frag_lower for offer_kw in (
            'help', 'tanong', 'assist',
        )))) and not _extract_article_ids(frag):
            continue

        # Skip lines that are purely citation references with no assertion
        if re.match(r'^[\[\(]?(?:art(?:icle)?\.?\s*\d+|g\.?\s*r\.?\s*no)', frag_lower) and len(frag) < 40:
            continue

        # Normalized dedup: template answers repeat the same assertion in the
        # direct-answer recap and the analysis section. Collapse exact repeats
        # and substring-contained repeats so one assertion counts once.
        norm = re.sub(r'\s+', ' ', frag_lower.strip())
        norm = re.sub(
            r'\[\s*(?:statutory\s+)?(?:article|jurisprudence|authority)\s+\d+\s*\]', '', norm)
        norm = re.sub(
            r'\[(?:art(?:icle)?\.?\s*\d+|g\.?\s*r\.?\s*no[^\]]*)\]', '', norm).strip()
        norm = re.sub(r'\s+([.,;:!?])', r'\1', norm)  # reattach orphaned punctuation
        if not norm or norm in seen_normalized:
            continue
        if any(norm in kept or kept in norm for kept in seen_normalized):
            continue
        seen_normalized.add(norm)

        claims.append(frag)

    return claims


# 7. PER-CLAIM SYMBOLIC VERIFICATION

_CASE_PREMISE_CUE_RE = re.compile(
    r'(?:^\[(?:supporting case|jurisprudence)|entered\s+into\s+between\s+the\s+parties|\b(?:appellee|appellant|petitioner|respondent)\b)',
    re.IGNORECASE,
)


def _split_context_to_premises(context: str) -> List[str]:
    """Split context text into individual premise sentences, including sentences ending inside quotes."""
    if not context:
        return []
    sentences = re.split(r'(?<=[.!?])["\'\u201d\u2019\)]?\s+|\n+', context)
    return [s.strip() for s in sentences if len(s.strip()) > 10]


def _extract_structured_premises(context: str | list) -> tuple[List[str], List[tuple[str, str]]]:
    """Extract premise sentences aligned with (parent_id, parent_type) provenance."""
    premises: List[str] = []
    sources: List[tuple[str, str]] = []
    if isinstance(context, list):
        for c in context:
            if isinstance(c, dict):
                content = c.get('content', '')
                pid = str(c.get('parent_id') or '')
                ptype = str(c.get('parent_type') or '')
                if not ptype:
                    ptype = 'case' if pid.startswith('GR_') or _CASE_PREMISE_CUE_RE.search(content) else 'article'
                for sent in _split_context_to_premises(content):
                    premises.append(sent)
                    sources.append((pid, ptype))
            else:
                for sent in _split_context_to_premises(str(c)):
                    inferred = 'case' if _CASE_PREMISE_CUE_RE.search(sent) else 'article'
                    premises.append(sent)
                    sources.append(('', inferred))
    else:
        for sent in _split_context_to_premises(str(context)):
            inferred = 'case' if _CASE_PREMISE_CUE_RE.search(sent) else 'article'
            premises.append(sent)
            sources.append(('', inferred))
    return premises, sources


def _article_matches_source(claim_article_ids: set, source_pid: str) -> bool:
    """Return True if source_pid matches any cited article (including RA386/EO209 1..257 bridge)."""
    if not claim_article_ids or not source_pid:
        return False
    if source_pid in claim_article_ids:
        return True
    m = re.match(r'^(?:RA386|EO209)-ART(\d+)$', source_pid.strip(), re.IGNORECASE)
    if m:
        num = int(m.group(1))
        if f"RA386-ART{num}" in claim_article_ids or f"EO209-ART{num}" in claim_article_ids:
            return True
    return False


def verify_claim_symbolic(
    claim: str,
    context_premises: List[str],
    context_article_ids: set,
    premise_sources: Optional[List[tuple[str, str]]] = None,
) -> ClaimVerdict:
    """
    Evaluates a single atomic claim against context premises using
    symbolic logic, deontic modality analysis, and lexical containment.

    Rules (applied in priority order):
        Rule 1: Statutory Anchor Validation
        Rule 2: Deontic / Polarity Contradiction (checked across relevant statutory/matching premises)
        Rule 4: Asymmetric Lexical Containment (Entailment, union-aware across premises)
    """
    claim_lower = _normalize_text(claim)
    claim_article_ids = set(_extract_article_ids(claim))
    claim_is_conditional = bool(
        re.search(r'\b(?:if|when|provided|unless|except|suppose|for\s+example|kapag|kung)\b', claim_lower)
    )

    # Rule 1: Statutory Anchor Validation
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

    sources = premise_sources if (premise_sources and len(premise_sources) == len(context_premises)) else [
        ('', 'case' if _CASE_PREMISE_CUE_RE.search(p) else 'article')
        for p in context_premises
    ]

    premise_lowers = [_normalize_text(p) for p in context_premises]
    ranked_coverages: List[tuple[float, str, str, str, str]] = []  # (coverage, premise, premise_lower, pid, ptype)
    for premise, premise_lower, (pid, ptype) in zip(context_premises, premise_lowers, sources):
        coverage = _compute_lexical_coverage(claim_lower, premise_lower)
        # Prioritize cited statutory article premises first on ties / near-ties.
        anchor_bonus = 0.05 if (ptype != 'case' and _article_matches_source(claim_article_ids, pid)) else 0.0
        ranked_coverages.append((coverage, premise, premise_lower, pid, ptype, anchor_bonus))

    ranked_coverages.sort(key=lambda t: t[0] + t[5], reverse=True)

    best_coverage = ranked_coverages[0][0] if ranked_coverages else 0.0
    best_premise = ranked_coverages[0][1] if ranked_coverages else ""

    union_coverage, union_premises = _compute_union_coverage(claim_lower, premise_lowers)
    eff_coverage = max(best_coverage, union_coverage)

    # Rule 2: Deontic & Polarity Contradiction
    has_supported_anchored_article = bool(
        claim_article_ids
        and (claim_article_ids <= context_article_ids)
        and any(_article_matches_source(claim_article_ids, pid) and ptype != 'case' for _, _, _, pid, ptype, _ in ranked_coverages)
    )
    best_premise_lower = ranked_coverages[0][2] if ranked_coverages else ""
    best_is_consistent = best_coverage >= 0.45 and not _has_polarity_inversion(
        claim_lower, best_premise_lower, coverage=best_coverage
    )
    if not best_is_consistent:
        for rel_coverage, rel_premise, rel_premise_lower, rel_pid, rel_ptype, _ in ranked_coverages[:4]:
            if not rel_premise:
                continue
            # Require stronger lexical alignment before flagging contradiction so unrelated snippets do not collide.
            min_cov = 0.55 if rel_ptype == 'case' else 0.35
            if rel_coverage < min_cov:
                continue
            # Do not let an un-anchored case snippet override an explicitly cited statutory article at sub-0.60 overlap.
            if rel_ptype == 'case' and has_supported_anchored_article and rel_coverage < 0.60:
                continue
            # Case-specific factual holdings do not contradict conditional statutory rules unless overlap is high.
            if rel_ptype == 'case' and claim_is_conditional and rel_coverage < 0.60:
                continue
            if _has_polarity_inversion(claim_lower, rel_premise_lower, coverage=rel_coverage):
                return ClaimVerdict(
                    claim=claim,
                    verdict='contradicted',
                    confidence=-1.0,
                    rule_fired='R2_deontic_polarity_contradiction',
                    statutory_refs=list(claim_article_ids),
                    matched_premise=rel_premise[:200],
                )

    # Premise text for the audit trail: union contributors when the union decided it.
    if union_coverage > best_coverage and union_premises:
        matched_text = " | ".join(p[:120] for p in union_premises[:2])[:200]
        union_decided = True
    else:
        matched_text = best_premise[:200] if best_premise else ''
        union_decided = False

    # Rule 4: Asymmetric Lexical Containment (Entailment, union-aware)
    if claim_article_ids and claim_article_ids <= context_article_ids:
        if eff_coverage >= 0.30 or len(_get_legal_tokens(claim_lower)) <= 3:
            return ClaimVerdict(
                claim=claim,
                verdict='entailed',
                confidence=1.0,
                rule_fired='R4_union_coverage_with_anchor' if union_decided else 'R4_lexical_containment_with_anchor',
                statutory_refs=list(claim_article_ids),
                matched_premise=matched_text,
            )

    if eff_coverage >= 0.35:
        return ClaimVerdict(
            claim=claim,
            verdict='entailed',
            confidence=1.0,
            rule_fired='R4_union_coverage' if union_decided else 'R4_lexical_containment',
            statutory_refs=[],
            matched_premise=matched_text,
        )

    return ClaimVerdict(
        claim=claim,
        verdict='neutral',
        confidence=0.0,
        rule_fired='R_default_neutral',
        statutory_refs=list(claim_article_ids),
        matched_premise=best_premise[:200] if best_premise else '',
    )


# 7. GEMMA NEURAL NLI VERIFIER (LM STUDIO ENDPOINT)

# Maximum characters of statutory context sent to Gemma per NLI call
GEMMA_NLI_CONTEXT_BUDGET = 4000



def _select_relevant_context(
    claims_to_verify: List[tuple[int, str]],
    context_premises: List[str],
    budget: int = GEMMA_NLI_CONTEXT_BUDGET,
) -> str:
    """
    Ranks context premises by maximum lexical coverage against any claim under
    audit and greedily packs the highest-ranked premises within the character
    budget. Guarantees at least the single most relevant premise is included.
    Falls back to head truncation when no premise scores above zero.
    """
    if not context_premises:
        return ""
    claim_lowers = [_normalize_text(c) for _, c in claims_to_verify]
    scored = []
    for premise in context_premises:
        p_lower = _normalize_text(premise)
        best = 0.0
        for cl in claim_lowers:
            cov = _compute_lexical_coverage(cl, p_lower)
            if cov > best:
                best = cov
        scored.append((best, premise))
    scored.sort(key=lambda t: t[0], reverse=True)

    selected: List[str] = []
    used = 0
    for score, premise in scored:
        if selected and (score <= 0.0 or used + len(premise) + 2 > budget):
            continue
        selected.append(premise)
        used += len(premise) + 2
        if used >= budget:
            break
    if not selected:
        return "\n\n".join(context_premises)[:budget].strip()
    return "\n\n".join(selected).strip()


def _build_gemma_nli_prompt(
    claims_to_verify: List[tuple[int, str]],
    context_text: str,
    score_hint: str = "",
) -> str:
    """Build a compact JSON-only NLI verification and score-analysis prompt for Gemma in LM Studio."""
    selected_context = context_text[:GEMMA_NLI_CONTEXT_BUDGET].strip()
    claims_formatted = "\n".join([f"[{cid}] {claim}" for cid, claim in claims_to_verify])
    hint_block = f"\nPRELIMINARY SYMBOLIC AUDIT: {score_hint}\n" if score_hint else ""
    return (
        "You are a Philippine Civil Law Natural Language Inference (NLI) auditor.\n"
        "Respond ONLY with valid JSON. No markdown commentary outside the JSON object.\n\n"
        "VERDICT RULES:\n"
        "- entailed: Supported by or validly paraphrasing the premises (in English or Tagalog), including conditional statutory exceptions (e.g. 'if there is a stipulation...', 'unless absent for 4 years...') that match an exception clause.\n"
        "- contradicted: ONLY when the claim directly states a legal rule opposite to the governing statutory provision (e.g. saying a party cannot rescind when the statute permits it). Do NOT mark conditional examples or general statutory rules contradicted by specific case-party facts.\n"
        "- neutral: Unstated procedural steps or external details neither proven nor disproven by the premises.\n\n"
        f"STATUTORY & JURISPRUDENCE PREMISES:\n{selected_context}\n\n"
        f"CLAIMS TO EVALUATE:\n{claims_formatted}\n"
        f"{hint_block}\n"
        "Output strictly this JSON object:\n"
        "{\n"
        '  "verdicts": [{"id": <int>, "verdict": "entailed"|"neutral"|"contradicted", "reason": "<short 1-sentence reason>"}],\n'
        '  "analysis": "<1-2 sentence assessment analyzing the response faithfulness score and statutory grounding>"\n'
        "}"
    )


def _parse_gemma_nli_payload(raw_text: str) -> tuple[Dict[int, dict], str]:
    """Parse Gemma JSON into (verdicts_by_id, overall_analysis); accepts object or legacy list."""
    results: Dict[int, dict] = {}
    analysis = ""
    if not raw_text or not raw_text.strip():
        return results, analysis

    text = raw_text.strip()
    fence_match = re.search(r'```(?:json)?\s*([\[{][\s\S]*?[\]}])\s*```', text, re.DOTALL)
    json_str = fence_match.group(1) if fence_match else text
    if not fence_match:
        obj_match = re.search(r'(\{[\s\S]*"verdicts"[\s\S]*\})', text, re.DOTALL)
        if obj_match:
            json_str = obj_match.group(1)
        else:
            arr_match = re.search(r'(\[\s*\{[\s\S]*\}\s*\])', text, re.DOTALL)
            if arr_match:
                json_str = arr_match.group(1)

    try:
        data = json.loads(json_str)
        items = []
        if isinstance(data, dict):
            analysis = str(data.get('analysis') or data.get('summary') or '').strip()
            raw_verdicts = data.get('verdicts')
            if isinstance(raw_verdicts, list):
                items = raw_verdicts
        elif isinstance(data, list):
            items = data

        for item in items:
            if isinstance(item, dict) and 'id' in item and 'verdict' in item:
                try:
                    cid = int(item['id'])
                    v = str(item['verdict']).lower().strip()
                    if v in ('entailed', 'neutral', 'contradicted'):
                        results[cid] = {
                            'verdict': v,
                            'reason': str(item.get('reason', '')).strip(),
                        }
                except (ValueError, TypeError):
                    continue
    except json.JSONDecodeError:
        logging.warning("Failed to parse Gemma NLI JSON response; falling back to symbolic verdicts.")

    return results, analysis


def _parse_gemma_nli_response(raw_text: str) -> Dict[int, dict]:
    """Parse JSON verdicts from Gemma output into a dictionary keyed by claim index."""
    results, _ = _parse_gemma_nli_payload(raw_text)
    return results


def _format_score_hint(verdicts: List[ClaimVerdict]) -> str:
    n_tot = len(verdicts)
    n_ent = sum(1 for v in verdicts if v.verdict == 'entailed')
    n_con = sum(1 for v in verdicts if v.verdict == 'contradicted')
    return f"{n_ent}/{n_tot} claims lexically matched, {n_con} tentative polarity flags"


def _verify_claims_gemma_with_analysis_sync(
    claims_to_verify: List[tuple[int, str]],
    context_text: str,
    timeout: float = 45.0,
    context_premises: Optional[List[str]] = None,
    score_hint: str = "",
) -> tuple[Dict[int, dict], str, bool]:
    """Query Gemma synchronously with reasoning disabled to verify claims and analyze grounding score."""
    if not claims_to_verify:
        return {}, "", False

    from services.llm_client import call_chat_completion_sync

    batch_size = 6
    all_results: Dict[int, dict] = {}
    analyses: List[str] = []
    responded = False
    for i in range(0, len(claims_to_verify), batch_size):
        batch = claims_to_verify[i:i + batch_size]
        curr_context = _select_relevant_context(batch, context_premises) if context_premises else context_text
        prompt = _build_gemma_nli_prompt(batch, curr_context, score_hint=score_hint)
        try:
            raw_text = call_chat_completion_sync(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=900,
                timeout_sec=timeout,
                reasoning_effort="none",
                allow_reasoning_fallback=False,
            )
            if raw_text:
                parsed, batch_analysis = _parse_gemma_nli_payload(raw_text)
                if parsed or batch_analysis:
                    responded = True
                all_results.update(parsed)
                if batch_analysis:
                    analyses.append(batch_analysis)
        except Exception as e:
            logging.warning(f"Unexpected error calling LLM NLI: {type(e).__name__} - {e}")

    if not responded:
        logging.info("LLM unavailable for NLI; using symbolic fallback.")
    return all_results, " ".join(analyses).strip(), responded


async def _verify_claims_gemma_with_analysis_async(
    claims_to_verify: List[tuple[int, str]],
    context_text: str,
    timeout: float = 45.0,
    context_premises: Optional[List[str]] = None,
    score_hint: str = "",
) -> tuple[Dict[int, dict], str, bool]:
    """Query Gemma asynchronously with reasoning disabled to verify claims and analyze grounding score."""
    if not claims_to_verify:
        return {}, "", False

    from services.llm_client import call_chat_completion_async

    batch_size = 6
    all_results: Dict[int, dict] = {}
    analyses: List[str] = []
    responded = False
    for i in range(0, len(claims_to_verify), batch_size):
        batch = claims_to_verify[i:i + batch_size]
        curr_context = _select_relevant_context(batch, context_premises) if context_premises else context_text
        prompt = _build_gemma_nli_prompt(batch, curr_context, score_hint=score_hint)
        try:
            raw_text = await call_chat_completion_async(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=900,
                timeout_sec=timeout,
                reasoning_effort="none",
                allow_reasoning_fallback=False,
            )
            if raw_text:
                parsed, batch_analysis = _parse_gemma_nli_payload(raw_text)
                if parsed or batch_analysis:
                    responded = True
                all_results.update(parsed)
                if batch_analysis:
                    analyses.append(batch_analysis)
        except Exception as e:
            logging.warning(f"Unexpected error calling LLM NLI async: {type(e).__name__} - {e}")

    if not responded:
        logging.info("LLM unavailable for NLI; using symbolic fallback.")
    return all_results, " ".join(analyses).strip(), responded


def verify_claims_gemma_sync(
    claims_to_verify: List[tuple[int, str]],
    context_text: str,
    timeout: float = 45.0,
    context_premises: Optional[List[str]] = None,
) -> Dict[int, dict]:
    """Synchronously query Gemma in LM Studio for batched NLI evaluation."""
    results, _, _ = _verify_claims_gemma_with_analysis_sync(
        claims_to_verify, context_text, timeout=timeout, context_premises=context_premises
    )
    return results


async def verify_claims_gemma_async(
    claims_to_verify: List[tuple[int, str]],
    context_text: str,
    timeout: float = 45.0,
    context_premises: Optional[List[str]] = None,
) -> Dict[int, dict]:
    """Asynchronously query Gemma in LM Studio for batched NLI evaluation."""
    results, _, _ = await _verify_claims_gemma_with_analysis_async(
        claims_to_verify, context_text, timeout=timeout, context_premises=context_premises
    )
    return results


# 8. HYBRID ARBITRATION & AGGREGATE FAITHFULNESS SCORING

def _is_neural_contradiction_grounded(claim: str) -> bool:
    """Require explicit normative negation and statutory anchor before 4B neural NLI marks contradiction."""
    claim_low = _normalize_text(claim)
    has_normative_neg = any(
        bool(re.search(r'\b' + re.escape(tok) + r'\b', claim_low))
        for tok in _PROHIBITION_TOKENS
    ) or any(f" {neg} " in f" {claim_low} " for neg in _NEGATION_TOKENS)
    return bool(has_normative_neg and _extract_article_ids(claim))


def _arbitrate_hybrid_verdicts(
    verdicts: List[ClaimVerdict],
    gemma_results: Dict[int, dict],
    gemma_analysis: str = "",
    gemma_responded: Optional[bool] = None,
) -> tuple[List[ClaimVerdict], str, str]:
    """
    Arbitrates between symbolic rules and Gemma neural NLI verdicts.

    Arbitration Truth Table:
        1. Tentative Symbolic R2 Flag + Gemma checked:
           - Gemma contradicted -> Confirmed Hybrid Contradiction (R_hybrid_confirmed_contradiction).
           - Gemma entailed / neutral -> Overturns symbolic false positive with Gemma rationale.
        2. Unsupported Statutory Anchor (Rule 1) -> Capped at neutral (Citation Defense).
        3. High Lexical Containment (Rule 4) -> Entailed (with Gemma rationale if reviewed).
        4. Neutral Symbolic Verdict -> Gemma verdict applied (with conditional-exception guard).
    """
    is_hybrid = gemma_responded if gemma_responded is not None else bool(gemma_results)
    engine_used = "hybrid" if is_hybrid else "symbolic_fallback"

    for idx, v in enumerate(verdicts):
        g_eval = gemma_results.get(idx)

        # Rule 1: Tentative symbolic polarity flag is adjudicated by Gemma when available
        if v.verdict == 'contradicted' and v.rule_fired == 'R2_deontic_polarity_contradiction':
            if g_eval is None:
                continue
            g_verdict = g_eval['verdict']
            g_reason = g_eval.get('reason', '')
            if g_verdict == 'contradicted':
                v.verifier = 'hybrid'
                v.rule_fired = 'R_hybrid_confirmed_contradiction'
                v.rationale = g_reason
            elif g_verdict == 'entailed':
                v.verdict = 'entailed'
                v.confidence = 1.0
                v.verifier = 'hybrid'
                v.rule_fired = 'R_hybrid_gemma_resolved_entailment'
                v.rationale = g_reason
            else:
                v.verdict = 'neutral'
                v.confidence = 0.0
                v.verifier = 'hybrid'
                v.rule_fired = 'R_hybrid_gemma_resolved_neutral'
                v.rationale = g_reason
            continue

        # Rule 2: Unsupported statutory anchor cannot be upgraded to entailed
        if v.rule_fired == 'R1_unsupported_statutory_anchor':
            continue

        # Rule 3: Fast-path entailed claim (attach Gemma rationale if spot-checked)
        if v.verdict == 'entailed':
            if g_eval is not None:
                g_reason = g_eval.get('reason', '')
                if g_eval['verdict'] == 'contradicted' and _is_neural_contradiction_grounded(v.claim):
                    v.verdict = 'contradicted'
                    v.confidence = -1.0
                    v.rule_fired = 'R_hybrid_gemma_contradiction'
                    v.verifier = 'gemma_neural'
                    v.rationale = g_reason
                elif g_reason and not v.rationale:
                    v.rationale = g_reason
                    v.verifier = 'hybrid'
            continue

        # Rule 4: Neutral claim checked by Gemma
        if g_eval is not None:
            g_verdict = g_eval['verdict']
            g_reason = g_eval.get('reason', '')

            if g_verdict == 'entailed':
                v.verdict = 'entailed'
                v.confidence = 1.0
                v.rule_fired = 'R_hybrid_gemma_entailment'
                v.verifier = 'gemma_neural'
                v.rationale = g_reason
            elif g_verdict == 'contradicted':
                if _is_neural_contradiction_grounded(v.claim):
                    v.verdict = 'contradicted'
                    v.confidence = -1.0
                    v.rule_fired = 'R_hybrid_gemma_contradiction'
                    v.verifier = 'gemma_neural'
                    v.rationale = g_reason
                else:
                    v.verifier = 'gemma_neural'
                    v.rationale = g_reason
            elif g_verdict == 'neutral':
                v.verifier = 'gemma_neural'
                v.rationale = g_reason

    return verdicts, engine_used, gemma_analysis


def _register_dual_code_anchor(article_ids: set, candidate: str) -> None:
    # Register both RA386 and EO209 IDs for articles 1..257 so Family Code claims never false-veto.
    if not candidate:
        return
    article_ids.add(candidate)
    m = re.match(r'^(?:RA386|EO209)-ART(\d+)$', str(candidate).strip(), re.IGNORECASE)
    if m:
        num = int(m.group(1))
        article_ids.add(f"RA386-ART{num}")
        if 1 <= num <= 257:
            article_ids.add(f"EO209-ART{num}")


def _normalize_context_payload(context: str | list) -> tuple[str, set]:
    """Extracts concatenated text and article IDs from context string or chunk dict list."""
    if isinstance(context, list):
        context_text = "\n\n".join(
            c.get('content', '') if isinstance(c, dict) else str(c)
            for c in context
        )
        context_article_ids = set()
        has_codal_structure = False
        has_fc_structure = False
        for c in context:
            if isinstance(c, dict):
                pid = c.get('parent_id', '')
                if pid:
                    _register_dual_code_anchor(context_article_ids, pid)
                content = c.get('content', '')
                if 'RA386-STRUCTURE' in pid or 'Total Articles and Structure' in content:
                    has_codal_structure = True
                if 'EO209-STRUCTURE' in pid or '257 articles' in content.lower():
                    has_fc_structure = True
                for extracted_id in _extract_article_ids(content):
                    _register_dual_code_anchor(context_article_ids, extracted_id)
        if has_codal_structure:
            context_article_ids.add('RA386-ART1')
            context_article_ids.add('RA386-ART2270')
        if has_fc_structure:
            _register_dual_code_anchor(context_article_ids, 'EO209-ART1')
            _register_dual_code_anchor(context_article_ids, 'EO209-ART257')
    else:
        context_text = str(context)
        context_article_ids = set()
        for extracted_id in _extract_article_ids(context_text):
            _register_dual_code_anchor(context_article_ids, extracted_id)
        if 'RA386-STRUCTURE' in context_text or 'Total Articles and Structure' in context_text:
            context_article_ids.add('RA386-ART1')
            context_article_ids.add('RA386-ART2270')

    return context_text, context_article_ids


def _compute_faithfulness_result(
    verdicts: List[ClaimVerdict],
    engine: str,
    analysis: str = "",
) -> FaithfulnessResult:
    """Computes aggregate metrics from arbitrated claim verdicts."""
    n_total = len(verdicts)
    n_entailed = sum(1 for v in verdicts if v.verdict == 'entailed')
    n_neutral = sum(1 for v in verdicts if v.verdict == 'neutral')
    n_contradicted = sum(1 for v in verdicts if v.verdict == 'contradicted')

    if n_total > 0:
        f_std = n_entailed / n_total
        f_net = max(0.0, (n_entailed - n_contradicted) / n_total)
        f_weighted = min(100.0, max(0.0, ((n_entailed + 0.35 * n_neutral - 2.0 * n_contradicted) / n_total) * 100.0))
    else:
        f_std = 0.0
        f_net = 0.0
        f_weighted = 0.0

    score_pct = round(f_std * 100.0, 1)
    net_pct = round(f_net * 100.0, 1)

    if n_contradicted > 0:
        status = 'Unverified'
    elif score_pct >= 80.0:
        status = 'Grounded'
    else:
        status = 'Unverified'

    final_analysis = (analysis or "").strip() or (
        f"Verified {n_entailed} of {n_total} claims ({score_pct}%) against retrieved provisions "
        f"({n_neutral} neutral, {n_contradicted} contradicted) via {engine}."
    )

    logging.info(
        f"NLI Faithfulness ({engine}): {score_pct}% ({status}) | "
        f"Claims: {n_total} total, {n_entailed} entailed, "
        f"{n_neutral} neutral, {n_contradicted} contradicted"
    )

    return FaithfulnessResult(
        score=f_std,
        score_percent=score_pct,
        status=status,
        claims_total=n_total,
        claims_entailed=n_entailed,
        claims_neutral=n_neutral,
        claims_contradicted=n_contradicted,
        verdicts=verdicts,
        engine=engine,
        score_weighted=round(f_weighted, 1),
        score_net=f_net,
        score_net_percent=net_pct,
        analysis=final_analysis,
    )


def _select_gemma_audit_candidates(verdicts: List[ClaimVerdict], limit: int = 6) -> List[tuple[int, str]]:
    """Select tentative contradictions first, then neutral claims, or top claims for Gemma score audit."""
    tentative_contra = [
        (idx, v.claim)
        for idx, v in enumerate(verdicts)
        if v.verdict == 'contradicted' and v.rule_fired == 'R2_deontic_polarity_contradiction'
    ]
    neutral_cands = [
        (idx, v.claim)
        for idx, v in enumerate(verdicts)
        if v.verdict == 'neutral' and v.rule_fired != 'R1_unsupported_statutory_anchor'
    ]
    neutral_cands.sort(key=lambda t: len(t[1]), reverse=True)
    combined = tentative_contra + neutral_cands
    if combined:
        return combined[:limit]
    # When all claims pass symbolic fast-path, let Gemma spot-check & analyze the response score.
    spot_checks = [
        (idx, v.claim)
        for idx, v in enumerate(verdicts)
        if v.rule_fired != 'R1_unsupported_statutory_anchor'
    ]
    return spot_checks[:limit]


def score_faithfulness(
    answer: str,
    context: str | list,
    mode: str = "hybrid",
) -> FaithfulnessResult:
    """
    Synchronously evaluate faithfulness of a generated answer against retrieved context.

    Uses Neuro-Symbolic Hybrid NLI:
        - Runs deterministic source-aware symbolic verification.
        - In 'hybrid' mode, queries Gemma with reasoning disabled to adjudicate tentative
          contradictions, verify neutral claims, and analyze the grounding score.
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
            score_weighted=100.0, score_net=1.0, score_net_percent=100.0,
        )

    context_premises, premise_sources = _extract_structured_premises(context)

    verdicts: List[ClaimVerdict] = [
        verify_claim_symbolic(claim, context_premises, context_article_ids, premise_sources=premise_sources)
        for claim in claims
    ]

    engine = "symbolic"
    analysis = ""
    if mode == "hybrid":
        audit_candidates = _select_gemma_audit_candidates(verdicts)
        if audit_candidates:
            gemma_results, gemma_analysis, responded = _verify_claims_gemma_with_analysis_sync(
                audit_candidates,
                context_text,
                context_premises=context_premises,
                score_hint=_format_score_hint(verdicts),
            )
            verdicts, engine, analysis = _arbitrate_hybrid_verdicts(
                verdicts, gemma_results, gemma_analysis=gemma_analysis, gemma_responded=responded
            )

    return _compute_faithfulness_result(verdicts, engine, analysis=analysis)


async def score_faithfulness_async(
    answer: str,
    context: str | list,
    mode: str = "hybrid",
) -> FaithfulnessResult:
    """Asynchronously evaluate answer faithfulness against retrieved context for SSE streaming."""
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
            score_weighted=100.0, score_net=1.0, score_net_percent=100.0,
        )

    context_premises, premise_sources = _extract_structured_premises(context)

    verdicts: List[ClaimVerdict] = [
        verify_claim_symbolic(claim, context_premises, context_article_ids, premise_sources=premise_sources)
        for claim in claims
    ]

    engine = "symbolic"
    analysis = ""
    if mode == "hybrid":
        audit_candidates = _select_gemma_audit_candidates(verdicts)
        if audit_candidates:
            gemma_results, gemma_analysis, responded = await _verify_claims_gemma_with_analysis_async(
                audit_candidates,
                context_text,
                context_premises=context_premises,
                score_hint=_format_score_hint(verdicts),
            )
            verdicts, engine, analysis = _arbitrate_hybrid_verdicts(
                verdicts, gemma_results, gemma_analysis=gemma_analysis, gemma_responded=responded
            )

    return _compute_faithfulness_result(verdicts, engine, analysis=analysis)

