import re
import json
import logging
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Any

from core.article_parser import parse_article_numbers

logger = logging.getLogger(__name__)



# Data Models
@dataclass
class ClarificationQuestion:
    """A single clarification question with selectable options."""
    id: str                             # e.g., "q1"
    question: str                       # Clarification question
    options: List[str]                  # Selectable options
    allows_free_text: bool = True       # User can type their own answer
    context_hint: str = ""              # Legal context / governing Civil Code article

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class AmbiguityResult:
    """Result of ambiguity detection on a user query."""
    is_ambiguous: bool = False
    confidence: float = 0.0             # 0.0 - 1.0
    category: str = ""                  # e.g., "missing_facts"
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



# LLM Ambiguity Analysis Prompt
AMBIGUITY_SYSTEM_PROMPT = """You are a Philippine Civil Law query analyzer for CIVIL-LEX.
Analyze whether the user's query is an AMBIGUOUS Philippine Civil Law inquiry that lacks essential legal facts needed to determine rights, obligations, or remedies under the Philippine Civil Code (RA 386).

RESPOND ONLY WITH VALID JSON. Do not include markdown codeblocks or commentary outside the JSON.
IMPORTANT: Never put unescaped double quotes inside JSON values; use single quotes (') for any quotes inside text.

DECISION CRITERIA:
1. NOT AMBIGUOUS (is_ambiguous: false, questions: []):
   - Non-legal or commercial price/shopping inquiries (e.g., car prices, product costs, electronics, retail goods, coding/programming, cooking, weather, general trivia, casual chat): These are strictly non-legal and NEVER ambiguous civil law disputes. You MUST return is_ambiguous: false and questions: []. NEVER invent, assume, or convert a commercial price or shopping query into a Civil Code contract or warranty scenario (e.g. do NOT ask about Article 1632 or dealership contracts).
   - Inquiries governed by other legal branches outside the Civil Code (pure criminal prosecution, labor standards under DOLE, tax under BIR, corporate SEC): Mark is_ambiguous: false, questions: [].
   - Contracts with illegal cause or illicit objects (e.g. sale of human organs/kidneys, organ trafficking, human trafficking, contract killings, illegal drugs/contraband): These agreements are void ab initio under Articles 1347 and 1409 and never produce legal effect. They are NEVER ambiguous civil disputes and lack no facts. You MUST return is_ambiguous: false and questions: [].
   - Statutory article or cause-of-action lookups: When the user asks what articles, laws, or civil cases apply or can be filed given an incident (e.g. 'ano ano ang mga article na nakakasakop...', 'what articles apply if...', 'anong mga batas o kaso ang pwede kung...'), mark is_ambiguous: false and questions: []. The system must directly synthesize the legal framework without blocking behind clarification questions.
   - Definitional, conceptual, or legal education queries (e.g., 'What is quasi-delict?').
   - Inquiries referencing specific articles, laws, or Supreme Court decisions (e.g., 'Article 1191', 'Art. 2176', 'G.R. No. 123456').
   - Codal structure and overview queries (e.g., total articles or books of the Civil Code).
   - Inquiries that already provide sufficient factual circumstances to identify the governing legal framework.
   - Follow-ups continuing an already-established line from CONVERSATION HISTORY ("ano ang exception dito?", "applies ba sa co-ownership?", "what about kung ...?") — reuse history, do NOT re-clarify resolved facts.
   - Requests to shorten, summarize, recap, or restate an answer already given in this conversation ("in short ...?", "buod?", "paikliin?", "so ano ang konklusyon?") — these are NEVER ambiguous; the facts were resolved in prior turns.

2. AMBIGUOUS (is_ambiguous: true):
   - Queries describing an ACTUAL ongoing Philippine Civil Law dispute, breach, unpaid loan, personal injury, property conflict, or contract issue that omits critical civil facts needed to determine liability (e.g., written vs oral contract, relationship between parties, timing for prescription, whether harm was intentional or accidental/negligent).
   - Ultra-vague legal inquiries about liability or suing (e.g., 'ano pwede ikaso sakin', 'can I be sued?') that provide zero facts.
   - Provide 1 to 2 concise clarification questions with 3 to 4 concrete options each.
   - Brevity limit: Keep each question under 25 words and each context_hint to one short sentence (under 15 words). Never produce more than 2 questions.

STRICT CIVIL LAW BOUNDARY (NEVER ACT AS POLICE OR CRIMINAL INVESTIGATOR):
- CIVIL-LEX is strictly a Philippine Civil Law platform (Civil Code, RA 386). It is NEVER a police investigator, forensic investigator, or prosecutor.
- NEVER ask police, forensic, or criminal procedural questions (e.g. eyewitnesses/saksi, murder weapons/armas, how the body was discovered, police blotter, arrests/pag-aresto, bail, autopsy). CIVIL-LEX does not conduct police interrogations!
- If an altercation, physical injury, or death is mentioned: Under Philippine Civil Law, the Civil Code strictly concerns CIVIL LIABILITY FOR DAMAGES (Articles 1161, 33, 2176, 2177, 2206, 2219) and the underlying debt/obligation (Articles 1159, 1953). Criminal liability (homicide/murder) falls under the Revised Penal Code.
- Clarification questions must ONLY pertain to civil law requisites:
  1. Sinadya ba o aksidente/kapabayaan? (Intentional injury under Art. 33 vs negligence/quasi-delict under Art. 2176).
  2. Danyos at naulila (funeral expenses, statutory indemnity for death under Art. 2206, moral damages under Art. 2219).
  3. Katibayan ng utang (written loan vs oral agreement under Arts. 1159/1953).
- NEVER ask 'May mga saksi ba?' or 'May nakakita ba ng nangyari?'!

ANTI-HALLUCINATION & ARTICLE NUMBER BOUNDS:
- The Philippine Civil Code (RA 386) strictly ends at Article 2270. There is NO Article 2271 or higher (e.g. Article 2476 DOES NOT EXIST).
- The Revised Penal Code strictly ends at Article 367.
- NEVER invent or cite non-existent article numbers. Do NOT put article citations in context_hint unless 100% certain.

STRICT UNILINGUAL LANGUAGE MATCH & SIMPLIFIED CITIZEN TONE:
- Questions, options, and context_hint MUST STRICTLY match the user's query language with ZERO code-switching:
  * If the user's query is in Filipino/Tagalog: Write all questions, options, and context_hint ENTIRELY in simplified, conversational Tagalog for normal citizens (zero English sentences or Taglish mixing).
    BAN DEEP / ARCHAIC FILIPINO WORDS: Strictly do NOT use deep words like alinsunod, sapagkat, datapwat, subalit, ipagkaloob, talastasin, kung kaya't, pananagutang sibil. Use simple everyday questions like: 'May kasulatan ba kayong pinirmahan?', 'Kailan ito nangyari?', 'Magkano ang halagang pinag-uusapan?'.
  * If the user's query is in English: Write all questions, options, and context_hint ENTIRELY in simple, plain 6th-grade English (zero Tagalog words).
    BAN DEEP LEGALESE: Do NOT use pursuant to, indemnification, pecuniary, herein, aforementioned, stipulation. Use simple everyday questions like: 'Did you sign a written agreement?', 'When did this happen?', 'How much is the unpaid amount?'.
- PERSONA: Act as a friendly, helpful community legal companion or neighbor asking clarifying questions so the citizen can get the right advice.
- Options: Must be simple, everyday choices that anyone can easily understand (e.g., 'May pinirmahang kasulatan', 'Wala, usapang bibig lamang', 'Hindi ako sigurado').
- context_hint: Briefly state why this matters in 1 short, simple sentence (under 15 words) using plain everyday words (e.g., 'Mahalaga ito upang malaman kung sinadya o aksidente ang nangyari para sa danyos').

JSON SCHEMA:
{
  "is_ambiguous": true or false,
  "confidence": 0.0 to 1.0,
  "category": "missing_facts" or "",
  "reasoning": "Brief explanation",
  "questions": [
    {
      "id": "q1",
      "question": "Clarification question",
      "options": ["Option 1", "Option 2", "Option 3"],
      "context_hint": "Brief reason why this matters for civil damages or obligations"
    }
  ]
}

If NOT ambiguous:
{
  "is_ambiguous": false,
  "confidence": 0.0,
  "category": "",
  "reasoning": "Query is clear enough, definitional, informational, or non-legal",
  "questions": []
}"""


def _fallback_extract_ambiguity(raw: str) -> Optional[dict]:
    """Regex-based fallback extraction if strict JSON decoding fails on LLM output."""
    try:
        ambig_m = re.search(r'"is_ambiguous"\s*:\s*(true|false)', raw, re.IGNORECASE)
        if not ambig_m:
            return None
        is_ambig = ambig_m.group(1).lower() == "true"
        conf_m = re.search(r'"confidence"\s*:\s*([0-9.]+)', raw)
        confidence = float(conf_m.group(1)) if conf_m else (0.85 if is_ambig else 0.0)
        cat_m = re.search(r'"category"\s*:\s*"([^"]*)"', raw)
        category = cat_m.group(1) if cat_m else ("missing_facts" if is_ambig else "")
        reason_m = re.search(r'"reasoning"\s*:\s*"(.*?)"(?:\s*,\s*"\w+"|\s*\})', raw, re.DOTALL)
        reasoning = reason_m.group(1).strip() if reason_m else ""

        questions = []
        if is_ambig:
            # Match individual question object blocks without tripping over options brackets
            q_blocks = re.findall(r'\{[^{}]*?"question"[^{}]*?\}', raw)
            for idx, block in enumerate(q_blocks):
                qm = re.search(r'"question"\s*:\s*"(.*?)"(?:\s*,\s*"\w+"|\s*\})', block, re.DOTALL)
                hint_m = re.search(r'"context_hint"\s*:\s*"(.*?)"(?:\s*,\s*"\w+"|\s*\})', block, re.DOTALL)
                options = []
                opt_section = re.search(r'"options"\s*:\s*\[(.*?)\]', block, re.DOTALL)
                if opt_section:
                    options = re.findall(r'"(.*?)"', opt_section.group(1))
                if qm:
                    questions.append({
                        "id": f"q{idx + 1}",
                        "question": qm.group(1).strip(),
                        "options": [o.strip() for o in options if o.strip()] or ["Yes", "No", "Not sure"],
                        "context_hint": hint_m.group(1).strip() if hint_m else "",
                    })

        return {
            "is_ambiguous": is_ambig,
            "confidence": confidence,
            "category": category,
            "reasoning": reasoning,
            "questions": questions,
        }
    except Exception as e:
        logger.warning(f"Fallback regex ambiguity extraction failed: {e}")
        return None


def _parse_llm_json(raw: str) -> Optional[dict]:
    """Extracts and parses JSON object from LLM output, with fallback cleaning."""
    if not raw:
        return None
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    match = re.search(r"\{[\s\S]*\}", cleaned)
    if not match:
        logger.warning(f"LLM ambiguity response contained no JSON object: {cleaned[:150]}")
        return None
    json_str = match.group()
    # Attempt 1: direct parse
    try:
        return json.loads(json_str, strict=False)
    except json.JSONDecodeError:
        pass
    # Attempt 2: clean trailing commas before closing braces/brackets
    try:
        fixed = re.sub(r",\s*([\]\}])", r"\1", json_str)
        return json.loads(fixed, strict=False)
    except json.JSONDecodeError:
        pass
    # Attempt 3: truncate at last valid closing brace if output was cut, balancing open brackets
    try:
        last_brace = json_str.rfind("}")
        if last_brace != -1:
            truncated = json_str[: last_brace + 1]
            if '"questions"' in truncated and truncated.count("[") > truncated.count("]"):
                truncated += "\n]"
            if truncated.count("{") > truncated.count("}"):
                truncated += "\n}"
            fixed = re.sub(r",\s*([\]\}])", r"\1", truncated)
            return json.loads(fixed, strict=False)
    except json.JSONDecodeError:
        pass
    # Attempt 4: regex-based field extraction fallback
    fallback = _fallback_extract_ambiguity(json_str)
    if fallback:
        return fallback

    logger.warning(f"Failed to parse LLM ambiguity JSON: {cleaned[:150]}")
    return None



# Main Detection Function (100% LLM Driven)


async def detect_ambiguity(
    query: str,
    history: Optional[list] = None,
    document_id: Optional[str] = None,
    use_llm: bool = True,
) -> AmbiguityResult:
    """
    Analyzes an in-domain Philippine civil law query for critical factual gaps
    using the LLM directly, without pattern matching rules.

    Args:
        query: The user's query text
        history: Conversation history (list of ChatMessage or dicts)
        document_id: If set, user is in document analysis mode (skip ambiguity)
        use_llm: Retained for interface compatibility

    Returns:
        AmbiguityResult indicating whether clarification is needed.
    """
    q_clean = query.strip()
    if not q_clean or document_id:
        return AmbiguityResult(original_query=q_clean)

    # 1. Skip trivial or very short queries (1-2 words like greetings)
    if len(q_clean.split()) <= 2:
        return AmbiguityResult(original_query=q_clean)

    # 1.5 Fast bypass: informational queries asking what articles, laws, or remedies apply to a described situation
    # (e.g., "ano ano ang mga article na nakakasakop...", "what articles apply if...", "anong mga batas o kaso ang pwede kung...")
    article_inquiry_cue = bool(re.search(
        r'\b(?:ano[- ]?ano|anong|what|which)\s+(?:ang\s+)?(?:mga\s+)?(?:article|articles|batas|kaso|artikulo|pananagutan)\b',
        q_clean,
        re.IGNORECASE
    ))
    if article_inquiry_cue and len(q_clean.split()) >= 6:
        return AmbiguityResult(
            is_ambiguous=False,
            confidence=0.0,
            category="",
            original_query=q_clean,
            reasoning="Informational inquiry asking which statutory articles or remedies apply to the described situation."
        )

    # 1.6 Fast bypass: statutory article queries or false-premise lookups are never ambiguous
    has_specific_article = bool(parse_article_numbers(q_clean))
    dispute_cues = bool(re.search(r'\b(sue|breach|accident|nasaktan|danyos|utang|idemanda|kaso)\b', q_clean, re.IGNORECASE))
    if has_specific_article and (len(q_clean.split()) <= 20 or not dispute_cues):
        return AmbiguityResult(
            is_ambiguous=False,
            confidence=0.0,
            category="",
            original_query=q_clean,
            reasoning="Specific statutory article inquiry or codal lookup."
        )

    # 1.7 Fast bypass: commercial price inquiries or general shopping are non-legal and never ambiguous
    commercial_price_cue = bool(re.search(
        r'\b(?:(?:what(?:\'s|\s+is)\s+(?:the\s+)?(?:price|cost|rate))|magkano\s+(?:ang\s+)?(?:presyo|kotse|sasakyan|benta)|price\s+of|how\s+much\s+is\s+(?:a\s+|an\s+|the\s+)?(?:car|vehicle|toyota|product)|just\s+want\s+to\s+know\s+the\s+price)\b',
        q_clean,
        re.IGNORECASE
    ))
    if commercial_price_cue and not dispute_cues:
        return AmbiguityResult(
            is_ambiguous=False,
            confidence=0.0,
            category="",
            original_query=q_clean,
            reasoning="Commercial price inquiries are non-legal and not ambiguous civil disputes."
        )

    # 1.8 Fast bypass: illicit transactions, fraudulent evasion, or persona jailbreaks are never ambiguous
    illicit_or_jailbreak_cue = bool(re.search(
        r'\b(?:magpanggap|pretend\s+to\s+be|jailbreak|simulated\s+sales?|pekeng\s+benta|lusutan\s+ang\s+legitime|circumvent|defraud|kidney|human\s+organ|hitman|droga)\b',
        q_clean,
        re.IGNORECASE
    ))
    if illicit_or_jailbreak_cue:
        return AmbiguityResult(
            is_ambiguous=False,
            confidence=0.0,
            category="",
            original_query=q_clean,
            reasoning="Illicit transactions, fraudulent evasion, or persona jailbreaks are not ambiguous civil disputes."
        )

    # 2. Build history context to avoid re-asking facts already stated
    history_context = ""
    if history:
        recent = history[-6:] if len(history) > 6 else history
        lines = []
        for m in recent:
            if hasattr(m, 'content'):
                role = getattr(m, 'role', 'user')
                lines.append(f"{role}: {m.content[:250]}")
            elif isinstance(m, dict):
                lines.append(f"{m.get('role', 'user')}: {str(m.get('content', ''))[:250]}")
        if lines:
            conv_str = "\n".join(lines)
            history_context = f"\nRecent conversation:\n{conv_str}\n"

    user_content = (
        f"Analyze this Philippine civil law query for ambiguity:\n\n\"{q_clean}\"\n"
        f"{history_context}\n"
        "Consider the recent conversation above — do NOT ask about facts already provided there. "
        "Strictly adhere to the unilingual language match rule: write questions, options, and hints entirely in English if the query is in English, or entirely in simplified Tagalog if the query is in Tagalog."
    )

    messages = [
        {"role": "system", "content": AMBIGUITY_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    from services.llm_client import call_chat_completion_async

    try:
        raw_content = await call_chat_completion_async(
            messages=messages,
            temperature=0.1,
            max_tokens=1000,
            timeout_sec=30.0,
        )
        if not raw_content:
            logger.warning("LLM ambiguity check returned empty; defaulting to clear.")
            return AmbiguityResult(original_query=q_clean)

        parsed = _parse_llm_json(raw_content)
        if not parsed:
            return AmbiguityResult(original_query=q_clean)

        is_ambig = bool(parsed.get("is_ambiguous", False))
        confidence = float(parsed.get("confidence", 0.8 if is_ambig else 0.0))

        if not is_ambig or confidence < 0.65:
            return AmbiguityResult(
                is_ambiguous=False,
                confidence=confidence,
                category=parsed.get("category", ""),
                original_query=q_clean,
                reasoning=parsed.get("reasoning", "Query is sufficiently clear."),
            )

        # Check for police/criminal interrogation patterns or hallucinated articles
        police_investigation_pattern = re.compile(
            r'\b(saksi|nakakita|aresto|pag-aresto|blotter|pulis|armas|autopsy|crime scene|witness|arrest|weapon)\b',
            re.IGNORECASE
        )
        invalid_article_pattern = re.compile(
            r'\bArticle\s+(?:227[1-9]|22[89]\d|2[3-9]\d{2}|[3-9]\d{3}|\d{5,})\b',
            re.IGNORECASE
        )

        questions: List[ClarificationQuestion] = []
        for q_data in parsed.get("questions", []):
            q_text = str(q_data.get("question", "")).strip()
            if not q_text:
                continue
            hint_text = str(q_data.get("context_hint", "")).strip()

            # Reject police/criminal investigation questions
            if police_investigation_pattern.search(q_text) or police_investigation_pattern.search(hint_text):
                logger.info(f"Filtered out police/criminal interrogation question: {q_text}")
                continue

            # Sanitize hallucinated article numbers
            q_text = invalid_article_pattern.sub("the Civil Code", q_text)
            hint_text = invalid_article_pattern.sub("the Civil Code", hint_text)

            opts = [invalid_article_pattern.sub("the Civil Code", str(o).strip()) for o in q_data.get("options", []) if str(o).strip()]
            questions.append(ClarificationQuestion(
                id=str(q_data.get("id", f"q_{len(questions) + 1}")),
                question=q_text,
                options=opts if opts else ["Yes", "No", "Not sure"],
                allows_free_text=True,
                context_hint=hint_text,
            ))

        if not questions:
            logger.info("Clarification bypassed: all generated questions were police interrogation or non-civil.")
            return AmbiguityResult(
                is_ambiguous=False,
                confidence=confidence,
                category=parsed.get("category", ""),
                original_query=q_clean,
                reasoning="Bypassed clarification: questions were outside Civil Code scope.",
            )

        # Sanitize reasoning from hallucinated articles
        clean_reasoning = invalid_article_pattern.sub("the Civil Code", str(parsed.get("reasoning", "LLM detected missing critical facts.")))

        logger.info(f"LLM detected ambiguity [{parsed.get('category')}]: {len(questions)} questions")
        return AmbiguityResult(
            is_ambiguous=True,
            confidence=confidence,
            category=str(parsed.get("category", "missing_facts")),
            questions=questions,
            original_query=q_clean,
            reasoning=clean_reasoning,
        )

    except Exception as e:
        logger.warning(f"LLM ambiguity detection failed ({type(e).__name__}: {e}); bypassing clarification safely.")
        return AmbiguityResult(original_query=q_clean)



# Query Enrichment with User Clarification Answers


def enrich_query_with_clarification(
    original_query: str,
    clarification_context: Dict[str, Any],
) -> str:
    """
    Merges the user's clarification answers into the search query
    to guide vector embedding similarity and hybrid statutory retrieval.

    Args:
        original_query: The user's original query text
        clarification_context: Dict with 'answers' key mapping question IDs to selected answers

    Returns:
        Enriched query string with clarification answers appended
    """
    answers = clarification_context.get("answers", {})
    if not answers:
        return original_query

    orig = clarification_context.get("original_query")
    if orig and str(orig).strip() and str(orig).strip().lower() not in original_query.lower():
        enriched_parts = [str(orig).strip(), original_query]
    else:
        enriched_parts = [original_query]

    for _, answer in answers.items():
        if isinstance(answer, list):
            for a in answer:
                a_str = str(a).strip()
                if a_str and a_str.lower() not in " ".join(enriched_parts).lower():
                    enriched_parts.append(a_str)
        elif answer and str(answer).strip():
            a_str = str(answer).strip()
            if a_str and a_str.lower() not in " ".join(enriched_parts).lower():
                enriched_parts.append(a_str)

    enriched = " ".join(enriched_parts)
    logger.info(f"Enriched query with clarification: {enriched[:200]}...")
    return enriched
