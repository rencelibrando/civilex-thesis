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
    "query: Can I be sued for damages civil liability breach of contract or quasi-delict",
    "query: Ano ang mga kaso o pananagutan sa civil law kapag may nagawang pagkukulang o pinsala",
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

        # Fast path 1: Explicit statutory article references always route to civil law
        if has_article_ref:
            return {
                "category": "in_domain_civil",
                "target_domain": None,
                "reason": "Explicit statutory article reference detected."
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

        model_name = os.getenv("EMBEDDING_MODEL_NAME", "intfloat/multilingual-e5-base").lower()
        q_text = f"query: {q_strip}" if "e5" in model_name else q_strip
        q_vec = self.embedder.encode(q_text, normalize_embeddings=True, show_progress_bar=False)

        sim_civil = float(np.dot(q_vec, self.civil_centroid))
        sim_non = float(np.dot(q_vec, self.non_legal_centroid))

        domain_sims = np.dot(self.domain_matrix, q_vec)
        best_idx = int(np.argmax(domain_sims))
        best_legal_sim = float(domain_sims[best_idx])
        best_domain = self.domain_names[best_idx]

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
