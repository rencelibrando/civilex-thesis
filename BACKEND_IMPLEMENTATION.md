# CIVIL-LEX: Backend Implementation Details

This document outlines the concrete technical implementation for **Phase 2 (Python RAG Service)** and **Phase 3 (Node.js Gateway)** of the CIVIL-LEX system.

## 1. System Topology Overview

The backend is split into two distinct local microservices:
1. **Node.js API Gateway (Port 4000):** Acts as the public-facing gateway for the Next.js frontend. It is strictly responsible for routing, CORS, and authenticating users using Supabase JWTs.
2. **Python FastAPI RAG Service (Port 8000):** Isolated service dedicated to heavy AI workloads: embedding queries, searching the vector database, executing OCR, and communicating with the LLM (LM Studio or Groq/Gemini fallback).

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
*   `httpx`: Async HTTP client for communicating with LM Studio and Groq.
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
│   ├── llm_client.py      # LLM logic (LM Studio -> Groq fallback)
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
3. Checks Relevance: Queries the LLM with the first 1000 tokens ("Does this relate to Civil Law?").
   * *If NO:* Updates `user_documents` status to `rejected_unrelated`.
   * *If YES:* Runs the sliding window chunker, generates embeddings, and inserts them into `document_chunks`. Updates status to `completed`.

---

## 4. LLM Fallback Mechanism (Reliability)

Because this is a thesis defense project running on a local Ryzen 5 laptop, the LM Studio connection (via Cloudflare tunnel) might experience high latency or timeouts. 

The `services/llm_client.py` will implement a robust fallback:
```python
async def generate_response_stream(prompt):
    try:
        # ATTEMPT 1: Primary LM Studio (Local/Tunnel)
        # Timeout set to 5 seconds for initial connection
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(LM_STUDIO_URL, json=prompt)
            async for chunk in response.aiter_lines():
                yield chunk
    except (httpx.TimeoutException, httpx.ConnectError):
        # ATTEMPT 2: Fallback to Groq API (Cloud)
        async with httpx.AsyncClient() as client:
            response = await client.post(GROQ_API_URL, json=prompt, headers={"Authorization": f"Bearer {GROQ_API_KEY}"})
            async for chunk in response.aiter_lines():
                yield chunk
```
This guarantees the presentation will never fail even if the local LLM hangs.
