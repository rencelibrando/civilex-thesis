import os
from typing import Dict, List, Optional, Any
import numpy as np
from sentence_transformers import SentenceTransformer

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
    "query: Hidden defects in sales and warranty against eviction redhibitory action"
]

OTHER_LEGAL_DOMAINS_ANCHORS: Dict[str, List[str]] = {
    "Philippine Labor Law (DOLE / NLRC)": [
        "query: Illegal dismissal from company without notice or 30 days statutory separation pay",
        "query: Pinasahod ako nang mababa sa minimum wage at walang 13th month pay reklamo sa DOLE",
        "query: Constructive dismissal due to workplace harassment filing complaint with NLRC labor arbiter",
        "query: Overtime pay computation holiday premium and SEnA conciliation under Labor Code of the Philippines",
        "query: Retrenchment redundancy and termination of employment by management prerogative"
    ],
    "Philippine Criminal Law (Revised Penal Code / PNP)": [
        "query: Warrantless arrest by police officer during inquest proceedings for theft robbery",
        "query: Estafa and swindling criminal complaint filed with office of the city prosecutor",
        "query: Homicide murder and physical injuries charges under Revised Penal Code bail hearing",
        "query: Nanakawan ako sa bahay paano mag-file ng criminal complaint sa pulis at prosecutor",
        "query: Cyber libel and online defamation criminal case under Cybercrime Prevention Act"
    ],
    "Philippine Tax Law (NIRC / BIR)": [
        "query: How to compute value-added tax VAT and file quarterly income tax return with BIR",
        "query: Letter of authority LOA and preliminary assessment notice PAN from Bureau of Internal Revenue",
        "query: Tax deficiency penalties and compromise settlement under National Internal Revenue Code TRAIN law",
        "query: Paano magbayad ng capital gains tax at documentary stamp tax sa pagbenta ng lupa sa BIR",
        "query: Estate tax amnesty return and donor tax computation BIR form"
    ],
    "Philippine Corporate & Commercial Law (SEC)": [
        "query: Articles of incorporation and registration requirements with Securities and Exchange Commission",
        "query: Board of directors quorum voting rights and election under Revised Corporation Code RA 11232",
        "query: Corporate dissolution insolvency and filing annual financial statements with SEC",
        "query: Securities Regulation Code compliance and stock ownership transfer certificate"
    ],
    "Philippine Data Privacy & Cybercrime (NPC)": [
        "query: Personal data breach notification and privacy rights violation under Data Privacy Act RA 10173",
        "query: National Privacy Commission complaint against unauthorized processing of sensitive personal data",
        "query: Data subject rights and privacy impact assessment PIA requirement"
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
        civil_vecs = self.embedder.encode(CIVIL_ANCHORS, normalize_embeddings=True)
        self.civil_centroid = np.mean(civil_vecs, axis=0)
        self.civil_centroid /= np.linalg.norm(self.civil_centroid)

        # 2. Non-legal centroid
        non_vecs = self.embedder.encode(NON_LEGAL_ANCHORS, normalize_embeddings=True)
        self.non_legal_centroid = np.mean(non_vecs, axis=0)
        self.non_legal_centroid /= np.linalg.norm(self.non_legal_centroid)

        # 3. Domain-specific centroids
        all_other_vecs = []
        for domain_name, anchors in OTHER_LEGAL_DOMAINS_ANCHORS.items():
            vecs = self.embedder.encode(anchors, normalize_embeddings=True)
            domain_centroid = np.mean(vecs, axis=0)
            domain_centroid /= np.linalg.norm(domain_centroid)
            self.domain_centroids[domain_name] = domain_centroid
            all_other_vecs.append(domain_centroid)

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
        q_vec = self.embedder.encode(q_text, normalize_embeddings=True)

        sim_civil = float(np.dot(q_vec, self.civil_centroid))
        sim_non = float(np.dot(q_vec, self.non_legal_centroid))

        best_domain = max(
            self.domain_centroids.keys(),
            key=lambda d: float(np.dot(q_vec, self.domain_centroids[d]))
        )
        best_legal_sim = float(np.dot(q_vec, self.domain_centroids[best_domain]))

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
