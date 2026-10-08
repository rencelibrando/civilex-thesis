from __future__ import annotations
import logging
import re
from typing import List, Optional

logger = logging.getLogger(__name__)

MAX_SUGGESTIONS = 3
# Defensive cap so a verbose LLM line can't blow out the card layout.
# UI wraps full text (no line-clamp); this only guards pathological output.
MAX_CHARS = 140

_SYSTEM_PROMPT = (
    "You suggest follow-up questions for a Philippine civil-law legal chat for ordinary citizens. "
    "Output exactly 3 short follow-up questions the user would plausibly ask next, "
    "each on its own line, with no numbering, bullets, quotes, or extra text. "
    "Keep each question concise: under 12 words and ~80 characters so it fits on a small card. "
    "STRICT UNILINGUAL MATCH: Write all 3 questions in the EXACT SAME language as the user's question with ZERO code-switching. "
    "If the user asked in English, write all questions ENTIRELY in simple, everyday English without any Tagalog words. "
    "If the user asked in Tagalog, write all questions ENTIRELY in simplified, natural Tagalog without Taglish or English mixing. "
    "Keep every question grounded in the Philippine Civil Code (RA 386) or Family Code (EO 209) "
    "and directly related to the answered topic. Never use dense lawyer jargon without plain wording. "
    "Never suggest out-of-scope topics (criminal, labor, tax, programming). "
    "ANTI-HALLUCINATION RULE: RA 386 is Republic Act No. 386 (the entire Civil Code), NOT Article 386. Never refer to 'Article 386'."
)


def build_messages(
    query: str,
    answer_excerpt: str,
    prior_user_turns: Optional[List[str]] = None,
    doc_filename: Optional[str] = None,
) -> List[dict]:
    user_block = f"User's question: {query[:500]}"
    if prior_user_turns:
        earlier = " | ".join(t[:160] for t in prior_user_turns[-2:] if t and t.strip())
        if earlier:
            user_block += f"\nEarlier questions in this chat: {earlier}"
    if doc_filename:
        user_block += f"\nActive document under review: {doc_filename[:120]}"
    user_block += f"\nAssistant's answer (excerpt): {answer_excerpt[:1200]}"
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_block},
    ]


def parse_followup_questions(text: Optional[str], limit: int = MAX_SUGGESTIONS) -> List[str]:
    """Parse raw LLM output into clean questions. Pure function — unit tested."""
    if not text or not text.strip():
        return []
    out: List[str] = []
    seen: set = set()
    for raw_line in text.strip().splitlines():
        line = raw_line.strip()
        # Strip list markers: "1.", "1)", "-", "*", "•"
        line = re.sub(r'^[\s]*(\d+[.)\-:]|[-*•])\s*', '', line).strip()
        line = line.strip('"“”\'').strip()
        if len(line) < 10:
            continue
        if not re.search(r'[a-zA-Z\u00c0-\u024f]', line):
            continue
        key = line.lower()
        if key in seen:
            continue
        seen.add(key)
        # Defensive cap: truncate pathological lines on a word boundary.
        if len(line) > MAX_CHARS:
            cut = line[:MAX_CHARS].rsplit(' ', 1)[0] or line[:MAX_CHARS]
            line = cut.rstrip(' ,;:')
        out.append(line if line.endswith('?') else line + '?')
        if len(out) >= int(limit):
            break
    return out


async def generate_followups(
    query: str,
    answer: str,
    prior_user_turns: Optional[List[str]] = None,
    doc_filename: Optional[str] = None,
    timeout_sec: float = 20.0,
) -> List[str]:
    """Ask the model for follow-up suggestions. Never raises; returns [] on failure."""
    if not query or not query.strip() or not answer or len(answer.strip()) < 20:
        return []
    try:
        from services.llm_client import call_chat_completion_async

        messages = build_messages(query, answer, prior_user_turns, doc_filename)
        raw = await call_chat_completion_async(
            messages=messages,
            temperature=0.7,
            max_tokens=200,
            timeout_sec=timeout_sec,
        )
    except Exception as exc:
        logger.warning("follow-up generation failed: %s", exc)
        return []
    return parse_followup_questions(raw)
