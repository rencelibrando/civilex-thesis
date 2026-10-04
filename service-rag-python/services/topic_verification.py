"""
Optional P2 LLM Topic Verifier for false-premise civil code queries.
Can be optionally enabled or called when suspected mismatch is flagged.
Falls back safely to symbolic P0 detection on timeout or error.
"""
import json
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

TOPIC_VERIFICATION_PROMPT = """You are a Philippine Civil Law statutory verifier for CIVIL-LEX.
Analyze whether the specified Philippine Civil Code (RA 386) article actually governs the specified legal topic, or if it constitutes a false-premise/mismatched query.

Article Number: Article {article_number}
Article Content Excerpt: {article_excerpt}
User Queried Topic: "{user_topic}"

RESPOND ONLY WITH A VALID JSON OBJECT with no code fences or extra text:
{{
  "is_mismatch": true or false,
  "confidence": 0.0 to 1.0,
  "action": "refuse_and_redirect" or "proceed",
  "reasoning": "Brief explanation",
  "suggested_redirect_article": "Article number if mismatch, or null"
}}
"""

async def verify_topic_alignment_with_llm(
    query: str,
    queried_article_num: str,
    article_excerpt: str,
    suspected_topic: str,
    timeout_sec: float = 2.5
) -> Dict[str, Any]:
    """
    Asynchronously queries local LLM to confirm topic mismatch on suspicious queries.
    Falls back gracefully to P0 on timeout or error.
    """
    from services.llm_client import call_chat_completion_async

    prompt = TOPIC_VERIFICATION_PROMPT.format(
        article_number=queried_article_num,
        article_excerpt=article_excerpt[:400],
        user_topic=suspected_topic
    )

    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": f"Query: \"{query}\""}
    ]

    try:
        raw_res = await call_chat_completion_async(
            messages=messages,
            temperature=0.0,
            max_tokens=300,
            timeout_sec=timeout_sec
        )
        if raw_res:
            clean = raw_res.strip()
            if clean.startswith("```"):
                clean = clean.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
            data = json.loads(clean)
            return {
                "is_mismatch": bool(data.get("is_mismatch", False)),
                "confidence": float(data.get("confidence", 0.0)),
                "action": str(data.get("action", "proceed")),
                "reasoning": str(data.get("reasoning", "")),
                "suggested_redirect_article": data.get("suggested_redirect_article")
            }
    except Exception as e:
        logger.warning(f"P2 LLM topic verification skipped or timed out ({e}); defaulting to symbolic P0.")

    return {
        "is_mismatch": True,
        "confidence": 0.9,
        "action": "refuse_and_redirect",
        "reasoning": "Fallback to symbolic distractor detection.",
        "suggested_redirect_article": None
    }
