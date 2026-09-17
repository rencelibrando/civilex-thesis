# CIVIL-LEX: Backend Implementation Details

This document outlines the concrete technical implementation for **Phase 2 (Python RAG Service)** and **Phase 3 (Node.js Gateway)** of the CIVIL-LEX system.

## 1. System Topology Overview

The backend is split into two distinct local microservices:
1. **Node.js API Gateway (Port 4000):** Acts as the public-facing gateway for the Next.js frontend. It is strictly responsible for routing, CORS, and authenticating users using Supabase JWTs.
2. **Python FastAPI RAG Service (Port 8000):** Isolated service dedicated to heavy AI workloads: embedding queries, searching the vector database, executing OCR, and communicating with the LLM (exclusively via LM Studio hosting Gemma 4 E4B).

*Security Note: The Next.js frontend NEVER talks to the Python service directly. It only talks to the Node.js Gateway.*

---

## 2. Node.js Express Gateway (backend-node)

### Key Dependencies
*   `express`: Web framework.
*   `cors`: Handling cross-origin requests from Next.js.
*   `@supabase/supabase-js`: Validating auth tokens and uploading files to Supabase Storage.
*   `multer`: Buffering incoming file uploads in memory.
*   `http-proxy-middleware`: For proxying SSE (Server-Sent Events) from Python directly to Next.js without buffering.

### Folder Structure
```text
backend-node/
├── src/
│   ├── index.js           # Express app entry point
│   ├── middleware/
│   │   └── auth.js        # Supabase JWT verification
│   └── routes/
│       └── proxy.js       # http-proxy-middleware configuration
├── package.json
└── .env                   # SUPABASE_URL, SUPABASE_ANON_KEY
```

### Core Logic (Authentication, File Buffering, & Proxying)
The gateway enforces that every request has a valid `Authorization: Bearer <token>`.
For document uploads, it accepts the file via `multer.memoryStorage()`, directly pushes the buffer to a Supabase Storage bucket (`documents`), and saves the generated public URL into the `user_documents` table.
For RAG chat and other proxied routes, `http-proxy-middleware` seamlessly forwards the request to the Python service running on Port 8000, ensuring the streaming Markdown chunks pass through instantly.

---

## 3. Python FastAPI RAG Service (service-rag-python)

### Key Dependencies
*   `fastapi` & `uvicorn`: High-performance API server.
*   `supabase`: Database client for executing RPCs and inserts.
*   `sentence-transformers`: Local XML-RoBERTa embedding generation.
*   `pymupdf` (fitz): Blazing fast digital PDF text extraction.
*   `pytesseract`: OCR fallback for scanned images.
*   `httpx`: Async HTTP client for communicating with LM Studio.
*   `pydantic`: Data validation for incoming payloads.

### Folder Structure
```text
service-rag-python/
├── main.py                # FastAPI entry point & routers
├── core/
│   ├── config.py          # Environment variables (LM Studio URL, Supabase)
│   └── database.py        # Supabase client initialization
├── services/
│   ├── embedding.py       # sentence-transformers logic
│   ├── llm_client.py      # LLM logic (LM Studio streaming for Gemma 4 E4B)
│   └── document.py        # PyMuPDF/Tesseract extraction & Chunking
└── requirements.txt
```

### Core API Routes

#### 1. `POST /search`
**Payload:** `{"query": "What are the requisites of marriage?", "history": [...]}`
**Logic:**
1. Generates a 768-dimensional embedding of the `query` using `sentence-transformers`.
2. Calls the Supabase RPC `match_documents(embedding, query)` to perform Hybrid Search (RRF).
3. Constructs the final Prompt holding the system instructions and the retrieved chunks.
4. Calls `services/llm_client.py`.
5. Returns a `StreamingResponse` (Server-Sent Events) back to the Node Gateway.

#### 2. `POST /extract`
**Payload:** `{"file_url": "https://.../storage/...", "document_id": "uuid"}`
**Logic (Runs as a Background Task):**
1. Downloads the PDF from Supabase Storage.
2. Runs `PyMuPDF` to extract text. If empty, runs `pytesseract`.
3. Runs the sliding window chunker, generates embeddings, and inserts them into `document_chunks`. Updates status to `completed`.

---

## 4. LLM Service Architecture (Local LM Studio Inference)

The system relies on local/tunneled inference using LM Studio to host the fine-tuned **Gemma 4 (E4B)** model:

```python
async def generate_response_stream(system_prompt: str, user_query: str, history: list = None):
    # Connects exclusively to LM Studio hosting Gemma 4 (E4B)
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
                # Stream Markdown tokens back to client
                yield content
```
This ensures complete data sovereignty and adheres strictly to the fine-tuned offline model architecture.
