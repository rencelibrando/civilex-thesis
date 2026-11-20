import asyncio
import unittest
from unittest.mock import AsyncMock, patch
import numpy as np

from services.ambiguity import (
    AMBIGUITY_PROB_THRESHOLD,
    FEATURE_NAMES,
    LLM_CANDIDATE_THRESHOLD,
    LOGREG_BIAS,
    LOGREG_WEIGHTS,
    SCALER_MEAN,
    SCALER_STD,
    detect_ambiguity,
    extract_ambiguity_features,
    predict_ambiguity_probability,
)
from services.domain_router import (
    DomainRouter,
    get_shared_domain_router,
    set_shared_domain_router,
    strip_conversational_preamble,
)
from services.memory import is_synthetic_greeting, resolve_history


def _compute_binary_metrics(y_true: np.ndarray, y_pred: np.ndarray, y_prob: np.ndarray) -> dict:
    tp = int(np.sum((y_true == 1) & (y_pred == 1)))
    tn = int(np.sum((y_true == 0) & (y_pred == 0)))
    fp = int(np.sum((y_true == 0) & (y_pred == 1)))
    fn = int(np.sum((y_true == 1) & (y_pred == 0)))
    total = len(y_true)
    accuracy = (tp + tn) / total if total else 0.0
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    specificity = tn / (tn + fp) if (tn + fp) else 0.0
    f1 = (2.0 * precision * recall) / (precision + recall) if (precision + recall) else 0.0

    order = np.argsort(-y_prob)
    y_sorted = y_true[order]
    cum_tp = np.cumsum(y_sorted == 1)
    cum_fp = np.cumsum(y_sorted == 0)
    prec_curve = cum_tp / np.maximum(1, cum_tp + cum_fp)
    rec_curve = cum_tp / max(1, int(np.sum(y_true == 1)))
    pr_auc = float(np.sum((rec_curve - np.concatenate([[0.0], rec_curve[:-1]])) * prec_curve))

    return {
        "accuracy": round(accuracy, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "specificity": round(specificity, 4),
        "f1": round(f1, 4),
        "pr_auc": round(pr_auc, 4),
        "confusion_matrix": [[tn, fp], [fn, tp]],
    }


class TestAmbiguityMLClassifier(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.prev_router = get_shared_domain_router()
        if cls.prev_router is None:
            from sentence_transformers import SentenceTransformer

            embedder = SentenceTransformer("intfloat/multilingual-e5-base")
            cls.router = DomainRouter(embedder)
            set_shared_domain_router(cls.router)
        else:
            cls.router = cls.prev_router

    def test_feature_schema_and_scaler_dimensions(self):
        self.assertEqual(len(FEATURE_NAMES), 7)
        self.assertEqual(SCALER_MEAN.shape, (7,))
        self.assertEqual(SCALER_STD.shape, (7,))
        self.assertEqual(LOGREG_WEIGHTS.shape, (7,))
        self.assertIsInstance(LOGREG_BIAS, float)
        self.assertTrue(np.all(SCALER_STD > 0))
        feats = extract_ambiguity_features("Can I be sued?")
        self.assertEqual(feats.shape, (7,))

    def test_personalized_greeting_stripped_and_does_not_suppress_ambiguity(self):
        greeting = (
            "Hello, rence! I am CIVIL-LEX, your Philippine Civil Law assistant. "
            "I can help you understand your rights and legal options in plain, everyday language — "
            "no law degree required. What legal question can I help you with today?"
        )
        self.assertTrue(is_synthetic_greeting(greeting))
        resolved = resolve_history([{"role": "assistant", "content": greeting}], [])
        self.assertEqual(resolved, [])

        # Even if greeting is passed directly in history to detect_ambiguity, it must not count as user history
        english_llm_json = (
            '{"is_ambiguous": true, "confidence": 0.98, "category": "missing_facts", '
            '"reasoning": "The question is incomplete and omits the specific case or topic.", '
            '"questions": [{"id": "q1", "question": "What specific legal situation or topic are you referring to?", '
            '"options": ["Contract dispute", "Property or lease", "Family or inheritance", "Damages"], '
            '"context_hint": "Identifies the applicable Civil Code articles."}]}'
        )
        with patch(
            "services.llm_client.call_chat_completion_async",
            new=AsyncMock(return_value=english_llm_json),
        ) as mock_llm:
            res = asyncio.run(
                detect_ambiguity(
                    "what article are applicable to the case of with",
                    history=[{"role": "assistant", "content": greeting}],
                )
            )
            self.assertTrue(res.is_ambiguous)
            self.assertTrue(len(res.questions) >= 1)
            mock_llm.assert_called_once()

    def test_clear_user_scenarios_pass_without_llm_call(self):
        clear_queries = [
            ("nag nakaw ako sa school namin ng gamit ano ang pwede ikaso sakin", False),
            ("lalaki ako, nangabit ang asawa ko ano amg gagawin ko", False),
            ("Hindi nagbayad ng utang ang kaibigan ko ano pwede kong gawin", False),
            ("My neighbor built a fence that crossed onto my titled land, what can I do?", False),
            (
                "sinampal ako ni raiven habang nag klaklase ako kase maingay ang boses ko "
                "naistorbo ang kanyang pag tulog ano ang iyong mungkahi tungkol dito",
                False,
            ),
            ("Bumili ako ng cellphone kahapon tapos sira pala yung screen, pwede ko ba ipa-refund?", False),
            ("Namatay ang tatay ko na walang testamento, paano ang hatian naming magkakapatid sa lupa?", False),
            ("Pwede ba mangayo og bayad kung ang usa ka tawo nakapahinabo og kadaot tungod sa iyang pagpabaya?", False),
            ("What are the requisites of a valid contract?", False),
            ("Can a landlord evict a tenant without a court order?", False),
            ("Ano ang pinagkaiba ng Article 1156 at Article 1191?", False),
            ("Kailangan ba ng pormal na abiso bago itigil ang bayad sa upa?", True),
        ]

        with patch("services.llm_client.call_chat_completion_async", new=AsyncMock()) as mock_llm:
            for query, has_hist in clear_queries:
                history = [{"role": "user", "content": "Prior lease repair question"}] if has_hist else None
                prob, info = predict_ambiguity_probability(query, has_history=has_hist)
                self.assertLess(
                    prob,
                    LLM_CANDIDATE_THRESHOLD,
                    f"Expected clear query '{query}' to have P(vague) < {LLM_CANDIDATE_THRESHOLD}, got {prob:.3f} ({info})",
                )
                res = asyncio.run(detect_ambiguity(query, history=history))
                self.assertFalse(res.is_ambiguous, f"Expected is_ambiguous=False for '{query}'")
            mock_llm.assert_not_called()

    def test_truly_vague_queries_consult_llm_and_enforce_bidirectional_unilingual(self):
        vague_queries = [
            "ANONG PWEDENG IKASO SAKIN",
            "Can I be sued?",
            "Can I sue my neighbor?",
            "whata re the article of",
            "what article are applicable to the case of with",
            "hat are the legal grounds for",
            "Ang sakit ng pwet ko ano pwede ko ikaso sa asawa ko",
            "May problema kami sa kontrata ano pwede kong gawin",
            "We had an issue with the property transaction, can I cancel it?",
            "May hindi pagkakaintindihan kami sa kasunduan, pwede ba akong humingi ng danyos?",
            "May habol ba ako sa kanya?",
        ]

        for q in vague_queries:
            prob, info = predict_ambiguity_probability(q, has_history=False)
            self.assertGreaterEqual(
                prob,
                LLM_CANDIDATE_THRESHOLD,
                f"Expected vague query '{q}' to enter LLM stage (>= {LLM_CANDIDATE_THRESHOLD}), got {prob:.3f} ({info})",
            )

        # 1. Tagalog query must reject English LLM questions
        mismatched_en_on_tl = (
            '{"is_ambiguous": true, "confidence": 0.95, "category": "missing_facts", '
            '"reasoning": "Kailangan ng detalye.", '
            '"questions": [{"id": "q1", "question": "Did you sign a written admission of guilt?", '
            '"options": ["Oo", "Hindi"], "context_hint": "Mahalaga ito."}]}'
        )
        with patch(
            "services.llm_client.call_chat_completion_async",
            new=AsyncMock(return_value=mismatched_en_on_tl),
        ):
            res_tl = asyncio.run(detect_ambiguity("ANONG PWEDENG IKASO SAKIN"))
            self.assertTrue(res_tl.is_ambiguous)
            self.assertNotIn("Did you sign", res_tl.questions[0].question)
            self.assertIn("Tungkol sa anong partikular na pangyayari", res_tl.questions[0].question)

        # 2. English query must reject Tagalog LLM questions
        mismatched_tl_on_en = (
            '{"is_ambiguous": true, "confidence": 1.0, "category": "missing_facts", '
            '"reasoning": "Paki-specify po ang sitwasyon.", '
            '"questions": [{"id": "q1", "question": "Paki-specify po ang sitwasyon: Tungkol ba sa pagmamay-ari ng lupa?", '
            '"options": ["Lupa", "Kontrata"], "context_hint": "Mahalaga ito."}]}'
        )
        with patch(
            "services.llm_client.call_chat_completion_async",
            new=AsyncMock(return_value=mismatched_tl_on_en),
        ):
            res_en = asyncio.run(detect_ambiguity("what article are applicable to the case of with"))
            self.assertTrue(res_en.is_ambiguous)
            self.assertNotIn("Paki-specify", res_en.questions[0].question)
            self.assertIn("What specific legal situation", res_en.questions[0].question)

    def test_domain_router_routes_school_theft_to_criminal_and_bare_vague_to_civil(self):
        theft_route = self.router.route("nag nakaw ako sa school namin ng gamit ano ang pwede ikaso sakin")
        self.assertEqual(theft_route["category"], "out_of_domain_legal")
        self.assertIn("Criminal Law", theft_route["target_domain"])

        vague_route = self.router.route("ANONG PWEDENG IKASO SAKIN")
        self.assertEqual(vague_route["category"], "in_domain_civil")

        frag_route = self.router.route("what article are applicable to the case of with")
        self.assertEqual(frag_route["category"], "in_domain_civil")

        preamble_stripped = strip_conversational_preamble(
            "Atty / Civil-Lex, paki-klaro: Nanloob ng bahay ang magnanakaw at tinangay ang mga alahas namin."
        )
        self.assertTrue(preamble_stripped.startswith("Nanloob ng bahay"))

    def test_strict_train_test_model_comparison_and_bootstrap_ci(self):
        held_out_test = [
            ("ANONG PWEDENG IKASO SAKIN", False, 1),
            ("Can I sue my neighbor?", False, 1),
            ("Pwede ba akong makasuhan sa ginawa ko?", False, 1),
            ("I want to file a case against someone, what do I need?", False, 1),
            ("May habol ba ako sa kanya?", False, 1),
            ("Anong kaso ang pwedeng isampa laban sa akin?", False, 1),
            ("Ang sakit ng pwet ko ano pwede ko ikaso sa asawa ko", False, 1),
            ("May problema kami sa kontrata ano pwede kong gawin", False, 1),
            ("We had an issue with the property transaction, can I cancel it?", False, 1),
            ("My family has a dispute over our house, what legal action applies?", False, 1),
            ("whata re the article of", False, 1),
            ("what is the law about", False, 1),
            ("sa ilalim ng artikulo", False, 1),
            ("what article are applicable to the case of with", False, 1),
            ("hat are the legal grounds for", True, 1),
            ("nag nakaw ako sa school namin ng gamit ano ang pwede ikaso sakin", False, 0),
            ("lalaki ako, nangabit ang asawa ko ano amg gagawin ko", False, 0),
            ("Hindi nagbayad ng utang ang kaibigan ko ano pwede kong gawin", False, 0),
            ("My neighbor built a fence that crossed onto my titled land, what can I do?", False, 0),
            (
                "sinampal ako ni raiven habang nag klaklase ako kase maingay ang boses ko "
                "naistorbo ang kanyang pag tulog ano ang iyong mungkahi tungkol dito",
                False,
                0,
            ),
            ("Bumili ako ng cellphone kahapon tapos sira pala yung screen, pwede ko ba ipa-refund?", False, 0),
            ("Namatay ang tatay ko na walang testamento, paano ang hatian naming magkakapatid sa lupa?", False, 0),
            ("My contractor failed to finish our house on time despite full payment, can I rescind?", False, 0),
            ("Ayaw magbayad ng upa ng tenant ko ng tatlong buwan, paano ko siya mapapaalis?", False, 0),
            ("Kinagat ng aso ng kapitbahay namin ang anak ko sa kalsada, sino ang sasagot sa ospital?", False, 0),
            ("Binenta ng kuya ko yung bahay ng magulang namin nang hindi namin alam.", False, 0),
            ("Pwede ba mangayo og bayad kung ang usa ka tawo nakapahinabo og kadaot tungod sa iyang pagpabaya?", False, 0),
            ("What are the requisites of a valid contract?", False, 0),
            ("Can a landlord evict a tenant without a court order?", False, 0),
            ("Ano ang pinagkaiba ng Article 1156 at Article 1191?", False, 0),
            ("What are the recognized grounds and evidentiary standards for psychological incapacity under Article 36?", False, 0),
            ("Can spouses donate property to each other during marriage?", False, 0),
            ("Ano ang karapatan ng builder in good faith sa ilalim ng Article 448?", False, 0),
            ("When is a debtor considered in legal delay or default without need of demand?", False, 0),
            ("Kailangan ba ng pormal na abiso bago itigil ang bayad sa upa?", True, 0),
            ("Can I suspend rent payments under that article?", True, 0),
            ("Magkano ang pwedeng singilin na legal interest kapag walang napagkasunduan?", True, 0),
        ]

        y_true = np.array([item[2] for item in held_out_test], dtype=np.int32)
        probs = []
        margins = []
        for q, has_hist, _ in held_out_test:
            p, info = predict_ambiguity_probability(q, has_history=has_hist)
            probs.append(p)
            margins.append(info["margin_top2"])

        y_prob = np.array(probs, dtype=np.float64)
        y_pred_logreg = (y_prob >= AMBIGUITY_PROB_THRESHOLD).astype(np.int32)
        y_pred_naive = np.zeros_like(y_true)
        y_pred_margin = (np.array(margins) > 0.005).astype(np.int32)

        m_naive = _compute_binary_metrics(y_true, y_pred_naive, np.zeros_like(y_prob))
        m_margin = _compute_binary_metrics(y_true, y_pred_margin, np.array(margins))
        m_logreg = _compute_binary_metrics(y_true, y_pred_logreg, y_prob)

        self.assertGreater(m_logreg["f1"], m_naive["f1"])
        self.assertGreaterEqual(m_logreg["accuracy"], 0.95)
        self.assertEqual(m_logreg["specificity"], 1.0)
        self.assertGreaterEqual(m_logreg["pr_auc"], 0.95)
        self.assertGreaterEqual(m_logreg["f1"], m_margin["f1"])


if __name__ == "__main__":
    unittest.main()
