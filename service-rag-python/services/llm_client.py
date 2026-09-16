import json
import logging
import httpx
from core.config import LM_STUDIO_URL, GEMINI_API_KEY

async def generate_response_stream(system_prompt: str, user_query: str, history: list = None):
    """
    Streams a response from the LLM.
    Tries LM Studio first, then falls back to Google Gemini models.
    """
    if history is None:
        history = []

    # Prepare messages for OpenAI compatible endpoint (LM Studio)
    messages = [{"role": "system", "content": system_prompt}]
    for msg in history:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": user_query})

    # ATTEMPT 1: LM Studio (Local / Tunnel)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            payload = {
                "model": "local-model",
                "messages": messages,
                "temperature": 0.3,
                "stream": True
            }
            url = f"{LM_STUDIO_URL.rstrip('/')}/chat/completions"
            
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
            return  # Successfully streamed from LM Studio

    except (httpx.TimeoutException, httpx.ConnectError, httpx.HTTPStatusError) as e:
        logging.warning(f"LM Studio unavailable at {LM_STUDIO_URL}: {type(e).__name__}. Falling back to Gemini API.")

    # ATTEMPT 2: Gemini API Fallback
    if not GEMINI_API_KEY or GEMINI_API_KEY == "your_gemini_api_key_here":
        logging.error("Gemini fallback failed: GEMINI_API_KEY is not configured.")
        yield ">  **Service Configuration Notice**\n>\n> The local legal model is currently unreachable and no fallback credentials are configured. Please check your system settings or contact the administrator."
        return

    # Convert messages to Gemini format
    gemini_contents = []
    for msg in history:
        role = "user" if msg["role"] == "user" else "model"
        gemini_contents.append({"role": role, "parts": [{"text": msg["content"]}]})
    
    gemini_contents.append({"role": "user", "parts": [{"text": user_query}]})

    gemini_payload = {
        "system_instruction": {
            "parts": [{"text": system_prompt}]
        },
        "contents": gemini_contents,
        "generationConfig": {
            "temperature": 0.3
        }
    }
    
    headers = {
        "x-goog-api-key": GEMINI_API_KEY,
        "Content-Type": "application/json"
    }

    # Try primary requested model and fallback to resilient alternatives on 503 / 429
    fallback_models = [
        "gemini-3.5-flash-lite",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.8-flash"
    ]

    last_error = None

    for model in fallback_models:
        gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse"
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                async with client.stream("POST", gemini_url, headers=headers, json=gemini_payload) as response:
                    response.raise_for_status()
                    chunk_received = False
                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data_str = line[6:]
                            try:
                                data = json.loads(data_str)
                                if "candidates" in data and len(data["candidates"]) > 0:
                                    parts = data["candidates"][0].get("content", {}).get("parts", [])
                                    for part in parts:
                                        if "text" in part:
                                            chunk_received = True
                                            yield part["text"]
                            except json.JSONDecodeError:
                                continue
                    if chunk_received:
                        return  # Successfully finished streaming from Gemini model

        except httpx.HTTPStatusError as e:
            last_error = e
            status = e.response.status_code
            logging.warning(f"Gemini model {model} returned HTTP {status}. Trying alternative fallback model if available.")
            if status in (500, 502, 503, 504, 429):
                # Temporary server unavailability or rate-limit, try next model in pool
                continue
            else:
                # Client or auth error (e.g. 401, 403), retrying won't help
                break
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            last_error = e
            logging.warning(f"Gemini model {model} connection error: {type(e).__name__}. Retrying alternative model...")
            continue
        except Exception as e:
            last_error = e
            logging.error(f"Unexpected error during Gemini generation with {model}: {type(e).__name__} - {e}")
            break

    # If all options failed, log the secure error on the server and show a clean notice to the user
    safe_err_log = str(last_error) if last_error else "All models exhausted"
    if GEMINI_API_KEY and GEMINI_API_KEY in safe_err_log:
        safe_err_log = safe_err_log.replace(GEMINI_API_KEY, "[REDACTED]")
    logging.error(f"Both LM Studio and all Gemini fallback models failed: {safe_err_log}")

    yield (
        "> **Service Temporarily Unavailable**\n>\n"
        "> CIVIL-LEX is currently unable to complete your legal analysis due to a temporary service interruption with the underlying AI models. "
        "Please try submitting your question again in a moment."
    )

