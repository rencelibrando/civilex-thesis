import asyncio
import hashlib
import logging
import re
import time
from collections import OrderedDict
from typing import Literal, Optional

import httpx

logger = logging.getLogger(__name__)

GTX_TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single"
MAX_CHUNK_CHARS = 3500
MAX_TRANSLATE_CHARS = 25000
MAX_CACHE_ENTRIES = 512
_SEGMENT_SEPARATOR = "\n\n"
_MAX_CONCURRENT_BATCHES = 4

SupportedLang = Literal["en", "tl"]
SourceLang = Literal["en", "tl", "auto"]

_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

_FENCE_RE = re.compile(r"^\s*(?:```|~~~)")
_HR_RE = re.compile(r"^\s*(?:[-*_]\s*){3,}$")
_TABLE_SEP_RE = re.compile(r"^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$")
_LINE_PREFIX_RE = re.compile(
    r"^(?P<prefix>(?:\s*>\s*)*(?:\s*#{1,6}\s+|\s*(?:[-*+]|\d+\.)\s+)?)"
)

_INLINE_CODE_RE = re.compile(r"`[^`\n]+`")
_MARKDOWN_LINK_URL_RE = re.compile(r'(?<=\])(\([^)\s\n]+(?:\s+"[^"\n]*")?\))')

# Ordered longest-first so bracketed/compound citations mask atomically before shorter tokens
_LEGAL_TOKEN_RE = re.compile(
    r"\[(?:Art(?:s|icles?)?\.?|Artikulo|Family\s+Code\s+Art(?:s|\.)?|Civil\s+Code\s+Art(?:s|\.)?)[^\]]{1,48}\]"
    r"|\bG\.?\s*R\.?\s*Nos?\.?\s*(?:L-)?\d+(?:[-–]\d+)?(?:\s*(?:,|&|and)\s*(?:L-)?\d+(?:[-–]\d+)?)*"
    r"|\b(?:Articles?|Arts?\.?|Artikulo)\s+\d+(?:-[A-Za-z])?(?:\s*(?:,|to|-|–|and|at|&)\s*\d+(?:-[A-Za-z])?)*"
    r"|\b(?:Republic\s+Act|R\.?\s*A\.?|Executive\s+Order|E\.?\s*O\.?|Presidential\s+Decree|P\.?\s*D\.?|Batas\s+Pambansa|B\.?\s*P\.?|Commonwealth\s+Act|C\.?\s*A\.?)\s*(?:No\.?\s*)?\d+\b"
    r"|\b(?:RA386|EO209)-[A-Z0-9-]+\b"
    r"|(?-i:\b(?:CIVIL-LEX|PAO|RTC|MTC|MeTC|MTCC|MCTC|IBP|NLI|HLURB|DHSUD|NLRC)\b)",
    re.IGNORECASE,
)

_DELIM_CANDIDATES = (
    ("\u27e6", "\u27e7"),
    ("\u27ea", "\u27eb"),
    ("\u2989", "\u298a"),
)


class TranslationServiceError(RuntimeError):
    """Raised when the upstream GTX translation endpoint fails or rate-limits."""

    def __init__(self, message: str, status_code: int = 503):
        super().__init__(message)
        self.status_code = status_code


_async_client: Optional[httpx.AsyncClient] = None
_translation_cache: OrderedDict[tuple[str, str, str], tuple[str, str]] = OrderedDict()


def get_translator_client() -> httpx.AsyncClient:
    global _async_client
    if _async_client is None or _async_client.is_closed:
        _async_client = httpx.AsyncClient(
            limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
            timeout=httpx.Timeout(10.0, connect=4.0),
            headers={"User-Agent": _USER_AGENT},
        )
    return _async_client


async def close_translator_client() -> None:
    global _async_client
    if _async_client and not _async_client.is_closed:
        await _async_client.aclose()
        _async_client = None


def clear_translation_cache() -> None:
    _translation_cache.clear()


def _normalize_lang(code: Optional[str], fallback: str = "auto") -> str:
    if not code:
        return fallback
    cleaned = code.strip().lower().split("-")[0]
    if cleaned in ("tl", "fil"):
        return "tl"
    if cleaned == "en":
        return "en"
    return cleaned or fallback


def _select_placeholder_delimiters(text: str) -> tuple[str, str]:
    for left, right in _DELIM_CANDIDATES:
        if left not in text and right not in text:
            return left, right
    return _DELIM_CANDIDATES[0]


def _normalize_restored_legal_token(token: str, target_lang: SupportedLang) -> str:
    if target_lang == "en":
        return re.sub(r"\bArtikulo\b", "Article", token, flags=re.IGNORECASE)
    return token


def _mask_segment(
    segment: str,
    placeholders: list[str],
    left: str,
    right: str,
    target_lang: SupportedLang,
) -> str:
    def store(value: str) -> str:
        idx = len(placeholders)
        placeholders.append(value)
        return f"{left}{idx}{right}"

    masked = _INLINE_CODE_RE.sub(lambda m: store(m.group(0)), segment)
    masked = _MARKDOWN_LINK_URL_RE.sub(lambda m: store(m.group(1)), masked)
    masked = _LEGAL_TOKEN_RE.sub(
        lambda m: store(_normalize_restored_legal_token(m.group(0), target_lang)),
        masked,
    )
    return masked


def _restore_placeholders(text: str, placeholders: list[str], left: str, right: str) -> str:
    if not placeholders:
        return text
    pattern = re.compile(rf"{re.escape(left)}\s*(\d+)\s*{re.escape(right)}")

    def replace(match: re.Match[str]) -> str:
        idx = int(match.group(1))
        if 0 <= idx < len(placeholders):
            return placeholders[idx]
        return match.group(0)

    return pattern.sub(replace, text)


def _repair_balanced_bold(text: str) -> str:
    """Moves stray interior spaces introduced by NMT outside balanced **...** spans."""
    parts = text.split("**")
    if len(parts) < 3 or len(parts) % 2 == 0:
        return text

    for idx in range(1, len(parts), 2):
        inner = parts[idx]
        stripped_left = inner.lstrip(" \t")
        if len(stripped_left) != len(inner):
            lead = inner[: len(inner) - len(stripped_left)]
            if parts[idx - 1] and not parts[idx - 1].endswith((" ", "\t", "(", "[", "\n")):
                parts[idx - 1] += lead
            inner = stripped_left

        stripped_right = inner.rstrip(" \t")
        if len(stripped_right) != len(inner):
            trail = inner[len(stripped_right) :]
            if parts[idx + 1] and not parts[idx + 1].startswith((" ", "\t", ")", "]", ".", ",", ":", ";", "!", "?", "\n")):
                parts[idx + 1] = trail + parts[idx + 1]
            inner = stripped_right

        parts[idx] = inner

    return "**".join(parts)


def _is_table_data_row(line: str) -> bool:
    stripped = line.strip()
    return stripped.startswith("|") and stripped.endswith("|") and stripped.count("|") >= 2


def _split_long_segment(segment: str, max_chars: int) -> list[str]:
    if len(segment) <= max_chars:
        return [segment]

    pieces: list[str] = []
    current = ""
    for sentence in re.split(r"(?<=[.!?])\s+", segment):
        if not sentence:
            continue
        if len(sentence) > max_chars:
            if current:
                pieces.append(current)
                current = ""
            for start in range(0, len(sentence), max_chars):
                pieces.append(sentence[start : start + max_chars])
            continue
        candidate = f"{current} {sentence}".strip() if current else sentence
        if len(candidate) <= max_chars:
            current = candidate
        else:
            if current:
                pieces.append(current)
            current = sentence
    if current:
        pieces.append(current)
    return pieces or [segment]


async def _call_gtx_single(
    text: str,
    source_lang: SourceLang,
    target_lang: SupportedLang,
    client: Optional[httpx.AsyncClient] = None,
) -> tuple[str, str]:
    http_client = client or get_translator_client()
    params = {
        "client": "gtx",
        "sl": source_lang,
        "tl": target_lang,
        "dt": "t",
    }

    last_exc: Optional[Exception] = None
    for attempt in range(2):
        try:
            resp = await http_client.post(
                GTX_TRANSLATE_URL,
                params=params,
                data={"q": text},
            )
            if resp.status_code == 429:
                raise TranslationServiceError(
                    "Translation service is temporarily rate-limited. Please try again in a moment.",
                    status_code=429,
                )
            if resp.status_code >= 500 and attempt == 0:
                await asyncio.sleep(0.15)
                continue
            if resp.status_code != 200:
                raise TranslationServiceError(
                    f"Translation upstream returned HTTP {resp.status_code}.",
                    status_code=502,
                )

            payload = resp.json()
            if not isinstance(payload, list) or not payload or not isinstance(payload[0], list):
                raise TranslationServiceError("Unexpected translation response format.", status_code=502)

            translated = "".join(
                seg[0]
                for seg in payload[0]
                if isinstance(seg, list) and seg and isinstance(seg[0], str)
            )
            detected = _normalize_lang(
                payload[2] if len(payload) > 2 and isinstance(payload[2], str) else None,
                fallback=source_lang if source_lang != "auto" else "en",
            )
            return translated, detected
        except TranslationServiceError:
            raise
        except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPError) as exc:
            last_exc = exc
            if attempt == 0:
                await asyncio.sleep(0.15)
                continue
            break
        except ValueError as exc:
            raise TranslationServiceError(f"Invalid JSON from translation service: {exc}", status_code=502) from exc

    logger.warning("GTX translation request failed after retry: %s", last_exc)
    raise TranslationServiceError(
        "Unable to reach Google Translate right now. Please check your internet connection and retry.",
        status_code=503,
    )


async def _translate_segment_list(
    segments: list[str],
    source_lang: SourceLang,
    target_lang: SupportedLang,
    client: Optional[httpx.AsyncClient] = None,
) -> tuple[list[str], str]:
    if not segments:
        return [], source_lang if source_lang != "auto" else target_lang

    # Pack segments into character-bounded batches so typical answers finish in one HTTP call
    batches: list[list[str]] = []
    current_batch: list[str] = []
    current_len = 0

    for seg in segments:
        added_len = len(seg) + (len(_SEGMENT_SEPARATOR) if current_batch else 0)
        if current_batch and current_len + added_len > MAX_CHUNK_CHARS:
            batches.append(current_batch)
            current_batch = [seg]
            current_len = len(seg)
        else:
            current_batch.append(seg)
            current_len += added_len

    if current_batch:
        batches.append(current_batch)

    sem = asyncio.Semaphore(_MAX_CONCURRENT_BATCHES)

    async def run_single_segment(seg: str) -> tuple[str, str]:
        pieces = _split_long_segment(seg, MAX_CHUNK_CHARS)
        if len(pieces) == 1:
            async with sem:
                return await _call_gtx_single(pieces[0], source_lang, target_lang, client=client)
        out_pieces: list[str] = []
        detected_lang = source_lang if source_lang != "auto" else "en"
        for piece in pieces:
            async with sem:
                tr, det = await _call_gtx_single(piece, source_lang, target_lang, client=client)
            out_pieces.append(tr)
            if det:
                detected_lang = det
        return " ".join(out_pieces), detected_lang

    async def run_batch(batch: list[str]) -> tuple[list[str], str]:
        if len(batch) == 1:
            tr, det = await run_single_segment(batch[0])
            return [tr], det

        joined = _SEGMENT_SEPARATOR.join(batch)
        async with sem:
            translated_block, det = await _call_gtx_single(joined, source_lang, target_lang, client=client)

        parts = translated_block.split(_SEGMENT_SEPARATOR)
        if len(parts) == len(batch):
            return parts, det

        # Fallback to per-segment calls if NMT merges or splits separator newlines
        results = await asyncio.gather(*(run_single_segment(seg) for seg in batch))
        return [r[0] for r in results], (results[0][1] if results else det)

    batch_outputs = await asyncio.gather(*(run_batch(batch) for batch in batches))

    translated_segments: list[str] = []
    detected_source = source_lang if source_lang != "auto" else "en"
    for idx, (seg_list, det) in enumerate(batch_outputs):
        translated_segments.extend(seg_list)
        if idx == 0 and det:
            detected_source = det

    return translated_segments, detected_source


async def translate_legal_markdown(
    text: str,
    target_lang: SupportedLang,
    source_lang: SourceLang = "auto",
    *,
    client: Optional[httpx.AsyncClient] = None,
) -> dict:
    """Translates legal Markdown EN <-> TL via httpx + Google Translate gtx without any API key."""
    if target_lang not in ("en", "tl"):
        raise ValueError(f"Unsupported target language: {target_lang}")
    if source_lang not in ("en", "tl", "auto"):
        raise ValueError(f"Unsupported source language: {source_lang}")

    t0 = time.perf_counter()

    if not text or not text.strip():
        return {
            "translated_text": text,
            "source_lang": source_lang if source_lang != "auto" else target_lang,
            "target_lang": target_lang,
            "latency_ms": 0.0,
            "cached": False,
        }

    if source_lang != "auto" and source_lang == target_lang:
        return {
            "translated_text": text,
            "source_lang": source_lang,
            "target_lang": target_lang,
            "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
            "cached": False,
        }

    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    cache_key = (digest, source_lang, target_lang)
    cached_entry = _translation_cache.get(cache_key)
    if cached_entry is not None:
        _translation_cache.move_to_end(cache_key)
        cached_text, cached_source = cached_entry
        return {
            "translated_text": cached_text,
            "source_lang": cached_source,
            "target_lang": target_lang,
            "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
            "cached": True,
        }

    left_delim, right_delim = _select_placeholder_delimiters(text)
    placeholders: list[str] = []
    lines = text.splitlines()
    had_trailing_newline = text.endswith("\n")

    # Each entry describes how to rebuild a line after batch translation
    line_plan: list[tuple[str, object]] = []
    translatable_segments: list[str] = []
    in_fence = False

    for line in lines:
        if _FENCE_RE.match(line):
            in_fence = not in_fence
            line_plan.append(("raw", line))
            continue

        if in_fence or not line.strip() or _HR_RE.match(line) or _TABLE_SEP_RE.match(line):
            line_plan.append(("raw", line))
            continue

        if _is_table_data_row(line):
            lead_ws = line[: len(line) - len(line.lstrip(" \t"))]
            trail_ws = line[len(line.rstrip(" \t")) :]
            inner = line.strip()[1:-1]
            cells = inner.split("|")
            cell_slots: list[tuple[bool, object]] = []
            for cell in cells:
                stripped_cell = cell.strip()
                if not stripped_cell:
                    cell_slots.append((False, cell))
                else:
                    masked_cell = _mask_segment(
                        stripped_cell, placeholders, left_delim, right_delim, target_lang
                    )
                    seg_idx = len(translatable_segments)
                    translatable_segments.append(masked_cell)
                    cell_slots.append((True, seg_idx))
            line_plan.append(("table", (lead_ws, trail_ws, cell_slots)))
            continue

        match = _LINE_PREFIX_RE.match(line)
        prefix = match.group("prefix") if match else ""
        body = line[len(prefix) :]
        if not body.strip():
            line_plan.append(("raw", line))
            continue

        masked_body = _mask_segment(body, placeholders, left_delim, right_delim, target_lang)
        seg_idx = len(translatable_segments)
        translatable_segments.append(masked_body)
        line_plan.append(("line", (prefix, seg_idx)))

    translated_segments, detected_source = await _translate_segment_list(
        translatable_segments,
        source_lang=source_lang,
        target_lang=target_lang,
        client=client,
    )

    rebuilt_lines: list[str] = []
    for kind, data in line_plan:
        if kind == "raw":
            rebuilt_lines.append(str(data))
        elif kind == "line":
            prefix, seg_idx = data  # type: ignore[misc]
            restored = _restore_placeholders(
                _repair_balanced_bold(translated_segments[seg_idx]),
                placeholders,
                left_delim,
                right_delim,
            )
            rebuilt_lines.append(f"{prefix}{restored}")
        elif kind == "table":
            lead_ws, trail_ws, cell_slots = data  # type: ignore[misc]
            rebuilt_cells: list[str] = []
            for is_translated, slot in cell_slots:
                if not is_translated:
                    rebuilt_cells.append(str(slot))
                else:
                    restored_cell = _restore_placeholders(
                        _repair_balanced_bold(translated_segments[slot]),
                        placeholders,
                        left_delim,
                        right_delim,
                    )
                    rebuilt_cells.append(f" {restored_cell.strip()} ")
            rebuilt_lines.append(f"{lead_ws}|{'|'.join(rebuilt_cells)}|{trail_ws}")

    translated_text = "\n".join(rebuilt_lines)
    if had_trailing_newline:
        translated_text += "\n"

    _translation_cache[cache_key] = (translated_text, detected_source)
    if len(_translation_cache) > MAX_CACHE_ENTRIES:
        _translation_cache.popitem(last=False)

    return {
        "translated_text": translated_text,
        "source_lang": detected_source,
        "target_lang": target_lang,
        "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
        "cached": False,
    }
