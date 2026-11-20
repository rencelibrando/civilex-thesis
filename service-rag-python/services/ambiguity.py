import re
import json
import logging
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Any, Tuple
import numpy as np

from core.article_parser import parse_article_numbers, parse_gr_numbers
from services.domain_router import get_shared_domain_router, strip_conversational_preamble

logger = logging.getLogger(__name__)


@dataclass
class ClarificationQuestion:
    """A single clarification question with selectable options."""
    id: str
    question: str
    options: List[str]
    allows_free_text: bool = True
    context_hint: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class AmbiguityResult:
    """Result of ambiguity detection on a user query."""
    is_ambiguous: bool = False
    confidence: float = 0.0
    category: str = ""
    questions: List[ClarificationQuestion] = field(default_factory=list)
    original_query: str = ""
    reasoning: str = ""

    def to_dict(self) -> dict:
        return {
            "is_ambiguous": self.is_ambiguous,
            "confidence": self.confidence,
            "category": self.category,
            "questions": [q.to_dict() for q in self.questions],
            "original_query": self.original_query,
            "reasoning": self.reasoning,
        }


# Zero-regex prototype banks for Semantic Embedding Ambiguity Classification
VAGUE_QUERY_PROTOTYPES: List[str] = [
    "query: Anong pwedeng ikaso sa akin",
    "query: Ano ang pwede kong ikaso o idemanda sa kanya",
    "query: Can I be sued or what case can be filed against me",
    "query: Can I sue someone or file a civil case against my neighbor or spouse",
    "query: May habol ba ako o ano ang pwede kong gawin sa batas",
    "query: May problema o hindi pagkakaintindihan kami sa kontrata o kasunduan ano ang gagawin ko",
    "query: We have a dispute issue or problem with an agreement or property transaction can I cancel or sue",
    "query: My family or neighbor has a dispute over our house or land what legal action applies",
    "query: What are the articles of",
    "query: What article are applicable to the case of with",
    "query: What are the legal grounds for",
    "query: What is the law or provision about",
    "query: Ano ang batas o artikulo tungkol sa",
    "query: Paano kung may nangyari ano ang batas para dito",
    "query: Ang sakit ng katawan o ulo ko ano pwede ko ikaso sa asawa ko o kapitbahay ko",
    "query: Need legal advice about my problem can I file a lawsuit or claim damages",
    "query: Ano ang pananagutan ko o pwede ba akong makasuhan sa ginawa ko",
    "query: Pinirmahan ko yung dokumento o kasunduan pero may problema pwede ba ipawalang-bisa",
    "query: May away o alitan kami ng kapitbahay o pamilya ko ano pwede ikaso",
]

CLEAR_QUERY_PROTOTYPES: List[str] = [
    "query: Nag nakaw ako ng gamit sa school o opisina ano ang pwede ikaso sa akin",
    "query: Hindi nagbayad ng utang ang kaibigan ko sa napagkasunduang petsa ano pwede kong gawin",
    "query: Lalaki o babae ako nangabit o nagtaksil ang asawa ko ano ang pwede kong gawin sa batas",
    "query: My neighbor built a fence that encroached or crossed onto my titled land what can I do",
    "query: The landlord evicted me without notice or court order or tenant failed to pay monthly rent",
    "query: Nabangga ang sasakyan ko ng lasing na driver o nakagat ng aso sino ang mananagot sa danyos",
    "query: The contractor failed to finish or abandoned the house construction despite receiving payment",
    "query: Namatay ang magulang o tatay namin nang walang iniwang last will o testamento paano ang hatian sa lupa",
    "query: Bumili ako ng sasakyan cellphone o gamit na may sira o hidden defect pwede ko ba ipa-refund",
    "query: What are the essential requisites or elements of a valid contract or obligation under the Civil Code",
    "query: Can a person claim damages if someone caused injury or harm due to negligence or quasi-delict",
    "query: Pwede ba mangayo og bayad kung ang usa ka tawo nakapahinabo og kadaot tungod sa iyang pagpabaya",
    "query: Sinampal o sinaktan ako ng kaklase o katrabaho ko habang nagkaklase ano ang pwede ikaso",
    "query: Ayaw ibalik ng landlord ang security deposit ko o may sira ang inuupahang bahay na ayaw ipagawa",
    "query: Binenta ng kapatid o kuya ko ang minanang lupa o bahay ng magulang namin nang walang pahintulot",
    "query: What is the difference between Civil Code articles or grounds for psychological incapacity under Article 36",
    "query: Can spouses donate property to each other during marriage or when is a debtor in legal delay",
    "query: Ano ang karapatan ng builder in good faith o prescriptive period ng kontrata sa Civil Code",
]

# StandardScaler (mu, sigma) and L2-Regularized Logistic Regression weights (w, b)
# Fitted strictly on the training split with 100% zero-regex embedding features
FEATURE_NAMES: Tuple[str, ...] = (
    "vague_peak",
    "clear_peak",
    "margin_top1",
    "margin_top2",
    "margin_top3",
    "token_specificity",
    "has_explicit_art_or_followup",
)
SCALER_MEAN = np.array([0.081007, 0.063059, 0.017948, 0.020091, 0.018733, 0.738782, 0.076923], dtype=np.float64)
SCALER_STD = np.array([0.039260, 0.030973, 0.061342, 0.050284, 0.044188, 0.249481, 0.266469], dtype=np.float64)
LOGREG_WEIGHTS = np.array([0.641538, -0.167727, 0.495292, 0.789082, 0.830954, 0.174153, -0.273050], dtype=np.float64)
LOGREG_BIAS = -0.618508
AMBIGUITY_PROB_THRESHOLD = 0.50
LLM_CANDIDATE_THRESHOLD = 0.24

TAGALOG_CUE_RE = re.compile(
    r'\b(?:ano|anong|paano|pwede|puwede|maaari|ba|ko|ako|akin|sakin|kami|namin|asawa|kapitbahay|kontrata|kasunduan|lupa|utang|kaso|ikaso|batas|artikulo|ng|sa|mga|ang|kung)\b',
    re.IGNORECASE,
)
ENGLISH_QUESTION_RE = re.compile(
    r'^(?:did\s+you|are\s+there|what\s+is|what\s+was|when\s+did|who\s+is|do\s+you|have\s+you|is\s+there|was\s+there|could\s+you|can\s+you)\b',
    re.IGNORECASE,
)
TAGALOG_RESPONSE_MARKERS_RE = re.compile(
    r'\b(?:paki-?specify|ano\s+po|tungkol\s+ba|maaari\s+(?:po|niyo|bang)|halimbawa|sitwasyon|ninyo|kailangan|pagmamay-ari|kasunduan|kapitbahay|asawa|pangyayari|batas\s+o\s+aksyon)\b',
    re.IGNORECASE,
)

_prototype_cache: Dict[int, Tuple[np.ndarray, np.ndarray]] = {}


def _get_prototype_matrices(embedder: Any) -> Tuple[np.ndarray, np.ndarray]:
    """Lazily encodes and caches normalized vague and clear prototype matrices per embedder instance."""
    key = id(embedder)
    cached = _prototype_cache.get(key)
    if cached is not None:
        return cached
    v_vecs = embedder.encode(VAGUE_QUERY_PROTOTYPES, normalize_embeddings=True, show_progress_bar=False)
    c_vecs = embedder.encode(CLEAR_QUERY_PROTOTYPES, normalize_embeddings=True, show_progress_bar=False)
    _prototype_cache[key] = (v_vecs, c_vecs)
    return v_vecs, c_vecs


def _has_substantive_user_history(history: Optional[list]) -> bool:
    """Returns True only when history contains at least one prior user turn (ignoring synthetic assistant greetings)."""
    if not history:
        return False
    for m in history:
        if hasattr(m, "role"):
            role = getattr(m, "role", "")
            content = getattr(m, "content", "")
        elif isinstance(m, dict):
            role = m.get("role", "")
            content = m.get("content", "")
        else:
            continue
        if role == "user" and str(content).strip():
            return True
    return False


def extract_ambiguity_features(
    query: str,
    query_embedding: Optional[np.ndarray] = None,
    has_history: bool = False,
    embedder: Optional[Any] = None,
) -> np.ndarray:
    """Extracts the 7-dimensional zero-regex semantic embedding feature vector for ambiguity classification."""
    q_clean = strip_conversational_preamble(query)
    n_tokens = len(q_clean.split())
    token_spec = min(1.0, n_tokens / 12.0)
    has_explicit_art = bool(parse_article_numbers(q_clean))

    active_router = get_shared_domain_router()
    active_embedder = embedder or (active_router.embedder if active_router is not None else None)

    if active_embedder is not None:
        v_vecs, c_vecs = _get_prototype_matrices(active_embedder)
        if query_embedding is not None:
            q_vec = query_embedding
        elif active_router is not None and active_router.embedder is active_embedder:
            q_vec = active_router.encode_query(q_clean)
        else:
            q_vec = active_embedder.encode(f"query: {q_clean}", normalize_embeddings=True, show_progress_bar=False)

        if q_vec.shape[-1] == v_vecs.shape[-1]:
            v_sims = np.sort(np.dot(v_vecs, q_vec))
            c_sims = np.sort(np.dot(c_vecs, q_vec))
            bg_mean = float(0.5 * (np.mean(v_sims) + np.mean(c_sims)))
            vague_peak = float(v_sims[-1] - bg_mean)
            clear_peak = float(c_sims[-1] - bg_mean)
            margin_top1 = float(v_sims[-1] - c_sims[-1])
            margin_top2 = float(np.mean(v_sims[-2:]) - np.mean(c_sims[-2:]))
            margin_top3 = float(np.mean(v_sims[-3:]) - np.mean(c_sims[-3:]))
            has_art_or_followup = 1.0 if (has_explicit_art or (has_history and margin_top2 < 0.0)) else 0.0
            return np.array([
                vague_peak,
                clear_peak,
                margin_top1,
                margin_top2,
                margin_top3,
                token_spec,
                has_art_or_followup,
            ], dtype=np.float64)

    synth_margin = -0.06 if (has_explicit_art or has_history or n_tokens >= 8) else 0.04
    return np.array([
        max(0.04, 0.07 + synth_margin),
        max(0.04, 0.07 - synth_margin),
        synth_margin,
        synth_margin,
        synth_margin,
        token_spec,
        1.0 if (has_explicit_art or has_history) else 0.0,
    ], dtype=np.float64)


def predict_ambiguity_probability(
    query: str,
    query_embedding: Optional[np.ndarray] = None,
    has_history: bool = False,
    embedder: Optional[Any] = None,
) -> Tuple[float, Dict[str, float]]:
    """Computes calibrated logistic regression probability P(is_ambiguous | query, history) with zero regexes."""
    x = extract_ambiguity_features(
        query,
        query_embedding=query_embedding,
        has_history=has_history,
        embedder=embedder,
    )
    x_std = (x - SCALER_MEAN) / SCALER_STD
    logit = float(np.dot(x_std, LOGREG_WEIGHTS) + LOGREG_BIAS)
    prob = float(1.0 / (1.0 + np.exp(-np.clip(logit, -30.0, 30.0))))
    feature_dict = {name: round(float(val), 6) for name, val in zip(FEATURE_NAMES, x)}
    feature_dict["probability"] = round(prob, 4)
    return prob, feature_dict


AMBIGUITY_SYSTEM_PROMPT = """You are a Philippine Civil Law query analyzer for CIVIL-LEX.
Determine whether the user's query is SO VAGUE OR INCOMPLETE that the core factual event, cause of action, or legal topic cannot be identified without asking the user a clarifying question first.

RESPOND ONLY WITH VALID JSON. Do not include markdown codeblocks or commentary outside the JSON.
IMPORTANT: Never put unescaped double quotes inside JSON values; use single quotes (') for any quotes inside text.

SUFFICIENT CAUSE-OF-ACTION STANDARD (CRITICAL):
1. NOT AMBIGUOUS (is_ambiguous: false, questions: []):
   - ANY query that ALREADY states WHAT happened (the underlying act, event, or breach — e.g., pagnanakaw/theft of items, hindi nagbayad ng utang/unpaid debt or loan, nangabit o nagtaksil ang asawa/marital infidelity, lumagpas na bakod/property encroachment, hindi nagbayad ng upa o pinalayas/lease eviction, sirang gamit na nabili/defective item purchased, aksidente o banggaan/car accident or injury, pananakit/physical assault, namatay na walang testamento/death of parent without a will) is NOT AMBIGUOUS.
   - Missing secondary details (such as whether an agreement was written or verbal, exact dates, or exact peso amounts) NEVER make a query ambiguous. The main legal response will explain both written and verbal rules directly.
   - Statutory, conceptual, definitional, jurisprudence, or general legal rule queries (e.g., 'What are the requisites of a valid contract?', 'Can a landlord evict a tenant without a court order?', 'What are the related jurisprudences for Article 56?', 'Cases under Article 1191').
   - ANY query that cites a specific Civil Code / Family Code article number (e.g., Article 56, Art. 1191) or Supreme Court G.R. number is ALWAYS NOT AMBIGUOUS. (Note: Philippine Civil Code articles are numbered continuously from Article 1 to 2270; never ask which book an article number belongs to.)
   - Follow-ups continuing an active conversation history.

2. AMBIGUOUS (is_ambiguous: true):
   - ONLY mark is_ambiguous: true when the CORE ACT, EVENT, OR LEGAL TOPIC itself is missing or unidentifiable:
     a) Incomplete or truncated sentence fragments where the subject or case is missing (e.g., 'what article are applicable to the case of with', 'what are the legal grounds for', 'what are the articles of', 'ano ang batas tungkol sa').
     b) Bare liability or lawsuit questions with zero factual event (e.g., 'Can I be sued?', 'Can I sue my neighbor?', 'Anong pwedeng ikaso sakin?', 'May habol ba ako?').
     c) Generic dispute or contract problem statements that omit what went wrong (e.g., 'We had an issue with our agreement, can I cancel it?', 'May problema kami sa kontrata, ano gagawin ko?', 'Ang sakit ng pwet ko ano pwede ko ikaso sa asawa ko').
   - Provide 1 to 2 concise clarification questions asking WHAT specific incident, breach, or legal topic occurred, with 3 to 4 concrete everyday options.
   - Keep each question under 22 words and each context_hint under 15 words.

STRICT CIVIL LAW BOUNDARY:
- Never ask police, forensic, or criminal interrogation questions (never ask about eyewitnesses/saksi, weapons/armas, police blotter, or arrests).
- Never invent Civil Code article numbers above Article 2270.

CRITICAL UNILINGUAL LANGUAGE MATCH RULE:
- Match the language of the user's query 100% with ZERO code-switching:
  * If the user's query is in English (even if it is a short or incomplete English fragment like 'what article are applicable to the case of with' or 'what are the legal grounds for'): You MUST write 'reasoning', every 'question', every 'option', and 'context_hint' 100% in plain simple English. NEVER output Tagalog on an English query!
  * If the user's query is in Tagalog/Filipino: You MUST write 'reasoning', every 'question', every 'option', and 'context_hint' 100% in simple everyday Tagalog. NEVER output English questions on a Tagalog query!

JSON SCHEMA:
{
  "is_ambiguous": true or false,
  "confidence": 0.0 to 1.0,
  "category": "missing_facts" or "",
  "reasoning": "Brief explanation in the user's exact language",
  "questions": [
    {
      "id": "q1",
      "question": "Clarification question in the user's exact language",
      "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
      "context_hint": "Brief reason why this matters"
    }
  ]
}"""


def _build_unilingual_fallback_clarification(query: str, prob: float) -> AmbiguityResult:
    """Provides language-matched clarification when a vague/incomplete query lacks valid unilingual LLM JSON."""
    is_tl = len(TAGALOG_CUE_RE.findall(query)) >= 1
    if is_tl:
        q = ClarificationQuestion(
            id="q1",
            question="Tungkol sa anong partikular na pangyayari o usaping sibil ang iyong tanong?",
            options=[
                "Utang o kontratang hindi tinupad (Obligations & Contracts)",
                "Upa, lupa, o ari-arian (Property & Lease)",
                "Pamilya, kasal, o mana (Family Code & Succession)",
                "Pinsala o aksidente na nakasakit sa tao o gamit (Damages / Quasi-Delict)",
            ],
            allows_free_text=True,
            context_hint="Mahalaga ito upang matukoy ang tamang artikulo sa Civil Code o Family Code.",
        )
        reasoning = "Kailangan po ng kaunting detalye kung anong partikular na pangyayari o paksa ang tinutukoy upang maibigay ang tamang batas."
    else:
        q = ClarificationQuestion(
            id="q1",
            question="What specific legal situation, incident, or Civil Code topic are you asking about?",
            options=[
                "Unpaid loan or breach of contract (Obligations & Contracts)",
                "Lease, rent, or land/property dispute (Property & Lease)",
                "Marriage, family relations, or inheritance (Family & Succession)",
                "Personal injury or property damage caused by fault/negligence (Damages)",
            ],
            allows_free_text=True,
            context_hint="Knowing the core event or topic identifies the governing Civil Code provisions.",
        )
        reasoning = "Your question appears incomplete or missing the core facts. Please specify the legal situation, incident, or topic you are referring to so I can identify the applicable articles."

    return AmbiguityResult(
        is_ambiguous=True,
        confidence=max(0.80, round(prob, 2)),
        category="missing_facts",
        questions=[q],
        original_query=query,
        reasoning=reasoning,
    )


def _fallback_extract_ambiguity(raw: str) -> Optional[dict]:
    """Fallback extraction if strict JSON decoding fails on LLM output."""
    try:
        ambig_m = re.search(r'"is_ambiguous"\s*:\s*(true|false)', raw, re.IGNORECASE)
        if not ambig_m:
            return None
        is_ambig = ambig_m.group(1).lower() == "true"
        conf_m = re.search(r'"confidence"\s*:\s*([0-9.]+)', raw)
        confidence = float(conf_m.group(1)) if conf_m else (0.85 if is_ambig else 0.0)
        cat_m = re.search(r'"category"\s*:\s*"([^"]*)"', raw)
        category = cat_m.group(1) if cat_m else ("missing_facts" if is_ambig else "")
        reason_m = re.search(r'"reasoning"\s*:\s*"(.*?)"(?:\s*,\s*"\w+"|\s*\})', raw, re.DOTALL)
        reasoning = reason_m.group(1).strip() if reason_m else ""

        questions = []
        if is_ambig:
            q_blocks = re.findall(r'\{[^{}]*?"question"[^{}]*?\}', raw)
            for idx, block in enumerate(q_blocks):
                qm = re.search(r'"question"\s*:\s*"(.*?)"(?:\s*,\s*"\w+"|\s*\})', block, re.DOTALL)
                hint_m = re.search(r'"context_hint"\s*:\s*"(.*?)"(?:\s*,\s*"\w+"|\s*\})', block, re.DOTALL)
                options = []
                opt_section = re.search(r'"options"\s*:\s*\[(.*?)\]', block, re.DOTALL)
                if opt_section:
                    options = re.findall(r'"(.*?)"', opt_section.group(1))
                if qm:
                    questions.append({
                        "id": f"q{idx + 1}",
                        "question": qm.group(1).strip(),
                        "options": [o.strip() for o in options if o.strip()] or ["Yes", "No", "Not sure"],
                        "context_hint": hint_m.group(1).strip() if hint_m else "",
                    })

        return {
            "is_ambiguous": is_ambig,
            "confidence": confidence,
            "category": category,
            "reasoning": reasoning,
            "questions": questions,
        }
    except Exception as e:
        logger.warning(f"Fallback ambiguity extraction failed: {e}")
        return None


def _parse_llm_json(raw: str) -> Optional[dict]:
    """Extracts and parses JSON object from LLM output, with fallback cleaning."""
    if not raw:
        return None
    cleaned = raw.strip()
    cleaned = re.sub(r"<(?:thought|think)>[\s\S]*?</(?:thought|think)>", "", cleaned).strip()

    code_block = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", cleaned)
    if code_block:
        json_str = code_block.group(1).strip()
    else:
        cleaned_no_fence = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned_no_fence = re.sub(r"\s*```$", "", cleaned_no_fence)
        match = re.search(r"\{[\s\S]*\}", cleaned_no_fence)
        if not match:
            logger.warning(f"LLM ambiguity response contained no JSON object: {cleaned[:150]}")
            return None
        json_str = match.group()

    try:
        return json.loads(json_str, strict=False)
    except json.JSONDecodeError:
        pass
    try:
        fixed = re.sub(r",\s*([\]\}])", r"\1", json_str)
        return json.loads(fixed, strict=False)
    except json.JSONDecodeError:
        pass
    try:
        last_brace = json_str.rfind("}")
        if last_brace != -1:
            truncated = json_str[: last_brace + 1]
            if '"questions"' in truncated and truncated.count("[") > truncated.count("]"):
                truncated += "\n]"
            if truncated.count("{") > truncated.count("}"):
                truncated += "\n}"
            fixed = re.sub(r",\s*([\]\}])", r"\1", truncated)
            return json.loads(fixed, strict=False)
    except json.JSONDecodeError:
        pass
    fallback = _fallback_extract_ambiguity(json_str)
    if fallback:
        return fallback

    logger.warning(f"Failed to parse LLM ambiguity JSON: {cleaned[:150]}")
    return None


async def detect_ambiguity(
    query: str,
    history: Optional[list] = None,
    document_id: Optional[str] = None,
    use_llm: bool = True,
    query_embedding: Optional[np.ndarray] = None,
) -> AmbiguityResult:
    """
    Zero-regex ML + LLM ensemble ambiguity detector:
    1. Computes zero-regex semantic prototype probability P_ML(vague | query, history).
    2. For candidate queries (P_ML >= 0.18), invokes the LLM under the Sufficient Cause-of-Action
       Standard so the LLM directly evaluates whether the query is vague/incomplete or clear.
    3. Enforces bidirectional unilingual consistency (English query -> English questions;
       Tagalog query -> Tagalog questions).
    """
    q_clean = query.strip()
    if not q_clean or document_id:
        return AmbiguityResult(original_query=q_clean)

    if len(q_clean.split()) <= 2:
        return AmbiguityResult(original_query=q_clean)

    # Explicit article or G.R. number queries already specify their statutory/case target
    if parse_article_numbers(q_clean, allow_bare_numbers=False) or parse_gr_numbers(q_clean):
        return AmbiguityResult(
            is_ambiguous=False,
            confidence=1.0,
            category="",
            original_query=q_clean,
            reasoning="Query explicitly cites a statutory article or Supreme Court G.R. number.",
        )

    has_user_history = _has_substantive_user_history(history)
    prob_vague, feat_info = predict_ambiguity_probability(
        q_clean,
        query_embedding=query_embedding,
        has_history=has_user_history,
    )

    if prob_vague < LLM_CANDIDATE_THRESHOLD:
        logger.info(
            "Zero-regex ML gate passed query as CLEAR (p_vague=%.3f, margin_top2=%.4f)",
            prob_vague,
            feat_info.get("margin_top2", 0.0),
        )
        return AmbiguityResult(
            is_ambiguous=False,
            confidence=round(1.0 - prob_vague, 4),
            category="",
            original_query=q_clean,
            reasoning="Query states a clear factual cause of action or legal inquiry.",
        )

    if not use_llm:
        if prob_vague >= AMBIGUITY_PROB_THRESHOLD:
            return _build_unilingual_fallback_clarification(q_clean, prob_vague)
        return AmbiguityResult(original_query=q_clean)

    history_context = ""
    if has_user_history and history:
        recent = history[-6:] if len(history) > 6 else history
        lines = []
        for m in recent:
            if hasattr(m, "content"):
                role = getattr(m, "role", "user")
                lines.append(f"{role}: {m.content[:250]}")
            elif isinstance(m, dict):
                lines.append(f"{m.get('role', 'user')}: {str(m.get('content', ''))[:250]}")
        if lines:
            conv_str = "\n".join(lines)
            history_context = f"\nRecent conversation:\n{conv_str}\n"

    is_tl_query = len(TAGALOG_CUE_RE.findall(q_clean)) >= 1
    lang_label = (
        "simplified conversational Tagalog (ZERO English questions)"
        if is_tl_query
        else "plain simple English (ZERO Tagalog words — do NOT write Paki-specify or Ano po)"
    )

    user_content = (
        f"Analyze this Philippine civil law query for ambiguity:\n\n\"{q_clean}\"\n"
        f"{history_context}\n"
        f"Semantic vagueness prior: {prob_vague:.2f}. "
        f"MANDATORY LANGUAGE: The user query is in {'TAGALOG' if is_tl_query else 'ENGLISH'}. "
        f"You MUST write reasoning, questions, options, and context_hint 100% in {lang_label}."
    )

    messages = [
        {"role": "system", "content": AMBIGUITY_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    from services.llm_client import call_chat_completion_async

    try:
        raw_content = await call_chat_completion_async(
            messages=messages,
            temperature=0.1,
            max_tokens=1200,
            timeout_sec=35.0,
        )
        if not raw_content:
            if prob_vague >= 0.70:
                return _build_unilingual_fallback_clarification(q_clean, prob_vague)
            return AmbiguityResult(original_query=q_clean)

        parsed = _parse_llm_json(raw_content)
        if not parsed:
            if prob_vague >= 0.70:
                return _build_unilingual_fallback_clarification(q_clean, prob_vague)
            return AmbiguityResult(original_query=q_clean)

        is_ambig = bool(parsed.get("is_ambiguous", False))
        llm_conf = float(parsed.get("confidence", prob_vague if is_ambig else 0.0))
        ensemble_conf = round(0.65 * (llm_conf if is_ambig else 0.0) + 0.35 * prob_vague, 4)

        if not is_ambig:
            # If the zero-regex ML classifier is ultra-confident (>= 0.90) that the query is an incomplete fragment
            if prob_vague >= 0.90:
                return _build_unilingual_fallback_clarification(q_clean, prob_vague)
            return AmbiguityResult(
                is_ambiguous=False,
                confidence=llm_conf,
                category=parsed.get("category", ""),
                original_query=q_clean,
                reasoning=parsed.get("reasoning", "Query is sufficiently clear."),
            )

        if ensemble_conf < 0.45:
            return AmbiguityResult(
                is_ambiguous=False,
                confidence=ensemble_conf,
                category="",
                original_query=q_clean,
                reasoning="Ensemble consensus determined query is sufficiently clear.",
            )

        police_investigation_pattern = re.compile(
            r'\b(saksi|nakakita|aresto|pag-aresto|blotter|pulis|armas|autopsy|crime scene|witness|arrest|weapon)\b',
            re.IGNORECASE,
        )
        invalid_article_pattern = re.compile(
            r'\bArticle\s+(?:227[1-9]|22[89]\d|2[3-9]\d{2}|[3-9]\d{3}|\d{5,})\b',
            re.IGNORECASE,
        )

        questions: List[ClarificationQuestion] = []
        for q_data in parsed.get("questions", []):
            q_text = str(q_data.get("question", "")).strip()
            if not q_text:
                continue
            hint_text = str(q_data.get("context_hint", "")).strip()

            if police_investigation_pattern.search(q_text) or police_investigation_pattern.search(hint_text):
                logger.info(f"Filtered out police/criminal interrogation question: {q_text}")
                continue

            if is_tl_query and ENGLISH_QUESTION_RE.search(q_text):
                logger.info(f"Filtered out English clarification question on Tagalog query: {q_text}")
                continue

            if not is_tl_query and TAGALOG_RESPONSE_MARKERS_RE.search(q_text):
                logger.info(f"Filtered out Tagalog clarification question on English query: {q_text}")
                continue

            q_text = invalid_article_pattern.sub("the Civil Code", q_text)
            hint_text = invalid_article_pattern.sub("the Civil Code", hint_text)

            raw_opts = [
                invalid_article_pattern.sub("the Civil Code", str(o).strip())
                for o in q_data.get("options", [])
                if str(o).strip()
            ]
            if not is_tl_query:
                raw_opts = [o for o in raw_opts if not TAGALOG_RESPONSE_MARKERS_RE.search(o)]

            questions.append(ClarificationQuestion(
                id=str(q_data.get("id", f"q_{len(questions) + 1}")),
                question=q_text,
                options=raw_opts if raw_opts else (
                    ["Oo", "Hindi", "Hindi sigurado"] if is_tl_query else ["Contract / Obligation", "Property / Lease", "Family / Inheritance", "Damages / Injury"]
                ),
                allows_free_text=True,
                context_hint=hint_text,
            ))

        if not questions:
            if prob_vague >= 0.50 or is_ambig:
                return _build_unilingual_fallback_clarification(q_clean, max(prob_vague, ensemble_conf))
            return AmbiguityResult(
                is_ambiguous=False,
                confidence=ensemble_conf,
                category=parsed.get("category", ""),
                original_query=q_clean,
                reasoning="Bypassed clarification: generated questions were outside scope.",
            )

        raw_reasoning = str(parsed.get("reasoning", "Missing core factual context."))
        if not is_tl_query and TAGALOG_RESPONSE_MARKERS_RE.search(raw_reasoning):
            raw_reasoning = "Your question appears incomplete or missing the core facts. Please specify the legal situation, incident, or topic you are referring to."
        clean_reasoning = invalid_article_pattern.sub("the Civil Code", raw_reasoning)

        logger.info(
            "Ambiguity confirmed [p_ml=%.3f, conf=%.2f, ensemble=%.2f, cat=%s]: %d questions",
            prob_vague,
            llm_conf,
            ensemble_conf,
            parsed.get("category"),
            len(questions),
        )
        return AmbiguityResult(
            is_ambiguous=True,
            confidence=max(llm_conf, ensemble_conf),
            category=str(parsed.get("category", "missing_facts")),
            questions=questions,
            original_query=q_clean,
            reasoning=clean_reasoning,
        )

    except Exception as e:
        logger.warning(f"LLM ambiguity detection failed ({type(e).__name__}: {e}); using fallback policy.")
        if prob_vague >= 0.70:
            return _build_unilingual_fallback_clarification(q_clean, prob_vague)
        return AmbiguityResult(original_query=q_clean)


def enrich_query_with_clarification(
    original_query: str,
    clarification_context: Dict[str, Any],
) -> str:
    """Merges the user's clarification answers into the search query to guide hybrid statutory retrieval."""
    answers = clarification_context.get("answers", {})
    if not answers:
        return original_query

    orig = clarification_context.get("original_query")
    if orig and str(orig).strip() and str(orig).strip().lower() not in original_query.lower():
        enriched_parts = [str(orig).strip(), original_query]
    else:
        enriched_parts = [original_query]

    for _, answer in answers.items():
        if isinstance(answer, list):
            for a in answer:
                a_str = str(a).strip()
                if a_str and a_str.lower() not in " ".join(enriched_parts).lower():
                    enriched_parts.append(a_str)
        elif answer and str(answer).strip():
            a_str = str(answer).strip()
            if a_str and a_str.lower() not in " ".join(enriched_parts).lower():
                enriched_parts.append(a_str)

    enriched = " ".join(enriched_parts)
    logger.info(f"Enriched query with clarification: {enriched[:200]}...")
    return enriched
