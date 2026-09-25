"""
Ambiguity Detection & Conversational Clarification Service for CIVIL-LEX.

Analyzes in-domain Philippine civil law queries for critical factual gaps
(citizenship, party identity, transaction type, temporal context) and
generates targeted clarification questions before proceeding with RAG.

Uses a two-tier approach:
  1. Rule-based pattern matching (fast, zero-cost) for common ambiguity patterns
  2. LLM-assisted analysis (optional, via local Gemma model) for nuanced edge cases
"""

import re
import json
import logging
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------

@dataclass
class ClarificationQuestion:
    """A single clarification question with selectable options."""
    id: str                             # e.g., "citizenship_status"
    question: str                       # "What is your citizenship status?"
    options: List[str]                  # ["Filipino citizen", "Dual citizen", ...]
    allows_free_text: bool = True       # User can type their own answer
    context_hint: str = ""              # Why this matters for legal analysis

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class AmbiguityResult:
    """Result of ambiguity detection on a user query."""
    is_ambiguous: bool = False
    confidence: float = 0.0             # 0.0 - 1.0
    category: str = ""                  # e.g., "missing_party_identity"
    questions: List[ClarificationQuestion] = field(default_factory=list)
    original_query: str = ""
    reasoning: str = ""                 # Brief explanation

    def to_dict(self) -> dict:
        return {
            "is_ambiguous": self.is_ambiguous,
            "confidence": self.confidence,
            "category": self.category,
            "questions": [q.to_dict() for q in self.questions],
            "original_query": self.original_query,
            "reasoning": self.reasoning,
        }


# ---------------------------------------------------------------------------
# Rule-Based Ambiguity Patterns
# ---------------------------------------------------------------------------

# Pattern structure: (trigger_regex, exclusion_regex_or_None, category, confidence, questions_fn)
# trigger_regex: if matched, the query *might* be ambiguous
# exclusion_regex: if matched, the ambiguity is already resolved (e.g., user stated citizenship)

def _citizenship_questions() -> List[ClarificationQuestion]:
    return [
        ClarificationQuestion(
            id="citizenship_status",
            question="What is your citizenship status?",
            options=[
                "Filipino citizen",
                "Dual citizen (e.g., Filipino-American)",
                "Former Filipino citizen (naturalized abroad)",
                "Foreign national (non-Filipino)",
            ],
            allows_free_text=True,
            context_hint="This determines which constitutional and statutory provisions apply to property ownership in the Philippines.",
        ),
        ClarificationQuestion(
            id="property_type",
            question="What type of property is involved?",
            options=[
                "Residential land / house and lot",
                "Condominium unit",
                "Agricultural land",
                "Commercial property",
                "Not sure",
            ],
            allows_free_text=True,
            context_hint="The type of property affects foreign ownership restrictions (e.g., the Condominium Act RA 4726 allows up to 40% foreign ownership).",
        ),
    ]


def _party_relationship_questions(query_lower: str) -> List[ClarificationQuestion]:
    questions = []

    # Detect loan/debt scenarios
    if any(w in query_lower for w in ['utang', 'borrow', 'loan', 'lend', 'pautang', 'bayad', 'pay', 'owe', 'debt']):
        questions.append(ClarificationQuestion(
            id="agreement_form",
            question="Was the agreement documented in writing?",
            options=[
                "Yes, there is a written contract or promissory note",
                "No, it was a verbal/oral agreement only",
                "There are text messages / chat records as evidence",
                "Not sure",
            ],
            allows_free_text=True,
            context_hint="Whether the agreement is written or oral affects the applicable prescriptive period and evidentiary requirements.",
        ))
        questions.append(ClarificationQuestion(
            id="amount_involved",
            question="Approximately how much is the amount involved?",
            options=[
                "Below ₱400,000",
                "₱400,000 to ₱2,000,000",
                "Above ₱2,000,000",
                "Prefer not to say / Not sure",
            ],
            allows_free_text=True,
            context_hint="The amount determines whether this falls under Small Claims Court, MTC, or RTC jurisdiction under RA 11576.",
        ))

    # Detect injury/accident scenarios
    elif any(w in query_lower for w in ['injury', 'injured', 'accident', 'aksidente', 'nabangga', 'nasagasaan', 'nasaktan', 'hurt', 'hit']):
        questions.append(ClarificationQuestion(
            id="accident_type",
            question="What type of incident was involved?",
            options=[
                "Vehicular / traffic accident",
                "Physical assault / battery by another person",
                "Workplace accident / injury at work",
                "Accident on someone else's property (slip and fall, etc.)",
                "Other",
            ],
            allows_free_text=True,
            context_hint="The type of incident determines whether this is a quasi-delict (Art. 2176), employer vicarious liability (Art. 2180), or an independent civil action (Art. 33).",
        ))
        questions.append(ClarificationQuestion(
            id="party_relationship",
            question="What is your relationship to the other party?",
            options=[
                "Stranger / no prior relationship",
                "Employer / employee",
                "Business / contractual relationship",
                "Family member or relative",
                "Neighbor",
            ],
            allows_free_text=True,
            context_hint="The relationship between parties affects which legal doctrines and liability provisions apply.",
        ))

    return questions


def _property_transfer_questions() -> List[ClarificationQuestion]:
    return [
        ClarificationQuestion(
            id="transfer_type",
            question="How did you acquire or receive the property?",
            options=[
                "Purchased (contract of sale / contract to sell)",
                "Donated / given as a gift (donation)",
                "Inherited from a deceased relative",
                "Verbal promise or informal agreement",
                "Not sure / still being negotiated",
            ],
            allows_free_text=True,
            context_hint="The mode of acquisition determines the governing legal framework: sale (Art. 1458), donation (Art. 725), or succession (Art. 777).",
        ),
        ClarificationQuestion(
            id="documentation",
            question="Is there a written document for this transaction?",
            options=[
                "Yes, a notarized deed or contract",
                "Yes, a private written agreement (not notarized)",
                "No, only a verbal agreement",
                "There is a title (TCT/CCT) involved",
                "Not sure",
            ],
            allows_free_text=True,
            context_hint="Written documentation and notarization affect the validity and enforceability of property transactions under the Statute of Frauds (Art. 1403).",
        ),
    ]


def _temporal_questions(query_lower: str) -> List[ClarificationQuestion]:
    questions = []
    questions.append(ClarificationQuestion(
        id="when_occurred",
        question="Approximately when did the event or breach occur?",
        options=[
            "Within the last 6 months",
            "6 months to 1 year ago",
            "1 to 4 years ago",
            "More than 4 years ago",
            "More than 10 years ago",
            "Not sure / ongoing",
        ],
        allows_free_text=True,
        context_hint="The timing is critical for determining whether the legal action has prescribed (e.g., 4 years for oral contracts under Art. 1145, 10 years for written contracts under Art. 1144).",
    ))
    return questions


def _unmarried_couple_questions() -> List[ClarificationQuestion]:
    return [
        ClarificationQuestion(
            id="relationship_status",
            question="What is the relationship status between the parties?",
            options=[
                "Living together but not married (common-law / live-in)",
                "Married under Philippine law",
                "Separated but not legally (no court decree)",
                "One or both parties are married to someone else",
                "Engaged / planning to marry",
            ],
            allows_free_text=True,
            context_hint="This determines whether Art. 147 (union without legal impediment) or Art. 148 (union with legal impediment) governs property relations.",
        ),
    ]


def _adverse_possession_questions() -> List[ClarificationQuestion]:
    return [
        ClarificationQuestion(
            id="property_titling_status",
            question="Is the abandoned property covered by a registered Torrens Title (TCT/OCT)?",
            options=[
                "Yes, it has a Torrens Title (TCT/OCT)",
                "No, it is untitled / covered only by Tax Declaration",
                "It is public / government land",
                "Unknown / not sure if titled",
            ],
            allows_free_text=True,
            context_hint="Under PD 1529 (Property Registration Decree) Sec. 47, registered land cannot be acquired by prescription or adverse possession regardless of the length of occupation.",
        ),
        ClarificationQuestion(
            id="occupation_duration",
            question="How long has the property been occupied, and under what basis?",
            options=[
                "Less than 10 years",
                "10 to 29 years (with good faith / just title)",
                "30 years or more (adverse possession / no title)",
                "Occupied with owner's mere tolerance or permission",
            ],
            allows_free_text=True,
            context_hint="Acquisitive prescription requires 10 years in good faith with just title (Art. 1134), or 30 years without title (Art. 1137). Mere tolerance does not confer ownership (Art. 537).",
        ),
    ]


# ---------------------------------------------------------------------------
# Rule-Based Ambiguity Detection Patterns
# ---------------------------------------------------------------------------

# Each pattern: (trigger_pattern, exclusion_pattern, category, base_confidence, questions_factory)

AMBIGUITY_RULES: List[tuple] = [
    # Category 1: Missing citizenship / cross-border property
    (
        r'\b(from\s+(?:the\s+)?(?:united\s+states|us|usa|canada|australia|japan|uk|abroad|overseas)|abroad|ofw|overseas\s+filipino|balikbayan|foreign(?:er)?|alien|american|japanese|korean|chinese|indian)\b.*\b(property|lupa|bahay|land|house|lot|condo|condominium|buy|bought|purchase|acquire|own)\b',
        r'\b(filipino\s+citizen|dual\s+citizen|naturalized|former\s+filipino|foreign\s+national|i\s+am\s+a\s+filipino|filipino\s+ako|citizen\s+of\s+the\s+philippines)\b',
        'missing_party_identity',
        0.90,
        lambda ql: _citizenship_questions(),
    ),
    # Reverse order: property first, then foreign mention
    (
        r'\b(property|lupa|bahay|land|house|lot|condo|condominium|buy|bought|purchase|acquire|own)\b.*\b(from\s+(?:the\s+)?(?:united\s+states|us|usa|canada|australia|japan|uk|abroad|overseas)|abroad|ofw|overseas\s+filipino|balikbayan|foreign(?:er)?|alien|american|japanese|korean|chinese|indian)\b',
        r'\b(filipino\s+citizen|dual\s+citizen|naturalized|former\s+filipino|foreign\s+national|i\s+am\s+a\s+filipino|filipino\s+ako|citizen\s+of\s+the\s+philippines)\b',
        'missing_party_identity',
        0.90,
        lambda ql: _citizenship_questions(),
    ),

    # Category 1b: Occupying abandoned / untitled property (Adverse Possession / Prescription)
    (
        r'\b(occup(?:y|ies|ied|ying)|okupa|inokupahan|tirahan|naninirahan|squat(?:ter|ting)?|stay(?:ing)?|lived?\s+in|stayed\s+in)\b.*\b(abandon(?:ed)?|bakante|tiniwangwang|matiwangwang|unclaimed|walang\s+nakatira|walang\s+tao)\b.*\b(property|land|lupa|house|bahay|lot|building)\b',
        r'\b(torrens\s+title|tct|oct|tax\s+declaration|titled|good\s+faith|just\s+title|p\.?d\.?\s*1529|article\s+113[47])\b',
        'unclear_legal_relationship',
        0.90,
        lambda ql: _adverse_possession_questions(),
    ),
    # Reverse order: abandoned property first, then occupies
    (
        r'\b(abandon(?:ed)?|bakante|tiniwangwang|matiwangwang|unclaimed|walang\s+nakatira|walang\s+tao)\b.*\b(property|land|lupa|house|bahay|lot|building)\b.*\b(occup(?:y|ies|ied|ying)|okupa|inokupahan|tirahan|naninirahan|squat(?:ter|ting)?|stay(?:ing)?|lived?\s+in|stayed\s+in|many\s+years|ilang\s+taon)\b',
        r'\b(torrens\s+title|tct|oct|tax\s+declaration|titled|good\s+faith|just\s+title|p\.?d\.?\s*1529|article\s+113[47])\b',
        'unclear_legal_relationship',
        0.90,
        lambda ql: _adverse_possession_questions(),
    ),

    # Category 2: Vague loan/debt without documentation detail
    (
        r'\b(umutang|nagpautang|pinahiram|utang|borrowed\s+money|lend\s+money|loan|pautang|nagbigay\s+ng\s+pera|hindi\s+(?:na)?(?:g)?bayad|won\'?t\s+pay|refuse[ds]?\s+to\s+pay|not\s+paying|unpaid)\b',
        r'\b(promissory\s+note|written\s+(?:contract|agreement)|notarized|kasulatan|document|contract|small\s+claims)\b',
        'unclear_legal_relationship',
        0.80,
        lambda ql: _party_relationship_questions(ql),
    ),

    # Category 3: Ambiguous property acquisition
    (
        r'\b(nakuha|nakuha\s+ko|got\s+(?:a\s+)?property|received?\s+(?:a\s+)?(?:property|land|house|lot)|binigay\s+(?:sa\s+akin|sa\s+amin)|gave\s+me\s+(?:a\s+)?(?:property|land|house)|property\s+from\s+(?:my\s+)?(?:parents?|lolo|lola|grandparents?|tito|tita|uncle|aunt|kapatid|sibling))\b',
        r'\b(sale|sold|bought|purchased|donated|donation|inherited|inheritance|will|testament|deed\s+of\s+(?:sale|donation)|kasulatan\s+ng\s+(?:bilihan|donasyon)|mana|pamana)\b',
        'ambiguous_transaction_type',
        0.85,
        lambda ql: _property_transfer_questions(),
    ),

    # Category 4: Filing/prescription-sensitive without temporal context
    (
        r'\b(can\s+i\s+(?:still\s+)?(?:file|sue|ihabla|ikaso|idemanda)|mag-?file|prescription|prescriptive|expired?|too\s+late|statute\s+of\s+limitation|lapsed|pwede\s+pa\s+ba|maaari\s+pa\s+ba)\b',
        r'\b(\d+\s+(?:year|month|day|week|taon|buwan|araw)s?\s+ago|last\s+(?:year|month|week|\d{4})|since\s+\d{4}|noong\s+\d{4}|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}|within\s+the\s+last)\b',
        'missing_temporal_context',
        0.85,
        lambda ql: _temporal_questions(ql),
    ),

    # Category 5: Unmarried couple property disputes
    (
        r'\b(partner|live[- ]?in|karelasyon|jowa|boyfriend|girlfriend|kasama\s+sa\s+bahay|common[- ]?law|live\s+together|nagsasama|magkasama)\b.*\b(property|house|bahay|lupa|land|bought|bili|puhunan|business|negosyo|invested)\b',
        r'\b(married|kasal|husband|wife|asawa|spouse|article\s+14[78])\b',
        'conflicting_facts',
        0.85,
        lambda ql: _unmarried_couple_questions(),
    ),
    # Reverse: property first, then relationship
    (
        r'\b(property|house|bahay|lupa|land|bought|bili|puhunan|business|negosyo|invested)\b.*\b(partner|live[- ]?in|karelasyon|jowa|boyfriend|girlfriend|kasama\s+sa\s+bahay|common[- ]?law|live\s+together|nagsasama|magkasama)\b',
        r'\b(married|kasal|husband|wife|asawa|spouse|article\s+14[78])\b',
        'conflicting_facts',
        0.85,
        lambda ql: _unmarried_couple_questions(),
    ),

    # Category 2b: Injury/accident without specifying type
    (
        r'\b(nasaktan|na-?injure|injured|accident|aksidente|nabangga|nasagasaan|na-?hurt|sinaktan|sinugatan)\b',
        r'\b(vehicular|sasakyan|kotse|motor|car|truck|bus|assault|suntok|punch|workplace|trabaho|sa\s+opisina|sa\s+trabaho|slip|nadulas)\b',
        'unclear_legal_relationship',
        0.78,
        lambda ql: _party_relationship_questions(ql),
    ),
]

# Patterns that indicate the query is inherently clear and should NOT trigger clarification
CLEAR_QUERY_PATTERNS = [
    # Explicit article / provision queries
    r'(?:article|art\.?)\s*\d+',
    # GR number queries
    r'g\.?\s*r\.?\s*(?:no\.?|nos\.?)\s*[\w\-]+',
    # Definitional queries (what is X, explain X)
    r'^(?:what\s+(?:is|are)|define|explain|describe|ano\s+(?:ang|yung)|ipaliwanag)\s+',
    # Checklist / requisite queries
    r'\b(?:requisites?|elements?|checklist|requirements?|grounds?|conditions?|exceptions?)\s+(?:of|for|under|ng)\b',
    # Queries that already state specific facts clearly
    r'\b(?:filipino\s+citizen|dual\s+citizen|foreign\s+national|i\s+am\s+married|i\s+am\s+single|oral\s+contract|written\s+contract|promissory\s+note|notarized)\b',
]


# ---------------------------------------------------------------------------
# History-Aware Check: Skip if clarification was already provided
# ---------------------------------------------------------------------------

def _history_already_clarified(
    history: Optional[list],
    category: str,
) -> bool:
    """
    Checks if the conversation history already contains answers
    that resolve the ambiguity, avoiding redundant re-asking.
    """
    if not history:
        return False

    # Map categories to keywords that, if found in recent messages, indicate resolution
    RESOLUTION_KEYWORDS: Dict[str, List[str]] = {
        'missing_party_identity': [
            'filipino citizen', 'dual citizen', 'foreign national', 'naturalized',
            'ofw', 'permanent resident', 'american citizen', 'us citizen',
            'residential', 'agricultural', 'condominium', 'condo',
        ],
        'unclear_legal_relationship': [
            'written', 'oral', 'promissory note', 'contract', 'text messages',
            'verbal', 'kasulatan', 'vehicular', 'assault', 'workplace',
            'employer', 'stranger', 'neighbor', 'family',
        ],
        'ambiguous_transaction_type': [
            'sale', 'sold', 'purchased', 'donated', 'donation', 'inherited',
            'inheritance', 'will', 'deed', 'bilihan', 'donasyon',
        ],
        'missing_temporal_context': [
            'year ago', 'years ago', 'month ago', 'months ago',
            'last year', 'last month', 'since', 'noong',
        ],
        'conflicting_facts': [
            'married', 'not married', 'live-in', 'common-law', 'kasal',
            'hindi kasal', 'single',
        ],
    }

    keywords = RESOLUTION_KEYWORDS.get(category, [])
    if not keywords:
        return False

    # Check last 6 messages for resolution keywords
    recent = history[-6:] if len(history) > 6 else history
    combined_text = " ".join(
        msg.content.lower() if hasattr(msg, 'content') else str(msg.get('content', '')).lower()
        for msg in recent
    )

    matches = sum(1 for kw in keywords if kw in combined_text)
    # If 2+ resolution keywords found, consider it already clarified
    return matches >= 2


# ---------------------------------------------------------------------------
# LLM-Assisted Ambiguity Detection (via local Gemma on LM Studio)
# ---------------------------------------------------------------------------

async def _llm_detect_ambiguity(
    query: str,
    query_lower: str,
) -> Optional[AmbiguityResult]:
    """
    Uses the local Gemma model (via LM Studio) to detect nuanced ambiguity
    that rule-based patterns might miss.

    Returns an AmbiguityResult if the LLM identifies critical missing facts,
    or None if the query is considered clear enough.
    """
    import httpx
    from core.config import LM_STUDIO_URL

    system_prompt = """You are a Philippine Civil Law query analyzer. Your ONLY job is to determine whether a legal query is missing critical facts that would change the legal answer.

RESPOND ONLY WITH VALID JSON. No explanations outside the JSON.
Keep questions and options concise. Provide at most 1 to 2 targeted questions with 2 to 3 concise options each.
Ensure the JSON is complete and valid with all closing brackets.

Analyze the query for these specific ambiguity categories:
1. "missing_party_identity" — Citizenship, residency, or legal capacity is unclear but essential (e.g., foreigner vs. Filipino in property queries)
2. "unclear_legal_relationship" — The parties' relationship, agreement form (written/oral), or the type of dispute is too vague
3. "ambiguous_transaction_type" — How property/rights were acquired is unclear (sale? donation? inheritance?)
4. "missing_temporal_context" — When the event occurred matters for prescription but is not stated
5. "conflicting_facts" — The stated facts suggest multiple contradictory legal theories

RULES:
- If the query is a DEFINITIONAL question (e.g., "What is a quasi-delict?"), it is NOT ambiguous.
- If the query references specific Articles or GR numbers, it is NOT ambiguous.
- If the user provides enough facts to determine the applicable legal framework, it is NOT ambiguous.
- Only flag as ambiguous if missing facts would lead to MATERIALLY DIFFERENT legal conclusions.

RESPOND WITH THIS EXACT JSON STRUCTURE:
{
  "is_ambiguous": true/false,
  "confidence": 0.0-1.0,
  "category": "category_name or empty string",
  "reasoning": "One sentence explaining why clarification is needed or why the query is clear",
  "questions": [
    {
      "id": "short_id",
      "question": "The clarification question to ask",
      "options": ["Option 1", "Option 2"],
      "context_hint": "Why this matters for the legal analysis"
    }
  ]
}

If the query is NOT ambiguous, return:
{"is_ambiguous": false, "confidence": 0.0, "category": "", "reasoning": "Query is clear enough", "questions": []}"""

    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            payload = {
                "model": "local-model",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Analyze this Philippine civil law query for ambiguity:\n\n\"{query}\""},
                ],
                "temperature": 0.1,
                "max_tokens": 1200,
                "stream": False,
            }
            url = f"{LM_STUDIO_URL.rstrip('/')}/chat/completions"
            response = await client.post(url, json=payload)
            response.raise_for_status()

            data = response.json()
            raw_content = data["choices"][0]["message"]["content"].strip()

            # Clean markdown code fences if present (e.g. ```json ... ```)
            cleaned = re.sub(r'^```(?:json)?\s*', '', raw_content)
            cleaned = re.sub(r'\s*```$', '', cleaned)

            # Extract JSON from the response (handle markdown code blocks)
            json_match = re.search(r'\{[\s\S]*\}', cleaned)
            if not json_match:
                logger.warning(f"LLM ambiguity response did not contain valid JSON (finish_reason={data.get('choices', [{}])[0].get('finish_reason')}): {raw_content[:200]}")
                return None

            try:
                parsed = json.loads(json_match.group())
            except json.JSONDecodeError as jde:
                logger.warning(f"LLM ambiguity response JSON parse error: {jde} | content: {raw_content[:200]}")
                return None

            if not parsed.get("is_ambiguous", False):
                return None

            confidence = float(parsed.get("confidence", 0.5))
            if confidence < 0.65:
                return None

            # Build ClarificationQuestion objects from LLM response
            questions = []
            for q_data in parsed.get("questions", []):
                if not q_data.get("question"):
                    continue
                questions.append(ClarificationQuestion(
                    id=q_data.get("id", f"llm_q_{len(questions)}"),
                    question=q_data["question"],
                    options=q_data.get("options", []),
                    allows_free_text=True,
                    context_hint=q_data.get("context_hint", ""),
                ))

            if not questions:
                return None

            return AmbiguityResult(
                is_ambiguous=True,
                confidence=confidence,
                category=parsed.get("category", "llm_detected"),
                questions=questions,
                original_query=query,
                reasoning=parsed.get("reasoning", "LLM detected missing critical facts."),
            )

    except httpx.TimeoutException:
        logger.warning("LLM ambiguity check timed out — falling back to rule-based only")
        return None
    except httpx.ConnectError:
        logger.warning("LLM ambiguity check failed to connect to LM Studio — falling back to rule-based only")
        return None
    except (json.JSONDecodeError, KeyError, ValueError) as e:
        logger.warning(f"LLM ambiguity check returned unparseable response: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error in LLM ambiguity check: {e}")
        return None


# ---------------------------------------------------------------------------
# Main Detection Function
# ---------------------------------------------------------------------------

async def detect_ambiguity(
    query: str,
    history: Optional[list] = None,
    document_id: Optional[str] = None,
    use_llm: bool = True,
) -> AmbiguityResult:
    """
    Analyzes an in-domain Philippine civil law query for critical factual gaps.

    Returns an AmbiguityResult indicating whether clarification questions
    should be presented before proceeding with RAG retrieval.

    Args:
        query: The user's raw query text
        history: Conversation history (list of ChatMessage or dicts)
        document_id: If set, user is in document analysis mode (skip ambiguity)
        use_llm: Whether to use LLM-assisted detection for edge cases
    """
    q_clean = query.strip()
    q_lower = q_clean.lower()

    # Guard: Never ask for clarification in document analysis mode
    if document_id:
        return AmbiguityResult(original_query=q_clean)

    # Guard: Very short queries (1-2 words) are likely greetings or commands
    if len(q_clean.split()) <= 2:
        return AmbiguityResult(original_query=q_clean)

    # Guard: Inherently clear queries (specific articles, definitions, etc.)
    for pattern in CLEAR_QUERY_PATTERNS:
        if re.search(pattern, q_lower):
            return AmbiguityResult(original_query=q_clean)

    # Tier 1: Rule-based pattern matching
    for trigger_pat, exclusion_pat, category, base_confidence, questions_fn in AMBIGUITY_RULES:
        if re.search(trigger_pat, q_lower, re.IGNORECASE):
            # Check if the exclusion pattern resolves the ambiguity
            if exclusion_pat and re.search(exclusion_pat, q_lower, re.IGNORECASE):
                continue

            # Check if conversation history already clarified this category
            if _history_already_clarified(history, category):
                continue

            questions = questions_fn(q_lower)
            if not questions:
                continue

            CATEGORY_REASONING = {
                'missing_party_identity': "Your query involves cross-border property ownership, but your citizenship status and the type of property aren't specified — these details critically determine which Philippine laws apply.",
                'unclear_legal_relationship': "To provide accurate legal guidance, I need more details about the nature of the agreement or dispute and the parties involved.",
                'ambiguous_transaction_type': "How you acquired the property determines which area of law governs — sale, donation, and inheritance each have different legal requirements and consequences.",
                'missing_temporal_context': "The timing of the event is crucial because legal actions in the Philippines have specific prescriptive periods — filing too late may bar your claim entirely.",
                'conflicting_facts': "Your situation involves details that could be governed by different legal provisions depending on the parties' specific relationship status.",
            }

            return AmbiguityResult(
                is_ambiguous=True,
                confidence=base_confidence,
                category=category,
                questions=questions,
                original_query=q_clean,
                reasoning=CATEGORY_REASONING.get(category, "Additional context is needed for an accurate legal analysis."),
            )

    # Tier 2: LLM-assisted detection (for queries that pass rule-based but seem factually thin)
    if use_llm:
        # Heuristic: only invoke LLM if query is factually thin
        # (contains a scenario/story but lacks specificity)
        content_words = [w for w in re.findall(r'\b\w+\b', q_lower) if len(w) > 2]
        has_scenario_cues = any(w in q_lower for w in [
            'legal', 'legit', 'pwede', 'puwede', 'allowed', 'can ', 'is it',
            'what happens', 'ano mangyayari', 'may karapatan', 'karapatan',
            'liable', 'liability', 'sue', 'file', 'case', 'court', 'ikaso',
            'idemanda', 'bawal', 'valid', 'right', 'entitled', 'claim',
        ])
        is_factually_thin = (
            len(content_words) >= 4  # Not too short
            and len(content_words) <= 45  # Not an essay
            and has_scenario_cues
        )

        if is_factually_thin:
            # Don't double-ask if history already has clarification context
            if not _history_already_clarified(history, "llm_detected"):
                llm_result = await _llm_detect_ambiguity(query, q_lower)
                if llm_result and llm_result.is_ambiguous:
                    return llm_result

    # No ambiguity detected
    return AmbiguityResult(original_query=q_clean)


# ---------------------------------------------------------------------------
# Query Enrichment from Clarification Answers
# ---------------------------------------------------------------------------

# Maps clarification answer values to statutory search enrichment terms
ENRICHMENT_MAP: Dict[str, Dict[str, str]] = {
    "citizenship_status": {
        "Filipino citizen": "Filipino citizen Philippine national property ownership full rights Art 414",
        "Dual citizen (e.g., Filipino-American)": "dual citizenship RA 9225 reacquisition of citizenship property rights natural-born Filipino",
        "Former Filipino citizen (naturalized abroad)": "former natural-born Filipino RA 9225 Batas Pambansa 185 limited land area residential urban rural",
        "Foreign national (non-Filipino)": "alien foreign national constitutional prohibition Art XII Sec 7 1987 Constitution land ownership condominium act RA 4726 40 percent foreign equity lease agreement",
    },
    "property_type": {
        "Residential land / house and lot": "residential land house and lot ownership title transfer deed of sale",
        "Condominium unit": "condominium unit RA 4726 Condominium Act foreign ownership 40 percent equity ceiling",
        "Agricultural land": "agricultural land CARP CARL DAR foreign ownership prohibition agrarian reform",
        "Commercial property": "commercial property lease agreement corporation 60-40 Filipino equity requirement",
    },
    "agreement_form": {
        "Yes, there is a written contract or promissory note": "written contract promissory note Art 1144 ten-year prescriptive period documentary evidence",
        "No, it was a verbal/oral agreement only": "oral contract verbal agreement Art 1145 six-year prescriptive period parol evidence",
        "There are text messages / chat records as evidence": "electronic evidence RA 8792 E-Commerce Act text messages digital records",
    },
    "amount_involved": {
        "Below ₱400,000": "small claims court RA 11576 A.M. No. 08-8-7-SC simplified procedure MTC",
        "₱400,000 to ₱2,000,000": "MTC Metropolitan Trial Court jurisdiction RA 11576",
        "Above ₱2,000,000": "RTC Regional Trial Court jurisdiction RA 11576 civil action",
    },
    "accident_type": {
        "Vehicular / traffic accident": "vehicular accident quasi-delict Art 2176 motor vehicle negligence reckless imprudence Art 2185 Art 2180",
        "Physical assault / battery by another person": "physical injuries independent civil action Art 33 assault battery quasi-delict Art 2176 moral damages Art 2219",
        "Workplace accident / injury at work": "employer liability vicarious liability Art 2180 workplace injury occupational safety",
        "Accident on someone else's property (slip and fall, etc.)": "premises liability negligence Art 2176 property owner duty of care possessor liability",
    },
    "transfer_type": {
        "Purchased (contract of sale / contract to sell)": "contract of sale Art 1458 deed of sale transfer of ownership Art 1477 contract to sell",
        "Donated / given as a gift (donation)": "donation Art 725 deed of donation acceptance formalities inter vivos mortis causa",
        "Inherited from a deceased relative": "succession inheritance Art 777 compulsory heirs legitime intestate testate will",
        "Verbal promise or informal agreement": "oral agreement Statute of Frauds Art 1403 parol evidence enforceability",
    },
    "when_occurred": {
        "Within the last 6 months": "recent event within prescriptive period timely filing",
        "6 months to 1 year ago": "within prescriptive period timely filing",
        "1 to 4 years ago": "check prescriptive period Art 1145 six years oral four years quasi-delict Art 1146",
        "More than 4 years ago": "possible prescription lapsed Art 1146 four years quasi-delict Art 1145 six years oral",
        "More than 10 years ago": "likely prescribed Art 1144 ten years written contract Art 1141 thirty years real actions",
    },
    "relationship_status": {
        "Living together but not married (common-law / live-in)": "Art 147 co-ownership union without legal impediment common-law property regime wages salary",
        "Married under Philippine law": "conjugal partnership absolute community property Art 75 Art 91 Family Code",
        "Separated but not legally (no court decree)": "de facto separation no court decree conjugal obligations subsist Art 100",
        "One or both parties are married to someone else": "Art 148 co-ownership union with legal impediment adulterous cohabitation actual joint contribution only",
    },
    "party_relationship": {
        "Stranger / no prior relationship": "quasi-delict Art 2176 fault negligence stranger tortfeasor",
        "Employer / employee": "employer vicarious liability Art 2180 diligence of a good father Art 2180 paragraph 4",
        "Business / contractual relationship": "breach of contract Art 1170 Art 1169 contractual obligation",
        "Family member or relative": "family relations Art 217 Art 218 parental authority family home",
        "Neighbor": "neighbor property nuisance Art 694 easement lateral support Art 684",
    },
    "property_titling_status": {
        "Yes, it has a Torrens Title (TCT/OCT)": "Torrens title registered land PD 1529 Sec 47 imprescriptibility cannot be acquired by prescription or adverse possession registered owner imprescriptible",
        "No, it is untitled / covered only by Tax Declaration": "untitled land alienable disposable public agricultural land tax declaration possession acquisitive prescription Art 1137 thirty years",
        "It is public / government land": "public dominion land patrimonial property State ownership inalienable Regalian doctrine",
        "Unknown / not sure if titled": "Torrens title registration status search Registry of Deeds verification PD 1529",
    },
    "occupation_duration": {
        "Less than 10 years": "less than ten years possession Art 555 loss of possession accion publiciana accion reivindicatoria",
        "10 to 29 years (with good faith / just title)": "ordinary acquisitive prescription Art 1134 ten years good faith just title Art 1117",
        "30 years or more (adverse possession / no title)": "extraordinary acquisitive prescription Art 1137 thirty years uninterrupted adverse possession bad faith",
        "Occupied with owner's mere tolerance or permission": "possession by mere tolerance Art 537 unlawful detainer acts of tolerance do not create prescription or ownership",
    },
}


def enrich_query_with_clarification(
    original_query: str,
    clarification_context: Dict[str, Any],
) -> str:
    """
    Merges the user's clarification answers into the search query
    to guide both vector embedding similarity and legal term expansion.

    Args:
        original_query: The user's original query text
        clarification_context: Dict with 'answers' key mapping question IDs to selected answers

    Returns:
        Enriched query string with relevant statutory terms appended
    """
    answers = clarification_context.get("answers", {})
    if not answers:
        return original_query

    enriched_parts = [original_query]

    for q_id, answer in answers.items():
        if q_id in ENRICHMENT_MAP:
            mapped = ENRICHMENT_MAP[q_id].get(answer)
            if mapped:
                enriched_parts.append(mapped)
            else:
                # Free-text answer: append directly
                enriched_parts.append(answer)
        else:
            # Unknown question ID: append the raw answer
            enriched_parts.append(answer)

    enriched = " ".join(enriched_parts)
    logger.info(f"Enriched query with clarification: {enriched[:200]}...")
    return enriched
