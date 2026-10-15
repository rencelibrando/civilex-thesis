import json
import logging
from typing import Optional
import httpx
from core.config import LM_STUDIO_URL

_async_client: Optional[httpx.AsyncClient] = None
_sync_client: Optional[httpx.Client] = None

def get_async_client() -> httpx.AsyncClient:
    global _async_client
    if _async_client is None or _async_client.is_closed:
        _async_client = httpx.AsyncClient(
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
            timeout=httpx.Timeout(600.0, connect=10.0),
        )
    return _async_client

def get_sync_client() -> httpx.Client:
    global _sync_client
    if _sync_client is None or _sync_client.is_closed:
        _sync_client = httpx.Client(
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
            timeout=httpx.Timeout(60.0, connect=10.0),
        )
    return _sync_client

async def close_llm_clients():
    global _async_client, _sync_client
    if _async_client and not _async_client.is_closed:
        await _async_client.aclose()
    if _sync_client and not _sync_client.is_closed:
        _sync_client.close()

async def generate_response_stream(
    system_prompt: str,
    user_query: str,
    history: list = None,
    max_tokens: int = 2048,
    repetition_penalty: float = 1.15,
    finish_info: dict | None = None,
):
    if history is None:
        history = []

    # Window history to last 12 messages and strip previous scope refusals
    SCOPE_REFUSAL_SNIPPET = "I am programmed only to assist with matters related to the Philippine Civil Code"
    clean_history = []
    for msg in history:
        content = msg.get("content", "").strip() if isinstance(msg, dict) else ""
        if content:
            if msg.get("role") == "assistant" and SCOPE_REFUSAL_SNIPPET in content:
                continue
            clean_history.append({"role": msg.get("role", "user"), "content": content})
    clean_history = clean_history[-12:]

    # Deduplicate consecutive user turn if already present
    if clean_history and clean_history[-1]["role"] == "user":
        last_user_text = clean_history[-1]["content"].strip().lower()
        query_text = user_query.strip().lower()
        if (last_user_text == query_text or 
            query_text.endswith(last_user_text) or 
            last_user_text in query_text):
            clean_history.pop()

    messages = [{"role": "system", "content": system_prompt}]
    for msg in clean_history:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": user_query})

    url = f"{LM_STUDIO_URL.rstrip('/')}/chat/completions"
    payload = {
        "model": "local-model",
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": max_tokens,
        "stream": True,
        "repetition_penalty": repetition_penalty,
    }

    try:
        logging.info(f"Connecting to LM Studio stream at {url} with max_tokens={max_tokens}...")
        stream_timeout = httpx.Timeout(600.0, connect=10.0)
        last_finish_reason = None
        client = get_async_client()
        async with client.stream("POST", url, json=payload, timeout=stream_timeout) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                        choices = data.get("choices", [])
                        if choices:
                            choice = choices[0]
                            finish_reason = choice.get("finish_reason")
                            if finish_reason:
                                last_finish_reason = finish_reason
                                logging.info(f"LM Studio stream finished with reason: '{finish_reason}'")
                                if finish_reason == "length":
                                    logging.warning(
                                        f"LM Studio output truncated by max_tokens={max_tokens}. "
                                        "Consider raising max_tokens for this query type."
                                    )
                            content = choice.get("delta", {}).get("content", "")
                            if content:
                                yield content
                    except json.JSONDecodeError:
                        continue
        if finish_info is not None:
            finish_info["reason"] = last_finish_reason
        return

    except (httpx.TimeoutException, httpx.ConnectError, httpx.HTTPStatusError) as e:
        logging.error(f"LM Studio connection error: {type(e).__name__} - {e}")
        yield (
            "> **Model Service Offline**\n>\n"
            "> Unable to connect to the language model. LM Studio is currently offline or unreachable. "
            "Please ensure LM Studio is running and try again."
        )
    except Exception as e:
        logging.error(f"Unexpected error during LM Studio streaming: {type(e).__name__} - {e}")
        yield (
            "> **Service Temporarily Unavailable**\n>\n"
            "> An unexpected error occurred while communicating with the language model service. "
            "Please try submitting your question again."
        )


async def call_chat_completion_async(
    messages: list,
    temperature: float = 0.1,
    max_tokens: int = 2500,
    timeout_sec: float = 60.0,
    repetition_penalty: float = 1.15,
) -> str | None:
    url = f"{LM_STUDIO_URL.rstrip('/')}/chat/completions"
    payload = {
        "model": "local-model",
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
        "repetition_penalty": repetition_penalty,
    }

    try:
        req_timeout = httpx.Timeout(timeout_sec, connect=min(10.0, timeout_sec))
        client = get_async_client()
        response = await client.post(url, json=payload, timeout=req_timeout)
        response.raise_for_status()
        data = response.json()
        msg = data["choices"][0]["message"]
        return msg.get("content") or msg.get("reasoning_content") or ""
    except (httpx.TimeoutException, httpx.ConnectError, httpx.HTTPStatusError) as e:
        logging.warning(f"LM Studio async completion failed ({type(e).__name__}: {e})")
        return None
    except Exception as e:
        logging.error(f"Unexpected error calling LM Studio async: {e}")
        return None


def call_chat_completion_sync(
    messages: list,
    temperature: float = 0.0,
    max_tokens: int = 2500,
    timeout_sec: float = 60.0,
    repetition_penalty: float = 1.15,
) -> str | None:
    url = f"{LM_STUDIO_URL.rstrip('/')}/chat/completions"
    payload = {
        "model": "local-model",
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
        "repetition_penalty": repetition_penalty,
    }

    try:
        req_timeout = httpx.Timeout(timeout_sec, connect=min(10.0, timeout_sec))
        client = get_sync_client()
        response = client.post(url, json=payload, timeout=req_timeout)
        response.raise_for_status()
        data = response.json()
        msg = data["choices"][0]["message"]
        return msg.get("content") or msg.get("reasoning_content") or ""
    except (httpx.TimeoutException, httpx.ConnectError, httpx.HTTPStatusError) as e:
        logging.warning(f"LM Studio sync completion failed ({type(e).__name__}: {e})")
        return None
    except Exception as e:
        logging.error(f"Unexpected error calling LM Studio sync: {e}")
        return None


def llm_generate_claim_verification(response: str, context: str) -> tuple[int, int]:
    from services.nli import score_faithfulness

    if not response or not context:
        return 0, 0

    result = score_faithfulness(response, context)
    return result.claims_entailed, result.claims_total
