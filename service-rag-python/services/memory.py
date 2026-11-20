from __future__ import annotations
import logging
import re as _re
import uuid
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

# Tunables calibrated for 6GB VRAM local inference and multi-turn document chats.
HISTORY_LIMIT = 20          # turns loaded from DB per request
LLM_WINDOW = 12             # turns sent to LLM (compacted in llm_client)
RETRIEVAL_WINDOW = 6        # turns used for query contextualization
PRIOR_CITATIONS_LIMIT = 24  # server-side retained citations across multi-turn chats
SUMMARY_TRIGGER_COUNT = 8   # start summarizing once history reaches 4 exchanges
SUMMARY_EVERY_N = 6         # refresh summary every 6 new messages after trigger
SUMMARY_MAX_CHARS = 1500    # cap stored summary length

_column_cache: Dict[str, bool] = {}

_SYNTHETIC_GREETING_SNIPPETS = (
    "i am civil-lex",
    "your philippine civil law assistant",
    "what legal question can i help you with today",
    "welcome back. continuing previous",
)


def is_synthetic_greeting(content: Optional[str]) -> bool:
    if not content:
        return False
    low = " ".join(str(content).strip().lower().split())
    return any(snippet in low for snippet in _SYNTHETIC_GREETING_SNIPPETS)


def dedupe_consecutive_user_turns(history: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Collapse consecutive duplicate user turns and strip synthetic UI greetings."""
    out: List[Dict[str, str]] = []
    for m in history:
        role = m.get("role")
        content = str(m.get("content", "")).strip()
        if role not in ("user", "assistant") or not content:
            continue
        if role == "assistant" and is_synthetic_greeting(content):
            continue
        if (
            role == "user"
            and out
            and out[-1]["role"] == "user"
            and out[-1]["content"].strip().lower() == content.lower()
        ):
            continue
        out.append({"role": role, "content": content})
    return out


def is_valid_uuid(value: Optional[str]) -> bool:
    if not value:
        return False
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def _has_column(conn, table: str, column: str) -> bool:
    """Probe information_schema once per process; tolerant of any DB error."""
    key = f"{table}.{column}"
    if key in _column_cache:
        return _column_cache[key]
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_name = %s AND column_name = %s
                """,
                (table, column),
            )
            exists = cur.fetchone() is not None
    except Exception:
        exists = False
    _column_cache[key] = exists
    return exists


def _session_owner(conn, session_id: str) -> Optional[str]:
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT user_id FROM chat_sessions WHERE id = %s;", (session_id,))
            row = cur.fetchone()
    except Exception as exc:
        logger.warning("session owner lookup failed: %s", exc)
        return None
    if not row:
        return None
    # psycopg2 returns tuple by default; RealDictCursor returns dict.
    if isinstance(row, dict):
        return str(row.get("user_id")) if row.get("user_id") else None
    try:
        return str(row[0]) if row[0] else None
    except Exception:
        return None


def load_session_history(
    session_id: Optional[str],
    limit: int = HISTORY_LIMIT,
    user_id: Optional[str] = None,
    get_conn: Optional[Callable] = None,
) -> List[Dict[str, str]]:
    """
    Load canonical per-chat history from chat_messages, oldest-first.
    Returns [] for missing/invalid sessions or owner mismatch (isolation).
    """
    if not is_valid_uuid(session_id) or get_conn is None:
        return []
    conn = None
    try:
        conn = get_conn()
        # Ownership check when caller knows the user (prevents cross-chat bleed
        # via forged session_id since RAG uses a privileged DB connection).
        if user_id:
            owner = _session_owner(conn, str(session_id))
            if owner is not None and str(owner) != str(user_id):
                logger.warning("session %s owner mismatch; returning empty history", session_id)
                return []
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT role, content FROM chat_messages
                WHERE session_id = %s AND content IS NOT NULL AND content <> ''
                ORDER BY created_at ASC
                LIMIT %s;
                """,
                (str(session_id), int(limit)),
            )
            # NOTE: LIMIT without OFFSET returns the *oldest* N rows. For a
            # sliding window we want the *newest* N in chronological order, so
            # fetch via subquery when the table grows. Keep it simple and
            # correct: order DESC, limit, then reverse in Python.
            rows = cur.fetchall()
        # The query above orders ASC, which gives oldest-first and drops new
        # messages once limit is exceeded. Re-query newest-first if needed.
        if len(rows) >= int(limit):
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT role, content FROM (
                        SELECT role, content, created_at FROM chat_messages
                        WHERE session_id = %s AND content IS NOT NULL AND content <> ''
                        ORDER BY created_at DESC
                        LIMIT %s
                    ) t ORDER BY created_at ASC;
                    """,
                    (str(session_id), int(limit)),
                )
                rows = cur.fetchall()
        out: List[Dict[str, str]] = []
        for r in rows:
            if isinstance(r, dict):
                role, content = r.get("role"), r.get("content")
            else:
                role, content = r[0], r[1]
            if role in ("user", "assistant") and content and str(content).strip():
                out.append({"role": role, "content": str(content)})
        return dedupe_consecutive_user_turns(out)
    except Exception as exc:
        logger.warning("load_session_history failed for %s: %s", session_id, exc)
        return []
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


def _citation_priority_key(cit: Dict[str, Any]) -> str:
    ptype = cit.get("parent_type")
    pid = cit.get("parent_id") or cit.get("id")
    if ptype == "article" and pid:
        return f"article_{pid}"
    if ptype == "case":
        meta = cit.get("metadata") or {}
        gr = meta.get("gr_number") or ""
        if gr:
            clean_gr = _re.sub(r'[^A-Za-z0-9]', '', str(gr)).upper()
            if clean_gr:
                return f"case_gr_{clean_gr}"
        if pid:
            return f"case_{pid}"
    cid = cit.get("chunk_id")
    if cid:
        return str(cid)
    snip = str(cit.get("content", ""))[:60].strip()
    if ptype == "user_document":
        return f"doc_{pid}_{snip}"
    return str(pid or snip)


def _prioritize_statutes_and_cases(items: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    """Retain statutory articles and jurisprudence ahead of document chunks within limit."""
    statutes_and_cases: List[Dict[str, Any]] = []
    other_items: List[Dict[str, Any]] = []
    for cit in items:
        if cit.get("parent_type") in ("article", "case", "jurisprudence"):
            statutes_and_cases.append(cit)
        else:
            other_items.append(cit)
    return (statutes_and_cases + other_items)[: int(limit)]


def load_recent_citations(
    session_id: Optional[str],
    limit: int = PRIOR_CITATIONS_LIMIT,
    get_conn: Optional[Callable] = None,
) -> List[Dict[str, Any]]:
    """Load most-recent stored citations for a session (prioritizing statutory authorities)."""
    if not is_valid_uuid(session_id) or get_conn is None:
        return []
    conn = None
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT citations FROM chat_messages
                WHERE session_id = %s AND citations IS NOT NULL
                ORDER BY created_at DESC LIMIT %s;
                """,
                (str(session_id), min(30, max(12, int(limit)))),
            )
            rows = cur.fetchall()
    except Exception as exc:
        logger.warning("load_recent_citations failed: %s", exc)
        return []
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

    import json as _json

    seen: set = set()
    out: List[Dict[str, Any]] = []
    for r in rows or []:
        raw = r.get("citations") if isinstance(r, dict) else r[0]
        if raw is None:
            continue
        items = raw
        if isinstance(raw, str):
            try:
                items = _json.loads(raw)
            except Exception:
                continue
        if isinstance(items, dict):
            items = [items]
        if not isinstance(items, list):
            continue
        for cit in items:
            if not isinstance(cit, dict):
                continue
            key = _citation_priority_key(cit)
            if key and key not in seen:
                seen.add(key)
                out.append(cit)
    return _prioritize_statutes_and_cases(out, int(limit))


def load_session_summary(
    session_id: Optional[str],
    get_conn: Optional[Callable] = None,
) -> Optional[str]:
    if not is_valid_uuid(session_id) or get_conn is None:
        return None
    conn = None
    try:
        conn = get_conn()
        if not _has_column(conn, "chat_sessions", "summary"):
            return None
        with conn.cursor() as cur:
            cur.execute("SELECT summary FROM chat_sessions WHERE id = %s;", (str(session_id),))
            row = cur.fetchone()
        if not row:
            return None
        val = row.get("summary") if isinstance(row, dict) else row[0]
        return str(val).strip() if val and str(val).strip() else None
    except Exception as exc:
        logger.warning("load_session_summary failed: %s", exc)
        return None
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


def save_user_message(
    session_id: Optional[str],
    content: str,
    get_conn: Optional[Callable] = None,
) -> bool:
    """
    Idempotent user-turn persist. Skips when the newest stored message is an
    identical user turn (covers the frontend fire-and-forget POST to
    /api/sessions/:id/messages racing this call).
    Returns True when a row was inserted.
    """
    if not is_valid_uuid(session_id) or not content or not content.strip():
        return False
    if get_conn is None:
        return False
    text = content.strip()
    conn = None
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            # Serialize per-session user writes to eliminate concurrent duplicate inserts.
            try:
                cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s));", (str(session_id),))
            except Exception:
                pass
            cur.execute(
                """
                SELECT role, content FROM chat_messages
                WHERE session_id = %s ORDER BY created_at DESC LIMIT 1;
                """,
                (str(session_id),),
            )
            last = cur.fetchone()
            if last is not None:
                if isinstance(last, dict):
                    lr, lc = last.get("role"), str(last.get("content", "")).strip()
                else:
                    lr, lc = last[0], str(last[1] or "").strip()
                if lr == "user" and lc == text:
                    conn.commit()
                    return False
            cur.execute(
                """
                INSERT INTO chat_messages (session_id, role, content)
                SELECT %s, 'user', %s
                WHERE NOT EXISTS (
                    SELECT 1 FROM chat_messages
                    WHERE session_id = %s
                      AND role = 'user'
                      AND btrim(content) = %s
                      AND created_at > NOW() - INTERVAL '15 seconds'
                );
                """,
                (str(session_id), text, str(session_id), text),
            )
            inserted = cur.rowcount > 0
            conn.commit()
        return inserted
    except Exception as exc:
        logger.warning("save_user_message failed: %s", exc)
        try:
            if conn:
                conn.rollback()
        except Exception:
            pass
        return False
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


def resolve_history(
    client_history: Optional[List[Any]],
    db_history: Optional[List[Dict[str, str]]],
) -> List[Dict[str, str]]:
    """Prefer server-authoritative DB history; collapse duplicate user turns and strip greetings."""
    if db_history:
        return dedupe_consecutive_user_turns(
            [{"role": m["role"], "content": m["content"]} for m in db_history]
        )[-HISTORY_LIMIT:]
    out: List[Dict[str, str]] = []
    for m in client_history or []:
        if isinstance(m, dict):
            role, content = m.get("role"), m.get("content", "")
        else:
            role = getattr(m, "role", "user")
            content = getattr(m, "content", "")
        if role in ("user", "assistant") and content and str(content).strip():
            out.append({"role": role, "content": str(content)})
    return dedupe_consecutive_user_turns(out)[-HISTORY_LIMIT:]


def merge_prior_citations(
    server_citations: Optional[List[Dict[str, Any]]],
    client_citations: Optional[List[Dict[str, Any]]],
    limit: int = PRIOR_CITATIONS_LIMIT,
) -> List[Dict[str, Any]]:
    """Union server + client citations, deduplicating by key and prioritizing statutes and cases."""
    seen: set = set()
    out: List[Dict[str, Any]] = []
    for cit in list(server_citations or []) + list(client_citations or []):
        if not isinstance(cit, dict):
            continue
        k = _citation_priority_key(cit)
        if k and k not in seen:
            seen.add(k)
            out.append(cit)
    return _prioritize_statutes_and_cases(out, int(limit))


def to_chat_messages(history_dicts: List[Dict[str, str]]):
    """Convert canonical dict history to main.ChatMessage objects (lazy import)."""
    from main import ChatMessage as _ChatMessage  # deferred to avoid circular import

    return [_ChatMessage(role=m["role"], content=m["content"]) for m in history_dicts]


def inject_summary_into_system_prompt(system_prompt: str, summary: Optional[str]) -> str:
    if not summary or not summary.strip():
        return system_prompt
    return (
        f"{system_prompt}\n\n"
        f"PRIOR CONVERSATION SUMMARY (same chat session, authoritative):\n{summary.strip()[:SUMMARY_MAX_CHARS]}"
    )


def should_refresh_summary(message_count: int) -> bool:
    if message_count < SUMMARY_TRIGGER_COUNT:
        return False
    return ((message_count - SUMMARY_TRIGGER_COUNT) % SUMMARY_EVERY_N) < 2


async def maybe_refresh_summary(
    session_id: Optional[str],
    get_conn: Optional[Callable] = None,
) -> Optional[str]:
    """Refresh chat_sessions.summary when the transcript grows past the trigger."""
    if not is_valid_uuid(session_id) or get_conn is None:
        return None
    history = load_session_history(session_id, limit=40, get_conn=get_conn)
    if not should_refresh_summary(len(history)):
        return None

    # Verify target column exists before spending GPU time on a summary LLM call.
    probe_conn = None
    has_summary_col = False
    has_updated_col = False
    try:
        probe_conn = get_conn()
        has_summary_col = _has_column(probe_conn, "chat_sessions", "summary")
        if has_summary_col:
            has_updated_col = _has_column(probe_conn, "chat_sessions", "summary_updated_at")
    except Exception as exc:
        logger.warning("summary schema check failed: %s", exc)
        return None
    finally:
        try:
            if probe_conn:
                probe_conn.close()
        except Exception:
            pass
    if not has_summary_col:
        logger.warning("chat_sessions.summary column missing; skipping summary generation")
        return None

    older = history[:-LLM_WINDOW] if len(history) > LLM_WINDOW else history
    if not older:
        return None
    from services.llm_client import call_chat_completion_async, compact_assistant_history_message

    transcript_lines = []
    for m in older[-20:]:
        body = (
            compact_assistant_history_message(m["content"], max_chars=360)
            if m["role"] == "assistant"
            else m["content"][:360]
        )
        transcript_lines.append(f"{m['role']}: {body}")
    transcript = "\n".join(transcript_lines)
    try:
        prompt = (
            "Summarize this Philippine civil-law chat transcript in 5 sentences max. "
            "Keep parties, key document clauses, facts, cited Civil/Family Code articles, and open questions:\n\n"
            + transcript
        )
        summary = await call_chat_completion_async(
            messages=[
                {"role": "system", "content": "You compress chat history into a short factual memory."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.0,
            max_tokens=400,
            timeout_sec=25.0,
        )
    except Exception as exc:
        logger.warning("summary LLM call failed: %s", exc)
        return None
    if not summary or not summary.strip():
        return None
    summary = summary.strip()[:SUMMARY_MAX_CHARS]
    conn = None
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            if has_updated_col:
                cur.execute(
                    "UPDATE chat_sessions SET summary = %s, summary_updated_at = NOW() WHERE id = %s;",
                    (summary, str(session_id)),
                )
            else:
                cur.execute(
                    "UPDATE chat_sessions SET summary = %s WHERE id = %s;",
                    (summary, str(session_id)),
                )
            conn.commit()
        return summary
    except Exception as exc:
        logger.warning("persisting session summary failed: %s", exc)
        return None
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


# Meta-questions about the conversation itself. Require an explicit
# conversation/history marker so civil queries ("what is quasi-delict?")
# never match.
_RECALL_PATTERNS = (
    r'\b(my|our)\s+(first|last|previous|earlier|latest|initial|second)\s+(query|queries|question|questions|message|messages|chat)\b',
    r'\bwhat\s+did\s+i\s+(ask|say|tell|ask\s+about)\b',
    r'\bwhat\s+was\s+my\s+(first|last|previous).*\b',
    r'\bwhat(\'s|\s+is)\s+my\s+first\s+query\b',
    r'\bsummariz\w*\s+(our|this|the)?\s*(conversation|chat|history|discussion|session)\b',
    r'\brecap\s+(our|this|the)?\s*(conversation|chat|history|discussion)\b',
    r'\brepeat\s+my\s+(last|previous|first)\s+(question|query)\b',
    r'\bremind\s+me\s+what\s+i\s+asked\b',
)


def is_history_recall_query(query: str) -> bool:
    """True when the user asks about the conversation itself. Pure."""
    if not query or not query.strip():
        return False
    q = query.strip().lower()
    return any(_re.search(p, q) for p in _RECALL_PATTERNS)


def build_recall_response(query: str, history: Optional[List[Dict[str, str]]]) -> str:
    """
    Deterministic answer to a history-recall question, quoted from the stored
    transcript. The caller's *current* turn must already be excluded from
    `history`. Pure function — unit tested.
    """
    prior_user = [
        str(m.get("content", "")).strip() if isinstance(m, dict) else str(getattr(m, "content", "")).strip()
        for m in (history or [])
        if (m.get("role") if isinstance(m, dict) else getattr(m, "role", "")) == "user"
    ]
    prior_user = [q for q in prior_user if q]
    # Defensive: drop a trailing echo of the recall question itself.
    if prior_user and query and prior_user[-1].strip().lower() == query.strip().lower():
        prior_user = prior_user[:-1]

    if not prior_user:
        return (
            "### Conversation Recall\n\n"
            "This is the first question in this chat — there are no earlier queries to recall yet.\n\n"
            "Ask me anything under the Philippine Civil Code (contracts, property, succession, family relations, quasi-delicts)."
        )

    def _short(q: str, n: int = 140) -> str:
        q = " ".join(q.split())
        return q if len(q) <= n else q[: n - 1].rstrip() + "…"

    lines = ["### Conversation Recall\n"]
    if _re.search(r'first', query.lower()):
        lines.append(f'Your first query in this chat was: **"{_short(prior_user[0])}"**')
    elif _re.search(r'last|previous|latest', query.lower()):
        lines.append(f'Your most recent query before this one was: **"{_short(prior_user[-1])}"**')
    else:
        lines.append(f'Your first query in this chat was: **"{_short(prior_user[0])}"**')
    if len(prior_user) > 1:
        lines.append(f"\nYou have asked {len(prior_user)} questions in this chat so far:")
        for i, q in enumerate(prior_user, 1):
            lines.append(f"{i}. {_short(q)}")
    else:
        lines.append("\nThat is the only earlier question in this chat so far.")
    return "\n".join(lines)


_SUMMARY_PATTERNS = (
    r'\bin\s+short\b',
    r'\bpaikliin\b',
    r'\bbuod\b',
    r'\bsummariz\w*\s+(it|that|this|your\s+answer|the\s+answer|yours|mo|naman)?\s*$',
    r'^\s*summariz\w*\b',
    r'\bgive\s+me\s+the\s+short\s+(version|answer)\b',
    r'\bshort\s+version\b',
    r'\bwrap\s+(it|this)\s+up\b',
    r'\bbottom\s+line\b',
    r'\bso\s+ano(ng)?\s+(naman\s+)?(ang\s+)?(konklusyon|hatol|punto)\b',
    r'\bano\s+ang\s+(konklusyon|punto|ibig\s+sabihin)\b',
)

_TAGALOG_MARKERS = (
    'buod', 'paikliin', 'naman', 'yung', 'yun', 'aking', 'saakin',
    'pwede', 'puwede', 'paano', 'bakit', 'kailan', 'saan', 'sino',
)
_TAGALOG_WORD_MARKERS = ('ano', 'ang', 'kung', 'nang', 'kong')


def is_summary_request(query: str) -> bool:
    """True when the user asks to shorten/summarize the answer just given. Pure."""
    if not query or not query.strip():
        return False
    q = query.strip().lower()
    return any(_re.search(p, q) for p in _SUMMARY_PATTERNS)


def _is_tagalog_query(query: str) -> bool:
    q = query.strip().lower()
    if any(m in q for m in _TAGALOG_MARKERS):
        return True
    # Short markers need word boundaries ('ano' must not match 'another').
    return any(_re.search(r'\b' + _re.escape(w) + r'\b', q) for w in _TAGALOG_WORD_MARKERS)


def _extract_conclusion(assistant_text: str, max_chars: int = 900) -> str:
    """Pull the direct-answer section out of a prior assistant message. Pure."""
    text = (assistant_text or "").strip()
    if not text:
        return ""
    m = _re.search(
        r'###\s*[^\n]*\n+(.+?)(?=\n###\s|\Z)',
        text,
        _re.DOTALL,
    )
    conclusion = m.group(1).strip() if m else text
    # Fall back to the first two sentences when no direct-answer section exists.
    if not m:
        parts = _re.split(r'(?<=[.!?])\s+', conclusion)
        conclusion = " ".join(p for p in parts[:2] if p).strip() or conclusion
    conclusion = " ".join(conclusion.split())
    if len(conclusion) > max_chars:
        conclusion = conclusion[: max_chars - 1].rstrip() + "…"
    return conclusion


def build_summary_response(query: str, history: Optional[List[Dict[str, str]]]) -> str:
    """
    Deterministic short-form answer built from the most recent assistant turn.
    The caller's *current* turn must already be excluded from `history`.
    Pure function — unit tested.
    """
    last_answer = ""
    for m in reversed(history or []):
        role = m.get("role") if isinstance(m, dict) else getattr(m, "role", "")
        if role == "assistant":
            content = m.get("content", "") if isinstance(m, dict) else getattr(m, "content", "")
            if content and str(content).strip():
                last_answer = str(content)
                break

    if _is_tagalog_query(query):
        header = "### Buod"
        empty = (
            f"{header}\n\n"
            "Wala pa akong naibibigay na sagot sa chat na ito na maaari kong paikliin. "
            "Itanong mo muna ang legal na concern mo."
        )
    else:
        header = "###  In Short"
        empty = (
            f"{header}\n\n"
            "There is no prior answer in this chat to shorten yet. "
            "Ask your legal question first."
        )
    if not last_answer:
        return empty
    return f"{header}\n\n{_extract_conclusion(last_answer)}"
