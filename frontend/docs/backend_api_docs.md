# CIVIL-LEX Backend API Documentation

This document specifies all backend API endpoints across the Node.js API Gateway and the Python RAG Microservice.

## Architecture & Service Ports

- **Node.js API Gateway (Port `4000`):** Primary entry point for the Next.js frontend. Handles Bearer JWT authentication via Supabase Auth, routes internal requests for Civil Code data, user documents, sessions, profiles, and system telemetry, and proxies streaming RAG endpoints to the Python service.
- **Python RAG Microservice (Port `8000`):** High-performance asynchronous FastAPI service. Executes semantic domain routing, pre-retrieval ambiguity detection, hybrid vector and full-text search, statutory companion graph expansion, Inverted Pyramid prompt assembly, streaming LLM generation, post-generation Neuro-Symbolic NLI verification, and concurrency queue management.
- **Supabase PostgreSQL & pgvector (Port `54322`):** Primary relational and vector database.
- **LM Studio Server (Port `1234`):** Local model inference hosting fine-tuned Google Gemma 4 E4B.

---

## 1. Node.js API Gateway Endpoints (Port 4000)

### 1.1 Health & Base Information

#### `GET /health` and `GET /`
- **Description:** Verifies gateway connectivity and operational status.
- **Authentication:** None
- **Response `200 OK`:**
  ```json
  {
    "status": "ok",
    "service": "civilex-backend-gateway"
  }
  ```

---

### 1.2 Authentication Middleware Specification

Endpoints marked **Authentication: Required** enforce the `requireAuth` middleware:
- Requires header: `Authorization: Bearer <supabase_jwt_access_token>`.
- Rejects requests missing or having invalid tokens with `401 Unauthorized`.
- Generates a request-scoped Supabase client (`req.supabase`) carrying the user's JWT to guarantee PostgreSQL Row Level Security (RLS) enforcement.
- Attaches the verified user object to `req.user`.
- Automatically calls `PresenceService.touch(user, req)` to refresh user active presence.

---

### 1.3 Chat Sessions & Message History (`/api/sessions`)

#### `GET /api/sessions`
- **Description:** Retrieves all chat sessions belonging to the authenticated user, sorted by `created_at` descending.
- **Authentication:** Required
- **Query Parameters:**
  - `document_id` (*optional, UUID*): Filter sessions linked to an active uploaded document.
  - `session_type` (*optional, string*): Filter sessions by type (e.g., `legal_chat`, `doc_chat`).
- **Response `200 OK`:** Array of session objects:
  ```json
  [
    {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "user_id": "7ca85f64-5717-4562-b3fc-2c963f66afa7",
      "title": "Contract Breach Inquiry",
      "session_type": "legal_chat",
      "document_id": null,
      "created_at": "2026-10-14T10:00:00.000Z"
    }
  ]
  ```

#### `POST /api/sessions`
- **Description:** Creates a new chat session for the authenticated user.
- **Authentication:** Required
- **Request Body:**
  ```json
  {
    "title": "Lease Contract Review",
    "session_type": "doc_chat",
    "document_id": "8fa85f64-5717-4562-b3fc-2c963f66afa8"
  }
  ```
- **Response `201 Created`:** Created session object.

#### `GET /api/sessions/:id`
- **Description:** Retrieves metadata for a specific session owned by the authenticated user.
- **Authentication:** Required
- **Response `200 OK`:** Single session object.
- **Response `404 Not Found`:** If session does not exist or does not belong to the user.

#### `GET /api/sessions/:id/messages`
- **Description:** Retrieves all messages recorded in a chat session in chronological order.
- **Authentication:** Required
- **Response `200 OK`:** Array of message objects:
  ```json
  [
    {
      "id": "e2a85f64-5717-4562-b3fc-2c963f66afa9",
      "session_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "role": "user",
      "content": "Can I cancel my contract if the builder delayed?",
      "citations": null,
      "legal_analytics": null,
      "created_at": "2026-10-14T10:01:00.000Z"
    },
    {
      "id": "f3a85f64-5717-4562-b3fc-2c963f66afb0",
      "session_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "role": "assistant",
      "content": "### Direct Answer & Legal Conclusion\n...",
      "citations": [ ... ],
      "legal_analytics": {
        "nli_score": 92.5,
        "nli_status": "Grounded",
        "top_article_score": 98.5
      },
      "created_at": "2026-10-14T10:01:15.000Z"
    }
  ]
  ```

#### `POST /api/sessions/:id/messages`
- **Description:** Appends a message to a session. Used by the client to record user prompts and store completed responses.
- **Authentication:** Required
- **Request Body:**
  ```json
  {
    "role": "user",
    "content": "What about Article 1191?",
    "citations": [],
    "legal_analytics": null
  }
  ```
- **Response `201 Created`:** Created message object.

#### `PATCH /api/sessions/:id`
- **Description:** Updates session title.
- **Authentication:** Required
- **Request Body:** `{ "title": "Updated Session Title" }`
- **Response `200 OK`:** Updated session object.

#### `DELETE /api/sessions/:id`
- **Description:** Deletes a session and cascades deletion to all associated chat messages.
- **Authentication:** Required
- **Response `200 OK`:** `{ "message": "Session deleted successfully" }`

---

### 1.4 User Documents (`/api/documents`)

#### `GET /api/documents`
- **Description:** Retrieves all documents uploaded by the authenticated user.
- **Authentication:** Required
- **Response `200 OK`:** Array of document objects with public preview URLs:
  ```json
  [
    {
      "id": "4623e2d6-0981-49e5-b093-8a00b79d395e",
      "user_id": "7ca85f64-5717-4562-b3fc-2c963f66afa7",
      "filename": "Lease_Contract_2026.pdf",
      "file_url": "/api/documents/4623e2d6-0981-49e5-b093-8a00b79d395e/file",
      "status": "completed",
      "progress": 100,
      "error_message": null,
      "created_at": "2026-10-14T09:30:00.000Z"
    }
  ]
  ```

#### `POST /api/documents/upload`
- **Description:** Uploads a document to Supabase Storage, registers record in `user_documents`, and triggers asynchronous extraction on Python RAG microservice.
- **Authentication:** Required
- **Content-Type:** `multipart/form-data`
- **Field:** `file` (Binary file; Max size: 50MB)
- **Allowed MIME Types:** `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `text/plain`, `image/png`, `image/jpeg`
- **Response `201 Created`:**
  ```json
  {
    "id": "4623e2d6-0981-49e5-b093-8a00b79d395e",
    "file_url": "/api/documents/4623e2d6-0981-49e5-b093-8a00b79d395e/file",
    "status": "uploading"
  }
  ```

#### `DELETE /api/documents/:id`
- **Description:** Deletes the document binary from Supabase Storage, removes its record from `user_documents`, and cascades deletion of embedded vector chunks in `document_chunks`.
- **Authentication:** Required
- **Response `200 OK`:** `{ "message": "Document deleted successfully" }`

#### `GET /api/documents/:id/file` and `GET /api/documents/:id/preview`
- **Description:** Streams the document file binary directly from local storage for browser preview or download. Bypasses tunnel anti-phishing interstitial warnings.
- **Authentication:** Optional (Supports Bearer token or `?token=` parameter for authorization validation)
- **Query Parameters:** `?download=1` (Sets `Content-Disposition: attachment` instead of `inline`)
- **Response `200 OK`:** Raw file bytes with resolved `Content-Type` and `Content-Disposition`.

---

### 1.5 Philippine Civil Code & Jurisprudence (`/api/civil-code`)

#### `GET /api/civil-code/stats`
- **Description:** Returns aggregate corpus statistics for articles, cases, and citation relations.
- **Authentication:** None
- **Response `200 OK`:**
  ```json
  {
    "total_cases": 11879,
    "total_articles": 2270,
    "civil_code_articles": 2270,
    "family_code_articles": 257,
    "total_relations": 11639
  }
  ```

#### `GET /api/civil-code/search`
- **Description:** Multi-strategy fast search across statutory numbers, text phrases, TOC topics, and jurisprudence cases.
- **Authentication:** None
- **Query Parameters:**
  - `q` (*string, required*): Search query or article number (e.g., `1191`, `rescission of contract`, `GR 189871`).
  - `limit` (*integer, default: 15, max: 50*): Result limit.
- **Response `200 OK`:**
  ```json
  {
    "query": "1191",
    "exact_article": {
      "article_id": "RA386-ART1191",
      "article_number": 1191,
      "title": "Article 1191",
      "hierarchy": {
        "book_name": "BOOK IV - OBLIGATIONS AND CONTRACTS",
        "title_name": "TITLE I - OBLIGATIONS",
        "chapter_name": "CHAPTER 3 - DIFFERENT KINDS OF OBLIGATIONS"
      },
      "content": "The power to rescind obligations is implied in reciprocal ones...",
      "snippet": "The power to rescind obligations is implied in reciprocal ones...",
      "match_type": "exact_number"
    },
    "articles": [ ... ],
    "toc_sections": [ ... ],
    "cases": [ ... ],
    "total_matches": 6
  }
  ```

#### `GET /api/civil-code/toc`
- **Description:** Generates the complete hierarchical tree of the Philippine Civil Code (Books > Titles > Chapters > Articles) and the Family Code of the Philippines (EO 209).
- **Authentication:** None
- **Response `200 OK`:**
  ```json
  {
    "toc": [
      {
        "id": "book-1",
        "title": "PRELIMINARY TITLE",
        "children": [
          {
            "id": "book-1-title-1",
            "title": "CHAPTER 1 - EFFECT AND APPLICATION OF LAWS",
            "children": [
              { "id": "RA386-ART1", "title": "Article 1" },
              { "id": "RA386-ART2", "title": "Article 2" }
            ]
          }
        ]
      }
    ]
  }
  ```

#### `GET /api/civil-code/article/:id`
- **Description:** Retrieves full article text, hierarchy path, and up to 5 top linked Supreme Court jurisprudence cases from `article_jurisprudence_relations`.
- **Authentication:** None
- **Path Parameter:** `id` (e.g., `RA386-ART1191` or `EO209-ART1`)
- **Response `200 OK`:**
  ```json
  {
    "article_id": "RA386-ART1191",
    "article_number": 1191,
    "hierarchy": { ... },
    "content": "The power to rescind obligations is implied in reciprocal ones...",
    "related_cases": [
      {
        "case_uid": "GR_189871_2012",
        "title": "Camp John Hay Development Corporation v. Charter Chemical",
        "gr_number": "G.R. No. 189871",
        "decision_date": "March 3, 2012",
        "content_summary": "Action for rescission under Article 1191...",
        "source_url": "https://lawphil.net/...",
        "full_text": "..."
      }
    ]
  }
  ```

#### `GET /api/civil-code/case/:uid`
- **Description:** Retrieves complete jurisprudence record including unabridged `full_text` for instant popup rendering.
- **Authentication:** None
- **Path Parameter:** `uid` (e.g., `GR_189871_2012`)
- **Response `200 OK`:** Case object.

---

### 1.6 User Profiles & Avatars (`/api/profiles`)

#### `GET /api/profiles/me`
- **Description:** Retrieves the authenticated user's profile settings. Auto-initializes profile record if first access.
- **Authentication:** Required
- **Response `200 OK`:** Profile object.

#### `PATCH /api/profiles/me`
- **Description:** Updates profile fields and user preferences.
- **Authentication:** Required
- **Request Body:**
  ```json
  {
    "full_name": "Maria Santos",
    "avatar_url": "https://...",
    "notification_preferences": { "email": true, "push": false },
    "theme_preferences": "system"
  }
  ```
- **Response `200 OK`:** Updated profile object.

#### `POST /api/profiles/me/avatar`
- **Description:** Uploads a user avatar image (max 5MB) using administrative service-role directly to the `avatars` bucket and invalidates the in-memory avatar cache.
- **Authentication:** Required
- **Content-Type:** `multipart/form-data`
- **Field:** `avatar` (Image file: JPEG, PNG, WEBP, GIF)
- **Response `200 OK`:** `{ "success": true, "avatar_url": "...", "profile": { ... } }`

#### `GET /api/profiles/avatar/:userId`
- **Description:** Public high-speed binary image streaming endpoint for user avatars. Utilizes an in-memory memory cache with HTTP ETags and 24-hour cache headers.
- **Authentication:** None
- **Response `200 OK` / `304 Not Modified`:** Image binary bytes.

#### `DELETE /api/profiles/me`
- **Description:** Permanently deletes user account, associated storage files in `avatars` and `documents`, chat history, profile record, and Supabase Auth entry.
- **Authentication:** Required
- **Response `200 OK`:** `{ "success": true, "message": "Account successfully deleted." }`

---

### 1.7 System Telemetry & Presence (`/api/system`)

#### `GET /api/system/theme`
- **Description:** Detects host operating system appearance theme (GNOME `gsettings`, FreeDesktop DBus portal, KDE, macOS AppleInterfaceStyle, or Windows Registry).
- **Authentication:** None
- **Response `200 OK`:** `{ "systemTheme": "dark" | "light" }`

#### `GET /api/system/queue`
- **Description:** Proxies query queue metrics from Python RAG microservice.
- **Authentication:** None
- **Response `200 OK`:** Queue telemetry object.

#### `GET /api/system/online-users`
- **Description:** Returns aggregate list and count of currently active and online users based on in-memory heartbeats (within 90 seconds) and Supabase active auth sessions (within 30 minutes).
- **Authentication:** None
- **Response `200 OK`:**
  ```json
  {
    "onlineCount": 3,
    "users": [
      {
        "userId": "uuid",
        "email": "user@example.com",
        "fullName": "User Name",
        "ip": "127.0.0.1",
        "client": "Chrome (Linux)",
        "lastSeenSec": 12,
        "status": "Active",
        "isLiveHeartbeat": true
      }
    ],
    "timestamp": "2026-10-14T10:00:00.000Z"
  }
  ```

#### `POST /api/system/heartbeat`
- **Description:** Records an active user presence heartbeat.
- **Authentication:** Optional (detects user token if present)
- **Request Body:** `{ "status": "Reading Document" }`
- **Response `200 OK`:** `{ "status": "ok", "onlineCount": 3 }`

#### `POST /api/system/offline`
- **Description:** Marks user explicitly offline upon signout.
- **Authentication:** Optional
- **Response `200 OK`:** `{ "status": "ok" }`

#### `GET /api/system/status`
- **Description:** Comprehensive host server health check: CPU cores, load averages, memory usage, concurrency settings, queue status, and active users.
- **Authentication:** None
- **Response `200 OK`:** Host status object.

---

### 1.8 Gateway Reverse Proxies

#### `POST /api/chat`
- **Forwarded To:** `http://localhost:8000/search`
- **Authentication:** Required (`requireAuth`)
- **Headers Injected by Gateway:**
  - `x-user-id`: User UUID
  - `x-user-email`: User email address
  - `x-user-name`: URL-encoded full name
- **Streaming Configuration:**
  - Proxy response buffering disabled (`X-Accel-Buffering: no`).
  - Proxy and socket timeouts disabled (`timeout: 0, proxyTimeout: 0`) to accommodate long-running legal reasoning streams.
- **Response:** Continuous Server-Sent Events (SSE) stream (`text/event-stream`).

#### `POST /api/chat/cancel`
- **Forwarded To:** `http://localhost:8000/cancel`
- **Authentication:** Required (`requireAuth`)
- **Request Body:** `{ "session_id": "uuid" }`
- **Response `200 OK`:** `{ "status": "cancelled", "session_id": "uuid" }`

#### `ALL /api/storage/*` and `ALL /storage/*`
- **Forwarded To:** `http://localhost:54321/storage/*`
- **Authentication:** None (Public assets)
- **Headers Injected:** `X-Tunnel-Skip-AntiPhishing-Page: true`

---

## 2. Python RAG Microservice Endpoints (Port 8000)

### 2.1 Health & Queue Status

#### `GET /health`
- **Response `200 OK`:** `{ "status": "ok", "service": "service-rag-python" }`

#### `GET /system/queue-status` and `GET /system/status`
- **Description:** Returns live GPU concurrency metrics, queue depth, active slot execution duration, and LM Studio model connectivity.
- **Response `200 OK`:**
  ```json
  {
    "max_concurrent": 1,
    "max_queue_size": 50,
    "queue_timeout_sec": 180.0,
    "active_queries": 1,
    "queued_queries": 0,
    "total_served": 48,
    "total_queued": 12,
    "total_timeouts": 0,
    "total_rejections": 0,
    "avg_latency_sec": 14.2,
    "active_slots": [
      {
        "ticket": 49,
        "user_id": "uuid",
        "user_name": "Maria Santos",
        "session_id": "uuid",
        "running_time_sec": 4.5
      }
    ],
    "waiters": [],
    "lm_studio": {
      "configured": true,
      "online": true,
      "latency_ms": 18.4,
      "models": ["gemma-4-e4b-finetuned"],
      "vram_profile": "6.0 GB VRAM Strict Concurrency Enforced"
    }
  }
  ```

---

### 2.2 Asynchronous Document Ingestion

#### `POST /extract`
- **Description:** Queues background text extraction, OCR fallback, text chunking, and E5 vector embedding for uploaded documents.
- **Request Body:**
  ```json
  {
    "file_url": "http://localhost:54321/storage/v1/object/public/documents/...",
    "document_id": "4623e2d6-0981-49e5-b093-8a00b79d395e",
    "filename": "Lease_Agreement.pdf"
  }
  ```
- **Response `200 OK`:** `{ "status": "processing" }`

---

### 2.3 Task Cancellation

#### `POST /cancel`
- **Description:** Explicitly cancels an active background generation task for a session, terminating LLM generation and freeing the concurrency queue slot immediately.
- **Request Body:** `{ "session_id": "uuid" }`
- **Response `200 OK`:** `{ "status": "cancelled", "session_id": "uuid" }`

---

### 2.4 Legal RAG Search & Streaming Engine

#### `POST /search`
- **Description:** The primary RAG inference pipeline endpoint. Executes end-to-end legal retrieval, prompt synthesis, LLM token streaming, and post-generation NLI verification over a single continuous Server-Sent Events (SSE) connection.
- **Request Body (`SearchRequest`):**
  ```json
  {
    "query": "Can I cancel a contract of lease if the landlord refuses to repair the roof?",
    "original_query": null,
    "session_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "history": [],
    "document_id": null,
    "document_name": null,
    "prior_citations": [],
    "clarification_context": null
  }
  ```

#### Server-Sent Events (SSE) Protocol Specification
The endpoint streams events formatted as `data: <JSON>\n\n`:

| Event Type | Payload Fields | Description |
|---|---|---|
| `ping` | `{ "type": "ping" }` | Keepalive heartbeat emitted every 12 seconds to prevent proxy disconnects. |
| `status` | `{ "type": "status", "stage": string, "message": string, ... }` | Granular pipeline progress notification. Stages: `queued`, `embedding`, `retrieving`, `retrieving_done`, `prompting`, `thinking`, `streaming`, `evaluating_nli`, `completed`, `error`. |
| `clarification_needed` | `{ "type": "clarification_needed", "data": ClarificationData }` | Emitted when ambiguity detection identifies critical missing legal facts. Includes interactive questions and options. |
| `text` | `{ "type": "text", "text": string }` | Incremental markdown tokens of the generated response. |
| `citations` | `{ "type": "citations", "data": Citation[] }` | Verified citation objects cited in this turn with suitability scores. |
| `accumulated_citations` | `{ "type": "accumulated_citations", "data": Citation[] }` | Deduplicated citations retained across the ongoing session. |
| `legal_analytics` | `{ "type": "legal_analytics", "data": LegalAnalytics }` | Neuro-Symbolic NLI faithfulness scores, contradiction counts, and domain audit results. |
| `follow_ups` | `{ "type": "follow_ups", "data": string[] }` | Exactly 3 unilingual, actionable next-step follow-up questions. |
| `error` | `{ "type": "error", "message": string }` | Stream error description. |
| `done` | `{ "type": "done" }` | Terminal event indicating end of response stream. |
