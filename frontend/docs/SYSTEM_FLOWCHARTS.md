# CIVIL-LEX: Complete System Flowcharts & Architecture Maps

This document provides architectural flowcharts and sequence diagrams mapping the end-to-end operations of the CIVIL-LEX platform across the Next.js frontend, Node.js API Gateway, Python RAG Microservice, Supabase PostgreSQL with `pgvector`, and the local LM Studio LLM inference host.

---

## 1. End-to-End System Architecture Topology

The overall system architecture spans client interfaces, gateway security, analytical microservices, storage layers, and hardware-accelerated local inference:

```mermaid
flowchart TD
    subgraph ClientLayer ["Client Presentation Layer (Next.js 16 + React 19)"]
        Browser(["User Web Browser"])
        ChatUI["Legal Assistant Chat Interface<br/>app/chat/page.tsx"]
        DocUI["Document Analysis Workspace<br/>app/research/page.tsx"]
        TOCUI["Table of Contents Explorer<br/>app/civil-code/page.tsx"]
        SettingsUI["User Settings & Profile<br/>app/settings/page.tsx"]
        
        Browser --> ChatUI
        Browser --> DocUI
        Browser --> TOCUI
        Browser --> SettingsUI
    end

    subgraph NetworkEdge ["Network & Ingress Edge"]
        PublicNet["Public Internet / HTTPS"]
        Tunnel["Cloudflare Tunnel / Dev Tunnel<br/>Bypasses NAT and Ingress Filters"]
        ClientLayer --> PublicNet --> Tunnel
    end

    subgraph GatewayLayer ["Node.js API Gateway :4000 (backend-node/)"]
        ExpressApp["Express 5 Application (index.js)"]
        AuthMiddleware["requireAuth Middleware<br/>Supabase JWT Verification"]
        ProxyRouter["Streaming Reverse Proxy<br/>http-proxy-middleware"]
        InternalServices["Internal Route Handlers<br/>Civil Code, Documents, Sessions, Profiles, System"]
        PresenceSvc["PresenceService<br/>In-Memory Heartbeats & Online Users"]
        AvatarCache["Avatar In-Memory Cache<br/>15-minute TTL, ETags"]
        
        Tunnel --> ExpressApp
        ExpressApp --> AuthMiddleware
        AuthMiddleware --> ProxyRouter
        AuthMiddleware --> InternalServices
        InternalServices --> PresenceSvc
        InternalServices --> AvatarCache
    end

    subgraph PythonLayer ["Python RAG Microservice :8000 (service-rag-python/)"]
        FastAPIApp["FastAPI Engine (main.py)"]
        QueueMgr["QueryQueueManager<br/>Strict 1-Query FIFO Concurrency Limiter"]
        DomainRouter["DomainRouter<br/>Centroid Semantic Gating"]
        AmbiguityDetector["Ambiguity Detection Engine<br/>Missing Legal Facts Analyzer"]
        DocPipeline["Document Ingestion Pipeline<br/>PyMuPDF + Tesseract OCR + Chunker"]
        RAGEngine["Hybrid Retrieval & RRF Fusion Engine"]
        PromptEngine["Inverted Pyramid Prompt Synthesizer"]
        NLIEngine["Neuro-Symbolic Hybrid NLI Engine<br/>Symbolic Veto + Gemma Arbitration"]
        FollowupEngine["Follow-up Suggestion Generator"]
        
        ProxyRouter -->|"POST /search"| FastAPIApp
        ProxyRouter -->|"POST /cancel"| FastAPIApp
        InternalServices -->|"POST /extract"| DocPipeline
        
        FastAPIApp --> QueueMgr --> DomainRouter --> AmbiguityDetector
        AmbiguityDetector --> RAGEngine --> PromptEngine --> NLIEngine --> FollowupEngine
    end

    subgraph DatabaseLayer ["Data & Storage Layer :54322 (Supabase Local Docker)"]
        Postgres[("PostgreSQL 15+ Primary DB")]
        VecTable["document_chunks<br/>pgvector HNSW Cosine Index"]
        FTSTable["document_chunks.fts<br/>PostgreSQL tsvector GIN Index"]
        StatuteTable["civil_code_articles<br/>2,270 Civil + 257 Family Articles"]
        CaseTable["jurisprudence_cases<br/>351,000+ Precedents"]
        GraphTable["article_jurisprudence_relations<br/>Junction Graph Edges"]
        DocTable["user_documents<br/>Extraction & Upload Metadata"]
        SessionTable["chat_sessions & chat_messages<br/>Conversational History"]
        ProfileTable["profiles<br/>User Preferences & Settings"]
        StorageBucket["Supabase Object Storage<br/>'documents' & 'avatars' Buckets"]
        
        InternalServices --- Postgres
        InternalServices --- StorageBucket
        RAGEngine --- VecTable
        RAGEngine --- FTSTable
        RAGEngine --- StatuteTable
        RAGEngine --- CaseTable
        RAGEngine --- GraphTable
        DocPipeline --- DocTable
        DocPipeline --- VecTable
        DocPipeline --- StorageBucket
        Postgres --- VecTable
        Postgres --- StatuteTable
        Postgres --- CaseTable
    end

    subgraph InferenceLayer ["Local Inference Layer :1234 (Dedicated Laptop Host)"]
        ZeroTierNet["ZeroTier Encrypted SD-WAN<br/>IP: 10.57.24.131"]
        LMStudio["LM Studio Server (:1234)<br/>OpenAI-Compatible Streaming API"]
        GemmaModel["Fine-Tuned Google Gemma 4 E4B<br/>LoRA r=32, alpha=64, BF16 GGUF"]
        
        FastAPIApp -->|"HTTP Streaming /v1/chat/completions"| ZeroTierNet
        ZeroTierNet --> LMStudio
        LMStudio --- GemmaModel
    end
```

---

## 2. Physical Network Deployment & Port Mapping Flowchart

```mermaid
flowchart LR
    subgraph CloudVercel ["Vercel Cloud Deployment"]
        NextFrontend["Next.js App Router<br/>Port 3000 / HTTPS"]
    end

    subgraph EdgeTunnel ["Encrypted Public Ingress"]
        TunnelConn["Cloudflare Tunnel / Dev Tunnel<br/>https://api.yourdomain.com"]
    end

    subgraph LinuxHost ["Ubuntu Linux Host Machine"]
        direction TB
        NodePort["Node.js API Gateway<br/>Port 4000"]
        PythonPort["FastAPI RAG Service<br/>Port 8000"]
        SupabaseDBPort["Supabase PostgreSQL + pgvector<br/>Port 54322"]
        SupabaseAPIPort["Supabase Studio / Storage API<br/>Port 54321"]
        
        NodePort -->|"Internal Loopback"| PythonPort
        NodePort -->|"TCP Connection"| SupabaseDBPort
        NodePort -->|"HTTP Storage API"| SupabaseAPIPort
        PythonPort -->|"TCP Connection"| SupabaseDBPort
    end

    subgraph ZeroTierWAN ["ZeroTier Virtual Private Network (10.57.24.0/24)"]
        SDWAN["Encrypted Virtual Layer-2 Mesh"]
    end

    subgraph LLMHost ["Dedicated LLM Inference Laptop"]
        LMStudioPort["LM Studio Server<br/>Port 1234 (10.57.24.131:1234)"]
        GPUDevice["NVIDIA GPU<br/>Local CUDA / VRAM"]
        LMStudioPort --- GPUDevice
    end

    NextFrontend -->|"Public HTTPS Requests"| TunnelConn
    TunnelConn -->|"Exposed Local Port"| NodePort
    PythonPort -->|"ZeroTier Private IP"| SDWAN
    SDWAN -->|"Port 1234"| LMStudioPort
```

---

## 3. End-to-End Chat Query & SSE Streaming Sequence Flowchart

```mermaid
sequenceDiagram
    autonumber
    participant UI as Next.js ChatContext
    participant Node as Node.js Gateway (:4000)
    participant Python as Python RAG Service (:8000)
    participant Queue as QueryQueueManager
    participant DB as PostgreSQL 15+ (:54322)
    participant LLM as LM Studio (:1234)

    UI->>Node: POST /api/chat {query, session_id, history, document_id}
    Note over Node: requireAuth verifies Supabase JWT Bearer token
    Node->>Python: Proxy POST /search (Keep-Alive, X-Accel-Buffering: no)
    
    Python->>Queue: enter_queue(user_id, session_id)
    alt GPU Slot Busy (Active == 1)
        Queue-->>Python: Waiter registered at position #N
        Python-->>UI: SSE status: queued (queue_position=N)
        Queue->>Queue: Await turn signal
    end
    Queue-->>Python: Slot granted
    Python-->>UI: SSE status: embedding

    Python->>DB: Load canonical session history & recent citations
    DB-->>Python: Stored turns & citations

    alt Query is History Recall ('what was my first question?')
        Python->>Python: Extract prior turns from transcript
        Python-->>UI: SSE text (deterministic recall answer)
        Python-->>UI: SSE done
    else Query is Summary Request ('in short?', 'buod?')
        Python->>Python: Extract conclusion from last assistant turn
        Python-->>UI: SSE text (deterministic summary)
        Python-->>UI: SSE done
    else Standard Legal Inquiry
        Python->>Python: Semantic Domain Router check
        alt Query is Non-Legal (Coding, Cooking, Math)
            Python-->>UI: SSE text (Civil Code scope refusal)
            Python-->>UI: SSE done
        else Query is Other Legal (Tax, Crime, Labor)
            Python-->>UI: SSE text (Statutory redirection to BIR/DOLE/PNP)
            Python-->>UI: SSE done
        else In-Domain Civil Query
            Python->>Python: Ambiguity check (services/ambiguity.py)
            alt Critical Legal Facts Missing
                Python-->>UI: SSE clarification_needed {questions, options}
                Python-->>UI: SSE done
            else Sufficient Facts
                Python->>Python: Query expansion & E5 dense embedding
                Python-->>UI: SSE status: retrieving
                Python->>DB: Hybrid Search (Exact Match + HNSW Cosine + FTS GIN)
                DB-->>Python: Ranked candidate statutory provisions
                Python->>DB: Statutory companion graph & linked case retrieval
                DB-->>Python: Companion provisions & Supreme Court doctrines
                Python->>Python: Reciprocal Rank Fusion (RRF) & noise pruning
                Python-->>UI: SSE status: retrieving_done {count}
                Python-->>UI: SSE status: prompting
                Python->>Python: Inverted pyramid prompt assembly with statutory primacy
                Python-->>UI: SSE status: thinking
                Python->>LLM: POST /v1/chat/completions (stream=True, temp=0.3)
                loop Token Streaming
                    LLM-->>Python: Token chunks
                    Python-->>UI: SSE text {delta}
                end
                LLM-->>Python: Stream finished
                Python-->>UI: SSE citations & accumulated_citations
                Python-->>UI: SSE status: evaluating_nli
                Python->>Python: Execute Neuro-Symbolic NLI verification
                Python-->>UI: SSE legal_analytics {nli_score, status, top_score}
                Python->>Python: Generate 3 unilingual follow-up suggestions
                Python-->>UI: SSE follow_ups {data}
                Python-->>UI: SSE done
                Python->>DB: Persist assistant message, citations & analytics
                Python->>Queue: release_slot(ticket)
            end
        end
    end
```

---

## 4. Document Ingestion, OCR & Vectorization Flowchart

This flowchart details how contracts, deeds, and scanned documents are ingested, OCR'd, and embedded:

```mermaid
flowchart TD
    Start(["User uploads file in Web UI"]) --> ValidateMIME{"Check File MIME Type<br/>PDF, DOCX, TXT, PNG, JPG"}
    ValidateMIME -->|"Unsupported"| RejectUpload["Return 400 Bad Request"]
    
    ValidateMIME -->|"Supported"| UploadStorage["Node.js Gateway uploads to Supabase Storage<br/>'documents' Bucket"]
    UploadStorage --> InsertDB["Node.js Gateway inserts record into user_documents<br/>status = uploading, progress = 0"]
    InsertDB --> PingPython["Node.js Gateway pings Python RAG Microservice<br/>POST /extract with file_url and document_id"]
    PingPython --> ReturnClient["Return 201 Created to Client UI<br/>status = uploading"]
    
    subgraph PythonBackgroundExtraction ["Python Background Extraction Worker (services/document.py)"]
        UpdateExtracting["Update user_documents SET status = extracting"]
        DownloadBytes["Download file bytes from storage URL"]
        DetectExt{"Determine File Extension"}
        
        UpdateExtracting --> DownloadBytes --> DetectExt
        
        DetectExt -->|"PDF"| PyMuPDFParse["Extract text stream using PyMuPDF / fitz"]
        PyMuPDFParse --> CheckPDFLength{"Extracted text under 100 characters?"}
        CheckPDFLength -->|"No - Digital PDF"| CleanText["Normalize whitespace"]
        CheckPDFLength -->|"Yes - Scanned PDF"| PDFOCR["Render pages to 150 DPI images<br/>Run Tesseract OCR per page max 15 pages"] --> CleanText
        
        DetectExt -->|"Image - PNG or JPG"| DownsampleImg["Downsample image to max 2200px<br/>Convert alpha channels to RGB"]
        DownsampleImg --> ImgOCR["Execute Tesseract OCR with 25s timeout"] --> CleanText
        
        DetectExt -->|"DOCX"| DocxParse["Parse paragraphs & tables via python-docx"] --> CleanText
        DetectExt -->|"TXT"| TxtParse["Decode UTF-8 text with ignore errors"] --> CleanText
        
        CleanText --> CheckAlnum{"Total alphanumeric characters at least 15?"}
        CheckAlnum -->|"No - Blank or Illegible"| RejectUnrelated["Update user_documents SET status = rejected_unrelated<br/>Provide descriptive user message"]
        
        CheckAlnum -->|"Yes - Valid Legal Text"| ChunkText["Slice text using sliding window<br/>350 words per chunk, 50-word overlap"]
        ChunkText --> EmbedLoop["Iterate through chunks"]
        
        subgraph VectorBatchLoop ["Vector Generation & Database Insertion"]
            PrefixE5["Prepend E5 instruction prefix: 'passage: '"]
            EncodeVector["Generate 768-dim dense embedding via SentenceTransformer"]
            InsertChunk["INSERT INTO document_chunks<br/>parent_type=user_document, parent_id=doc_id, content, embedding"]
            UpdateProgress["UPDATE user_documents SET progress = calculated_percent"]
            
            PrefixE5 --> EncodeVector --> InsertChunk --> UpdateProgress
        end
        
        EmbedLoop --> VectorBatchLoop
        VectorBatchLoop --> FinalizeDoc["UPDATE user_documents SET status = completed, progress = 100"]
    end
    
    PingPython -.->|"Triggers Async Task"| UpdateExtracting
```

---

## 5. Table of Contents & Jurisprudence Modal Flowchart

This flowchart illustrates Table of Contents navigation and the two-tier caching mechanism for Supreme Court jurisprudence case popups:

```mermaid
flowchart TD
    subgraph ClientNavigation ["Next.js Client (Civil Code Explorer)"]
        OpenTOC["User navigates to /civil-code"]
        FetchTOC["GET /api/civil-code/toc"]
        RenderTree["Render hierarchical tree<br/>Books to Titles to Chapters to Articles"]
        SelectArticle["User clicks Article node e.g. Art. 1191"]
        FetchArticle["GET /api/civil-code/article/RA386-ART1191"]
        RenderArticle["Render Article text, hierarchy breadcrumb & related cases"]
        ClickCase["User clicks related case card e.g. G.R. No. 189871"]
    end

    subgraph GatewayTOC ["Node.js API Gateway (:4000)"]
        HandleTOC["civil-code.js: GET /toc"]
        QueryTOCArticles["Query civil_code_articles ordered by article_number"]
        BuildHierarchyTree["Build nested JSON tree in memory"]
        HandleArticle["civil-code.js: GET /article/:id"]
        QueryArticleRow["Query civil_code_articles by article_id"]
        QueryRelations["Query article_jurisprudence_relations for case_uids"]
        QueryCases["Query jurisprudence_cases for case metadata and summary"]
        HandleCase["civil-code.js: GET /case/:uid"]
        QueryFullCase["Query jurisprudence_cases by case_uid including full_text"]
    end

    subgraph CaseModalCache ["Modal Caching Lifecycle"]
        CheckCache{"Case already cached in React state?"}
        UseCached["Open popup dialog instantly with cached case full text"]
        FetchCaseAPI["Call GET /api/civil-code/case/:uid"]
        SaveCache["Save case record to local modal cache state"]
        OpenModal["Open dialog displaying official title, docket number, date, summary & full text"]
    end

    OpenTOC --> FetchTOC --> HandleTOC --> QueryTOCArticles --> BuildHierarchyTree --> RenderTree
    RenderTree --> SelectArticle --> FetchArticle --> HandleArticle --> QueryArticleRow --> QueryRelations --> QueryCases --> RenderArticle
    RenderArticle --> ClickCase --> CheckCache
    CheckCache -->|"Yes"| UseCached
    CheckCache -->|"No"| FetchCaseAPI --> HandleCase --> QueryFullCase --> SaveCache --> OpenModal
```

---

## 6. Authentication, Profile & Avatar In-Memory Cache Flowchart

This flowchart outlines Bearer authentication, user metadata synchronization, and high-speed in-memory avatar delivery:

```mermaid
flowchart TD
    subgraph AuthPipeline ["Client Authentication & State"]
        UserLogin["User submits credentials on /login"]
        SupabaseAuth["Supabase Auth issues JWT access & refresh tokens"]
        StoreSession["Next.js client stores session in localStorage / cookies"]
        SendReq["Client attaches header: Authorization Bearer JWT"]
    end

    subgraph GatewayAuth ["Node.js Gateway Authentication (requireAuth)"]
        ExtractToken["Extract Bearer token string"]
        VerifyToken["Verify token with Supabase defaultClient.auth.getUser"]
        CheckUser{"Token valid & user active?"}
        RejectAuth["Return 401 Unauthorized"]
        CreateScoped["Create request-scoped Supabase client with user JWT"]
        TouchPresence["Call PresenceService.touch user, req"]
        AttachUser["Attach req.user and req.supabase"]
        ProceedRoute["Proceed to requested route handler"]
        
        ExtractToken --> VerifyToken --> CheckUser
        CheckUser -->|"No"| RejectAuth
        CheckUser -->|"Yes"| CreateScoped --> TouchPresence --> AttachUser --> ProceedRoute
    end

    subgraph AvatarDelivery ["High-Speed Avatar Delivery Flow (GET /api/profiles/avatar/:userId)"]
        ReqAvatar["Client requests avatar image: /api/profiles/avatar/:userId"]
        CheckMemCache{"Avatar present in avatarMemoryCache and not expired?"}
        CheckETag{"Request If-None-Match matches cached ETag?"}
        Return304["Return 304 Not Modified"]
        ReturnMemBytes["Return cached image buffer directly from memory under 5ms"]
        
        CheckMemCache -->|"Yes"| CheckETag
        CheckETag -->|"Yes"| Return304
        CheckETag -->|"No"| ReturnMemBytes
        
        CheckMemCache -->|"No"| DownloadStorage["Download avatar blob from Supabase Storage 'avatars' bucket"]
        DownloadStorage --> GenETag["Compute MD5 ETag & store buffer in avatarMemoryCache"]
        GenETag --> ReturnBytes["Return image bytes with 24h Cache-Control headers"]
    end

    SendReq --> ExtractToken
    ProceedRoute --> ReqAvatar
```

---

## 7. Real-Time Telemetry & Concurrency Queue Flowchart

This diagram maps how the `QueryQueueManager` and `PresenceService` coordinate to protect resources and report live metrics:

```mermaid
flowchart TD
    subgraph ClientHeartbeat ["Frontend Heartbeat & Status Polling"]
        Timer["Client interval timer: every 30s"]
        HeartbeatCall["POST /api/system/heartbeat"]
        QueuePoll["GET /api/system/queue"]
    end

    subgraph GatewayTelemetry ["Node.js System Routes (/api/system)"]
        HandleHeartbeat["system.js: POST /heartbeat"]
        TouchSvc["PresenceService.touch user, req, action='Active'"]
        GetOnline["PresenceService.getOnlineUsers"]
        FetchRAGQueue["Fetch Python service /system/queue-status"]
        DetectOSTheme["system.js: GET /theme to detectHostSystemTheme GNOME/KDE/macOS/Win"]
        HostStatus["system.js: GET /status to CPU, RAM, LoadAvg, Online Users"]
    end

    subgraph PythonQueue ["Python QueryQueueManager (core/queue_manager.py)"]
        QueueState["In-Memory Concurrency State"]
        ActiveSlots["Active Execution Slots<br/>(Max: 1)"]
        WaitersList["FIFO Waiters List<br/>(Max: 50)"]
        StatusReport["Queue Telemetry<br/>max_concurrent, active, queued, avg_latency, uptime"]
        
        QueueState --- ActiveSlots
        QueueState --- WaitersList
        QueueState --- StatusReport
    end

    HeartbeatCall --> HandleHeartbeat --> TouchSvc --> GetOnline
    QueuePoll --> FetchRAGQueue --> StatusReport
```
