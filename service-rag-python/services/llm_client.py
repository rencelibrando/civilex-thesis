import json
import logging
import httpx
from core.config import LM_STUDIO_URL

async def generate_response_stream(
    system_prompt: str,
    user_query: str,
    history: list = None,
    max_tokens: int = 2048,
    repetition_penalty: float = 1.15,
    finish_info: dict | None = None,
):
    """
    Streams a response from the LLM via LM Studio.
    If finish_info dict is provided, sets finish_info['reason'] to the
    terminal finish_reason ('stop', 'length', etc.) for truncation detection.
    """
    if history is None:
        history = []

    # Sanitize and window history: keep up to last 12 messages with non-empty content.
    # Omit previous scope refusal responses from history to prevent small local models
    # from falling into repetitive refusal loops on follow-up civil inquiries.
    SCOPE_REFUSAL_SNIPPET = "I am programmed only to assist with matters related to the Philippine Civil Code"
    clean_history = []
    for msg in history:
        content = msg.get("content", "").strip() if isinstance(msg, dict) else ""
        if content:
            if msg.get("role") == "assistant" and SCOPE_REFUSAL_SNIPPET in content:
                continue
            clean_history.append({"role": msg.get("role", "user"), "content": content})
    clean_history = clean_history[-12:]

    # Prepare messages for OpenAI compatible endpoint
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
        timeout = httpx.Timeout(600.0, connect=10.0)
        last_finish_reason = None
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", url, json=payload) as response:
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
            ">  **Model Service Offline**\n>\n"
            "> Unable to connect to the language model. LM Studio is currently offline or unreachable. "
            "Please ensure LM Studio is running and try again."
        )
    except Exception as e:
        logging.error(f"Unexpected error during LM Studio streaming: {type(e).__name__} - {e}")
        yield (
            ">  **Service Temporarily Unavailable**\n>\n"
            "> An unexpected error occurred while communicating with the language model service. "
            "Please try submitting your question again."
        )


async def call_chat_completion_async(
    messages: list,
    temperature: float = 0.1,
    max_tokens: int = 1200,
    timeout_sec: float = 30.0,
    repetition_penalty: float = 1.15,
) -> str | None:
    """
    Executes a non-streaming chat completion via LM Studio.
    Returns the string content of the response, or None if LM Studio fails.
    """
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
        timeout = httpx.Timeout(timeout_sec, connect=min(10.0, timeout_sec))
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]
    except (httpx.TimeoutException, httpx.ConnectError, httpx.HTTPStatusError) as e:
        logging.warning(f"LM Studio async completion failed ({type(e).__name__}: {e})")
        return None
    except Exception as e:
        logging.error(f"Unexpected error calling LM Studio async: {e}")
        return None


def call_chat_completion_sync(
    messages: list,
    temperature: float = 0.0,
    max_tokens: int = 1200,
    timeout_sec: float = 30.0,
    repetition_penalty: float = 1.15,
) -> str | None:
    """
    Synchronous non-streaming chat completion via LM Studio.
    """
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
        timeout = httpx.Timeout(timeout_sec, connect=min(10.0, timeout_sec))
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]
    except (httpx.TimeoutException, httpx.ConnectError, httpx.HTTPStatusError) as e:
        logging.warning(f"LM Studio sync completion failed ({type(e).__name__}: {e})")
        return None
    except Exception as e:
        logging.error(f"Unexpected error calling LM Studio sync: {e}")
        return None


def llm_generate_claim_verification(response: str, context: str) -> tuple[int, int]:
    """
    Deconstructs generated response into factual claims and verifies entailment
    against context using the deterministic symbolic NLI engine.

    Returns (entailed_claims_count, total_claims_count).

    NOTE: This function is retained for backward compatibility with
    eval_ragas.py and eval_iso25010.py.  All new code should call
    ``services.nli.score_faithfulness()`` directly.
    """
    from services.nli import score_faithfulness

    if not response or not context:
        return 0, 0

    result = score_faithfulness(response, context)
    return result.claims_entailed, result.claims_total
