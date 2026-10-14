# CIVIL-LEX: Dedicated RAG Pipeline Flowcharts & Execution Logic

This document provides exhaustive, granular flowcharts detailing every phase of the CIVIL-LEX bilingual Retrieval-Augmented Generation (RAG) pipeline for Philippine Civil Law.

---

## 1. Complete RAG Pipeline Master Flowchart (14 Distinct Phases)

```mermaid
flowchart TD
    Start(["User Submits Prompt via Web UI"]) --> QueueGate{"Resource Queue<br/>QueryQueueManager<br/>Active is 0?"}
    
    QueueGate -->|"No - Slot Busy"| Enqueue["Wait in FIFO Queue<br/>Emit SSE status: queued<br/>Display Position in UI"]
    Enqueue --> AwaitSlot["Await Concurrency Slot Event"]
    AwaitSlot --> AcquireSlot["Acquire Slot<br/>Emit SSE status: embedding"]
    QueueGate -->|"Yes - Slot Free"| AcquireSlot
    
    AcquireSlot --> P1["Phase 1: History Windowing & Session Memory<br/>Load canonical turns from chat_messages by session_id"]
    
    P1 --> CheckMetaQueries{"Meta-Query Check"}
    CheckMetaQueries -->|"History Recall Query"| HistoryRecall["Extract prior queries from transcript<br/>Emit deterministic recall response<br/>Emit SSE done"]
    CheckMetaQueries -->|"Summary Request Query"| SummaryRecall["Extract direct conclusion from last assistant turn<br/>Emit deterministic summary response<br/>Emit SSE done"]
    CheckMetaQueries -->|"Standard Legal Inquiry"| P2["Phase 2: Intent Classification & Semantic Domain Router<br/>services/domain_router.py"]
    
    P2 --> DomainCheck{"Evaluate Query Category"}
    DomainCheck -->|"Out of Domain - Non-Legal"| RefuseNonLegal["Synthesize Civil Code Scope Refusal<br/>List supported civil topics<br/>Emit SSE done"]
    DomainCheck -->|"Out of Domain - Other Legal"| RedirectLegal["Synthesize Statutory Redirection<br/>Identify competent agency: BIR, DOLE, PNP<br/>Emit SSE done"]
    DomainCheck -->|"Out of Domain - Fake Article"| RefuseFakeArticle["Inform user Civil Code concludes at Art. 2270<br/>Emit SSE done"]
    DomainCheck -->|"Out of Domain - Illicit Object"| RefuseIllicit["Refuse illegal object under Arts. 1347 and 1409<br/>Emit SSE done"]
    
    DomainCheck -->|"In-Domain Civil Law"| P3["Phase 3: Pre-Retrieval Ambiguity Detection<br/>services/ambiguity.py"]
    
    P3 --> AmbiguityCheck{"Critical Legal<br/>Facts Missing?"}
    AmbiguityCheck -->|"Yes - Ambiguous Dispute"| EmitClarification["Emit SSE clarification_needed<br/>Send interactive questions & options<br/>Save state and Emit SSE done"]
    AmbiguityCheck -->|"No - Sufficient Facts"| P4["Phase 4: Conversational Coreference & Context Augmentation<br/>Resolve pronouns using preceding 6 turns"]
    
    P4 --> P5["Phase 5: Philippine Legal Expansion Engine<br/>Map Tagalog/Taglish expressions to statutory concepts"]
    P5 --> P6["Phase 6: Dense Query Vectorization<br/>Prepend 'query: ' prefix to intfloat/multilingual-e5-base"]
    P6 --> P7["Phase 7: Multi-Stage Hybrid Retrieval<br/>Exact Match + HNSW Cosine + PostgreSQL GIN FTS + RRF k=60"]
    P7 --> P8["Phase 8: Knowledge Graph Expansion<br/>Statutory Companion Graph + Linked Supreme Court Cases"]
    P8 --> P9["Phase 9: Suitability Scoring & Adaptive Noise Pruning<br/>Drop delta over 22% from top anchor; absolute floor = 62.0%"]
    P9 --> P10["Phase 10: Multi-Turn Citation Retention & Deduplication<br/>Union with top 6 prior citations, dampening non-context items"]
    P10 --> P11["Phase 11: Strict Context Hierarchy Partitioning<br/>Statutory Primacy over Document Excerpts over Jurisprudence"]
    P11 --> P12["Phase 12: Inverted Pyramid Prompt Synthesis<br/>Direct Answer to Statutory Basis to Analysis to Next Steps"]
    P12 --> P13["Phase 13: Local LLM Generation & Server-Sent Events Streaming<br/>Stream delta tokens via LM Studio Gemma 4; keepalive pings"]
    P13 --> P14["Phase 14: Post-Generation Neuro-Symbolic NLI Verification & Follow-Ups<br/>Symbolic veto + Gemma arbitration; generate 3 unilingual follow-ups"]
    
    P14 --> PersistDB["Save assistant message, citations & analytics to chat_messages"]
    PersistDB --> ReleaseSlot["Release QueryQueueManager Slot<br/>Wake next FIFO waiter in line"]
    ReleaseSlot --> End(["Complete"])
```

---

## 2. Pre-Retrieval Gating Flowchart (Phases 1 to 3)

This flowchart details session memory loading, domain classification, and interactive ambiguity resolution:

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
        DetectSummary -->|"No"| ProceedToDomain["Proceed to Domain Router"]
    end

    subgraph Phase2Domain ["Phase 2: Semantic Domain Router (services/domain_router.py)"]
        ProceedToDomain --> CheckFastPaths{"Check Fast Regex Rules"}
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
    CheckSummaryRefresh -->|"No"| FinishedTask["Pipeline Complete"]
    RefreshSummary --> FinishedTask
```
