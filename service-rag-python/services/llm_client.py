import json
import httpx
from core.config import LM_STUDIO_URL, GEMINI_API_KEY

async def generate_response_stream(system_prompt: str, user_query: str, history: list = None):
    """
    Streams a response from the LLM.
    Tries LM Studio first, falls back to Gemini 1.5 Flash.
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
                "model": "local-model", # LM Studio ignores this, but it's required
                "messages": messages,
                "temperature": 0.3,
                "stream": True
            }
            # LM Studio endpoints typically have /chat/completions appended
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
            return # Successfully streamed from LM Studio, exit function

    except (httpx.TimeoutException, httpx.ConnectError, httpx.HTTPStatusError) as e:
        print(f"LM Studio connection failed: {e}. Falling back to Gemini API.")

    # ATTEMPT 2: Gemini 1.5 Flash (Fallback)
    if not GEMINI_API_KEY or GEMINI_API_KEY == "your_gemini_api_key_here":
        yield "\n\n**Error**: LM Studio is unreachable and no Gemini API Key was provided for fallback."
        return

    # Convert messages to Gemini format
    gemini_contents = []
    
    # Gemini requires user and model alternating. System instruction goes separate.
    # We will just append system prompt to the first user message for simplicity via REST, 
    # or use the systemInstruction field.
    
    for msg in history:
        role = "user" if msg["role"] == "user" else "model"
        gemini_contents.append({"role": role, "parts": [{"text": msg["content"]}]})
    
    # Add the current user query
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
    
    gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse&key={GEMINI_API_KEY}"
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            async with client.stream("POST", gemini_url, json=gemini_payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data_str = line[6:]
                        try:
                            data = json.loads(data_str)
                            # Gemini SSE returns an array of response objects or a single response object
                            if "candidates" in data and len(data["candidates"]) > 0:
                                parts = data["candidates"][0].get("content", {}).get("parts", [])
                                for part in parts:
                                    if "text" in part:
                                        yield part["text"]
                        except json.JSONDecodeError:
                            continue
    except Exception as e:
        yield f"\n\n**Error**: Both LM Studio and Gemini Fallback failed. Detail: {e}"
