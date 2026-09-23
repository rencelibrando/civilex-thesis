import json
import logging
import httpx
from core.config import LM_STUDIO_URL

async def generate_response_stream(system_prompt: str, user_query: str, history: list = None):
    """
    Streams a response from the LLM.
    Exclusively connects to LM Studio hosting the Gemma 4 (E4B) model.
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

    # Prepare messages for OpenAI compatible endpoint (LM Studio)
    messages = [{"role": "system", "content": system_prompt}]
    for msg in clean_history:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": user_query})

    # Connect exclusively to LM Studio
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
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
