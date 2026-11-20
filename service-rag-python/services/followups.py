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
    "PRACTICAL NEXT STEPS: Ground each question in real-life practical next steps for the user's specific scenario "
    "(e.g., claiming damages under Art. 2206, collecting debts from the estate under Art. 1159, barangay conciliation, or demand letters). "
    "NEVER suggest generic textbook questions (e.g. do NOT ask 'What are the legal exceptions to Article 2176?'). "
    "NEVER suggest out-of-scope topics (criminal arrest, police investigations, labor, tax, programming). "
    "CIVIL CODE ARTICLE BOUNDS: The Philippine Civil Code strictly ends at Article 2270. Never cite any article above 2270. "
    "ANTI-HALLUCINATION RULE: RA 386 is Republic Act No. 386 (the entire Civil Code), NOT Article 386. Never refer to 'Article 386'."
)


_TAGALOG_STRONG_RE = re.compile(
    r"\b(?:ano\s+ang|anong|paano|bakit|sino|saan|kailan|ilan\s+ang|ipaliwanag|pakipaliwanag|"
    r"artikulo|mga\s+kaso|hatol\s+sa|desisyon\s+sa|doktrina\s+sa|batas|karapatan|pananagutan|"
    r"sinasabi|mapapatunayan|ganito|kasong|pwede|maaari|hindi|walang)\b",
    re.IGNORECASE,
)
_TAGALOG_FUNCTION_RE = re.compile(
    r"\b(?:ang|mga|sa|ng|na|ko|mo|niya|namin|natin|nila|ako|ikaw|siya|kami|tayo|sila|"
    r"ay|po|opo|ba|naman|kung|kapag|dahil|pero|ngunit|para|laban|tungkol|ukol)\b",
    re.IGNORECASE,
)


def detect_query_language(text: Optional[str]) -> str:
    """Deterministically detect whether a query/line is Tagalog ('tl') or English ('en')."""
    if not text or not text.strip():
        return "en"
    if _TAGALOG_STRONG_RE.search(text):
        return "tl"
    func_hits = len(_TAGALOG_FUNCTION_RE.findall(text))
    return "tl" if func_hits >= 2 else "en"


def build_messages(
    query: str,
    answer_excerpt: str,
    prior_user_turns: Optional[List[str]] = None,
    doc_filename: Optional[str] = None,
) -> List[dict]:
    target_lang = detect_query_language(query)
    if target_lang == "tl":
        lang_instruction = (
            "TARGET LANGUAGE: TAGALOG ONLY. Write all 3 questions 100% in natural, simple Tagalog."
        )
    else:
        lang_instruction = (
            "TARGET LANGUAGE: ENGLISH ONLY. Write all 3 questions 100% in simple English with ZERO Tagalog words."
        )

    user_block = f"{lang_instruction}\nUser's question: {query[:500]}"
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


_THINK_BLOCK_RE = re.compile(r"<think>[\s\S]*?</think>", re.IGNORECASE)
_COT_META_LINE_RE = re.compile(
    r"(?:^\s*(?:thinking\s+process|thought\s+process|internal\s+monologue|reasoning|analysis|"
    r"draft(?:ing)?(?:\s+follow[- ]?ups?)?|step\s+\d+|here\s+are\s+(?:the\s+)?\d*\s*follow[- ]?up)|"
    r"^\s*\*{2}[^*\n]+:?\*{2}\s*:?|"
    r"\b(?:analyze\s+the\s+request|the\s+user\s+asked|the\s+assistant\s+provided|"
    r"constraint\s+check|output\s+format|strict\s+unilingual)\b)",
    re.IGNORECASE,
)


def parse_followup_questions(
    text: Optional[str],
    limit: int = MAX_SUGGESTIONS,
    target_lang: Optional[str] = None,
) -> List[str]:
    """Parse raw LLM output into clean questions, stripping reasoning traces and language mismatches."""
    if not text or not text.strip():
        return []
    cleaned_text = _THINK_BLOCK_RE.sub("", text).strip()
    if not cleaned_text:
        return []
    out: List[str] = []
    seen: set = set()
    for raw_line in cleaned_text.splitlines():
        line = raw_line.strip()
        # Strip list markers: "1.", "1)", "-", "*", "•"
        line = re.sub(r'^[\s]*(\d+[.)\-:]|[-*•])\s*', '', line).strip()
        line = line.strip('"“”\'').strip()
        if len(line) < 10:
            continue
        # Reject leaked chain-of-thought headers, markdown meta-labels, and colon-terminated headings.
        if line.endswith(':') or _COT_META_LINE_RE.search(line):
            continue
        if not re.search(r'[a-zA-Z\u00c0-\u024f]', line):
            continue
        if target_lang == "en" and detect_query_language(line) == "tl":
            continue
        if target_lang == "tl" and detect_query_language(line) == "en":
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
    target_lang = detect_query_language(query)
    try:
        from services.llm_client import call_chat_completion_async

        messages = build_messages(query, answer, prior_user_turns, doc_filename)
        raw = await call_chat_completion_async(
            messages=messages,
            temperature=0.2,
            max_tokens=300,
            timeout_sec=timeout_sec,
            reasoning_effort="none",
        )
        parsed = parse_followup_questions(raw, target_lang=target_lang)
        if not parsed and raw and raw.strip():
            # Retry once with an explicit strict-language correction when the model drifted languages.
            retry_note = (
                "Your previous output used the wrong language. Rewrite all 3 follow-up questions strictly in ENGLISH ONLY."
                if target_lang == "en"
                else "Your previous output used the wrong language. Rewrite all 3 follow-up questions strictly in TAGALOG ONLY."
            )
            retry_msgs = messages + [{"role": "user", "content": retry_note}]
            raw_retry = await call_chat_completion_async(
                messages=retry_msgs,
                temperature=0.1,
                max_tokens=300,
                timeout_sec=timeout_sec,
                reasoning_effort="none",
            )
            parsed = parse_followup_questions(raw_retry, target_lang=target_lang)
        return parsed
    except Exception as exc:
        logger.warning("follow-up generation failed: %s", exc)
        return []
