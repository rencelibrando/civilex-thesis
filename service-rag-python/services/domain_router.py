import os
import re
from typing import Dict, List, Optional, Any
import numpy as np
from sentence_transformers import SentenceTransformer

EXTERNAL_STATUTE_ROUTING: List[tuple[re.Pattern, str]] = [
    (re.compile(r'\b(?:revised\s+penal\s+code|rpc|penal\s+code|batas\s+pambansa\s+blg\.?\s*22|\bbp\s*22\b)\b', re.IGNORECASE), "Philippine Criminal Law (Revised Penal Code / PNP)"),
    (re.compile(r'\b(?:labor\s+code|pd\s*442|p\.d\.\s*442|dole|nlrc|sena\b)\b', re.IGNORECASE), "Philippine Labor Law (DOLE / NLRC)"),
    (re.compile(r'\b(?:national\s+internal\s+revenue\s+code|nirc|tax\s+code|train\s+law|\bbir\b)\b', re.IGNORECASE), "Philippine Tax Law (NIRC / BIR)"),
    (re.compile(r'\b(?:revised\s+corporation\s+code|corporation\s+code|ra\s*11232|\bsec\b)\b', re.IGNORECASE), "Philippine Corporate & Commercial Law (SEC)"),
    (re.compile(r'\b(?:data\s+privacy\s+act|ra\s*10173|\bnpc\b|cybercrime\s+prevention\s+act|ra\s*10175)\b', re.IGNORECASE), "Philippine Data Privacy & Cybercrime (NPC)"),
    (re.compile(r'\b(?:intellectual\s+property\s+code|ip\s+code|ra\s*8293|ipophl|copyright|trademark|patent)\b', re.IGNORECASE), "Philippine Intellectual Property Law (RA 8293 / IPOPHL)"),
    (re.compile(r'\b(?:ra\s*9208|ra\s*10364|ra\s*11862|organ\s+trafficking|human\s+trafficking)\b', re.IGNORECASE), "Philippine Anti-Trafficking & Organ Laws (RA 9208)"),
]

ILLICIT_CONTRACT_PATTERNS: List[tuple[re.Pattern, str]] = [
    (re.compile(r'\b(?:sell(?:ing)?|sale|buy(?:ing)?|purchase|benta|ibenta|bentahan)\b.{0,40}\b(?:kidneys?|human\s+organs?|bato|atay|dugo)\b', re.IGNORECASE), "Human Organ Sale / Trafficking (RA 9208 / Art. 1347 & 1409)"),
    (re.compile(r'\b(?:organ\s+(?:sale|selling|trafficking)|organ\s+donor\s+for\s+sale)\b', re.IGNORECASE), "Human Organ Sale / Trafficking (RA 9208 / Art. 1347 & 1409)"),
    (re.compile(r'\b(?:kontrata\s+(?:sa|para\s+sa)\s+pagpatay|contract\s+killing|hitman|upahang\s+mamamatay-tao|benta\s+ng\s+droga|sale\s+of\s+shabu|illegal\s+drugs\s+contract)\b', re.IGNORECASE), "Unlawful Cause / Criminal Object (Art. 1409)"),
]

CIVIL_ANCHORS: List[str] = [
    "query: How to cancel a contract and claim damages for breach of reciprocal obligations",
    "query: Ano ang mga kailangan o requisites para maging valid ang isang kontrata sa batas",
    "query: The contractor did not finish building the house despite advance payment rescission damages",
    "query: Hindi nagbayad ng utang ang kaibigan ko kahit may nilagdaang promissory note",
    "query: Who inherits the property if the deceased parent left no will or testament compulsory heirs",
    "query: Boundary dispute and encroachment of neighbor fence on my titled land property accession",
    "query: Car accident caused by negligent reckless driver who was speeding quasi-delict damages",
    "query: Nabangga ang sasakyan ko ng lasing na driver sino ang mananagot sa danyos perwisyo",
    "query: Eviction of tenant for non-payment of monthly house rent lease contract ejectment",
    "query: Annulment of marriage and legal separation property regime liquidation Family Code",
    "query: Slander defamation civil damages for injury to personal reputation and moral damages",
    "query: Builder in good faith on another person land accession rights and reimbursement",
    "query: Legal easement of right of way to access public road highway from estate",
    "query: Essential requisites of contract consent object cause and consideration Article 1318",
    "query: Action for judicial rescission of reciprocal obligations under Article 1191 of Civil Code",
    "query: Moral damages exemplary damages and nominal damages for breach of contract or tort",
    "query: Co-ownership of agricultural land and partition among legal heirs Civil Code",
    "query: Usurious interest rates and valid legal interest rate for monetary loan obligations",
    "query: Donation inter vivos and revocation of donation under Philippine Civil Code",
    "query: Hidden defects in sales and warranty against eviction redhibitory action",
    "query: Ano ang pwede ikaso sakin sa batas sibil pananagutan danyos perwisyo",
    "query: Ano ang pwede kong ikaso sakin",
    "query: Ano ang pwede ikaso sakin",
    "query: Can I be sued for damages civil liability breach of contract or quasi-delict",
    "query: Can I be sued or face liability under civil law",
    "query: Ano ang mga kaso o pananagutan sa civil law kapag may nagawang pagkukulang o pinsala",
    "query: Anong kaso ang pwede isampa sa akin danyos pananagutan",
    "query: Civil liability and damages for death or physical injuries caused by crime or negligence Article 2206 Article 33",
    "query: Bayad sa danyos at sibil na pananagutan sa pagkamatay o pagkasugat sa ilalim ng Civil Code",
    "query: Independent civil action for damages arising from death physical injury or altercation Article 33 Article 2177",
    "query: Pananagutan sa danyos at bayad-pinsala sa mga naulila dahil sa pagkamatay ng biktima sa ilalim ng Civil Code Article 2206"
]

OTHER_LEGAL_DOMAINS_ANCHORS: Dict[str, List[str]] = {
    "Philippine Labor Law (DOLE / NLRC)": [
        "query: Illegal dismissal from company without notice or 30 days statutory separation pay",
        "query: Pinasahod ako nang mababa sa minimum wage at walang 13th month pay reklamo sa DOLE",
        "query: Constructive dismissal due to workplace harassment filing complaint with NLRC labor arbiter",
        "query: Overtime pay computation holiday premium and SEnA conciliation under Labor Code of the Philippines",
        "query: Retrenchment redundancy and termination of employment by management prerogative",
        "query: Tinanggal sa trabaho nang walang sapat na dahilan o separation pay reklamo sa DOLE NLRC",
        "query: Hindi binigay ang sahod at final pay ng employer labor dispute SEnA conciliation",
        "query: Labor standards violation unpaid overtime holiday pay night differential DOLE"
    ],
    "Philippine Criminal Law (Revised Penal Code / PNP)": [
        "query: Warrantless arrest by police officer during inquest proceedings for theft robbery",
        "query: Estafa and swindling criminal complaint filed with office of the city prosecutor",
        "query: Homicide murder and physical injuries charges under Revised Penal Code bail hearing",
        "query: Nanakawan ako sa bahay paano mag-file ng criminal complaint sa pulis at prosecutor",
        "query: Cyber libel and online defamation criminal case under Cybercrime Prevention Act",
        "query: Nakapatay ako ng tao o kapitbahay anong kasong kriminal ang kakaharapin ko sa pulis at piskal",
        "query: Homicide murder parricide manslaughter criminal charges under Revised Penal Code",
        "query: Napatay o sinaksak o binaril dahil sa alitan o utang anong kasong kriminal ang isasampa",
        "query: Criminal cases and penalty for killing someone or physical injuries Revised Penal Code",
        "query: Makukulong ba ako kung nakapatay o nanakit ng tao criminal complaint warrant of arrest",
        "query: Threat to kill grave coercion pananakit at tangkang pagpatay kaso sa pulis",
        "query: Ano ang mga kasong kriminal at parusa sa pagpatay o pananakit sa kapwa tao",
        "query: Reklamo sa piskal at pulis para sa kasong murder homicide o tangkang pagpatay"
    ],
    "Philippine Tax Law (NIRC / BIR)": [
        "query: How to compute value-added tax VAT and file quarterly income tax return with BIR",
        "query: Letter of authority LOA and preliminary assessment notice PAN from Bureau of Internal Revenue",
        "query: Tax deficiency penalties and compromise settlement under National Internal Revenue Code TRAIN law",
        "query: Paano magbayad ng capital gains tax at documentary stamp tax sa pagbenta ng lupa sa BIR",
        "query: Estate tax amnesty return and donor tax computation BIR form",
        "query: Tax evasion penalties audit assessment notice BIR form tax compliance",
        "query: Paano mag-file ng income tax return at bayad ng withholding tax sa BIR"
    ],
    "Philippine Corporate & Commercial Law (SEC)": [
        "query: Articles of incorporation and registration requirements with Securities and Exchange Commission",
        "query: Board of directors quorum voting rights and election under Revised Corporation Code RA 11232",
        "query: Corporate dissolution insolvency and filing annual financial statements with SEC",
        "query: Securities Regulation Code compliance and stock ownership transfer certificate",
        "query: Rehistro ng korporasyon at SEC registration board meeting general information sheet GIS",
        "query: Pagbenta ng shares of stock at corporate dissolution sa ilalim ng Revised Corporation Code"
    ],
    "Philippine Data Privacy & Cybercrime (NPC)": [
        "query: Personal data breach notification and privacy rights violation under Data Privacy Act RA 10173",
        "query: National Privacy Commission complaint against unauthorized processing of sensitive personal data",
        "query: Data subject rights and privacy impact assessment PIA requirement",
        "query: Na-hack ang Facebook account o na-leak ang personal na impormasyon reklamo sa NPC cybercrime",
        "query: Online identity theft phishing at cybercrime complaint PNP ACG NBI"
    ]
}

NON_LEGAL_ANCHORS: List[str] = [
    "query: How to implement quicksort algorithm in python or binary search tree recursion",
    "query: Write a javascript react function to fetch api data and render list components",
    "query: Solve the quadratic equation x squared plus 5x plus 6 equals zero calculus derivative",
    "query: What is the recipe for chocolate chip cookies with butter flour and sugar",
    "query: Explain the theory of relativity and quantum physics entanglement in simple words",
    "query: What is the current weather forecast and temperature in Manila today",
    "query: Tell me a funny joke about cats or write a creative poem about nature",
    "query: Who won the NBA championship finals basketball game scores and highlights",
    "query: Paano magluto ng masarap na adobo sinigang na baboy at paboritong ulam",
    "query: Recommendations for the best smartphone laptop or video games to buy",
    "query: Write a python script to parse csv files and calculate average values",
    "query: What is the capital city of France Germany Japan and geography facts"
]


class DomainRouter:
    """Semantic Embedding Router for triaging legal and non-legal queries."""

    def __init__(self, embedder: SentenceTransformer):
        self.embedder = embedder
        self._initialized = False
        self.civil_centroid: Optional[np.ndarray] = None
        self.non_legal_centroid: Optional[np.ndarray] = None
        self.other_legal_centroid: Optional[np.ndarray] = None
        self.domain_centroids: Dict[str, np.ndarray] = {}
        self._init_centroids()

    def _init_centroids(self):
        """Precomputes normalized semantic centroid vectors."""
        # 1. Civil centroid
        civil_vecs = self.embedder.encode(CIVIL_ANCHORS, normalize_embeddings=True, show_progress_bar=False)
        self.civil_centroid = np.mean(civil_vecs, axis=0)
        self.civil_centroid /= np.linalg.norm(self.civil_centroid)

        # 2. Non-legal centroid
        non_vecs = self.embedder.encode(NON_LEGAL_ANCHORS, normalize_embeddings=True, show_progress_bar=False)
        self.non_legal_centroid = np.mean(non_vecs, axis=0)
        self.non_legal_centroid /= np.linalg.norm(self.non_legal_centroid)

        # 3. Domain-specific centroids
        all_other_vecs = []
        for domain_name, anchors in OTHER_LEGAL_DOMAINS_ANCHORS.items():
            vecs = self.embedder.encode(anchors, normalize_embeddings=True, show_progress_bar=False)
            domain_centroid = np.mean(vecs, axis=0)
            domain_centroid /= np.linalg.norm(domain_centroid)
            self.domain_centroids[domain_name] = domain_centroid
            all_other_vecs.append(domain_centroid)

        # Precompute stacked domain matrix for vectorized similarity scoring
        self.domain_names: List[str] = list(self.domain_centroids.keys())
        self.domain_matrix = np.stack([self.domain_centroids[d] for d in self.domain_names])

        # Combined other-legal centroid
        self.other_legal_centroid = np.mean(all_other_vecs, axis=0)
        self.other_legal_centroid /= np.linalg.norm(self.other_legal_centroid)
        self._initialized = True

    def route(
        self,
        query: str,
        has_article_ref: bool = False,
        has_case_ref: bool = False,
        document_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Classifies incoming query into in_domain_civil, out_of_domain_legal, or out_of_domain_non_legal."""
        q_strip = query.strip()
        q_lower = q_strip.lower()

        # Fast path -1: Illicit object or cause (void ab initio under Arts. 1347 & 1409, RA 9208)
        for pattern, domain_name in ILLICIT_CONTRACT_PATTERNS:
            if pattern.search(q_lower):
                return {
                    "category": "out_of_domain_illicit",
                    "target_domain": domain_name,
                    "reason": f"Contract involves illicit object or cause contrary to law: {domain_name}."
                }

        # Fast path 0: Explicit external non-civil statute references route directly to specialized domain
        is_explicit_civil = bool(re.search(r'\b(?:civil\s+code|ra\s*386|family\s+code|eo\s*209)\b', q_lower))
        if not is_explicit_civil:
            for pattern, domain_name in EXTERNAL_STATUTE_ROUTING:
                if pattern.search(q_lower):
                    return {
                        "category": "out_of_domain_legal",
                        "target_domain": domain_name,
                        "reason": f"Explicit reference to non-civil statute ({domain_name}) detected."
                    }

        # Fast path 1: Explicit statutory article or jurisprudence case references always route to civil law
        is_explicit_case = has_case_ref or bool(re.search(r'\b(?:g\.?r\.?\s*(?:no\.?|nos\.?)?\s*[\w\-]+|gr\s*no\.?\s*\d+|gr\s+number\s*\d+|jurisprudence|court\s+of\s+appeals|supreme\s+court)\b', q_lower))
        if has_article_ref or is_explicit_case:
            return {
                "category": "in_domain_civil",
                "target_domain": None,
                "reason": "Explicit statutory article or jurisprudence reference detected."
            }

        # Fast path 2: Casual greetings without substantive legal inquiry
        casual_words = ["hello", "hi", "hey", "kumusta", "kamusta", "good morning", "good afternoon", "good evening"]
        if any(q_lower == w or q_lower.startswith(w + " ") for w in casual_words) and len(q_strip.split()) <= 4:
            return {
                "category": "out_of_domain_non_legal",
                "target_domain": None,
                "reason": "Casual greeting without legal inquiry."
            }

        # Fast path 3: Active document analysis context
        if document_id:
            return {
                "category": "in_domain_civil",
                "target_domain": None,
                "reason": "Active legal document analysis session."
            }

        # Fast path 4: Philippine civil litigation, liability, dispute, or lawsuit terms
        legal_dispute_cue = bool(re.search(
            r'\b(?:ikaso|ikasuhan|makaso|makasuhan|kaso|demanda|idemanda|mademanda|pananagutan|habulin|danyos|bayad-pinsala|sue|sued|suing|lawsuit|liable|liability|breach|quasi[- ]delict|tort|kontrata|kasunduan|upa|utang|lupa|mana|testamento)\b',
            q_lower
        ))
        external_legal_indicators = bool(re.search(
            r'\b(?:pulis|police|blotter|kulong|makulong|arrest|aresto|inquest|piskal|prosecutor|homicide|murder|robbery|theft|magnanakaw|estafa|shabu|droga|dole|nlrc|bir|tax|sec|npc)\b',
            q_lower
        ))
        if legal_dispute_cue and not external_legal_indicators:
            return {
                "category": "in_domain_civil",
                "target_domain": None,
                "reason": "Civil litigation, dispute, or legal liability inquiry detected."
            }

        sim_scores = self.score_text(q_strip)
        sim_civil = sim_scores["sim_civil"]
        sim_non = sim_scores["sim_non"]
        best_legal_sim = sim_scores["best_legal_sim"]
        best_domain = sim_scores["best_domain"]

        # Specialized other Philippine legal branches (Labor, Tax, Crime, Corporate, Privacy)
        if best_legal_sim > max(sim_civil, sim_non):
            return {
                "category": "out_of_domain_legal",
                "target_domain": best_domain,
                "reason": f"Inquiry primarily governed by specialized Philippine law: {best_domain}."
            }

        # Non-legal topics (code, cooking, math, science, entertainment)
        if sim_non > sim_civil:
            return {
                "category": "out_of_domain_non_legal",
                "target_domain": None,
                "reason": "Query pertains to non-legal subject matter (science, technology, programming, or casual topics)."
            }

        # In-domain Philippine Civil Code inquiry
        return {
            "category": "in_domain_civil",
            "target_domain": None,
            "reason": "In-domain Philippine Civil Law inquiry."
        }

    def score_text(self, text: str) -> Dict[str, Any]:
        """Computes normalized cosine similarity against civil, non-legal, and specialized domains."""
        model_name = os.getenv("EMBEDDING_MODEL_NAME", "intfloat/multilingual-e5-base").lower()
        clean = (text or "").strip()
        q_text = f"query: {clean}" if "e5" in model_name else clean
        q_vec = self.embedder.encode(q_text, normalize_embeddings=True, show_progress_bar=False)

        sim_civil = float(np.dot(q_vec, self.civil_centroid))
        sim_non = float(np.dot(q_vec, self.non_legal_centroid))

        domain_sims = np.dot(self.domain_matrix, q_vec)
        best_idx = int(np.argmax(domain_sims))
        return {
            "sim_civil": sim_civil,
            "sim_non": sim_non,
            "best_legal_sim": float(domain_sims[best_idx]),
            "best_domain": self.domain_names[best_idx],
        }


_shared_domain_router: Optional[DomainRouter] = None


def set_shared_domain_router(router: Optional[DomainRouter]) -> None:
    """Registers the process-wide DomainRouter so extraction shares warm centroids."""
    global _shared_domain_router
    _shared_domain_router = router


def get_shared_domain_router(embedder: Optional[SentenceTransformer] = None) -> Optional[DomainRouter]:
    """Returns the shared DomainRouter, lazily initializing one if an embedder is supplied."""
    global _shared_domain_router
    if _shared_domain_router is None and embedder is not None:
        _shared_domain_router = DomainRouter(embedder)
    return _shared_domain_router


CIVIL_LAW_DOC_PATTERNS: List[tuple[str, int]] = [
    # Formal civil document headers and agreements
    (r'\b(?:contract\s+of\s+lease|lease\s+contract|lease\s+agreement|rental\s+agreement|contract\s+of\s+rent|tenancy\s+agreement)\b', 3),
    (r'\b(?:contract\s+of\s+sale|deed\s+of\s+(?:absolute\s+)?sale|conditional\s+sale|contract\s+to\s+sell|deed\s+of\s+donation|deed\s+of\s+assignment|deed\s+of\s+conveyance|deed\s+of\s+transfer)\b', 3),
    (r'\b(?:loan\s+agreement|promissory\s+note|contract\s+of\s+loan|acknowledgment\s+of\s+debt|kasulatan\s+ng\s+utang|patunay\s+ng\s+utang)\b', 3),
    (r'\b(?:real\s+estate\s+mortgage|chattel\s+mortgage|contract\s+of\s+mortgage|mortgage\s+contract|antichresis|contract\s+of\s+pledge|pactum\s+commissorium)\b', 3),
    (r'\b(?:last\s+will\s+and\s+testament|holographic\s+will|notarial\s+will|testamento|habilin|probate\s+of\s+will)\b', 3),
    (r'\b(?:extrajudicial\s+settlement|extra-judicial\s+settlement|settlement\s+of\s+estate|partition\s+of\s+(?:real\s+)?estate|deed\s+of\s+extrajudicial|kasunduan\s+sa\s+paghahati)\b', 3),
    (r'\b(?:compromise\s+agreement|amicable\s+settlement|release\s+and\s+quitclaim|waiver\s+and\s+quitclaim|release\s+of\s+claims|waiver\s+of\s+rights|kasunduan\s+ng\s+pag-aayos)\b', 3),
    (r'\b(?:special\s+power\s+of\s+attorney|general\s+power\s+of\s+attorney|\bspa\b|attorney-in-fact|principal\s+and\s+agent)\b', 3),
    (r'\b(?:marriage\s+settlement|prenuptial\s+agreement|marriage\s+contract|absolute\s+community\s+of\s+property|conjugal\s+partnership\s+of\s+gains|declaration\s+of\s+(?:absolute\s+)?nullity\s+of\s+marriage|psychological\s+incapacity|legal\s+separation|support\s+pendente\s+lite)\b', 3),
    (r'\b(?:affidavit\s+of\s+loss|affidavit\s+of\s+undertaking|affidavit\s+of\s+two\s+disinterested\s+persons|affidavit\s+of\s+guardianship|affidavit\s+of\s+support\s+and\s+consent|affidavit\s+of\s+adverse\s+claim|affidavit\s+of\s+self-adjudication)\b', 3),
    (r'\b(?:memorandum\s+of\s+agreement|\bmoa\b|memorandum\s+of\s+understanding|\bmou\b|service\s+agreement|consultancy\s+agreement|independent\s+contractor\s+agreement|retainer\s+agreement)\b', 2),
    (r'\b(?:notice\s+to\s+vacate|formal\s+demand\s+letter|demand\s+to\s+pay|demand\s+to\s+vacate|demand\s+letter|final\s+demand)\b', 3),
    (r'\b(?:complaint\s+for\s+sum\s+of\s+money|complaint\s+for\s+damages|unlawful\s+detainer\s+complaint|forcible\s+entry\s+complaint|petition\s+for\s+declaration\s+of\s+nullity|petition\s+for\s+probate|action\s+for\s+reconveyance|quieting\s+of\s+title)\b', 3),
    (r'\b(?:katarungang\s+pambarangay|certificate\s+to\s+file\s+action|lupon\s+tagapamayapa|pangkat\s+ng\s+tagapagkasundo|barangay\s+conciliation)\b', 3),
    # Codified civil law statutes and doctrine
    (r'\b(?:civil\s+code\s+of\s+the\s+philippines|republic\s+act\s+(?:no\.?\s*)?386|\bra\s*386\b)\b', 3),
    (r'\b(?:family\s+code\s+of\s+the\s+philippines|executive\s+order\s*(?:no\.?\s*)?209|\beo\s*209\b)\b', 3),
    (r'\b(?:lessor\b|lessee\b|vendor\b|vendee\b|mortgagor\b|mortgagee\b|pledgor\b|pledgee\b|testator\b|testatrix\b|compulsory\s+heir|legitime\b)\b', 2),
    (r'\b(?:quasi[- ]delict|torts?\s+and\s+damages|vicarious\s+liability|actual\s+damages|moral\s+damages|exemplary\s+damages|liquidated\s+damages|nominal\s+damages)\b', 2),
    (r'\b(?:easement\s+of\s+right\s+of\s+way|builder\s+in\s+good\s+faith|quieting\s+of\s+title|usufruct|accession|co-ownership)\b', 2),
    (r'\b(?:know\s+all\s+men\s+by\s+these\s+presents|in\s+witness\s+whereof|subscribed\s+and\s+sworn\s+to\s+before\s+me|notary\s+public|doc\.\s*no\.\s*\d+)\b', 1),
    # Informal English and Tagalog civil notes, receipts, and community agreements
    (r'\b(?:borrowed\s+(?:money|cash|php|peso|pesos|p\s*\d)|i\s+owe|nanghiram|hiniram|pinahiram|nangutang|nagpautang)\b', 2),
    (r'\b(?:promise\s+to\s+(?:pay|repay)|repayment\s+of\s+loan|babayaran\s+(?:ko|ito)|nangangakong\s+babayaran)\b', 2),
    (r'\b(?:monthly\s+rent|security\s+deposit|advance\s+rent|paupahan|nagpapaupa|nangungupahan|umuupa|inuupahang\s+(?:bahay|kwarto|lupa|unit)|renta\s+sa|kasunduan\s+sa\s+(?:pag-?upa|upa|renta))\b', 2),
    (r'\b(?:bilihan\s+ng\s+(?:lupa|bahay|sasakyan)|bentahan\s+ng|pagbebenta\s+ng\s+lupa|earnest\s+money|purchase\s+price|real\s+property|land\s+title|transfer\s+of\s+ownership|boundary\s+line|right\s+of\s+way)\b', 2),
    (r'\b(?:child\s+support|spousal\s+support|sustento\s+(?:sa|ng)\s+anak|paghahati\s+ng\s+(?:mana|ari-?arian|lupa)|bayad\s+sa\s+(?:danyos|pinsala|pagpapagawa)|kasunduan\s+sa\s+pagbabayad)\b', 2),
    (r'\b(?:borrower|lender|debtor|creditor|utang|pautang|danyos|perwisyo|tagapagmana|pamana|sustento|kasunduan)\b', 1),
]

NON_CIVIL_LEGAL_DOC_DOMAINS: List[Dict[str, Any]] = [
    {
        "domain": "Philippine Criminal Law (Revised Penal Code / Special Penal Laws / DOJ National Prosecution Service / PNP)",
        "primary": [
            r'\b(?:revised\s+penal\s+code|act\s+no\.?\s*3815|\brpc\b|special\s+penal\s+laws?)\b',
            r'\b(?:complaint-affidavit|criminal\s+complaint|information\s+filed\s+in\s+court|police\s+blotter|inquest\s+resolution|inquest\s+proceedings?|preliminary\s+investigation|probable\s+cause|warrant\s+of\s+arrest|search\s+warrant|plea\s+bargaining|bail\s+bond|criminal\s+case\s+no\.?)\b',
            r'\b(?:office\s+of\s+the\s+city\s+prosecutor|office\s+of\s+the\s+provincial\s+prosecutor|national\s+prosecution\s+service|department\s+of\s+justice|pnp-cidg|philippine\s+national\s+police|national\s+bureau\s+of\s+investigation)\b',
            r'\b(?:comprehensive\s+dangerous\s+drugs\s+act|ra\s*9165|comprehensive\s+firearms|ra\s*10591|anti-carnapping|ra\s*10883|anti-fencing\s+law|pd\s*1612|anti-graft|ra\s*3019)\b',
        ],
        "secondary": [
            r'\b(?:homicide|murder|robbery|theft|estafa|swindling|rape|kidnapping|illegal\s+detention|parricide|infanticide|rebellion|sedition|shabu|marijuana|buy-bust|accused)\b',
        ],
    },
    {
        "domain": "Philippine Labor Law (Presidential Decree No. 442 - Labor Code / DOLE / NLRC)",
        "primary": [
            r'\b(?:labor\s+code\s+of\s+the\s+philippines|presidential\s+decree\s+(?:no\.?\s*)?442|\bpd\s*442\b|dole\s+department\s+order)\b',
            r'\b(?:department\s+of\s+labor\s+and\s+employment|\bdole\b|national\s+labor\s+relations\s+commission|\bnlrc\b|labor\s+arbiter|single\s+entry\s+approach|\bsena\b|national\s+conciliation\s+and\s+mediation\s+board|\bncmb\b)\b',
            r'\b(?:illegal\s+dismissal|constructive\s+dismissal|unjust\s+dismissal|unfair\s+labor\s+practice|\bulp\b|labor\s+union|collective\s+bargaining\s+agreement|\bcba\b|retrenchment|redundancy\s+program|dole\s+labor\s+inspection)\b',
        ],
        "secondary": [
            r'\b(?:separation\s+pay|backwages|13th\s+month\s+pay|holiday\s+pay|overtime\s+pay|minimum\s+wage\s+order|strike|lockout)\b',
        ],
    },
    {
        "domain": "Philippine Tax Law (National Internal Revenue Code [NIRC] / Bureau of Internal Revenue [BIR])",
        "primary": [
            r'\b(?:national\s+internal\s+revenue\s+code|\bnirc\b|tax\s+code|republic\s+act\s+(?:no\.?\s*)?8424|\bra\s*8424\b|train\s+law|ra\s*10963|create\s+act|ra\s*11534|tariff\s+and\s+customs\s+code|customs\s+modernization\s+and\s+tariff\s+act|\bcmta\b)\b',
            r'\b(?:bureau\s+of\s+internal\s+revenue|\bbir\b|court\s+of\s+tax\s+appeals|\bcta\b|bureau\s+of\s+customs|\bboc\b|department\s+of\s+finance|\bdof\b|local\s+board\s+of\s+assessment\s+appeals)\b',
            r'\b(?:preliminary\s+assessment\s+notice|\bpan\b|final\s+assessment\s+notice|\bfan\b|formal\s+letter\s+of\s+demand|\bfld\b|letter\s+of\s+authority|\bloa\b|tax\s+audit|tax\s+deficiency|tax\s+evasion)\b',
        ],
        "secondary": [
            r'\b(?:income\s+tax\s+return|\bitr\b|value-added\s+tax|\bvat\b|percentage\s+tax|withholding\s+tax|capital\s+gains\s+tax|donor\'s\s+tax|estate\s+tax\s+return|tax\s+clearance)\b',
        ],
    },
    {
        "domain": "Philippine Data Privacy & Cybercrime Law (RA 10173 [DPA] / RA 10175 [Cybercrime Act] / NPC / CICC)",
        "primary": [
            r'\b(?:data\s+privacy\s+act\s+of\s+2012|republic\s+act\s+(?:no\.?\s*)?10173|\bra\s*10173\b|cybercrime\s+prevention\s+act\s+of\s+2012|republic\s+act\s+(?:no\.?\s*)?10175|\bra\s*10175\b)\b',
            r'\b(?:national\s+privacy\s+commission|\bnpc\b|cybercrime\s+investigation\s+and\s+coordinating\s+center|\bcicc\b|pnp\s+anti-cybercrime\s+group|pnp-acg|nbi\s+cybercrime\s+division)\b',
            r'\b(?:personal\s+information\s+controller|\bpic\b|personal\s+information\s+processor|\bpip\b|data\s+subject\s+rights|data\s+breach\s+notification|privacy\s+impact\s+assessment|\bpia\b|unauthorized\s+processing\s+of\s+personal)\b',
        ],
        "secondary": [
            r'\b(?:illegal\s+access\s+to\s+computer\s+system|data\s+interference|cyber-squatting|cyber-libel|computer-related\s+forgery|computer-related\s+fraud)\b',
        ],
    },
    {
        "domain": "Philippine Corporate & Commercial Law (Revised Corporation Code [RA 11232] / SEC / BSP)",
        "primary": [
            r'\b(?:revised\s+corporation\s+code\s+of\s+the\s+philippines|republic\s+act\s+(?:no\.?\s*)?11232|\bra\s*11232\b|securities\s+regulation\s+code|\bsrc\b|republic\s+act\s+(?:no\.?\s*)?8799|\bra\s*8799\b|anti-money\s+laundering\s+act|\bamla\b|ra\s*9160|general\s+banking\s+law|ra\s*8791)\b',
            r'\b(?:securities\s+and\s+exchange\s+commission|\bsec\b|bangko\s+sentral\s+ng\s+pilipinas|\bbsp\b|anti-money\s+laundering\s+council|\bamlc\b|insurance\s+commission|\bic\b)\b',
            r'\b(?:articles\s+of\s+incorporation|corporate\s+by-laws|general\s+information\s+sheet|\bgis\b|board\s+resolution|secretary\'s\s+certificate|sec\s+registration|sec\s+revocation|sec\s+compliance)\b',
        ],
        "secondary": [
            r'\b(?:board\s+of\s+directors\s+meeting|quorum\s+of\s+the\s+board|stockholders\'?\s+meeting|outstanding\s+capital\s+stock|subscribed\s+capital|treasury\s+shares|corporate\s+officers|ultra\s+vires|corporate\s+dissolution)\b',
        ],
    },
    {
        "domain": "Philippine Intellectual Property Law (Republic Act No. 8293 - IP Code / IPOPHL)",
        "primary": [
            r'\b(?:intellectual\s+property\s+code\s+of\s+the\s+philippines|republic\s+act\s+(?:no\.?\s*)?8293|\bra\s*8293\b|\bip\s+code\b)\b',
            r'\b(?:intellectual\s+property\s+office\s+of\s+the\s+philippines|\bipophl\b|bureau\s+of\s+legal\s+affairs|\bbla\b)\b',
            r'\b(?:trademark\s+registration|trademark\s+infringement|patent\s+application|patent\s+infringement|letters\s+patent|utility\s+model|industrial\s+design|copyright\s+registration|inter\s+partes\s+proceedings|unfair\s+competition\s+under\s+section\s+168)\b',
        ],
        "secondary": [
            r'\b(?:copyright\s+infringement|infringing\s+goods|patent\s+claim)\b',
        ],
    },
]


def _sample_document_text(text: str, filename: Optional[str] = None, max_chars: int = 1800) -> str:
    clean = " ".join((text or "").split())
    if len(clean) > max_chars:
        clean = clean[:1200] + " " + clean[-600:]
    prefix = f"{filename} " if filename else ""
    return f"{prefix}{clean}".strip()


def classify_document_domain(
    text: str,
    filename: Optional[str] = None,
    router: Optional[DomainRouter] = None,
) -> Dict[str, Any]:
    """Classifies a document into in_domain_civil, out_of_domain_legal, or out_of_domain_non_legal."""
    combined = f"{filename or ''} {text or ''}".lower()
    if not combined.strip():
        return {
            "category": "out_of_domain_non_legal",
            "target_domain": None,
            "reason": "Document contains no readable text.",
        }

    civil_score = sum(weight for p, weight in CIVIL_LAW_DOC_PATTERNS if re.search(p, combined))
    explicit_civil_statute = bool(
        re.search(
            r'\b(?:civil\s+code|ra\s*386|republic\s+act\s+(?:no\.?\s*)?386|family\s+code|eo\s*209|executive\s+order\s+(?:no\.?\s*)?209)\b',
            combined,
        )
    )

    non_civil_scores: List[tuple[str, int]] = []
    for d in NON_CIVIL_LEGAL_DOC_DOMAINS:
        primary_hits = sum(1 for p in d["primary"] if re.search(p, combined))
        sec_hits = sum(1 for p in d.get("secondary", []) if re.search(p, combined))
        if primary_hits > 0 or (sec_hits >= 2 and civil_score < 2):
            non_civil_scores.append((d["domain"], (primary_hits * 3) + sec_hits))

    if non_civil_scores:
        non_civil_scores.sort(key=lambda x: x[1], reverse=True)
        top_domain, top_score = non_civil_scores[0]
        if top_score >= civil_score and (not explicit_civil_statute or top_score > civil_score):
            return {
                "category": "out_of_domain_legal",
                "target_domain": top_domain,
                "reason": f"Document belongs to specialized Philippine legal jurisdiction: {top_domain}.",
            }

    if civil_score >= 3 or (civil_score >= 2 and explicit_civil_statute):
        return {
            "category": "in_domain_civil",
            "target_domain": None,
            "reason": "Document contains Philippine Civil Law concepts, instruments, or stipulations.",
        }

    active_router = router if router is not None else get_shared_domain_router()
    if active_router is not None:
        sample = _sample_document_text(text, filename)
        sem = active_router.score_text(sample)
        sim_civil = sem["sim_civil"]
        sim_non = sem["sim_non"]
        best_legal_sim = sem["best_legal_sim"]
        best_domain = sem["best_domain"]

        if civil_score >= 2:
            if sim_non - sim_civil > 0.08:
                return {
                    "category": "out_of_domain_non_legal",
                    "target_domain": None,
                    "reason": "Document contains non-legal material and lacks recognized Philippine Civil Code context.",
                }
            return {
                "category": "in_domain_civil",
                "target_domain": None,
                "reason": "Document contains Philippine Civil Law concepts, instruments, or stipulations.",
            }

        if civil_score >= 1 and sim_civil >= max(sim_non, best_legal_sim):
            return {
                "category": "in_domain_civil",
                "target_domain": None,
                "reason": "Document matches Philippine Civil Law obligations, property, or family concepts.",
            }

        if best_legal_sim > max(sim_civil, sim_non) + 0.015:
            return {
                "category": "out_of_domain_legal",
                "target_domain": best_domain,
                "reason": f"Document belongs to specialized Philippine legal jurisdiction: {best_domain}.",
            }

        if sim_civil > max(sim_non, best_legal_sim) + 0.02:
            return {
                "category": "in_domain_civil",
                "target_domain": None,
                "reason": "Document matches Philippine Civil Law concepts and obligations.",
            }

        if non_civil_scores:
            return {
                "category": "out_of_domain_legal",
                "target_domain": non_civil_scores[0][0],
                "reason": f"Document belongs to specialized Philippine legal jurisdiction: {non_civil_scores[0][0]}.",
            }

        return {
            "category": "out_of_domain_non_legal",
            "target_domain": None,
            "reason": "Document contains non-legal material and lacks recognized Philippine Civil Code concepts.",
        }

    if civil_score >= 2:
        return {
            "category": "in_domain_civil",
            "target_domain": None,
            "reason": "Document contains authentic Philippine Civil Law concepts, instruments, or stipulations.",
        }
    if non_civil_scores:
        return {
            "category": "out_of_domain_legal",
            "target_domain": non_civil_scores[0][0],
            "reason": f"Document belongs to specialized Philippine legal jurisdiction: {non_civil_scores[0][0]}.",
        }
    return {
        "category": "out_of_domain_non_legal",
        "target_domain": None,
        "reason": "Document contains non-legal material and lacks recognized Philippine Civil Code concepts.",
    }
