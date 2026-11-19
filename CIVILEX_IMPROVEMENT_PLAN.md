# CIVIL-LEX Improvement Plan, Phased Checklist, and Summary of Changes

> **Session Continuity Protocol (For Any AI Agent or Developer):**
> 1. Implement phases **one by one in order**, starting from **Phase 1**.
> 2. Before implementing a phase that contains a `[DECISION]` item, verify the chosen option in **Section 1: Architectural Recommendations & Decisions** with the user if not yet confirmed.
> 3. Follow `.agents/GEMINI.md` (Mandatory Verification Loop: `npm run type-check` in `frontend` and `backend-node` where applicable, `ruff check .` / `mypy .` in `service-rag-python`, plus endpoint/UI verification) and `.agents/rules/clean-code-hygiene.md` (zero emojis in code/comments, no decorative banners, KISS, reuse existing helpers).
> 4. **Mandatory Update Rule:** After completing each task or phase, immediately:
>    - Check off completed items (`- [ ]` -> `- [x]`) in **Section 2: Phased Implementation Checklist**.
>    - Append/update the corresponding entry in **Section 3: Summary of Changes & Solutions Log** below the checklist, documenting the root cause, files changed, how the problem was solved, and verification output.

---

## 1. Architectural Recommendations & Decisions (Tasks 3, 6, and 7)

### Decision A — Task 3: Data Visualization Scope, Extra Graphs & Charting Stack
- **Data Available Today:**
  - `chat_messages` (`role`, `content`, `citations` JSONB, `legal_analytics` JSONB, `created_at`) linked to `chat_sessions` (`user_id`, `session_type`, `document_id`).
  - `civil_code_articles` (`article_id`, `article_number`, `hierarchy` JSONB with `book_name`, `title_name`, `chapter_name`).
  - `document_chunks` (`parent_id`, `legal_topics` text[]).
  - `user_documents` (`status`, `user_id`, `created_at`).
- **Privacy Boundary:** Global ("All Users") charts will query PostgreSQL via `backend-node` (`supabaseAdmin` / `pg` pool) and return **strictly anonymized aggregate counts** (article number, topic/book name, counts/percentages). No other user's message text, document names, or user IDs are ever returned. "My Activity" charts filter strictly by `req.user.id`.
- **Required Visualizations:**
  1. **Most Queried Civil Code Articles (Horizontal Bar Chart):** Ranked top articles extracted from user queries (`Article N` / exact matches), toggleable between **All Users** and **My Queries**. Clicking a bar navigates to `/civil-code?article=...`.
  2. **Most Queried Legal Topics / Civil Code Books (Donut / Ranked Bar Chart):** Aggregated from matched article `hierarchy.book_name` / `title_name` and `document_chunks.legal_topics` (Obligations & Contracts, Property, Family Code E.O. 209, Succession, Torts/Quasi-Delicts, Persons), toggleable between **All Users** and **My Topics**.
  3. **Most Answered / Cited Articles (Grouped or Ranked Bar Chart):** Specific Civil Code articles most frequently cited in AI responses (`citations` JSONB where `parent_type = 'article'` and active/cited), comparing **All Users** vs **My Answers**.
- **Approved Additional Visualizations (Included in Phase 3):**
  1. **Query & Document Activity Timeline (Area / Line Chart):** Daily or weekly trend of Legal Consultations vs. Document Analyses over 7d / 30d / All.
  2. **NLI Statutory Grounding Score Distribution (Band Histogram):** Share of responses scoring Strict Entailment (>=85%), Substantially Consistent (70–84%), Generalized (<70%), and Out-of-Domain redirects — directly highlighting CIVIL-LEX's hallucination-mitigation thesis metric.
  3. **Language & Domain Intent Mix (Stacked Breakdown):** English vs. Tagalog usage split and In-Domain Civil Law vs. Non-Civil Legal Redirects (Criminal/Labor/Tax) vs. Non-Legal refusals.
  4. **Document Analysis Validation Funnel:** Uploaded documents accepted (Philippine Civil Law) vs. rejected (out-of-domain / unreadable) vs. Document Builder drafts.
- **Approved Charting Stack:** Install `recharts` (React 19 compatible) with theme-aware CSS variables (`--chart-1`..`--chart-5` in `frontend/app/globals.css`) and responsive containers.
- **Decision Status:** `[APPROVED — Implement All Core + 4 Additional Visualizations with Recharts]`

### Decision B — Task 6: Ensuring Every Citation Appears in the Model Answer
- **Root Cause Identified in `service-rag-python/main.py`:**
  1. `search_with_embedding` passes `context_budget=15` to `rank_and_stratify_citations` (lines 2413, 2826), sending up to 15 articles and cases into both `context_str` and the SSE `citations` event.
  2. Gemma 4 E4B (4B parameter local model) naturally grounds its concise citizen explanation on the 2–5 strongest provisions and ignores the remaining lower-ranked items.
  3. `reconcile_response_citations(full_text, results)` (line 1288) currently **adds** missing articles mentioned in `full_text`, but **never removes** unused articles that the model did not cite.
- **Evaluated Approaches:**
  - *Approach 1 — Force all 15 retrieved articles into the answer:* Not recommended. Prompting a 4B local model to include 10–15 articles degrades readability, causes tangential/forced citations, increases token latency, and lowers NLI faithfulness.
  - *Approach 2 — Lower post-rerank retrieval cap only (e.g. top 3–5):* Helps reduce noise, but the LLM may still intentionally omit 1 of the 4–5 items if redundant, leaving a mismatch in the Citation Panel.
  - *Approach 3 — Recommended Hybrid (Precision Rerank + Tighter Context Cap + Bidirectional Citation Reconciliation):*
    1. Tighten `context_budget` after reranking (e.g., **3–5 primary Civil Code articles** + **up to 2–3 jurisprudence cases** when relevant; keep 1–3 for simple/explicit single-article lookups), improving latency and prompt focus.
    2. Instruct the model clearly to cite `[Art. X]` / `Article X` (and case title / `G.R. No.`) for every provision it relies upon from `CONTEXT`.
    3. Upgrade `reconcile_response_citations(full_text, results)` (which already executes after `full_text` finishes and before emitting `citations` at line 4281) to:
       - Keep/add articles explicitly referenced in `full_text`.
       - Prune any retrieved articles or jurisprudence cases that were **not cited or referenced** in `full_text` (with a safety fallback keeping the top 1 exact/primary item only if an in-domain response omitted explicit article numbers).
       - Apply the same rule to `accumulated_citations` so the Citation Panel strictly mirrors authorities used in the conversation's actual answers.
    4. Verify `eval_comprehensive_metrics.py` / `eval_ragas.py` still work cleanly (expose raw retrieved IDs separately if eval scripts inspect pre-reconciliation retrieval).
- **Decision Status:** `[APPROVED — Approach 3: Hybrid Precision Rerank + Tighter Context Cap + Bidirectional Reconciliation]`

### Decision C — Task 7: Fast Google-Translate-Style Bidirectional Translation (English <-> Tagalog, Zero LLM)
- **Evaluated Approaches:**
  - *Option 1 — Approved: Google Translate HTTP Service + Markdown/Citation Shielding (`POST /translate` -> `/api/chat/translate`):*
    - Uses fast, zero-LLM HTTP translation (`deep-translator` `GoogleTranslator` or direct Google Translate REST endpoint, with optional official Google Cloud Translation v2 API key support via `GOOGLE_TRANSLATE_API_KEY`) in `service-rag-python/services/translator.py`.
    - **Zero GPU / Zero LLM Queue Impact:** Completely bypasses LM Studio and `queue_manager` (`MAX_CONCURRENT_QUERIES=1`), responding in ~150–350ms even while another RAG query is running.
    - **Markdown & Legal Citation Shielding:** Before translating, segment Markdown blocks (preserving `### `, `> `, `- `, `1. `, `---`, `**bold**`) and mask statutory citations/acronyms (`[Art. 1191]`, `Article 1156`, `G.R. No. ...`, `R.A. 386`, `E.O. 209`, `PAO`, `RTC`, `MTC`) with safe placeholder tokens, translate text segments in batch, then restore exact formatting and legal references.
    - **Instant Client Toggle & Cache:** Per-message translation cache in chat state (`translations: { en?: string; tl?: string }`) + optional server LRU cache so toggling `"Tagalog"` <-> `"English"` after the first click is instantaneous (`0ms`).
  - *Option 2 — Dedicated Offline CPU NMT (`Helsinki-NLP/opus-mt-en-tl` / `NLLB-200` / `argostranslate`):*
    - Pure offline CPU alternative, though adds ~1.2–2.4 GB RAM/disk and produces noticeably stiffer Tagalog than Google Translate; can optionally serve as a fallback if outbound HTTP is unavailable.
  - *Option 3 — LM Studio LLM Translation (Rejected by User):*
    - Too slow and competes with the single-GPU RAG inference queue.
- **Approved Implementation:** Option 1 (Fast Google-Translate-style HTTP translation with Markdown/citation placeholder protection + instant client toggle cache, zero LLM usage).
- **Decision Status:** `[APPROVED — Fast Non-LLM Google Translate Integration]`

---

## 2. Phased Implementation Checklist

### Phase 1: Integrate Document Analysis into Legal Chat + Upload-Time Civil Code Gate + Auto-Analysis & Follow-Ups
**Goal:** Unify Document Analysis inside `/chat`, reject non-Civil-Code documents immediately upon upload/extraction, trigger automatic initial analysis with zero user typing, and support full follow-up Q&A on the uploaded document.

- [x] **1.1 Move & Strengthen Document Domain Classification (`service-rag-python`):**
  - Extract `classify_document_domain`, `CIVIL_LAW_DOC_PATTERNS`, and `NON_CIVIL_LEGAL_DOC_DOMAINS` from `service-rag-python/main.py` into `service-rag-python/services/domain_router.py` (or a shared module) to eliminate circular imports.
  - Enhance `classify_document_domain` to combine regex scoring with `DomainRouter` semantic embedding similarity so informal Tagalog/English civil documents (e.g., handwritten promissory notes, informal lease/loan agreements) pass accurately while non-legal docs and non-Civil-Law docs (Criminal, Labor, Tax, Corporate, IP, Privacy) are accurately caught.
- [x] **1.2 Upload-Time Domain Rejection in Extraction Pipeline (`service-rag-python/services/document.py`):**
  - Inside `extract_and_process_document`, immediately after extracting `clean_text` and validating `alnum_chars >= 15`:
    - Run `classify_document_domain(clean_text, filename)`.
    - If `category != 'in_domain_civil'`:
      - Delete any partial chunks from `document_chunks` for `document_id`.
      - Update `user_documents` with `status = 'rejected_unrelated'`, storing a clear user-facing rejection reason in `error_message` (identifying whether it is non-legal content or a specialized non-civil statute like Labor/Tax/Criminal Law, plus what Civil Code documents are supported) and `extracted_text = NULL`.
      - Return early without embedding.
    - If `category == 'in_domain_civil'`: chunk, embed into `document_chunks`, and set `status = 'completed'`.
- [x] **1.3 Auto-Analysis Support in RAG Streaming (`service-rag-python/main.py` & `services/memory.py`):**
  - Add optional `auto_analyze: bool = False` to `SearchRequest` in `service-rag-python/main.py`.
  - When `auto_analyze=True` and `request.document_id` is set:
    - Do not persist a synthetic user prompt as a typed user message in `chat_messages` (or persist a clean system/attachment marker, keeping conversation history clean for follow-ups).
    - Run a dedicated comprehensive initial document analysis prompt summarizing document type, parties/obligations, Philippine Civil Code (RA 386 / EO 209) statutory alignment, potential risks/void clauses, and practical takeaways.
    - Generate contextual `follow_ups` after the auto-analysis completes so the user immediately sees relevant next questions.
  - Ensure all subsequent user turns in that session pass `document_id` so follow-up questions retrieve both `user_document` chunks and Civil Code / Jurisprudence authorities.
- [x] **1.4 Integrate Document Upload, Status Polling, Rejection UI & Preview into Legal Chat (`frontend/context/chat-context.tsx`, `frontend/app/(dashboard)/chat/page.tsx`):**
  - Add document state to `ChatContext` (`activeDocument`, `isUploadingDoc`, `docUploadError`, `attachDocument`, `clearDocument`, polling for `uploading` / `extracting` status).
  - Add an **Attach / Upload Document** button (and drag-and-drop dropzone overlay) in the Legal Chat composer (`frontend/app/(dashboard)/chat/page.tsx`). Supported formats: `.pdf`, `.doc`, `.docx`, `.txt`, `.png`, `.jpg`, `.jpeg`.
  - When an uploaded document finishes extraction:
    - If `status === 'rejected_unrelated'` or `'error'`: display a clear inline rejection/error alert card in the chat panel explaining why the file was rejected (not related to Philippine Civil Code) and allow uploading another file without starting a dead session.
    - If `status === 'completed'`: create/bind a `document` session (`session_type: 'document'`, `document_id: doc.id`), display a clean `"Document Attached"` system/attachment card in the chat thread, and **automatically invoke the initial analysis** (`auto_analyze: true`) without requiring the user to type anything.
  - Provide a collapsible/modal **Document Preview** drawer/viewer inside `/chat` (reusing PDF iframe, DOCX `mammoth` preview, and image preview) so users can read the uploaded file alongside the chat & citations.
  - Keep the chat input enabled immediately after auto-analysis completes for unlimited follow-up questions.
- [x] **1.5 Route & Link Updates Across App (`frontend`):**
  - Update `frontend/app/(dashboard)/history/page.tsx` and `frontend/app/(dashboard)/dashboard/page.tsx` so `session_type === 'document' || document_id` sessions open `/chat?session=<id>` (and `chat/page.tsx` restores `activeDocument` when loading a session with `document_id`).
  - Update Dashboard Document Analysis CTA to navigate to `/chat` (e.g. `/chat?upload=1`).
- [x] **1.6 Phase 1 Verification:**
  - Verify `npm run type-check` in `frontend`, `ruff check .` in `service-rag-python`.
  - Test uploading: (a) non-legal PDF/TXT -> rejected immediately with `rejected_unrelated`; (b) criminal/labor PDF -> rejected immediately with statutory domain explanation; (c) Philippine Lease/Sale/Loan PDF -> accepted, auto-analyzed immediately without typing, citations & NLI populated, and follow-up question works.

---

### Phase 2: Separate Document Builder into Its Own Dedicated Tab
**Goal:** Give the 25-template Legal Document Builder a standalone navigation tab and full workspace route, decoupled from `/research` and Legal Chat.

- [x] **2.1 Update Navigation (`frontend/components/layout/sidebar.tsx`):**
  - Replace `"Document Analysis"` (`/research`) in `sidebarNavItems` with `"Document Builder"` pointing to `/document-builder` (with an appropriate icon from `lucide-react` or `@/components/icons`).
- [x] **2.2 Build Dedicated `/document-builder` Page (`frontend/app/(dashboard)/document-builder/page.tsx`):**
  - Create a dedicated full-height workspace combining:
    - Left/sidebar panel (plus mobile sheet): **"Saved Legal Drafts"** (filtered by `isBuilderDocument(doc)` from `GET /api/documents`) + **"Create New Document"** button.
    - Main area when no draft is active (or toggleable Template Gallery): Inline categorized grid of all 25 templates from `LEGAL_TEMPLATES` (`frontend/lib/legal-templates/catalog.ts`) with search/category filter, rather than burying them only inside a modal.
    - Main area when a draft is selected: Live `LegalDocumentPaper` editor, **"Edit Fields in Builder"** (`DocumentBuilderModal`), E-Signature modal (`ESignatureModal`), **"Save to Database & Reindex"**, and **Export PDF / DOCX** (`POST /api/documents/export-pdf`, `POST /api/documents/export-docx`).
    - Optional **"Analyze Draft in Legal Chat"** shortcut button that opens `/chat?doc=<id>` so users can ask Legal Chat to review a built document if desired.
- [x] **2.3 Update Dashboard & Retire `/research` (`frontend/app/(dashboard)/dashboard/page.tsx`, `frontend/app/(dashboard)/research/page.tsx`):**
  - Update `frontend/app/(dashboard)/dashboard/page.tsx` workspace cards and `frontend/lib/user-persona.ts` so Document Analysis links to `/chat` and Document Builder has a clear link to `/document-builder`.
  - Convert `/research` (`frontend/app/(dashboard)/research/page.tsx`) into a clean client/server redirect to `/chat` (or `/document-builder?doc=<id>` if `?doc=` matches a builder doc, or `/chat?session=<id>` if `?session=` is present) so no existing URLs break.
  - Prune dead code left over from splitting `/research`.
- [x] **2.4 Phase 2 Verification:**
  - Verify `npm run type-check` and `npm run lint` in `frontend`.
  - Test navigating to `/document-builder`, picking a template, filling fields, saving draft, reopening draft, signing with `ESignatureModal`, and exporting PDF/DOCX.

---

### Phase 3: Data Visualization Graphs (Most Queried Articles, Topics, Most Answered Articles — Global & Personal)
**Goal:** Add interactive data visualization charts on `/dashboard` (and supporting backend analytics API) showing most queried articles, legal topics, and most answered specific articles for both **All Users** and **Current User**, plus approved extra visualizations.

- [x] **3.1 Backend Analytics Aggregation Service (`backend-node/src/routes/analytics.js` or `civil-code.js` + `backend-node/index.js`):**
  - Create `GET /api/analytics/overview` (protected by `requireAuth`, supporting `?scope=all|me` and `?days=7|30|all`).
  - Implement server-side SQL/aggregation against PostgreSQL (`chat_messages`, `chat_sessions`, `civil_code_articles`, `user_documents`):
    - **Most Queried Articles:** Parse user messages (`role = 'user'`) for explicit article numbers + exact-match queries, aggregate counts for `scope=all` (anonymized) and `scope=me` (`user_id = req.user.id`), joined with `civil_code_articles` metadata.
    - **Most Answered / Cited Specific Articles:** Aggregate `citations` JSONB in `role = 'assistant'` messages (`parent_type = 'article'`, active/cited), returning article ID, article number, book name, count, and share %.
    - **Most Queried Topics / Civil Code Books:** Aggregate by Civil Code `hierarchy->>'book_name'` / `title_name` and normalized topic buckets (Obligations & Contracts, Property, Family Code E.O. 209, Succession, Torts & Damages, Sales & Lease, Persons).
    - **Additional Approved Charts:** Activity timeline (daily consultations vs. document analyses), NLI grounding score band distribution, language/domain mix, and document validation stats.
  - Add a DB migration/index if needed (e.g. `GIN` index on `chat_messages.citations` or `chat_sessions(user_id, created_at)`) or an optional lightweight `query_analytics` summary table if live JSONB aggregation latency exceeds ~100ms.
- [x] **3.2 Frontend Chart Components (`frontend/components/analytics/` & `frontend/app/(dashboard)/dashboard/page.tsx`):**
  - Install `recharts` in `frontend/package.json` and build responsive, dark/light-mode chart wrappers matching `--chart-1..5` theme tokens.
  - Build a clean **"Legal Intelligence & Usage Analytics"** section on `/dashboard` with:
    - Segmented scope switch: **All Users** vs. **My Activity** (plus timeframe selector: `7D` / `30D` / `All`).
    - Chart 1: **Most Queried Articles** (horizontal bar chart; clicking a bar opens `/civil-code?article=...`).
    - Chart 2: **Most Answered Specific Articles** (comparison/bar chart showing global vs. personal counts or selected scope).
    - Chart 3: **Top Legal Topics & Civil Code Books** (donut / horizontal bar distribution).
    - Chart 4: **Query & Document Activity Timeline** (area/line chart over 7D / 30D / All).
    - Chart 5: **NLI Statutory Grounding Score Distribution** (Strict Entailment >=85%, Consistent 70–84%, Generalized <70%, Out-of-Domain).
    - Chart 6: **Language & Domain Intent Mix** (English vs. Tagalog split + In-Domain vs. Non-Civil Legal Redirects vs. Non-Legal Refusals).
    - Chart 7: **Document Analysis Validation Funnel** (Civil Law accepted vs. rejected out-of-domain vs. Document Builder drafts).
    - Graceful empty states, loading skeletons, and mobile responsiveness.
- [x] **3.3 Phase 3 Verification:**
  - Verify `npm run type-check` in `frontend`.
  - Verify `GET /api/analytics/overview?scope=all` and `?scope=me` with curl/JWT, confirming zero PII or cross-user private content is exposed in `scope=all`.
  - Visually verify charts in light/dark themes and desktop/mobile viewports.

---

### Phase 4: Citation Panel Ranking Cleanup (Remove `#1, #2, #3`, Enforce Unique Percentages, Trim `RA386` Prefix)
**Goal:** Eliminate duplicate suitability percentages across ranked citations, remove `#1`/`#2`/`#3` rank badges from citation cards, and display clean article numbers (e.g., `Article 1156`) instead of raw `RA386-ART1156`.

- [ ] **4.1 Guarantee Strictly Unique Decreasing Percentages (`service-rag-python/main.py`):**
  - Update `calibrate_suitability_score` and `rank_and_stratify_citations` (lines 1985–2260) so:
    - Exact-matched articles/cases are no longer all hardcoded to `98.5%`; instead they are differentiated by relevance order, RRF/similarity, and match priority (e.g., starting from `99.0%` or `98.5%` and stepping cleanly).
    - After sorting by `calculate_sort_score` descending, enforce a strict monotonic ceiling: if `suitability >= prev_suitability`, decrement by a clear visible step (e.g., `prev_suitability - 0.5` or adaptive `0.3–0.8` step clamped >= `1.0` and rounded to 1 decimal) so **no two citations ever share the same percentage**.
  - Apply the same strict monotonic deduplication step after merging `accumulated_citations` (line 3738) and after `reconcile_response_citations` (line 4281) so newly reconciled or accumulated items never introduce duplicate percentages.
- [ ] **4.2 Remove `#1, #2, #3` Rank Badges from Citation Cards (`frontend/app/(dashboard)/chat/page.tsx` & `frontend/context/chat-context.tsx`):**
  - Remove the `#{cit.rank}` pill from both Jurisprudence cards (line 1267) and Statutory Article cards (line 1343) in `chat/page.tsx` (and in `DocCitationCard` if any legacy reference remains), while preserving sort order (highest percentage on top) and keeping the percentage badge (`{cit.suitability_percent}%`).
  - Add a lightweight frontend safeguard in `sortCitations` / display mapping so even historical DB messages saved prior to this fix do not render identical percentages.
- [ ] **4.3 Trim `RA386` Prefix to Clean Article Number (`frontend`):**
  - Add a shared formatter `formatCitationArticleLabel(cit)` (e.g., in `frontend/lib/utils.ts` or `chat-context.tsx`):
    - `RA386-ART1156` -> `Article 1156` (or using `metadata.article_number`: `Article ${artNum}`).
    - `EO209-ART36` -> `Family Code Art. 36` (clearly distinguishing EO 209 from RA 386 while stripping raw `EO209-ART` / `RA386-ART` codes).
    - Structural IDs (`RA386-GENERAL-INFO`, `RA386-STRUCTURE-AND-ARTICLES`, `RA386-SPECIAL-LAWS-AND-AMENDMENTS`) -> clean readable titles (`Civil Code Overview`, `Civil Code Structure`, `Special Laws`).
  - Apply `formatCitationArticleLabel` to citation cards AND the Statutory Citation Detail Modal header (`chat/page.tsx` lines 1349, 1518, 1581).
- [ ] **4.4 Phase 4 Verification:**
  - Verify `ruff check .` in `service-rag-python` and `npm run type-check` in `frontend`.
  - Test a multi-article query (e.g., *"Compare Article 1156, Article 1157, and Article 1191"*) and verify: (a) zero `#1`/`#2`/`#3` numbering, (b) every card has a distinct percentage in strictly descending order, and (c) badges read `Article 1156`, `Article 1157`, `Article 1191` with no `RA386` prefix.

---

### Phase 5: Hide "Out of Rank" Citations from the Citation Panel
**Goal:** Completely hide `out_of_rank` (`is_in_context === false`) citations and their divider/counters from the Citation Panel UI.

- [ ] **5.1 Filter Out-of-Rank Authorities in Citation Panel (`frontend/app/(dashboard)/chat/page.tsx`):**
  - Remove `outOfRankCitations` rendering and the `"Out of Rank Authorities (...)"` divider (lines 1220–1255).
  - Filter `displayCitations` strictly to active grounded items (`c.is_in_context !== false && c.rank_status !== "out_of_rank"`).
  - Remove the `"Out of Rank"` badge branch on cards (lines 1276–1280, 1351–1355).
- [ ] **5.2 Align Panel Header & Badge Counts (`frontend/app/(dashboard)/chat/page.tsx` & `frontend/context/chat-context.tsx`):**
  - Filter `retainedCitations` and `currentCitations` counts in the Citation Panel header (`Total`, `All Sources (N)`, `Latest (N)`) and mobile `"Citations (N)"` button so the displayed number matches the exact count of visible active citations (never counting hidden `out_of_rank` entries).
  - In `service-rag-python/main.py` (line 3724–3737), review whether dampened `out_of_rank` prior citations should stop being appended to `accumulated_citations` for the UI stream (while keeping `is_in_context` tracking intact if needed by eval scripts).
- [ ] **5.3 Phase 5 Verification:**
  - Verify `npm run type-check` in `frontend` and `ruff check .` in `service-rag-python`.
  - Run a multi-turn conversation and confirm zero `"Out of Rank"` cards or dividers appear in either `"Latest"` or `"All Sources"` views, and header counts match rendered card count 1:1.

---

### Phase 6: Citation-to-Answer Alignment (Only Cite Articles Actually Used in the Answer)
**Goal:** Eliminate the mismatch where the Citation Panel displays retrieved articles that the model never cited or used in its answer, following Decision B.

- [ ] **6.1 Tighten Post-Reranking Context Budget (`service-rag-python/main.py`):**
  - Lower `context_budget` in `search_with_embedding` from `15` to a focused precision budget (e.g., `5` max total primary items: up to `3–4` highest-scoring Civil Code articles + `1–2` jurisprudence cases, or `len(explicit_art_nums)` when the user asks about specific articles).
  - Ensure `rank_and_stratify_citations` and `hybrid_search` prioritize precision (cross-checking similarity/RRF gap so weak tangential articles aren't injected into `context_str`).
- [ ] **6.2 Strengthen Prompt Grounding Directives (`service-rag-python/main.py`):**
  - Instruct the generator prompt to explicitly reference each statutory article (`[Art. X]` / `Article X`) and Supreme Court case (`Case Title`, `G.R. No. ...`) from `CONTEXT` that supports its reasoning, while omitting irrelevant noise.
- [ ] **6.3 Bidirectional Answer-Grounded Reconciliation (`service-rag-python/main.py`):**
  - Update `reconcile_response_citations(full_text, existing_citations, ...)` so that for normal in-domain responses:
    - Extract all article numbers cited in `full_text` via `parse_article_numbers(full_text)` and all G.R. numbers / case titles mentioned in `full_text`.
    - Retain retrieved `article` items **only if** their article number appears in `full_text` (or is an explicitly requested exact article discussed in `full_text`).
    - Retain retrieved `case` items **only if** their `gr_number` or distinctive case title party appears in `full_text`.
    - Retain `user_document` excerpts when analyzing an active `document_id`.
    - Add any valid Civil Code / Family Code article mentioned in `full_text` that was missing from `existing_citations` via `fetch_article_citations`.
    - Safety fallback: if an in-domain response somehow cited zero explicit article numbers, retain only the #1 primary grounding authority rather than wiping everything.
    - Re-run unique percentage monotonic calibration on the reconciled list so percentages remain clean and descending, and sync `accumulated_citations` to include only reconciled active citations!
- [ ] **6.4 Regression Check on Evaluation Scripts (`service-rag-python`):**
  - Check `eval_comprehensive_metrics.py`, `eval_ragas.py`, and `verify_rag_pipeline.py` to confirm citation recall / precision metrics remain compatible.
- [ ] **6.5 Phase 6 Verification:**
  - Verify `ruff check .` in `service-rag-python`.
  - Test multiple legal queries (single article, multi-article comparison, factual dispute, jurisprudence query, document analysis) and confirm every Civil Code article card shown in the Citation Panel is explicitly cited in the assistant's answer text.

---

### Phase 7: Fast English <-> Tagalog Google-Translate Toggle Button in Chat Panel (Zero LLM)
**Goal:** Add a fast, Google-Translate-style instant translation toggle (`English` <-> `Tagalog`) on assistant answers in the Legal Chat panel without calling the LLM, following Decision C.

- [ ] **7.1 Markdown-Aware Non-LLM Translator Module (`service-rag-python/services/translator.py`):**
  - Add `deep-translator` (or lightweight `httpx` Google Translate client + optional official `GOOGLE_TRANSLATE_API_KEY` Cloud Translate v2 path) to `service-rag-python/requirements.txt`.
  - Implement `translate_legal_markdown(text: str, target_lang: Literal["en", "tl"]) -> dict`:
    - Detect/preserve Markdown line prefixes (`### `, `> `, `- `, `1. `, `---`) and inline formatting (`**...**`, `*...*`).
    - Mask legal citations and statutory identifiers (`[Art. 1191]`, `Article 1156`, `G.R. No. ...`, `R.A. 386`, `E.O. 209`, `PAO`, `RTC`, `MTC`) with safe placeholder tokens before translation and restore them verbatim afterward.
    - Translate text cleanly in a single fast HTTP batch (~150–350ms, zero GPU/LLM queue usage) with an in-memory LRU cache keyed by `(sha256(text), target_lang)`.
- [ ] **7.2 Fast Translation API Route (`service-rag-python/main.py` & `backend-node/src/routes/proxy.js` or `sessions.js`):**
  - Add `TranslateRequest` (`text: str`, `target_lang: Literal["en", "tl"]`, `source_lang: Optional[Literal["en", "tl", "auto"]] = "auto"`) and `POST /translate` JSON endpoint in `service-rag-python/main.py` returning `{ translated_text, source_lang, target_lang, latency_ms }` (no GPU lock / no `queue_manager`).
  - Expose `POST /api/chat/translate` (protected with `requireAuth`) in `backend-node` forwarding to FastAPI `/translate`.
- [ ] **7.3 Frontend Fast Per-Message Translation Toggle (`frontend/app/(dashboard)/chat/page.tsx` & `frontend/context/chat-context.tsx`):**
  - Add per-message translation state/cache (storing `{ originalLang, en?: string, tl?: string, activeLang: 'en' | 'tl', isTranslating?: boolean, error?: string }`).
  - Detect the message's base language lightly on the client (`en` vs `tl`), and render a compact Google-Translate-style toggle pill right next to `CopyMessageButton` on every completed assistant message:
    - Shows `"Translate to Tagalog"` (when showing English) or `"Translate to English"` (when showing Tagalog), plus a subtle `"Translated (Tagalog)"` / `"Original"` indicator when toggled.
    - First click fetches `POST /api/chat/translate` (~150–350ms) and caches the result; every subsequent click toggles back and forth instantaneously (`0ms`).
    - Disable button while the assistant message is actively generating (`isLatestAssistant && isGenerating`), and show a clean retry notice if the translation request fails.
- [ ] **7.4 Phase 7 Verification:**
  - Verify `ruff check .` in `service-rag-python` and `npm run type-check` in `frontend`.
  - Test `POST /api/chat/translate` via curl and UI: verify English -> Tagalog and Tagalog -> English toggle speed (<500ms first fetch, instant cached toggle), zero LM Studio GPU usage, and intact Markdown headings, blockquotes, and `[Art. X]` citations.

---

## 3. Summary of Changes & Solutions Log

> Update this section immediately after completing each phase or feature. Never delete prior entries.

### Phase 1: Document Analysis in Legal Chat + Auto-Reject + Auto-Analyze
- **Status:** Completed
- **Completed Date:** 2026-11-19
- **Files Created / Modified:**
  - Created: `service-rag-python/tests/test_document_domain.py`, `service-rag-python/tests/test_document_extraction_gate.py`, `service-rag-python/tests/test_auto_analyze.py`, `frontend/components/document-preview.tsx`
  - Modified: `service-rag-python/services/domain_router.py`, `service-rag-python/services/document.py`, `service-rag-python/services/llm_client.py`, `service-rag-python/main.py`, `backend-node/src/routes/documents.js`, `frontend/context/chat-context.tsx`, `frontend/app/(dashboard)/chat/page.tsx`, `frontend/app/(dashboard)/history/page.tsx`, `frontend/app/(dashboard)/dashboard/page.tsx`
- **Problem & Root Cause:** Document analysis was isolated in `/research`, off-domain uploads (non-legal files and non-Civil statutes such as Criminal or Labor Law) were still chunked and embedded into `document_chunks`, `/search` always persisted a user message even when an automatic document analysis had no user-typed prompt, and follow-up turns starting after an assistant-only opening broke strict user/assistant alternation in Gemma templates and could omit statutory Civil Code retrieval on colloquial questions.
- **How It Was Solved / Changes Made:** Moved `classify_document_domain`, `CIVIL_LAW_DOC_PATTERNS`, and `NON_CIVIL_LEGAL_DOC_DOMAINS` into `service-rag-python/services/domain_router.py` with `DomainRouter.score_text` hybrid semantic + regex classification; enforced upload-time gating in `service-rag-python/services/document.py` (`extract_and_process_document`, `reject_document`) setting `status = 'rejected_unrelated'`, deleting partial chunks, and clearing `extracted_text`; added `auto_analyze: bool = False` in `service-rag-python/main.py` (skipping `save_user_message`, triggering automatic comprehensive Civil Code analysis and contextual `follow_ups`, and keeping statutory retrieval active for follow-up questions) and `build_llm_messages` history normalization in `service-rag-python/services/llm_client.py`; added `.jpg`/`.jpeg` filter support and `GET /api/documents/:id` in `backend-node/src/routes/documents.js`; integrated upload button, drag-and-drop zone, status polling, inline rejection card, `"Document Attached"` banner, auto-analyze trigger, follow-up binding, and shared `DocumentPreview` component in `frontend/context/chat-context.tsx`, `frontend/app/(dashboard)/chat/page.tsx`, and `frontend/components/document-preview.tsx`; updated session links and Document Analysis CTAs in `frontend/app/(dashboard)/history/page.tsx` and `frontend/app/(dashboard)/dashboard/page.tsx` to route to `/chat?session=<id>` and `/chat?upload=1`.
- **Verification Results:**
  - `service-rag-python`: `./venv/bin/python -m unittest discover -s tests -v` -> 15 tests OK; `ruff check .` -> `All checks passed!` (`mypy` not installed in venv).
  - Live `POST http://127.0.0.1:8000/extract` against PostgreSQL: non-legal recipe TXT, Criminal Law Estafa complaint TXT, and NLRC Labor complaint TXT terminated at `rejected_unrelated` (`extracted_text IS NULL`, `chunk_count = 0`); Philippine Lease TXT terminated at `completed` (`progress = 100`, `chunk_count = 1`).
  - Live `POST http://127.0.0.1:8000/search` with `auto_analyze: true` returned HTTP `200` SSE stream (remote `LM_STUDIO_URL` was offline during live test, returning clean LM Studio readiness `error` event; full `auto_analyze` + follow-up SSE flow verified with mocked LLM stream in `tests/test_auto_analyze.py`).
  - `backend-node`: `node --check index.js src/routes/documents.js src/routes/sessions.js src/routes/proxy.js` exited `0`; unauthenticated `GET /api/documents/:id` returned HTTP `401`.
  - `frontend`: `npm run type-check` exited `0`; `npx eslint components/document-preview.tsx "app/(dashboard)/dashboard/page.tsx"` exited `0` (0 errors, 0 warnings; pre-existing lint issues remain in `chat/page.tsx`, `chat-context.tsx`, and `history/page.tsx`); Next.js `GET /chat`, `/chat?upload=1`, `/history`, `/dashboard` returned HTTP `200`.

### Phase 2: Dedicated Document Builder Tab
- **Status:** Completed
- **Completed Date:** 2026-11-19
- **Files Created / Modified:**
  - Created: `frontend/lib/legal-templates/document-utils.ts`, `frontend/components/document-builder/template-gallery.tsx`, `frontend/app/(dashboard)/document-builder/page.tsx`, `service-rag-python/tests/test_docx_export.py`
  - Modified: `frontend/components/layout/sidebar.tsx`, `frontend/components/document-builder/document-builder-modal.tsx`, `frontend/components/document-builder/legal-document-paper.tsx`, `frontend/components/document-builder/e-signature-modal.tsx`, `frontend/app/(dashboard)/dashboard/page.tsx`, `frontend/app/(dashboard)/research/page.tsx`, `frontend/app/(dashboard)/layout.tsx`, `frontend/lib/user-persona.ts`, `frontend/context/chat-context.tsx`, `frontend/app/(dashboard)/chat/page.tsx`, `service-rag-python/main.py`
  - Deleted (dead code pruned): `frontend/context/doc-chat-context.tsx`, `frontend/components/document-builder/document-format-picker-modal.tsx`
- **Problem & Root Cause:** The 25-template Legal Document Builder was buried inside a modal on the legacy `/research` workspace alongside the retired `DocChatProvider`, `/research` loaded canvas drafts via a nonexistent `GET /api/documents/:id/content` path, `DocumentBuilderModal` skipped re-hydrating external edits when reopened for the same draft, `/chat?doc=<id>` did not start a fresh document analysis if another chat session was already open, and `generate_legal_docx` in `service-rag-python/main.py` defined `_extract_b64` inside the bilateral signature branch causing unilateral signed `.docx` exports to fail with `UnboundLocalError`.
- **How It Was Solved / Changes Made:** Replaced `"Document Analysis"` (`/research`) in `sidebar.tsx` with `"Document Builder"` (`/document-builder`, `FilePenLine`); extracted shared builder metadata, signer-option, and PDF/DOCX/TXT export helpers into `frontend/lib/legal-templates/document-utils.ts` and inline 25-template browsing (with search, 8 categories, statutory preview, and unique filename dialog) into `frontend/components/document-builder/template-gallery.tsx`; refactored `DocumentBuilderModal` to mount fresh per open session (fixing reopen re-hydration and React 19 hook rules) with explicit one-click `"Save Draft"`; created `frontend/app/(dashboard)/document-builder/page.tsx` with collapsible desktop + mobile `"Saved Legal Drafts"` sidebar, inline `<TemplateGallery />`, live `<LegalDocumentPaper>` editor, inline rename (`PATCH /api/documents/:id/rename`), `"Edit Fields in Builder"`, `<ESignatureModal>` with immediate persistence (`PUT /api/documents/:id/content`), `"Save to Database & Reindex"`, Export PDF/DOCX/Print/TXT dropdown, delete confirmation dialog, and `"Analyze Draft in Legal Chat"` (`/chat?doc=<id>` with `startFreshAnalysis: true`); updated `/dashboard` and `user-persona.ts` to a balanced 4-card Core Workspaces grid linking Document Analysis to `/chat?upload=1` and Document Builder to `/document-builder`; converted `/research` into a smart redirect (`/research?session=` -> `/chat?session=`, `/research?doc=` -> `/document-builder?doc=` for builder drafts or `/chat?doc=` otherwise, default -> `/chat`); removed `<DocChatProvider>` from `(dashboard)/layout.tsx` and pruned dead files/exports; hoisted `_extract_b64` in `service-rag-python/main.py` and added regression tests in `service-rag-python/tests/test_docx_export.py`.
- **Verification Results:**
  - `frontend`: `npm run type-check` (`tsc --noEmit`) exited `0`; `npx eslint` across all Phase 2 files (`lib/legal-templates/document-utils.ts`, `components/document-builder/`, `components/layout/sidebar.tsx`, `app/(dashboard)/document-builder/page.tsx`, `app/(dashboard)/research/page.tsx`, `app/(dashboard)/dashboard/page.tsx`, `app/(dashboard)/layout.tsx`, `lib/user-persona.ts`) exited `0` (0 errors, 0 warnings).
  - Template catalog compilation check verified all 25 templates across 8 categories generate valid text, match `isBuilderDocument` / `findTemplateForDocument`, and pass filename deduplication/self-exclusion validation.
  - Clean-code hygiene scan confirmed 0 emojis, 0 decorative banner comments, and 0 stale imports/references to deleted files.
  - Live Next.js routes `GET /document-builder`, `/document-builder?doc=...`, `/research`, `/research?doc=...`, `/research?session=...`, `/dashboard`, `/chat`, `/chat?upload=1` all returned HTTP `200`.
  - Live authenticated CRUD + export verification against Express (`:4000`) & FastAPI (`:8000`) passed end-to-end: `POST /api/documents/create-from-template` (`201`), `GET /api/documents` (`200`), `GET /api/documents/:id/canvas` (`200`), `PUT /api/documents/:id/content` with persisted E-Signature JSON (`200`), `PATCH /api/documents/:id/rename` (`200`), signed `POST /api/documents/export-pdf` (`200 application/pdf`, `%PDF-1.7`, 54,000 bytes), signed unilateral & bilateral `POST /api/documents/export-docx` (`200 wordprocessingml`, valid ZIP `PK\x03\x04`, 37,139 / 37,291 bytes), and `DELETE /api/documents/:id` (`200`) with full cleanup.
  - `service-rag-python`: `ruff check .` -> `All checks passed!`; `./venv/bin/python -m unittest discover -s tests -v` -> 17 tests OK.
  - `backend-node`: `node --check index.js src/routes/documents.js` exited `0`. (Note: live Chrome DevTools MCP browser click-through was unavailable because Chrome remote debugging was not active on this host.)

### Phase 3: Data Visualization Graphs (Dashboard Analytics)
- **Status:** Completed
- **Completed Date:** 2026-11-19
- **Files Created / Modified:**
  - Created: `backend-node/src/services/db.js`, `backend-node/src/routes/analytics.js`, `backend-node/test/analytics.test.mjs`, `supabase/migrations/20261119152000_analytics_indexes.sql`, `frontend/components/analytics/analytics-types.ts`, `frontend/components/analytics/chart-primitives.tsx`, `frontend/components/analytics/dashboard-analytics-section.tsx`
  - Modified: `backend-node/src/services/presence.js`, `backend-node/index.js`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/next.config.ts`, `frontend/app/globals.css`, `frontend/app/(dashboard)/dashboard/page.tsx`
- **Problem & Root Cause:** `/dashboard` lacked interactive visualizations for statutory query demand, grounded article citation frequency, legal topic shares, consultation/document activity trends, Neuro-Symbolic Hybrid NLI grounding distributions (including contradicted claims), bilingual/domain routing telemetry, and document validation rates. Additionally, live `jsonb_array_elements(citations)` aggregation against TOASTed full-text citation arrays averaged ~238ms uncached and risked double-counting multi-chunk articles per response and duplicate consecutive user messages.
- **How It Was Solved / Changes Made:** Extracted a single shared PostgreSQL pool (`backend-node/src/services/db.js`) reused by `presence.js` and `analytics.js`; created an idempotent migration (`supabase/migrations/20261119152000_analytics_indexes.sql`) adding composite/partial/GIN indexes plus an RLS-locked `analytics_article_citations` normalized projection table kept synchronized automatically by `trg_sync_analytics_article_citations` (`AFTER INSERT OR UPDATE OF citations` with `ON DELETE CASCADE`), dropping warm uncached aggregation latency from 238ms to 10–24ms; implemented `GET /api/analytics/overview` (`backend-node/src/routes/analytics.js`) protected by `requireAuth` with strict `scope=all|me` and `days=7|30|all` sanitization, 30s consecutive user-message deduplication, Family Code (E.O. 209) vs. Civil Code (R.A. 386) article disambiguation, strict privacy isolation (zero PII in `scope=all`), and 15s scoped caching; registered `/api/analytics` in `backend-node/index.js` and added `/api/analytics/:path*` rewrite in `frontend/next.config.ts`; installed `recharts` (`3.11.0`) and upgraded `--chart-1..7` theme tokens for light and dark modes in `frontend/app/globals.css`; built modular accessible Recharts components in `frontend/components/analytics/` rendering all 3 core + 4 additional approved charts in an asymmetric 12-column 3-band layout with `All Users` / `My Activity` and `7D` / `30D` / `All` segmented switches, clickable article navigation to `/civil-code?article=...`, loading skeletons, and graceful empty states; integrated `<DashboardAnalyticsSection />` into `frontend/app/(dashboard)/dashboard/page.tsx` reusing the resolved auth token.
- **Verification Results:**
  - `backend-node`: `node --check index.js src/services/db.js src/services/presence.js src/routes/analytics.js` exited `0`; `node --test test/analytics.test.mjs` -> 6/6 tests passed (parameter sanitization, formatting, privacy-safe `scope=all`, empty-user `scope=me`, active-user scoping, and PostgreSQL trigger insert/dedup/cascade-delete verification); warm uncached aggregation measured `23.5ms` (`all/all`) and `10.6ms` (`me/30`).
  - Live HTTP & Next.js proxy verification: unauthenticated `GET :4000/api/analytics/overview` and `:3000/api/analytics/overview` returned `401`; authenticated JWT requests across all `scope` (`all`/`me`/invalid) and `days` (`7`/`30`/`all`/invalid) combinations returned `200` (`4.4ms` cached, `10–17ms` uncached) with zero PII exposure.
  - `frontend`: `npm run type-check` (`tsc --noEmit`) exited `0`; `npx eslint` across all Phase 3 files (`components/analytics/*`, `app/(dashboard)/dashboard/page.tsx`, `next.config.ts`) exited `0` (0 errors, 0 warnings).
  - `service-rag-python`: `ruff check .` -> `All checks passed!`; `./venv/bin/python -m unittest discover -s tests -v` -> 17/17 tests OK.
  - Clean-code hygiene scan across all Phase 3 files confirmed 0 emojis and 0 decorative banner comments.
  - Live headless Chrome Playwright verification on `http://localhost:3000/dashboard`: all 8 Recharts SVG surfaces rendered with non-zero bounding boxes, interactive `30D` / `7D` / `All` / `My Activity` / `All Users` toggles and `/civil-code?article=EO209-ART36` deep-link navigation passed, horizontal overflow `0px` at both `1440px` desktop and `390px` mobile viewports, 0 console errors, 0 page errors, and screenshots visually audited in both light and dark modes.

### Phase 4: Citation Panel Ranking, Unique Percentages & Trim `RA386`
- **Status:** Not Started
- **Completed Date:** TBD
- **Files Created / Modified:** TBD
- **Problem & Root Cause:** TBD
- **How It Was Solved / Changes Made:** TBD
- **Verification Results:** TBD

### Phase 5: Hide Out-of-Rank Citations in Citation Panel
- **Status:** Not Started
- **Completed Date:** TBD
- **Files Created / Modified:** TBD
- **Problem & Root Cause:** TBD
- **How It Was Solved / Changes Made:** TBD
- **Verification Results:** TBD

### Phase 6: Citation-to-Answer Grounding Alignment
- **Status:** Not Started
- **Completed Date:** TBD
- **Files Created / Modified:** TBD
- **Problem & Root Cause:** TBD
- **How It Was Solved / Changes Made:** TBD
- **Verification Results:** TBD

### Phase 7: Fast Google-Translate-Style English <-> Tagalog Toggle Button (Zero LLM)
- **Status:** Not Started
- **Completed Date:** TBD
- **Files Created / Modified:** TBD
- **Problem & Root Cause:** TBD
- **How It Was Solved / Changes Made:** TBD
- **Verification Results:** TBD
