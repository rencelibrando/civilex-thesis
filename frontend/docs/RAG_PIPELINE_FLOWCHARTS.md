# CIVIL-LEX: Dedicated RAG Pipeline Flowcharts & Execution Logic

This document provides exhaustive, granular flowcharts detailing every phase of the CIVIL-LEX bilingual Retrieval-Augmented Generation (RAG) pipeline for Philippine Civil Law.

---

## 1. Complete RAG Pipeline Master Flowchart (14 Distinct Phases)

The master pipeline is architected around a strict **Separation of Concerns (SoC)** model across 10 decoupled layers. Each layer maintains its own boundary, input/output contract, and fault isolation barrier:

```mermaid
flowchart TD
    subgraph Layer1 ["1. Presentation & Transport Gateway (Edge / Proxy)"]
        direction TB
        ClientReq(["Client Submits Prompt via Web UI"]) --> ExpressGateway["Node.js Express 5 API Gateway<br/>Validate Auth, Headers & Session Tokens"]
        ExpressGateway --> StreamJobInit["Stream Job Registration<br/>stream_jobs.create() -> Emit SSE: job (job_id)"]
    end

    subgraph Layer2 ["2. Session State & Fast-Path Memory (Phase 1)"]
        direction TB
        StreamJobInit --> LoadMemory["Load Canonical History<br/>services/memory.py: chat_messages"]
        LoadMemory --> CheckMetaQuery{"Meta-Query Check<br/>is_history_recall or<br/>is_summary_request?"}
        CheckMetaQuery -->|"History Recall"| FastRecall["session_memory.build_recall_response<br/>Deterministic recall from transcript"]
        CheckMetaQuery -->|"Summary Request"| FastSummary["session_memory.build_summary_response<br/>Extract direct answer from prior turn"]
        FastRecall --> FastSSE["Emit SSE: status, text, done<br/>(Bypasses GPU Queue completely)"]
        FastSummary --> FastSSE
        FastSSE --> FastPersist["Save turn to chat_messages"]
        FastPersist --> FastComplete(["Fast-Path Turn Complete"])
    end

    subgraph Layer3 ["3. Hardware Resource & Concurrency Governor"]
        direction TB
        CheckMetaQuery -->|"Standard Legal Inquiry"| CheckReadiness{"Model Readiness Probe<br/>check_model_readiness()"}
        CheckReadiness -->|"LM Studio Offline"| HaltOffline["Emit SSE error: Model not ready<br/>Halt pipeline before queue"]
        CheckReadiness -->|"Model Online"| EnterQueue["queue_manager.enter_queue()<br/>Register ticket for 6GB VRAM slot"]
        EnterQueue --> ConcurrencyGate{"Active Slots < 1?<br/>(Strict VRAM Guard)"}
        ConcurrencyGate -->|"No - Slot Busy"| EnqueueWait["FIFO Waiters Queue<br/>Emit SSE status: queued (#k)<br/>Periodic keepalive status updates"]
        EnqueueWait --> AwaitEvent["Await Concurrency Slot Event"]
        AwaitEvent --> GrantSlot["Grant VRAM Slot<br/>Emit SSE status: embedding"]
        ConcurrencyGate -->|"Yes - Slot Free"| GrantSlot
    end

    subgraph Layer4 ["4. Cognitive Scope & Ambiguity Guardrails (Phases 2 & 3)"]
        direction TB
        GrantSlot --> DocGate{"Document Uploaded<br/>(document_id present)?"}
        DocGate -->|"Yes"| EvalDocLegality{"classify_document_domain()<br/>Is document valid civil law?"}
        EvalDocLegality -->|"Non-Legal Document"| RefuseDocNonLegal["Synthesize Scope Refusal<br/>List supported civil contracts<br/>Emit SSE citations, text, done"]
        EvalDocLegality -->|"Other Legal Document"| RedirectDocLegal["Synthesize Statutory Redirection<br/>Identify competent agency: DOLE/BIR/PNP<br/>Emit SSE citations, text, done"]
        EvalDocLegality -->|"Valid Civil Document"| AmbiguityDetector

        DocGate -->|"No Document"| SemanticRouter["Phase 2: Semantic Domain Router<br/>services/domain_router.py"]
        SemanticRouter --> DomainClassify{"Evaluate Query Domain<br/>Fast Regex + E5 Centroids"}
        DomainClassify -->|"Non-Legal Inquiry"| RefuseNonLegal["Synthesize Scope Boundary Refusal<br/>List supported civil law topics<br/>Emit SSE citations, text, done"]
        DomainClassify -->|"Specialized Legal Inquiry"| RedirectLegal["Synthesize Statutory Redirection<br/>Map to Labor/Tax/Penal statute & agency<br/>Sanitize hallucinated external statutes<br/>Emit SSE citations, text, done"]
        DomainClassify -->|"Out-of-Bounds Article"| RefuseFakeArticle["Boundary Notice: RA 386 ends at Art. 2270<br/>Clarify penal/theft under RPC<br/>Emit SSE citations, text, done"]
        DomainClassify -->|"Illicit Contract Object"| RefuseIllicit["Refuse illegal object under Arts. 1347 & 1409<br/>Emit SSE citations, text, done"]
        DomainClassify -->|"In-Domain Civil Law"| AmbiguityDetector["Phase 3: Pre-Retrieval Ambiguity Detection<br/>services/ambiguity.py"]

        AmbiguityDetector --> AmbiguityGate{"Ambiguity Gating<br/>is_ambiguous AND<br/>confidence >= 0.65?"}
        AmbiguityGate -->|"Yes - Missing Facts"| EmitClarification["Emit SSE clarification_needed<br/>Send interactive multi-choice options<br/>Save turn state & Emit SSE done"]
        AmbiguityGate -->|"No - Sufficient Facts"| ProceedToAugmentation["Proceed to Query Formulation"]
    end

    subgraph Layer5 ["5. Query Engineering & Legal Expansion (Phases 4 & 5)"]
        direction TB
        ProceedToAugmentation --> P4Coreference["Phase 4: Conversational Coreference<br/>build_contextual_query(): Resolve pronouns from prior 6 turns"]
        P4Coreference --> P5Expansion["Phase 5: Philippine Legal Expansion Engine<br/>expand_legal_query(): Map Tagalog/Taglish to statutory anchors"]
    end

    subgraph Layer6 ["6. Hybrid Knowledge Retrieval & Graph Expansion (Phases 6, 7 & 8)"]
        direction TB
        P5Expansion --> P6Vectorize["Phase 6: Dense Vectorization<br/>SentenceTransformer: multilingual-e5-base ('query: ' prefix)"]
        P6Vectorize --> P7Hybrid["Phase 7: Tri-Search Hybrid Retrieval (search_with_embedding)<br/>1. Exact Match (Arts 1-2270, G.R. Nos.)<br/>2. pgvector HNSW Cosine Search<br/>3. PostgreSQL GIN Full-Text Search (ts_rank_cd)<br/>4. SQL Reciprocal Rank Fusion (RRF k=60)"]
        P7Hybrid --> P8Graph["Phase 8: Knowledge Graph Expansion<br/>STATUTORY_COMPANION_GRAPH + Linked Landmark Supreme Court Cases"]
    end

    subgraph Layer7 ["7. Evidence Calibration & Context Stratification (Phases 9, 10 & 11)"]
        direction TB
        P8Graph --> P9Calibration["Phase 9: Suitability Calibration & Adaptive Pruning<br/>Cosine to % calibration; prune delta > 22% from anchor; floor = 62.0%"]
        P9Calibration --> P10Deduplication["Phase 10: Multi-Turn Citation Retention & Deduplication<br/>Union top 6 prior citations; dampen unretrieved items by 30%"]
        P10Deduplication --> P11Hierarchy["Phase 11: Strict Context Hierarchy Partitioning<br/>Tier 1: Verbatim Articles -> Tier 2: Doc Excerpts -> Tier 3: Jurisprudence"]
    end

    subgraph Layer8 ["8. Inverted Pyramid Synthesis & Decoupled Streaming (Phases 12 & 13)"]
        direction TB
        P11Hierarchy --> P12Prompt["Phase 12: Inverted Pyramid Prompt Synthesis<br/>Citizen persona + unilingual directive + 4-tier markdown structure"]
        P12Prompt --> P13StreamWorker["Phase 13: Local LLM Generation & Decoupled Streaming<br/>Call LM Studio Gemma 4; decouple via asyncio.Queue & 12s heartbeat pings"]
        P13StreamWorker --> StreamTokens["Stream delta tokens via SSE event: text"]
        StreamTokens --> ReconcileCitations["Reconcile citations against generated text<br/>Emit SSE citations and accumulated_citations"]
    end

    subgraph Layer9 ["9. Neuro-Symbolic Verification & Faithfulness Audit (Phase 14)"]
        direction TB
        ReconcileCitations --> P14NLI["Phase 14: Neuro-Symbolic NLI Engine (services/nli.py)"]
        ReconcileCitations -.->|"Concurrent Async Task"| GenFollowups["Concurrent Follow-Up Generation<br/>services/followups.py: 3 unilingual questions"]
        P14NLI --> ClaimDecomposition["Atomic Claim Decomposition & Deontic Modality Parsing (shall, may, cannot)"]
        ClaimDecomposition --> ArbitrationTruthTable["4-Tier Arbitration Truth Table:<br/>1. Citation Guardrail (Article in context?)<br/>2. Deontic Symbolic Veto (Modality match?)<br/>3. Horn Clause Fast-Path (Containment >= 50%)<br/>4. Neural Tier (Gemma 4 NLI entailment check)"]
        ArbitrationTruthTable --> EmitAnalytics["Emit SSE event: legal_analytics (nli_score, nli_status)"]
        GenFollowups --> EmitFollowups["Emit SSE event: follow_ups"]
        EmitAnalytics --> EmitStreamDone["Emit SSE event: done<br/>(Closes Client SSE Stream)"]
        EmitFollowups --> EmitStreamDone
    end

    subgraph Layer10 ["10. Persistence, Analytics & Hardware Lifecycle"]
        direction TB
        RefuseDocNonLegal --> EarlyExitDone["Emit SSE done"]
        RedirectDocLegal --> EarlyExitDone
        RefuseNonLegal --> EarlyExitDone
        RedirectLegal --> EarlyExitDone
        RefuseFakeArticle --> EarlyExitDone
        RefuseIllicit --> EarlyExitDone
        EmitClarification --> EarlyExitDone

        EmitStreamDone --> PostStreamBridge["Post-Stream Execution Hand-off"]
        EarlyExitDone --> PostStreamBridge
        PostStreamBridge --> PersistDB["Save assistant message, citations & analytics to chat_messages"]
        PersistDB --> CheckSummaryRefresh{"Transcript length >= 14<br/>and interval reached?"}
        CheckSummaryRefresh -->|"Yes"| RefreshSummary["Call LM Studio to summarize transcript<br/>UPDATE chat_sessions SET summary"]
        CheckSummaryRefresh -->|"No"| ReleaseVRAMSlot["finally: queue_manager.release_slot(ticket)<br/>Wake next FIFO waiter in line"]
        RefreshSummary --> ReleaseVRAMSlot
        ReleaseVRAMSlot --> PipelineComplete(["Pipeline Complete"])
    end
```

---

## 2. Pre-Retrieval Gating Flowchart (Phases 1 to 3)

This flowchart details session memory loading, dual-track domain classification (document vs query), and interactive ambiguity resolution:

```mermaid
flowchart TD
    subgraph Phase1Memory ["Phase 1: Session Memory Loading (services/memory.py)"]
        ReqIn["Incoming SearchRequest"]
        LoadDBHistory["Load history from chat_messages by session_id"]
        VerifyOwner{"Session user_id<br/>matches token?"}
        VerifyOwner -->|"No"| ClearHistory["Return empty history for isolation"]
        VerifyOwner -->|"Yes"| ResolveHistory["Merge with client history fallback<br/>Window to last 12 messages"]
        
        ResolveHistory --> DetectRecall{"Query asks about<br/>conversation history?"}
        DetectRecall -->|"Yes"| BuildRecall["session_memory.build_recall_response<br/>Quote exact prior turns from transcript"]
        DetectRecall -->|"No"| DetectSummary{"Query asks to<br/>shorten last answer?"}
        DetectSummary -->|"Yes"| BuildSummary["session_memory.build_summary_response<br/>Extract direct conclusion from last assistant turn"]
        DetectSummary -->|"No"| CheckDocPresence{"Is document_id<br/>present in request?"}
    end

    subgraph Phase2ADocument ["Phase 2A: Active Document Legality Gate (services/document.py)"]
        CheckDocPresence -->|"Yes - Document Active"| ClassifyDoc["classify_document_domain(sample_text)"]
        ClassifyDoc --> DocDomainCheck{"Evaluate Document Domain"}
        DocDomainCheck -->|"Non-Legal (Technical/Scientific)"| RefuseDocNonLegal["Category: non_legal<br/>Synthesize Scope Refusal"]
        DocDomainCheck -->|"Other Legal (Labor/Tax/Penal)"| RedirectDocLegal["Category: other_legal<br/>Synthesize Statutory Redirection"]
        DocDomainCheck -->|"Valid Civil Law Document"| ForceCivilDoc["Document Approved for Analysis"]
    end

    subgraph Phase2BQueryDomain ["Phase 2B: Query Semantic Domain Router (services/domain_router.py)"]
        CheckDocPresence -->|"No Document"| CheckFastPaths{"Check Fast Regex Rules"}
        CheckFastPaths -->|"Illicit Object"| IllicitCat["Category: out_of_domain_illicit<br/>Void under Arts. 1347 and 1409"]
        CheckFastPaths -->|"External Code"| ExternalCat["Category: out_of_domain_legal<br/>Statutory Redirection"]
        CheckFastPaths -->|"Article above 2270"| FakeArtCat["Category: out_of_domain_fake_article<br/>RA 386 ends at Art. 2270"]
        CheckFastPaths -->|"Explicit Article 1-2270"| ForceCivil["Category: in_domain_civil"]
        
        CheckFastPaths -->|"General Inquiry"| EncodeQuery["Vectorize query text with E5 Base"]
        EncodeQuery --> DotCentroids["Compute Cosine Similarity against Precomputed Centroids:<br/>1. Civil Law Centroid<br/>2. Non-Legal Centroid<br/>3. Specialized Legal Centroid"]
        DotCentroids --> CompareSim{"Compare Similarities"}
        CompareSim -->|"Non-legal dominant"| NonLegalCat["Category: out_of_domain_non_legal<br/>Scope Boundary Refusal"]
        CompareSim -->|"Specialized legal dominant"| ExternalCat
        CompareSim -->|"Civil law dominant"| ForceCivil
    end

    subgraph Phase3Ambiguity ["Phase 3: Ambiguity Detection (services/ambiguity.py)"]
        ForceCivil --> CheckBypasses{"Check Fast Ambiguity Bypasses"}
        ForceCivilDoc --> CheckBypasses
        CheckBypasses -->|"Codal lookup"| SkipAmbiguity["is_ambiguous = false"]
        CheckBypasses -->|"Specific article"| SkipAmbiguity
        CheckBypasses -->|"Commercial query"| SkipAmbiguity
        CheckBypasses -->|"Document active"| SkipAmbiguity
        
        CheckBypasses -->|"Dispute with missing facts"| CallLLMAmbiguity["Call local LLM with AMBIGUITY_SYSTEM_PROMPT<br/>Temperature = 0.1"]
        CallLLMAmbiguity --> ParseAmbiguityJSON["Parse structured JSON output"]
        ParseAmbiguityJSON --> EvalConfidence{"is_ambiguous == true<br/>AND confidence at least 0.65?"}
        
        EvalConfidence -->|"No - Sufficient Facts"| SkipAmbiguity
        EvalConfidence -->|"Yes - Missing Facts"| FilterQuestions["Sanitize questions:<br/>Filter police interrogation patterns<br/>Sanitize hallucinated article numbers<br/>Enforce unilingual match with user query"]
        FilterQuestions --> CheckRemainingQ{"Any valid civil questions remaining?"}
        CheckRemainingQ -->|"No"| SkipAmbiguity
        CheckRemainingQ -->|"Yes"| EmitClarificationSSE["Emit SSE clarification_needed<br/>Payload: ClarificationData with questions and options"]
        EmitClarificationSSE --> SaveClarificationDB["Save clarification turn in chat_messages"]
    end
```

---

## 3. Query Augmentation & Legal Expansion Flowchart (Phases 4 and 5)

```mermaid
flowchart TD
    InputCleanQuery["Clean Validated Query<br/>(e.g., Tagalog or English dispute inquiry)"]
    
    subgraph CoreferenceAugmentation ["Phase 4: Coreference Resolution (build_contextual_query)"]
        ScanHistory["Inspect preceding 6 conversational turns"]
        ExtractPriorArticles["Extract previously discussed Civil Code articles: Art. 1191, Art. 2176"]
        ExtractPriorCases["Extract previously referenced G.R. docket numbers"]
        DetectPronouns{"Does query contain<br/>pronouns or follow-up stems?<br/>'it', 'said lease', 'what about'"}
        DetectPronouns -->|"Yes"| AppendContext["Append extracted prior anchors in parentheses"]
        DetectPronouns -->|"No"| KeepQuery["Retain query structure"]
    end

    subgraph LegalExpansion ["Phase 5: Philippine Legal Expansion Engine (expand_legal_query)"]
        MatchPatterns{"Match Query against PHILIPPINE_LEGAL_EXPANSIONS Regex"}
        
        MatchPatterns -->|"Vehicular Torts"| AddVehicular["Inject: quasi delict fault negligence vehicular accident employer vicarious liability damages Arts. 2176, 2180, 2206"]
        MatchPatterns -->|"Physical Assault"| AddAssault["Inject: physical injuries quasi delict assault battery fault negligence civil liability damages Arts. 33, 2176, 2219"]
        MatchPatterns -->|"Unpaid Debt"| AddDebt["Inject: obligations contracts breach delay default mora payment legal interest Arts. 1169, 1170"]
        MatchPatterns -->|"Contract Cancellation"| AddContract["Inject: reciprocal obligations rescission resolution breach damages restitution Arts. 1191, 1170, 1385"]
        MatchPatterns -->|"Lease and Ejectment"| AddLease["Inject: lease contract ejectment unlawful detainer obligations of lessor lessee Arts. 1654, 1673"]
        MatchPatterns -->|"Property Encroachment"| AddProperty["Inject: ownership property possession accession builder in good faith Arts. 448, 546"]
        MatchPatterns -->|"Inheritance and Wills"| AddSuccession["Inject: succession inheritance will legitime compulsory heirs Arts. 777, 887, 960"]
        
        CombineTerms["Concatenate expanded concept hints to search query string"]
    end

    InputCleanQuery --> ScanHistory
    AppendContext --> MatchPatterns
    KeepQuery --> MatchPatterns
    AddVehicular --> CombineTerms
    AddAssault --> CombineTerms
    AddDebt --> CombineTerms
    AddContract --> CombineTerms
    AddLease --> CombineTerms
    AddProperty --> CombineTerms
    AddSuccession --> CombineTerms
    CombineTerms --> AugmentedOutput["Augmented Search Query Ready for Vectorization & Retrieval"]
```

---

## 4. Multi-Stage Hybrid Retrieval & Graph Expansion Flowchart (Phases 6 to 8)

```mermaid
flowchart TD
    AugmentedQuery["Augmented Search Query"]
    
    subgraph Vectorization ["Phase 6: Dense Vectorization"]
        PrependPrefix["Prepend E5 Query Prefix: 'query: '"]
        ComputeVector["Generate 768-dim normalized embedding via SentenceTransformer"]
        AugmentedQuery --> PrependPrefix --> ComputeVector
    end

    subgraph HybridSearch ["Phase 7: Multi-Stage Hybrid Search & SQL RRF Fusion"]
        direction TB
        
        subgraph Stage1Regex ["Stage 7.1: Exact Statutory Regex Matcher"]
            ParseNums["Parse valid article numbers 1-2270 via article_parser.py"]
            ResolveIDs["Resolve exact article IDs: RA386-ART or EO209-ART"]
            FetchExact["Fetch exact rows from document_chunks WHERE parent_id = ANY exact_ids"]
            AssignExactScore["Assign guaranteed 98.5% suitability score"]
            ParseNums --> ResolveIDs --> FetchExact --> AssignExactScore
        end
        
        subgraph Stage2DenseVector ["Stage 7.2: pgvector Cosine Search"]
            HNSWSearch["Query document_chunks via HNSW index<br/>ORDER BY embedding <=> q_emb<br/>LIMIT 50"]
            ComputeVectorRank["Calculate rrf_vector_rank = ROW_NUMBER()"]
            HNSWSearch --> ComputeVectorRank
        end
        
        subgraph Stage3SparseFTS ["Stage 7.3: PostgreSQL Full-Text Search"]
            FilterStopwords["Filter query words against search stopwords"]
            BuildORQuery["Construct websearch_to_tsquery('simple', or_query)"]
            GINSearch["Query document_chunks via GIN index on fts<br/>ORDER BY ts_rank_cd(fts, query) DESC<br/>LIMIT 50"]
            ComputeTextRank["Calculate rrf_text_rank = ROW_NUMBER()"]
            FilterStopwords --> BuildORQuery --> GINSearch --> ComputeTextRank
        end
        
        subgraph Stage4RRFFusion ["Stage 7.4: Reciprocal Rank Fusion (RRF)"]
            FullOuterJoin["FULL OUTER JOIN on chunk_id"]
            CalculateRRF["Calculate RRF Score:<br/>score = (1.0 / (60 + rrf_vector_rank)) + (1.0 / (60 + rrf_text_rank))<br/>ORDER BY rrf_score DESC LIMIT 20"]
            FullOuterJoin --> CalculateRRF
        end
        
        ComputeVector --> Stage2DenseVector
        AugmentedQuery --> Stage1Regex
        AugmentedQuery --> Stage3SparseFTS
        Stage2DenseVector --> FullOuterJoin
        Stage3SparseFTS --> FullOuterJoin
    end

    subgraph GraphExpansion ["Phase 8: Knowledge Graph Expansion"]
        CalculateRRF --> CheckCompanions{"Check STATUTORY_COMPANION_GRAPH<br/>for top 4 primary articles"}
        CheckCompanions -->|"Art. 1191"| PullCompanions["Fetch Arts. 1170, 1169, 1385 from document_chunks"]
        CheckCompanions -->|"Art. 2176"| PullTortCompanions["Fetch Arts. 2180, 2206 from document_chunks"]
        
        CalculateRRF --> LinkCases["Query article_jurisprudence_relations & jurisprudence_cases"]
        LinkCases --> FilterLandmark["Filter top 2 cases per article with non-empty content_summary"]
        FilterLandmark --> AssembleLinkedCases["Format case doctrine chunks with GR docket numbers and decision dates"]
    end

    Stage1Regex --> FinalCandidatePool["Unified Ranked Candidate Pool"]
    CalculateRRF --> FinalCandidatePool
    PullCompanions --> FinalCandidatePool
    PullTortCompanions --> FinalCandidatePool
    AssembleLinkedCases --> FinalCandidatePool
```

---

## 5. Scoring, Stratification & Context Partitioning Flowchart (Phases 9 to 11)

```mermaid
flowchart TD
    CandidatesIn["Unified Candidate Pool (Articles + Cases + Document Chunks)"]
    
    subgraph Phase9Scoring ["Phase 9: Suitability Calibration & Adaptive Noise Pruning"]
        MapSuitability["Map raw cosine similarity to percentage S_i:<br/>S_i = min(98.0, max(52.0, ((sim - 0.20) / 0.58) * 100))<br/>Exact regex matches receive S_exact = 98.5%"]
        SortCandidates["Sort candidates descending by suitability percentage"]
        IdentifyAnchor["Identify top anchor score S_top = S_1"]
        
        EvaluateDrop["Evaluate relative drop Delta_i = (S_top - S_i) / S_top"]
        FilterCondition{"Does chunk satisfy:<br/>S_i at least max(62.0%, S_top - 22.0)?"}
        
        RetainChunk["Retain chunk in context pool (is_in_context = true)"]
        PruneChunk["Prune chunk as retrieval noise (is_in_context = false)"]
        
        CandidatesIn --> MapSuitability --> SortCandidates --> IdentifyAnchor --> EvaluateDrop --> FilterCondition
        FilterCondition -->|"Yes"| RetainChunk
        FilterCondition -->|"No"| PruneChunk
    end

    subgraph Phase10PriorDeduplication ["Phase 10: Multi-Turn Citation Retention & Deduplication"]
        LoadPrior["Load top 6 citations from preceding chat turns"]
        DeduplicateKeys["Generate unique keys:<br/>article_id<br/>case_gr_number<br/>doc_id_snippet"]
        UnionCitations["Union newly retrieved citations with prior citations"]
        DampenPrior["Mark prior unretrieved citations as is_in_context = false<br/>Dampen display suitability by 30%"]
        
        RetainChunk --> UnionCitations
        LoadPrior --> DeduplicateKeys --> UnionCitations --> DampenPrior
    end

    subgraph Phase11HierarchyPartitioning ["Phase 11: Strict Context Hierarchy Partitioning"]
        SeparateTiers["Partition active in-context items into legal tiers:"]
        
        Tier1["Tier 1: Primary Statutory Authority<br/>Philippine Civil Code (RA 386) & Family Code (EO 209)<br/>Verbatim statutory articles"]
        Tier2["Tier 2: Active Document Excerpts<br/>Uploaded contract, deed, or affidavit clauses"]
        Tier3["Tier 3: Secondary Supporting Interpretations<br/>Supreme Court Jurisprudence decisions & doctrines"]
        
        AssemblePromptContext["Assemble prompt CONTEXT string in strict hierarchy:<br/>PRIMARY STATUTORY AUTHORITY to ACTIVE DOCUMENT EXCERPTS to SECONDARY JURISPRUDENCE"]
        
        BudgetCheck{"Context string length<br/>over 205,000 characters?"}
        TruncateSecondary["Truncate secondary jurisprudence cases to top 6<br/>Preserve all primary Civil Code statutory articles"]
        KeepAllContext["Preserve complete assembled context"]
        
        DampenPrior --> SeparateTiers
        SeparateTiers --> Tier1
        SeparateTiers --> Tier2
        SeparateTiers --> Tier3
        Tier1 --> AssemblePromptContext
        Tier2 --> AssemblePromptContext
        Tier3 --> AssemblePromptContext
        AssemblePromptContext --> BudgetCheck
        BudgetCheck -->|"Yes"| TruncateSecondary
        BudgetCheck -->|"No"| KeepAllContext
    end

    TruncateSecondary --> OutputContext["Context String Prepared for Inverted Pyramid Synthesis"]
    KeepAllContext --> OutputContext
```

---

## 6. Prompt Assembly & Server-Sent Events Streaming Flowchart (Phases 12 and 13)

```mermaid
flowchart TD
    subgraph Phase12PromptAssembly ["Phase 12: Inverted Pyramid Prompt Synthesis"]
        ContextReady["Assembled Statutory Context"]
        DetectLang["Detect user query language (English vs Tagalog)"]
        InjectPersona["Inject citizen profile & friendly community paralegal persona"]
        InjectLanguageDirective["Inject strict unilingual directive (zero code-switching)"]
        InjectCivilReassurance["Inject civil law reassurance: disputes concern money/damages, no jail time"]
        InjectStructure["Inject Inverted Pyramid Markdown Structure:<br/>1. Direct Answer & Legal Conclusion<br/>2. Governing Statutory Basis<br/>3. Legal Analysis & Application with Example<br/>4. Practical Next Steps & Remedies"]
        
        ContextReady --> DetectLang --> InjectPersona --> InjectLanguageDirective --> InjectCivilReassurance --> InjectStructure --> FinalSystemPrompt["Final Formulated System Prompt"]
    end

    subgraph Phase13Streaming ["Phase 13: Local LLM Generation & SSE Streaming Engine"]
        FinalSystemPrompt --> OpenStream["Call LM Studio /v1/chat/completions via httpx AsyncClient<br/>stream = true, temperature = 0.3, max_tokens = 4096"]
        
        EmitStatusPrompting["Emit SSE status: prompting"]
        EmitStatusThinking["Emit SSE status: thinking"]
        
        EmitStatusPrompting --> EmitStatusThinking --> OpenStream
        
        subgraph DecoupledQueueWorker ["Decoupled Queue Worker (pipeline_worker & sse_consumer)"]
            TokenGenerator["LM Studio streams JSON chunks"]
            ExtractDelta["Extract choices[0].delta.content"]
            PutQueue["Put chunk into asyncio.Queue"]
            HeartbeatTimeout{"Queue read timeout<br/>at least 12 seconds?"}
            EmitPing["Emit SSE comment: ping and event type: ping<br/>Prevents tunnel/proxy disconnects"]
            ReadQueue["Read item from asyncio.Queue"]
            EmitTextSSE["Emit SSE event type: text with delta_chunk"]
            
            TokenGenerator --> ExtractDelta --> PutQueue --> ReadQueue --> EmitTextSSE
            PutQueue -.-> HeartbeatTimeout
            HeartbeatTimeout -->|"Yes"| EmitPing
        end
        
        OpenStream --> TokenGenerator
        ExtractDelta --> CheckFinish{"finish_reason is stop?"}
        CheckFinish -->|"Yes"| CloseLLMStream["LLM Generation Finished"]
    end

    CloseLLMStream --> EmitCitations["Emit SSE citations and accumulated_citations"]
    EmitCitations --> StartNLIPhase["Trigger Phase 14: Post-Generation Verification"]
```

---

## 7. Post-Generation Verification & Follow-Up Engine Flowchart (Phase 14)

```mermaid
flowchart TD
    StartNLI["Completed Generated Text + Retrieved Statutory Context"]
    
    subgraph FollowupTask ["Concurrent Follow-Up Generation (services/followups.py)"]
        SpawnTask["Spawn background task: generate_followups()"]
        CallGemmaFollowup["Call LM Studio async with followup system prompt"]
        ParseQuestions["Parse exactly 3 clean, unilingual next-step legal questions"]
        CapLength["Cap question length to max 140 chars"]
        EmitFollowupsSSE["Emit SSE event type: follow_ups with suggestions"]
        
        SpawnTask --> CallGemmaFollowup --> ParseQuestions --> CapLength --> EmitFollowupsSSE
    end

    subgraph NeuroSymbolicNLI ["Phase 14: Neuro-Symbolic NLI Engine (services/nli.py)"]
        direction TB
        EmitStatusNLI["Emit SSE status: evaluating_nli<br/>Emit legal_analytics with nli_status = Evaluating"]
        DecomposeClaims["1. Atomic Proposition Decomposition:<br/>Split generated answer into individual assertions S = s_1 to s_n"]
        ParseModality["2. Deontic Modality & Polarity Parsing:<br/>Classify Obligation (shall), Permission (may), Prohibition (cannot)"]
        
        EmitStatusNLI --> DecomposeClaims --> ParseModality --> EvaluateClaimsLoop["For each atomic claim s_i"]
        
        subgraph ClaimEvaluation ["Claim-Level Arbitration Truth Table"]
            CheckAnchor{"Rule 1: Does claim cite Article X<br/>absent from retrieved context?"}
            MarkNeutralAnchor["Verdict: Neutral (Citation Guardrail)"]
            
            CheckDeontic{"Rule 2: Does claim contradict<br/>statutory deontic modality or polarity?"}
            MarkContradicted["Verdict: Contradicted (Symbolic Veto Override)"]
            
            CheckHornClause{"Rule 3: High asymmetric lexical<br/>containment in context premises?"}
            MarkEntailedFast["Verdict: Entailed (Fast-Path Symbolic)"]
            
            CallGemmaNLI["Neural Tier: Call Gemma 4 E4B in LM Studio<br/>Evaluate semantic entailment & statutory deduction"]
            GemmaVerdict{"Gemma NLI<br/>Prediction"}
            
            MarkEntailedNeural["Verdict: Entailed (Neural Upgrade)"]
            MarkNeutralNeural["Verdict: Neutral (Unsubstantiated)"]
            MarkContradictedNeural["Verdict: Contradicted (Semantic Discrepancy)"]
            
            CheckAnchor -->|"Yes"| MarkNeutralAnchor
            CheckAnchor -->|"No"| CheckDeontic
            CheckDeontic -->|"Yes"| MarkContradicted
            CheckDeontic -->|"No"| CheckHornClause
            CheckHornClause -->|"Yes - Match at least 50%"| MarkEntailedFast
            CheckHornClause -->|"No - Borderline"| CallGemmaNLI
            
            CallGemmaNLI --> GemmaVerdict
            GemmaVerdict -->|"Entailed"| MarkEntailedNeural
            GemmaVerdict -->|"Neutral or Timeout"| MarkNeutralNeural
            GemmaVerdict -->|"Contradicted"| MarkContradictedNeural
        end
        
        EvaluateClaimsLoop --> ClaimEvaluation
        ClaimEvaluation --> ComputeScores["Aggregate Arbitrated Verdicts:<br/>N_E = entailed, N_N = neutral, N_C = contradicted<br/><br/>1. Net Faithfulness: F_net = max(0, (N_E - N_C) / S_total) * 100%<br/>2. Weighted Score: F_hybrid = (N_E + 0.35*N_N - 2.0*N_C) / S_total<br/>3. Grounding Status: Grounded if F_net at least 80% and N_C == 0"]
        
        ComputeScores --> EmitAnalyticsSSE["Emit SSE event type: legal_analytics<br/>Payload: nli_score, nli_status, claims_total, claims_entailed"]
    end

    StartNLI --> SpawnTask
    StartNLI --> EmitStatusNLI
    
    EmitAnalyticsSSE --> EmitDoneSSE["Emit SSE event type: done<br/>Closes Client SSE Stream"]
    EmitFollowupsSSE --> EmitDoneSSE
    
    EmitDoneSSE --> PersistData["Asynchronously save message, citations, and analytics to chat_messages"]
    PersistData --> CheckSummaryRefresh{"Transcript length at least 14<br/>and interval reached?"}
    CheckSummaryRefresh -->|"Yes"| RefreshSummary["Call LM Studio to summarize transcript<br/>UPDATE chat_sessions SET summary = new_summary"]
    CheckSummaryRefresh -->|"No"| ReleaseVRAMSlot["finally: queue_manager.release_slot(ticket)<br/>Wake next FIFO waiter in line"]
    RefreshSummary --> ReleaseVRAMSlot
    ReleaseVRAMSlot --> FinishedTask["Pipeline Complete"]
```

---

## 8. Separation of Concerns Architecture Matrix

| Architectural Layer / Concern | Responsible Code Module(s) | Primary Invariant / Single Responsibility | Key Inputs | Clean Outputs / Interfaces |
| :--- | :--- | :--- | :--- | :--- |
| **1. Presentation & Transport Gateway** | `backend-node/src/routes/chat.js`<br/>`stream_jobs.py` | HTTP/SSE transport negotiation, client token validation, reconnectable job ticket creation. | Raw HTTP Request, Auth Headers | `job_id`, SSE stream handle, keepalive pings |
| **2. Session State & Fast-Path Memory** | `services/memory.py` | Transcript windowing (last 12 turns), user-level data isolation, and instant deterministic meta-query resolution. | `session_id`, `user_id`, query string | Canonical history, deterministic recall/summary (zero GPU cost) |
| **3. Hardware Resource & Concurrency Governor** | `core/queue_manager.py`<br/>`services/llm_client.py` | Strict 6GB VRAM hardware safety (`max_concurrent = 1`), model health validation, and FIFO request scheduling. | Ingress ticket request | Execution slot acquisition, queue position `#k` SSE events |
| **4. Cognitive Scope & Ambiguity Guardrails** | `services/document.py`<br/>`services/domain_router.py`<br/>`services/ambiguity.py` | Gating inputs to Philippine Civil Law (RA 386 / EO 209), sanitizing external statute hallucinations, and clarifying under-specified disputes. | Query text, document chunks, session history | Validated civil intent OR graceful scope refusal / statutory redirection / interactive clarification |
| **5. Query Engineering & Legal Expansion** | `main.py` (`build_contextual_query`, `expand_legal_query`) | Resolving conversational pronouns and augmenting colloquial Tagalog/Taglish disputes with statutory legal anchors. | Raw query, prior 6 turns, document name | Contextualized augmented search query |
| **6. Hybrid Knowledge Retrieval & Graph Expansion** | `main.py` (`search_with_embedding`) | High-recall hybrid information retrieval combining dense semantic vectors, sparse full-text search, exact statutory regex, and graph traversal. | Augmented query string, 768-dim E5 vector | Merged candidate pool (statutes, contracts, Supreme Court cases) |
| **7. Evidence Calibration & Context Stratification** | `main.py` (`rank_and_stratify_citations`) | Calibrating suitability scores to human-interpretable percentages, pruning semantic noise, and partitioning active context into 3 strict legal tiers. | Candidate citations, multi-turn prior citations | Calibrated citations, partitioned context string (Tier 1 > Tier 2 > Tier 3) |
| **8. Inverted Pyramid Synthesis & Decoupled Streaming** | `services/llm_client.py`<br/>`main.py` (`pipeline_worker`) | Assembling citizen-tailored inverted pyramid prompts and decoupling GPU token generation from client network latency via async buffers. | System prompt, user query, partitioned context | Delta character tokens (`text`), reconciled citations |
| **9. Neuro-Symbolic Verification & Faithfulness Audit** | `services/nli.py`<br/>`services/followups.py` | Decomposing claims, enforcing statutory modality guardrails, running neural entailment checks, and generating unilingual follow-up questions. | Generated answer text, retrieved context, user language | Faithfulness analytics (`nli_score`, `nli_status`), 3 follow-up suggestions |
| **10. Persistence, Analytics & Hardware Lifecycle** | `main.py` (`finally:` block)<br/>PostgreSQL / Supabase | Asynchronous conversation persistence, background session summary updates, and guaranteed hardware VRAM slot release. | Final answer, citations, NLI payload, queue ticket | Persisted database records, released VRAM slot waking next FIFO waiter |

