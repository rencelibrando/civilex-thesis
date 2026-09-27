import json
import logging
import httpx
from core.config import LM_STUDIO_URL

async def generate_response_stream(
    system_prompt: str,
    user_query: str,
    history: list = None,
    max_tokens: int = 2048,
):
    """
    Streams a response from the LLM via LM Studio.
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
    }

    try:
        logging.info(f"Connecting to LM Studio stream at {url}...")
        timeout = httpx.Timeout(180.0, connect=10.0)
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
                            content = data["choices"][0]["delta"].get("content", "")
                            if content:
                                yield content
                        except json.JSONDecodeError:
                            continue
        return

    except (httpx.TimeoutException, httpx.ConnectError, httpx.HTTPStatusError) as e:
        logging.error(f"LM Studio connection error at {LM_STUDIO_URL}: {type(e).__name__} - {e}")
        yield (
            "> **Local LLM Service Notice**\n>\n"
            "> CIVIL-LEX is unable to connect to the local Gemma 4 (E4B) model via LM Studio. "
            f"Please verify that LM Studio is running and accessible at `{LM_STUDIO_URL}`."
        )
    except Exception as e:
        logging.error(f"Unexpected error during LM Studio streaming: {type(e).__name__} - {e}")
        yield (
            "> **Service Temporarily Unavailable**\n>\n"
            "> An error occurred while communicating with the Gemma 4 (E4B) language model. "
            "Please try submitting your question again."
        )


async def call_chat_completion_async(
    messages: list,
    temperature: float = 0.1,
    max_tokens: int = 1200,
    timeout_sec: float = 30.0,
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
