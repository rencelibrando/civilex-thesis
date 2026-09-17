# CIVIL-LEX: Expert Lawyer Validation Instrument & Rubric
**Thesis Title:** CIVIL LEX: A Retrieval-Augmented Generation Framework Using Transformer-Based Neural Networks for Explainable Interpretation of Philippine Civil Law  
**Researchers:** Dela Peña, Raiven; Garcia, John JM Cedrick; Librando, Clarence; Roxas, Rain Rhailli  
**Adviser:** Dr. Kathleen M. Dimaano  

---

## 1. Overview & Purpose
This instrument is designed to satisfy the panel recommendation from **Dr. Sheila Marie M. Matias** during the proposal defense:
> *"Output must be validated by lawyers."*
> *"Include All Criteria in ISO 25010."*

Licensed Philippine attorneys and legal scholars evaluate the system's responses across five key legal dimensions using a 5-point Likert Scale (5 = Excellent/Fully Accurate, 1 = Very Poor/Inaccurate).

---

## 2. Evaluation Criteria & Scoring Rubric

| Criterion | Description | 5 - Excellent | 3 - Acceptable | 1 - Unacceptable |
| :--- | :--- | :--- | :--- | :--- |
| **1. Statutory Correctness (Civil Code)** | Accuracy of cited Philippine Civil Code (RA 386) articles and their doctrinal elements. | Citations are exact, governing provisions are correct, and elements of the law are precisely explained. | Relevant articles are cited, but secondary provisions are missing or partially explained. | Irrelevant or incorrect articles cited, or complete misstatement of law. |
| **2. Jurisdictional Accuracy (RA 11576)** | Proper determination of court authority (MTC vs. RTC, Family Court, Katarungang Pambarangay). | Correctly distinguishes MTC ($\le$ ₱2M) vs RTC ($>$ ₱2M), Katarungang Pambarangay pre-condition, or Family Court (RA 8369). | Mentions court jurisdiction but lacks monetary threshold or pre-condition caveat. | Recommends the wrong court or completely misapplies jurisdictional thresholds. |
| **3. Cause of Action Formulation** | Technical correctness of the recommended action or petition to file. | Precisely names the correct remedy (e.g., *Action for Specific Performance*, *Rescission under Art. 1191*, *Quasi-Delict Art. 2176*). | Mentions a viable remedy but uses colloquial or non-technical naming. | Recommends a legally non-existent or improper cause of action. |
| **4. Grounding & Faithfulness (No Hallucination)** | Whether all legal conclusions and facts strictly derive from the statutory context. | 100% faithful to the text of RA 386; zero legal hallucinations or fabricated doctrines. | Minor embellishment that does not affect legal soundness. | Severe hallucination of non-existent articles, case rulings, or penalties. |
| **5. Plain-Language Explainability** | Accessibility and clarity of the explanation for ordinary Filipino citizens. | Plain, crystal-clear explanation in English or Filipino without loss of legal rigor. | Understandable but excessively burdened with heavy legalese. | Confusing, convoluted, or misleading to an ordinary litigant. |

---

## 3. Evaluation Form Template

**Evaluator Information:**  
- Name (Optional): _____________________________________________  
- Roll of Attorneys No. / IBP Chapter: __________________________  
- Years in Active Practice: [ ] 1–5 yrs  [ ] 6–10 yrs  [ ] 10+ yrs  
- Field of Specialization: [ ] Civil Litigation  [ ] Family Law  [ ] Corporate/Contracts  [ ] General Practice  

### Sample Test Case Evaluation Matrix

| Case # | Scenario Category | Statutory Score (1-5) | Jurisdiction Score (1-5) | Cause of Action Score (1-5) | Faithfulness Score (1-5) | Explainability Score (1-5) | Evaluator Remarks |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **01** | Breach of Construction Contract (Rescission) | | | | | | |
| **02** | Vehicular Accident & Vicarious Liability (Torts) | | | | | | |
| **03** | Hidden Defect in Used Vehicle (Sales) | | | | | | |
| **04** | Psychological Incapacity (Family Code Art. 36) | | | | | | |
| **05** | Unpaid Loan under Promissory Note (Obligations) | | | | | | |
| **06** | Neighbor Nuisance & Boundary Dispute (Property) | | | | | | |
| **07** | Non-Civil Redirection (Illegal Dismissal / Labor) | | | | | | |
| **08** | Non-Civil Redirection (Estafa / Criminal Offense) | | | | | | |

---

## 4. Acceptance Threshold
For the system to be classified as acceptable for the thesis defense:
- **Mean Legal Correctness Score** $\ge 4.20 / 5.00$ ($84\%$)
- **Zero Critical Legal Hallucinations** ($100\%$ grounding verified via NLI entailment).
- **Statutory Article Recall** $\ge 85\%$ across benchmark sets.
