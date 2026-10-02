"""
Ambiguity Detection & Conversational Clarification Service for CIVIL-LEX.

Directly leverages the LLM (LM Studio / Gemma) to analyze in-domain Philippine
civil law queries for critical factual gaps (e.g., missing party relationship,
unspecified transaction type, citizenship, prescription timing) and generates
targeted clarification questions before proceeding with RAG retrieval.
"""

import re
import json
import logging
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Any

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
Analyze whether the user's query is AMBIGUOUS or lacks essential facts needed to analyze rights, obligations, or remedies under the Philippine Civil Code (RA 386).

RESPOND ONLY WITH VALID JSON. Do not include markdown codeblocks or commentary outside the JSON.
IMPORTANT: Never put unescaped double quotes inside JSON values; use single quotes (') for any quotes inside text.

DECISION CRITERIA:
1. NOT AMBIGUOUS (is_ambiguous: false, questions: []):
   - Definitional, conceptual, or legal education queries (e.g., 'What is quasi-delict?').
   - Inquiries referencing specific articles, laws, or Supreme Court decisions (e.g., 'Article 1191', 'Art. 2176', 'G.R. No. 123456').
   - Codal structure and overview queries (e.g., total articles or books of the Civil Code).
   - Inquiries that already provide sufficient factual circumstances to identify the governing legal framework.
   - Non-legal queries.

2. AMBIGUOUS (is_ambiguous: true):
   - Queries describing an ongoing dispute, breach, loan, injury, or property conflict that omit critical facts (e.g., written vs oral contract, relationship between parties, timing for prescription, nature of damage).
   - Ultra-vague inquiries (e.g., 'ano pwede ikaso sakin', 'can I be sued?') that provide zero facts.
   - Provide 1 to 2 concise clarification questions with 3 to 4 concrete options each.

BILINGUAL FORMATTING:
- Questions and options should be bilingual (Tagalog / English) or match the user's language.
- context_hint should briefly state why this matters under the Civil Code (e.g., Art. 1144, Art. 1170, or Art. 2176).

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
      "context_hint": "Why this matters under the Civil Code (cite article)"
    }
  ]
}

If NOT ambiguous:
{
  "is_ambiguous": false,
  "confidence": 0.0,
  "category": "",
  "reasoning": "Query is clear enough or definitional",
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
            q_section = re.search(r'"questions"\s*:\s*\[([\s\S]*?)\]', raw)
            if q_section:
                blocks = re.findall(r'\{([^{}]*)\}', q_section.group(1))
                for idx, block in enumerate(blocks):
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
    # Attempt 3: truncate at last valid closing brace if output was slightly cut
    try:
        last_brace = json_str.rfind("}")
        if last_brace != -1:
            truncated = json_str[: last_brace + 1]
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
        "Consider the recent conversation above — do NOT ask about facts already provided there."
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

        questions: List[ClarificationQuestion] = []
        for q_data in parsed.get("questions", []):
            q_text = str(q_data.get("question", "")).strip()
            if not q_text:
                continue
            opts = [str(o).strip() for o in q_data.get("options", []) if str(o).strip()]
            questions.append(ClarificationQuestion(
                id=str(q_data.get("id", f"q_{len(questions)}")),
                question=q_text,
                options=opts if opts else ["Yes", "No", "Not sure"],
                allows_free_text=True,
                context_hint=str(q_data.get("context_hint", "")),
            ))

        if not questions:
            return AmbiguityResult(
                is_ambiguous=False,
                confidence=confidence,
                category=parsed.get("category", ""),
                original_query=q_clean,
                reasoning="No clarification questions produced; proceeding directly.",
            )

        logger.info(f"LLM detected ambiguity [{parsed.get('category')}]: {len(questions)} questions")
        return AmbiguityResult(
            is_ambiguous=True,
            confidence=confidence,
            category=str(parsed.get("category", "missing_facts")),
            questions=questions,
            original_query=q_clean,
            reasoning=str(parsed.get("reasoning", "LLM detected missing critical facts.")),
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

    enriched_parts = [original_query]

    for _, answer in answers.items():
        if isinstance(answer, list):
            enriched_parts.extend(str(a).strip() for a in answer if str(a).strip())
        elif answer and str(answer).strip():
            enriched_parts.append(str(answer).strip())

    enriched = " ".join(enriched_parts)
    logger.info(f"Enriched query with clarification: {enriched[:200]}...")
    return enriched
