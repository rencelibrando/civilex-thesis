# CIVIL-LEX Backend API Documentation

This document outlines the available backend endpoints across the Node.js API Gateway and the Python RAG (Retrieval-Augmented Generation) Service.

## Architecture Overview
- **Node.js Gateway (Port `4000`)**: Acts as the primary entry point for the Next.js frontend. It handles authentication checks (via `requireAuth` middleware) and proxies specific RAG-related and data endpoints to the Python backend.
- **Python RAG Service (Port `8000`)**: Built with FastAPI. Handles direct database queries (PostgreSQL), vector search, and AI extraction tasks.

---

## 1. Gateway Endpoints (Node.js - Port 4000)

These are the endpoints directly exposed by the Node.js server to the frontend.

### `GET /health`
- **Description**: Basic health check for the Node.js server.
- **Auth Required**: No
- **Response**:
  ```json
  {
    "status": "ok",
    "service": "backend-node-gateway"
  }
  ```

---

## 2. Proxied Endpoints (Frontend -> Node.js -> Python)

These endpoints are called via the Node.js Gateway (`http://localhost:4000`) but are forwarded to the Python Service (`http://localhost:8000`). The Node gateway automatically attaches the `x-user-id` header based on the authenticated user.

### `POST /api/chat` (Proxied to Python `/search`)
- **Description**: Handles conversational queries and vector search against the RAG system.
- **Auth Required**: Yes (`requireAuth` middleware)
- **Forwarded To**: `http://localhost:8000/search`

### `POST /api/documents` (Proxied to Python `/extract`)
- **Description**: Handles document uploading, text extraction, and processing.
- **Auth Required**: Yes (`requireAuth` middleware)
- **Forwarded To**: `http://localhost:8000/extract`

### `GET /api/civil-code/toc`
- **Description**: Fetches the complete hierarchical table of contents for the Philippine Civil Code (Books > Titles > Chapters > Articles).
- **Auth Required**: No
- **Forwarded To**: `http://localhost:8000/api/civil-code/toc`
- **Response Format**:
  ```json
  {
    "toc": [
      {
        "id": "book-1",
        "title": "PRELIMINARY TITLE",
        "children": [
          {
            "id": "book-1-title-1",
            "title": "Uncategorized Title",
            "children": [
               { "id": "RA386-ART1", "title": "Article 1" }
            ]
          }
        ]
      }
    ]
  }
  ```

### `GET /api/civil-code/article/{article_id}`
- **Description**: Retrieves the full text, hierarchy path, and related jurisprudence for a specific Civil Code article.
- **Auth Required**: No
- **Forwarded To**: `http://localhost:8000/api/civil-code/article/{article_id}`
- **Response Format**:
  ```json
  {
    "article_id": "RA386-ART37",
    "article_number": 37,
    "hierarchy": { ... },
    "content": "Juridical capacity...",
    "related_cases": [
      {
        "case_uid": "GR_12345",
        "title": "Case Title",
        "gr_number": "G.R. No. 12345",
        "decision_date": "1911",
        "content_summary": "Summary...",
        "source_url": "https://..."
      }
    ]
  }
  ```

---

## 3. Direct Python Service Endpoints (Port 8000)

If hitting the Python service directly (bypassing Node), these are the raw endpoints available.

### `GET /health`
- **Description**: Health check for the Python FastAPI server.
- **Response**:
  ```json
  {
    "status": "ok",
    "service": "service-rag-python"
  }
  ```

### `GET /api/civil-code/toc`
- **Description**: Raw Table of Contents endpoint. (Same as proxied route above).

### `GET /api/civil-code/article/{article_id}`
- **Description**: Raw Article retrieval endpoint. (Same as proxied route above).

*(Note: `/search` and `/extract` routes are intended to be implemented in the Python RAG service to support the `/api/chat` and `/api/documents` proxy routes from Node).*
