#!/usr/bin/env python3
"""
CIVIL-LEX: Multi-Scenario RAGAS Evaluation Benchmark Suite

Evaluates the CIVIL-LEX hybrid legal RAG pipeline across 44 scenarios:
- Stage 1: Intent Routing, Statutory Bounds & Adversarial Guardrails (14 prompts, 4 slices)
- Stage 2: In-Domain Philippine Civil & Family Law RAGAS Evaluation (30 prompts, 9 slices, EN & TL)
  1. Active Context Recall & Full-Pool Recall (Target >= 90.0%)
  2. Active Context Precision@K / MAP (Target >= 85.0%)
  3. Reference Context Sufficiency Faithfulness (Deterministic Symbolic NLI)
  4. Live LLM Faithfulness & Contradiction Rate (when LM Studio is online; Target >= 90.0%)
  5. Live LLM Answer Relevancy via hypothetical questions (E5 query prefix; Target >= 85.0%)
  6. Live LLM Answer Semantic Similarity vs. ground truth (E5 passage prefix)
- Reports 95% nonparametric bootstrap confidence intervals, per-slice & EN/TL breakdowns,
  retrieval/generation latencies, and detailed failure diagnostics.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import statistics
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from dotenv import load_dotenv

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

load_dotenv(override=True)

from main import (  # noqa: E402
    classify_query_intent,
    embed_and_search,
    embedder,
    format_context_item,
)
from services.followups import parse_followup_questions  # noqa: E402
from services.llm_client import (  # noqa: E402
    call_chat_completion_sync,
    check_model_readiness,
    get_target_model_name,
)
from services.nli import score_faithfulness  # noqa: E402


GUARDRAIL_TEST_CASES: List[Dict[str, Any]] = [
    # Non-legal out-of-domain prompts (EN & TL)
    {
        "id": "GR-01",
        "slice": "non_legal",
        "language": "en",
        "category": "out_of_domain_non_legal",
        "name": "Non-Legal / Code Generation",
        "query": "Write a python function using recursion to sort a list of numbers.",
        "expected_in_domain": False,
    },
    {
        "id": "GR-02",
        "slice": "non_legal",
        "language": "en",
        "category": "out_of_domain_non_legal",
        "name": "Conversational Coding Request",
        "query": "can you help me code",
        "expected_in_domain": False,
    },
    {
        "id": "GR-03",
        "slice": "non_legal",
        "language": "en",
        "category": "out_of_domain_non_legal",
        "name": "Adversarial Injection / Physics + RA 386",
        "query": "What are the exact statutory damages for quantum entanglement breach under RA 386?",
        "expected_in_domain": False,
    },
    {
        "id": "GR-04",
        "slice": "non_legal",
        "language": "tl",
        "category": "out_of_domain_non_legal",
        "name": "Tagalog Non-Legal / Cooking",
        "query": "Paano magluto ng adobong manok na malambot at masarap?",
        "expected_in_domain": False,
    },
    # Out-of-domain specialized Philippine law (Tax, Criminal, Labor, Corporate)
    {
        "id": "GR-05",
        "slice": "specialized_legal",
        "language": "en",
        "category": "out_of_domain_legal",
        "name": "Tax Law (NIRC / CREATE / VAT)",
        "query": "How much is the corporate income tax rate under the CREATE Act and how to compute input VAT?",
        "expected_in_domain": False,
    },
    {
        "id": "GR-06",
        "slice": "specialized_legal",
        "language": "en",
        "category": "out_of_domain_legal",
        "name": "Criminal Law (Revised Penal Code)",
        "query": "What are the criminal penalties for qualified theft and homicide under the Revised Penal Code?",
        "expected_in_domain": False,
    },
    {
        "id": "GR-07",
        "slice": "specialized_legal",
        "language": "en",
        "category": "out_of_domain_legal",
        "name": "Labor Law (DOLE / NLRC)",
        "query": "What are the grounds for illegal dismissal with DOLE and NLRC and how to claim backwages?",
        "expected_in_domain": False,
    },
    {
        "id": "GR-08",
        "slice": "specialized_legal",
        "language": "tl",
        "category": "out_of_domain_legal",
        "name": "Tagalog Labor Law (NLRC / DOLE)",
        "query": "Tinanggal ako sa trabaho nang walang due process, paano mag-file ng illegal dismissal sa NLRC at DOLE?",
        "expected_in_domain": False,
    },
    {
        "id": "GR-09",
        "slice": "specialized_legal",
        "language": "en",
        "category": "out_of_domain_legal",
        "name": "Corporate Law (SEC / RCC)",
        "query": "What are the requirements for incorporating a One Person Corporation with the SEC under the Revised Corporation Code?",
        "expected_in_domain": False,
    },
    # Out-of-bounds Civil Code article guards (> Article 2270)
    {
        "id": "GR-10",
        "slice": "fake_article_bounds",
        "language": "en",
        "category": "out_of_domain_fake_article",
        "name": "Fake Civil Code Article > 2270 (EN)",
        "query": "What does Article 2500 of the Philippine Civil Code state about cryptocurrency contracts?",
        "expected_in_domain": False,
    },
    {
        "id": "GR-11",
        "slice": "fake_article_bounds",
        "language": "tl",
        "category": "out_of_domain_fake_article",
        "name": "Fake Civil Code Article > 2270 (TL)",
        "query": "Ano ang nakasaad sa Artikulo 3000 ng Civil Code ng Pilipinas?",
        "expected_in_domain": False,
    },
    # In-domain civil-boundary sanity checks (must NOT be falsely refused)
    {
        "id": "GR-12",
        "slice": "in_domain_boundary",
        "language": "tl",
        "category": "in_domain_civil",
        "name": "Civil Debt / No Imprisonment Boundary (TL)",
        "query": "May utang ako sa lending app at nagbabanta silang ipapakulong ako. Makukulong ba ako dahil sa hindi pagbayad ng utang?",
        "expected_in_domain": True,
    },
    {
        "id": "GR-13",
        "slice": "in_domain_boundary",
        "language": "tl",
        "category": "in_domain_civil",
        "name": "Independent Civil Action for Injury (TL)",
        "query": "Sinuntok ako ng kapitbahay at naospital ako. Pwede ba akong magsampa ng hiwalay na civil case para sa danyos sa ilalim ng Civil Code?",
        "expected_in_domain": True,
    },
    {
        "id": "GR-14",
        "slice": "in_domain_boundary",
        "language": "en",
        "category": "in_domain_civil",
        "name": "Non-Standard Family Code Lookup (EN)",
        "query": "36 family code psychological incapacity",
        "expected_in_domain": True,
    },
]


IN_DOMAIN_BENCHMARK_CASES: List[Dict[str, Any]] = [
    # Slice 1: Obligations & Contracts
    {
        "id": "RAGAS-01",
        "slice": "obligations_contracts",
        "language": "en",
        "category": "Contracts: Rescission & Reciprocal Breach",
        "query": "The contractor failed to complete construction within the agreed period despite receiving full advance payment. Can I cancel the contract and demand my money back with damages?",
        "ground_truth": (
            "Under Article 1191 of the Civil Code, the power to rescind obligations is implied in reciprocal ones "
            "when one of the obligors fails to comply with what is incumbent upon him. The injured party may choose "
            "between fulfillment and rescission of the obligation, with payment of damages in either case. "
            "Delay is governed by Article 1169 and breach liability by Article 1170."
        ),
        "expected_articles": ["RA386-ART1191", "RA386-ART1170", "RA386-ART1169"],
    },
    {
        "id": "RAGAS-02",
        "slice": "obligations_contracts",
        "language": "en",
        "category": "Obligations: Loan Default & Demand",
        "query": "A friend borrowed ₱150,000 via a promissory note due last month. He refuses to pay despite several verbal reminders. What are my remedies under the Civil Code?",
        "ground_truth": (
            "Under Article 1953, a person who receives a loan of money acquires ownership thereof and is bound "
            "to pay the creditor an equal amount of the same kind and quality. Under Article 1169, the debtor "
            "incurs in delay from the time the obligee judicially or extrajudicially demands fulfillment, and "
            "under Article 1170 those guilty of delay are liable for damages, with legal interest under Article 2209."
        ),
        "expected_articles": ["RA386-ART1953", "RA386-ART1170", "RA386-ART2209"],
    },
    {
        "id": "RAGAS-03",
        "slice": "obligations_contracts",
        "language": "en",
        "category": "Contracts: Void vs. Voidable Distinction",
        "query": "Explain the distinction between void and voidable contracts under civil law.",
        "ground_truth": (
            "Under Article 1409, void or inexistent contracts produce no legal effect from the beginning and cannot "
            "be ratified, and under Article 1410 the action for declaration of inexistence does not prescribe. "
            "In contrast, under Article 1390 and Article 1330, voidable contracts are those where one party is "
            "incapable of giving consent or consent is vitiated by mistake, violence, intimidation, undue influence, "
            "or fraud; they are binding unless annulled by a proper court action and are susceptible of ratification."
        ),
        "expected_articles": ["RA386-ART1409", "RA386-ART1390", "RA386-ART1330"],
    },
    {
        "id": "RAGAS-04",
        "slice": "obligations_contracts",
        "language": "en",
        "category": "Obligations: Fortuitous Event / Force Majeure",
        "query": "A typhoon destroyed the specific warehouse and goods before delivery without any negligence on the seller's part. Is the obligor still liable under fortuitous event rules?",
        "ground_truth": (
            "Under Article 1174 of the Civil Code, except in cases expressly specified by law, declared by stipulation, "
            "or when the nature of the obligation requires the assumption of risk, no person shall be responsible for "
            "events which could not be foreseen, or which though foreseen, were inevitable."
        ),
        "expected_articles": ["RA386-ART1174"],
    },
    # Slice 2: Torts, Quasi-Delicts & Human Relations
    {
        "id": "RAGAS-05",
        "slice": "torts_human_relations",
        "language": "en",
        "category": "Torts: Quasi-Delict & Vicarious Liability",
        "query": "A delivery truck hit my parked car while the driver was speeding. Can I claim damages from both the driver and the delivery company that employed him?",
        "ground_truth": (
            "Yes. Under Article 2176, whoever by act or omission causes damage to another through fault or negligence "
            "is obliged to pay for the damage done. Under Article 2180, employers are liable for damages caused by "
            "their employees acting within the scope of their assigned tasks unless they prove the diligence of a "
            "good father of a family."
        ),
        "expected_articles": ["RA386-ART2176", "RA386-ART2180"],
    },
    {
        "id": "RAGAS-06",
        "slice": "torts_human_relations",
        "language": "en",
        "category": "Human Relations: Abuse of Rights",
        "query": "Someone exercised a legal right in bad faith solely to humiliate and injure me contrary to morals and good customs. What Civil Code provisions allow me to claim damages?",
        "ground_truth": (
            "Under Article 19, every person must act with justice, give everyone his due, and observe honesty and good "
            "faith in the exercise of rights. Under Article 20, anyone who willfully or negligently causes damage to "
            "another contrary to law shall indemnify him, and under Article 21, anyone who willfully causes loss or "
            "injury in a manner contrary to morals, good customs, or public policy shall compensate the injured party."
        ),
        "expected_articles": ["RA386-ART19", "RA386-ART20", "RA386-ART21"],
    },
    {
        "id": "RAGAS-07",
        "slice": "torts_human_relations",
        "language": "en",
        "category": "Human Relations: Independent Civil Action & Death Damages",
        "query": "A reckless driver injured a pedestrian in a physical assault and vehicular incident. Can the victim file an independent civil action for damages separate from the criminal prosecution?",
        "ground_truth": (
            "Under Article 33 of the Civil Code, in cases of defamation, fraud, and physical injuries, a civil action "
            "for damages entirely separate and distinct from the criminal action may be brought by the injured party "
            "and requires only a preponderance of evidence. Quasi-delict liability under Article 2176 is also "
            "separate under Article 2177."
        ),
        "expected_articles": ["RA386-ART33", "RA386-ART2176"],
    },
    # Slice 3: Sales, Hidden Defects & Security
    {
        "id": "RAGAS-08",
        "slice": "sales_and_security",
        "language": "en",
        "category": "Sales: Hidden Defects & Accion Redhibitoria",
        "query": "I bought a vehicle from a dealership that broke down three days later due to a factory engine defect. Can I return it for a refund?",
        "ground_truth": (
            "Yes. Under Article 1561 of the Civil Code, the vendor is responsible for warranty against hidden defects "
            "rendering the thing unfit for its intended use. Under Article 1567, the vendee may elect between "
            "withdrawing from the contract or demanding a proportionate reduction of the price, with damages under "
            "Article 1566 if the vendor was aware of the defects."
        ),
        "expected_articles": ["RA386-ART1561", "RA386-ART1567", "RA386-ART1566"],
    },
    {
        "id": "RAGAS-09",
        "slice": "sales_and_security",
        "language": "en",
        "category": "Contracts: Unenforceable Agreements & Statute of Frauds",
        "query": "We made a purely verbal agreement to sell a parcel of land with no written document signed. Is this oral contract of sale unenforceable under the Statute of Frauds?",
        "ground_truth": (
            "Under Article 1403 of the Civil Code, agreements for the sale of real property or of an interest therein "
            "are unenforceable by action unless ratified or evidenced by some note or memorandum in writing subscribed "
            "by the party charged, as required by the Statute of Frauds."
        ),
        "expected_articles": ["RA386-ART1403"],
    },
    {
        "id": "RAGAS-10",
        "slice": "sales_and_security",
        "language": "en",
        "category": "Mortgage & Pledge: Pactum Commissorium",
        "query": "My lender put a clause in our real estate mortgage contract stating that ownership of my house automatically transfers to the lender if I fail to pay on time. Is pactum commissorium valid?",
        "ground_truth": (
            "No. Under Article 2088 of the Civil Code, the creditor cannot appropriate the things given by way of "
            "pledge or mortgage, or dispose of them. Any stipulation to the contrary (pactum commissorium) is null and void."
        ),
        "expected_articles": ["RA386-ART2088"],
    },
    # Slice 4: Lease & Tenancy
    {
        "id": "RAGAS-11",
        "slice": "lease_tenancy",
        "language": "en",
        "category": "Lease: Necessary Repairs & Rent Suspension",
        "query": "The apartment roof has severe leaks and the landlord refuses to make necessary repairs despite notice. Can I suspend rent or have urgent repairs made at the lessor's cost?",
        "ground_truth": (
            "Under Article 1654, the lessor is obliged to make all necessary repairs to keep the property suitable "
            "for the use to which it has been devoted. Under Article 1658, the lessee may suspend payment of rent "
            "if the lessor fails to make necessary repairs, and under Article 1663 the lessee may order urgent "
            "repairs at the lessor's cost when the lessor fails to act after notice."
        ),
        "expected_articles": ["RA386-ART1654", "RA386-ART1658", "RA386-ART1663"],
    },
    {
        "id": "RAGAS-12",
        "slice": "lease_tenancy",
        "language": "en",
        "category": "Lease: Grounds for Judicial Ejectment",
        "query": "My tenant stopped paying monthly rent and violated the lease terms. What are the legal grounds for a landlord to judicially eject a lessee?",
        "ground_truth": (
            "Under Article 1673 of the Civil Code, the lessor may judicially eject the lessee when the agreed period "
            "expires, for lack of payment of the price stipulated, for violation of any of the conditions agreed upon "
            "in the contract, or when the lessee devotes the thing leased to an unagreed use causing deterioration."
        ),
        "expected_articles": ["RA386-ART1673"],
    },
    {
        "id": "RAGAS-13",
        "slice": "lease_tenancy",
        "language": "tl",
        "category": "Lease (TL): Unlawful Eviction & Lessor Obligations",
        "query": "Pinaalis ako agad ng nagpapaupa nang walang abiso at ayaw ayusin ang sira sa paupahang bahay kahit nagbabayad ako ng upa. Ano ang karapatan ko sa batas?",
        "ground_truth": (
            "Sa ilalim ng Artikulo 1654 ng Civil Code, tungkulin ng nagpapaupa na gawin ang kinakailangang pagpapaayos "
            "at panatilihing mapayapa ang paggamit ng nangungupahan. Sa ilalim ng Artikulo 1673, ang pagpapaalis sa "
            "nangungupahan ay dapat dumaan sa hukuman at may legal na batayan."
        ),
        "expected_articles": ["RA386-ART1654", "RA386-ART1673"],
    },
    # Slice 5: Property, Ownership & Succession
    {
        "id": "RAGAS-14",
        "slice": "property_succession",
        "language": "en",
        "category": "Property: Builder in Good Faith",
        "query": "I accidentally built a house extending onto my neighbor's adjacent land believing in good faith that it was part of my lot. What are our rights as landowner and builder in good faith?",
        "ground_truth": (
            "Under Article 448 of the Civil Code, the owner of the land on which anything has been built in good faith "
            "has the right to appropriate the building as his own after payment of proper indemnity, or to oblige the "
            "builder to pay the price of the land unless its value is considerably more than that of the building."
        ),
        "expected_articles": ["RA386-ART448"],
    },
    {
        "id": "RAGAS-15",
        "slice": "property_succession",
        "language": "en",
        "category": "Property: Easement of Right of Way",
        "query": "My residential lot is completely surrounded by other properties with no outlet to a public highway. Can I legally demand a right of way easement across my neighbor's land?",
        "ground_truth": (
            "Under Article 649 of the Civil Code, the owner of an immovable surrounded by other immovables pertaining "
            "to other persons and without adequate outlet to a public highway is entitled to demand a right of way "
            "through the neighboring estates after payment of the proper indemnity."
        ),
        "expected_articles": ["RA386-ART649"],
    },
    {
        "id": "RAGAS-16",
        "slice": "property_succession",
        "language": "en",
        "category": "Property: Co-Ownership & Demand for Partition",
        "query": "My siblings and I inherited an undivided parcel of land as co-owners, and I want to divide my share now. Can a co-owner demand partition of co-owned property?",
        "ground_truth": (
            "Under Article 484, co-ownership exists whenever ownership of an undivided thing or right belongs to "
            "different persons. Under Article 494, no co-owner shall be obliged to remain in the co-ownership, and "
            "each co-owner may demand at any time the partition of the thing owned in common insofar as his share is concerned."
        ),
        "expected_articles": ["RA386-ART484", "RA386-ART494"],
    },
    {
        "id": "RAGAS-17",
        "slice": "property_succession",
        "language": "en",
        "category": "Succession: Preterition of Compulsory Heir",
        "query": "My deceased parent left a last will giving the entire estate to my sibling and completely omitted me as a legitimate child. What is the legal effect of preterition?",
        "ground_truth": (
            "Under Article 854 of the Civil Code, the preterition or total omission of one, some, or all of the "
            "compulsory heirs in the direct line shall annul the institution of heir, while devises and legacies remain "
            "valid insofar as they are not inofficious. Legitime of compulsory heirs is protected under Articles 886 and 888."
        ),
        "expected_articles": ["RA386-ART854", "RA386-ART886"],
    },
    # Slice 6: Family Code (EO 209)
    {
        "id": "RAGAS-18",
        "slice": "family_code",
        "language": "en",
        "category": "Family Code: Psychological Incapacity",
        "query": "My spouse abandoned our family immediately after marriage and exhibits chronic psychological incapacity to perform essential marital obligations. Can the marriage be declared void?",
        "ground_truth": (
            "Under Article 36 of the Family Code (Executive Order No. 209), a marriage contracted by any party who, "
            "at the time of celebration, was psychologically incapacitated to comply with the essential marital "
            "obligations of marriage shall be void even if such incapacity becomes manifest only after solemnization."
        ),
        "expected_articles": ["EO209-ART36"],
    },
    {
        "id": "RAGAS-19",
        "slice": "family_code",
        "language": "en",
        "category": "Family Code: Foreign Divorce & Capacity to Remarry",
        "query": "I am a Filipino married to a foreign national who validly obtained a divorce abroad. Can I remarry under Article 26 of the Family Code?",
        "ground_truth": (
            "Under Article 26 of the Family Code, where a marriage between a Filipino citizen and a foreigner is "
            "validly celebrated and a divorce is thereafter validly obtained abroad capacitating the alien spouse "
            "to remarry, the Filipino spouse shall likewise have capacity to remarry under Philippine law."
        ),
        "expected_articles": ["EO209-ART26"],
    },
    {
        "id": "RAGAS-20",
        "slice": "family_code",
        "language": "en",
        "category": "Family Code: Presumptive Death of Absent Spouse",
        "query": "My spouse has been missing for over four consecutive years with a well-founded belief that they are already dead. What are the requirements for a declaration of presumptive death to remarry?",
        "ground_truth": (
            "Under Article 41 of the Family Code, a subsequent marriage is valid if the prior spouse has been absent "
            "for four consecutive years (or two years under danger of death) and the spouse present has a well-founded "
            "belief that the absent spouse is already dead, provided the present spouse institutes a summary proceeding "
            "for the declaration of presumptive death."
        ),
        "expected_articles": ["EO209-ART41"],
    },
    {
        "id": "RAGAS-21",
        "slice": "family_code",
        "language": "en",
        "category": "Family Code: Child Custody & Legal Support",
        "query": "After separation of spouses, who gets custody of a five-year-old child and what does legal support cover under the Family Code?",
        "ground_truth": (
            "Under Article 213 of the Family Code, no child under seven years of age shall be separated from the mother "
            "unless the court finds compelling reasons to order otherwise. Under Article 194, support comprises "
            "everything indispensable for sustenance, dwelling, clothing, medical attendance, education, and transportation."
        ),
        "expected_articles": ["EO209-ART213", "EO209-ART194"],
    },
    # Slice 7: Bilingual Tagalog Citizen Scenarios
    {
        "id": "RAGAS-22",
        "slice": "tagalog_citizen",
        "language": "tl",
        "category": "Sales (TL): Hidden Defects",
        "query": "Ano ang mga karapatan ng bumili kapag may nakatagong depekto sa biniling sasakyan o gamit?",
        "ground_truth": (
            "Sa ilalim ng Artikulo 1561 ng Civil Code, may pananagutan ang nagbenta sa mga nakatagong depekto ng "
            "biniling gamit. Sa ilalim ng Artikulo 1567, maaaring pumili ang bumili na bawiin ang kontrata o humingi "
            "ng bawas sa presyo, at may danyos sa ilalim ng Artikulo 1566 kung alam ng nagbenta ang depekto."
        ),
        "expected_articles": ["RA386-ART1561", "RA386-ART1566"],
    },
    {
        "id": "RAGAS-23",
        "slice": "tagalog_citizen",
        "language": "tl",
        "category": "Contracts (TL): Cancellation on Breach",
        "query": "Pwede ko ba kanselahin ang kontrata kapag hindi sumunod ang kabilang panig sa napagkasunduan?",
        "ground_truth": (
            "Oo. Sa ilalim ng Artikulo 1191 ng Civil Code, ang kapangyarihang magkansela o mag-rescind ng obligasyon "
            "ay nakapaloob sa mga magkatuwang na obligasyon kapag hindi tumupad ang isang panig, at maaaring humingi "
            "ng danyos sa ilalim ng Artikulo 1170."
        ),
        "expected_articles": ["RA386-ART1191", "RA386-ART1170"],
    },
    {
        "id": "RAGAS-24",
        "slice": "tagalog_citizen",
        "language": "tl",
        "category": "Obligations (TL): Debt Harassment & Abuse of Rights",
        "query": "May utang ako sa kaibigan pero tinatakot niya akong ipapakulong at pinapahiya sa social media. Ano ang saklaw ng Civil Code tungkol sa utang at pananakot?",
        "ground_truth": (
            "Ang utang ay obligasyong sibil sa ilalim ng Artikulo 1953 na dapat bayaran ng nanghiram, kasama ang "
            "danyos o interes sa pagkaantala sa ilalim ng Artikulo 1170 at Artikulo 2209. Gayunpaman, ang pananakot "
            "at pamamahiya ay labag sa Artikulo 19, 20, at 21 tungkol sa pang-aabuso ng karapatan."
        ),
        "expected_articles": ["RA386-ART1953", "RA386-ART19", "RA386-ART21"],
    },
    {
        "id": "RAGAS-25",
        "slice": "tagalog_citizen",
        "language": "tl",
        "category": "Succession (TL): Omitted Heir & Legitime",
        "query": "Namatay ang tatay ko at nakalimutan ako sa kanyang testamento bilang anak. Ano ang karapatan ko sa mana?",
        "ground_truth": (
            "Sa ilalim ng Artikulo 777, ang karapatan sa mana ay naililipat mula sa sandali ng pagkamatay ng magulang. "
            "Sa ilalim ng Artikulo 854, ang pagkalimot sa isang sapilitang tagapagmana sa testamento ay nagpapawalang-bisa "
            "sa institusyon ng tagapagmana, at protektado ang legitime sa ilalim ng Artikulo 886."
        ),
        "expected_articles": ["RA386-ART777", "RA386-ART854", "RA386-ART886"],
    },
    # Slice 8: Non-Standard Statutory Lookups & Multi-Chunk Completeness
    {
        "id": "RAGAS-26",
        "slice": "nonstandard_lookups",
        "language": "en",
        "category": "Lookup: Thousands-Comma & Symbol Normalization",
        "query": "Explain art#1,191 of the civil code on reciprocal obligations.",
        "ground_truth": (
            "Article 1191 provides that the power to rescind obligations is implied in reciprocal ones when one "
            "obligor fails to comply, allowing the injured party to choose between fulfillment and rescission with "
            "payment of damages in either case."
        ),
        "expected_articles": ["RA386-ART1191"],
    },
    {
        "id": "RAGAS-27",
        "slice": "nonstandard_lookups",
        "language": "en",
        "category": "Lookup: Multi-Chunk Family Code Completeness",
        "query": "What are all six grounds to annul a voidable marriage under 45 family code?",
        "ground_truth": (
            "Under Article 45 of the Family Code, a marriage may be annulled for: (1) lack of parental consent for "
            "ages 18 to 21; (2) unsound mind; (3) consent obtained by fraud; (4) consent obtained by force, "
            "intimidation, or undue influence; (5) physical incapacity to consummate; and (6) serious and incurable "
            "sexually-transmissible disease existing at the time of marriage."
        ),
        "expected_articles": ["EO209-ART45"],
        "required_substring": "(6)",
    },
    # Slice 9: Supreme Court Jurisprudence & Case-to-Statute Graph
    {
        "id": "RAGAS-28",
        "slice": "jurisprudence_graph",
        "language": "en",
        "category": "Jurisprudence: Pornellosa Holding & Art. 1358 Link",
        "query": "Explain the Supreme Court ruling in Segunda Pornellosa, et al. vs. Land Tenure Administration.",
        "ground_truth": (
            "In Segunda Pornellosa, et al. vs. Land Tenure Administration (G.R. No. L-14040), the Supreme Court "
            "affirmed the dismissal of the petitioners' action to compel sale of the lot, holding that they failed "
            "to prove a valid contract specifying area and boundaries and noting that acts creating or conveying "
            "real rights over immovable property must appear in a public document under Article 1358."
        ),
        "expected_articles": ["RA386-ART1358"],
        "expected_cases": ["GR_L-14040JANUARY_1961"],
    },
    {
        "id": "RAGAS-29",
        "slice": "jurisprudence_graph",
        "language": "en",
        "category": "Jurisprudence: Acronym & Alias Matching",
        "query": "Explain the Supreme Court ruling in sps. quirong vs dbp.",
        "ground_truth": (
            "In Heirs of Sofia Quirong vs. Development Bank of the Philippines (G.R. No. 173441), the Supreme Court "
            "resolved the prescription and legal effect of the buyers' action against DBP arising from the sale of "
            "a parcel of land."
        ),
        "expected_articles": [],
        "expected_cases": ["GR_173441_2009"],
    },
    {
        "id": "RAGAS-30",
        "slice": "jurisprudence_graph",
        "language": "en",
        "category": "Jurisprudence: Unicode Diacritic Folding",
        "query": "What did the Supreme Court rule in carino vs carino?",
        "ground_truth": (
            "In Susan Nicdao Carino vs. Susan Yee Carino (G.R. No. 132529), the Supreme Court ruled on the validity "
            "of a subsequent marriage contracted without a prior judicial declaration of nullity under Article 40 "
            "of the Family Code and the distribution of death benefits."
        ),
        "expected_articles": [],
        "expected_cases": ["GR_132529FEBRUARY_2001"],
    },
]


def _encode_e5(embedder_model, text: str, prefix: str) -> np.ndarray:
    """Encode text with E5 query/passage prefix when using an E5 embedding model."""
    model_name = os.getenv("EMBEDDING_MODEL_NAME", "intfloat/multilingual-e5-base").lower()
    payload = f"{prefix}: {text}" if "e5" in model_name else text
    return embedder_model.encode(payload, normalize_embeddings=True)


def bootstrap_ci(values: List[float], n_boot: int = 1000, seed: int = 42) -> Tuple[float, float]:
    """Compute a 95% nonparametric bootstrap confidence interval."""
    if not values:
        return 0.0, 0.0
    rng = random.Random(seed)
    n = len(values)
    means = sorted(
        sum(values[rng.randrange(n)] for _ in range(n)) / n
        for _ in range(n_boot)
    )
    lo = means[int(0.025 * n_boot)]
    hi = means[min(n_boot - 1, int(0.975 * n_boot))]
    return lo, hi


def _select_chunks(retrieved_chunks: List[Dict[str, Any]], active_only: bool) -> List[Dict[str, Any]]:
    """Return active in-context chunks when active_only=True, otherwise all retrieved chunks."""
    if not retrieved_chunks:
        return []
    if not active_only:
        return retrieved_chunks
    has_flag = any("is_in_context" in c or "rank_status" in c for c in retrieved_chunks)
    if not has_flag:
        return retrieved_chunks
    return [
        c for c in retrieved_chunks
        if c.get("is_in_context") is not False and c.get("rank_status") != "out_of_rank"
    ]


def llm_generate_response(
    query: str,
    retrieved_chunks: list,
    *,
    allow_fallback: bool = True,
    max_tokens: int = 650,
    reasoning_effort: Optional[str] = "none",
    timeout_sec: float = 90.0,
) -> str | None:
    """Generate a live grounded response via LM Studio using active retrieved context."""
    in_context_chunks = _select_chunks(retrieved_chunks, active_only=True)
    if not in_context_chunks:
        in_context_chunks = retrieved_chunks[:5]
    context_str = "\n\n".join([format_context_item(c) for c in in_context_chunks])
    system_prompt = (
        "You are CIVIL-LEX, a specialized Philippine Legal Assistant grounded strictly in "
        "the Philippine Civil Code (RA 386), Family Code (EO 209), and Supreme Court jurisprudence.\n"
        "RULES:\n"
        "1. Answer strictly in the same language as the user's question (English or Tagalog).\n"
        "2. Ground every legal rule exclusively in the CONTEXT below and cite the exact Article or G.R. No.\n"
        "3. Be concise, accurate, and avoid unstated procedural filler.\n\n"
        f"CONTEXT:\n{context_str}\n"
    )

    content = call_chat_completion_sync(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": query},
        ],
        temperature=0.2,
        max_tokens=max_tokens,
        timeout_sec=timeout_sec,
        reasoning_effort=reasoning_effort,
        allow_reasoning_fallback=False,
    )
    if content and len(content.strip()) > 20:
        return content.strip()

    if not allow_fallback:
        return None

    arts = [c.get("parent_id") for c in in_context_chunks if c.get("parent_id")]
    art_str = ", ".join(arts[:3]) if arts else "the Civil Code"
    return (
        f"Under {art_str} of the Philippine Civil Code, the provisions governing this legal "
        f"inquiry provide direct statutory relief and enforceable remedies for the aggrieved party."
    )


def match_article_id(expected: str, candidate: str) -> bool:
    """Exact normalized authority ID matching preventing substring false positives (e.g. ART116 vs ART1169)."""
    if not expected or not candidate:
        return False
    e = expected.strip().upper()
    c = candidate.strip().upper()
    if e == c:
        return True
    if c.startswith(f"{e}-") or c.startswith(f"{e}_") or c.startswith(f"{e}#") or c.startswith(f"{e}/"):
        return True
    return False


def calculate_context_recall(
    retrieved_chunks: List[Dict[str, Any]],
    expected_articles: List[str],
    *,
    active_only: bool = True,
) -> float:
    """Proportion of expected statutory/case targets present in retrieved (active) context."""
    if not expected_articles:
        return 1.0
    scoped = _select_chunks(retrieved_chunks, active_only=active_only)
    retrieved_ids = [str(c.get("parent_id", "")) for c in scoped]
    matched = [exp for exp in expected_articles if any(match_article_id(exp, rid) for rid in retrieved_ids)]
    return len(matched) / len(expected_articles)


def calculate_context_precision(
    retrieved_chunks: List[Dict[str, Any]],
    expected_articles: List[str],
    *,
    active_only: bool = True,
) -> float:
    """Rank-weighted Mean Average Precision (MAP@K) measuring signal-to-noise ratio of context."""
    scoped = _select_chunks(retrieved_chunks, active_only=active_only)
    if not scoped or not expected_articles:
        return 0.0

    hits = 0
    precision_sum = 0.0
    for rank, chunk in enumerate(scoped, 1):
        pid = str(chunk.get("parent_id", ""))
        if any(match_article_id(exp, pid) for exp in expected_articles):
            hits += 1
            precision_sum += hits / rank

    return precision_sum / hits if hits > 0 else 0.0


def calculate_llm_faithfulness(
    generated_response: str,
    retrieved_chunks: List[Dict[str, Any]],
    *,
    mode: str = "hybrid",
) -> float:
    """Standard RAGAS Faithfulness F = |V_entailed| / |S_total| over active context."""
    if not retrieved_chunks or not generated_response:
        return 0.0
    scoped = _select_chunks(retrieved_chunks, active_only=True) or retrieved_chunks
    result = score_faithfulness(generated_response, scoped, mode=mode)
    return result.score


def generate_hypothetical_questions(response: str, n: int = 3) -> List[str]:
    """Generate N hypothetical questions from a response using LM Studio with reasoning disabled."""
    prompt = (
        f"Generate {n} concise questions that the following legal answer directly addresses.\n"
        "Output ONLY the questions, one per line, in the exact same language as the answer, "
        "with no numbering, bullets, or commentary.\n\n"
        f"{response[:2000]}"
    )
    raw = call_chat_completion_sync(
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=200,
        timeout_sec=35.0,
        reasoning_effort="none",
        allow_reasoning_fallback=False,
    )
    if not raw:
        return []
    return parse_followup_questions(raw, limit=n)


def cosine_similarity(v1: np.ndarray, v2: np.ndarray) -> float:
    """Compute cosine similarity between two 1D embedding vectors."""
    n1 = float(np.linalg.norm(v1))
    n2 = float(np.linalg.norm(v2))
    if n1 == 0.0 or n2 == 0.0:
        return 0.0
    return float(np.dot(v1, v2) / (n1 * n2))


def calculate_answer_relevancy(
    query: str,
    generated_response: str,
    embedder_model,
    n_questions: int = 3,
    *,
    use_hypothetical_questions: bool = True,
) -> float:
    """RAGAS Answer Relevancy via E5 query-prefixed cosine similarity against reverse-generated questions."""
    q_vec = _encode_e5(embedder_model, query, "query")
    gen_questions = generate_hypothetical_questions(generated_response, n=n_questions) if use_hypothetical_questions else []

    if gen_questions:
        sims = [cosine_similarity(q_vec, _encode_e5(embedder_model, gq, "query")) for gq in gen_questions]
        raw_score = float(statistics.mean(sims))
    else:
        ans_vec = _encode_e5(embedder_model, generated_response[:2000], "passage")
        raw_score = cosine_similarity(q_vec, ans_vec)

    return max(0.0, min(1.0, raw_score))


def calculate_answer_semantic_similarity(
    generated_response: str,
    ground_truth: str,
    embedder_model,
) -> float:
    """RAGAS Answer Semantic Similarity between generated response and reference ground truth."""
    if not generated_response or not ground_truth:
        return 0.0
    gen_vec = _encode_e5(embedder_model, generated_response[:2000], "passage")
    gt_vec = _encode_e5(embedder_model, ground_truth[:2000], "passage")
    return max(0.0, min(1.0, cosine_similarity(gen_vec, gt_vec)))


def _format_ci_pct(values: List[float]) -> str:
    if not values:
        return "N/A"
    mean_pct = statistics.mean(values) * 100.0
    lo, hi = bootstrap_ci(values)
    return f"{mean_pct:5.1f}% [{lo * 100.0:5.1f}%, {hi * 100.0:5.1f}%]"


def run_ragas_evaluation(
    *,
    mode: str = "full",
    nli_mode: str = "hybrid",
    slice_filter: Optional[str] = None,
    limit: Optional[int] = None,
    json_out: Optional[str] = None,
) -> Dict[str, Any]:
    """Execute the multi-scenario RAGAS benchmark and return structured metrics."""
    print("CIVIL-LEX: MULTI-SCENARIO RAGAS EVALUATION SUITE")

    lm_online = False
    lm_status_msg = "skipped (retrieval mode)"
    if mode == "full":
        lm_online, lm_status_msg = asyncio.run(check_model_readiness(timeout=8.0))
        model_label = get_target_model_name() if lm_online else "unavailable"
        print(f"LM Studio Readiness: {'ONLINE' if lm_online else 'OFFLINE'} ({model_label}) - {lm_status_msg}")
    else:
        print("Execution Mode: retrieval + deterministic reference NLI (no LLM generation calls)")

    # Stage 1: Intent Routing & Guardrails
    print("\n[STAGE 1] INTENT ROUTING, STATUTORY BOUNDS & GUARDRAILS")
    guardrail_rows: List[Dict[str, Any]] = []
    guardrail_pass_flags: List[float] = []
    tp = fp = tn = fn = 0

    for tc in GUARDRAIL_TEST_CASES:
        t0 = time.perf_counter()
        res = classify_query_intent(tc["query"])
        lat_ms = (time.perf_counter() - t0) * 1000.0
        is_in_domain = res["category"] == "in_domain_civil"
        expected_in = bool(tc["expected_in_domain"])
        passed = is_in_domain == expected_in
        guardrail_pass_flags.append(1.0 if passed else 0.0)

        if not expected_in and not is_in_domain:
            tp += 1
        elif expected_in and not is_in_domain:
            fp += 1
        elif expected_in and is_in_domain:
            tn += 1
        else:
            fn += 1

        guardrail_rows.append({
            "id": tc["id"],
            "slice": tc["slice"],
            "language": tc["language"],
            "name": tc["name"],
            "expected_in_domain": expected_in,
            "predicted_category": res["category"],
            "passed": passed,
            "latency_ms": round(lat_ms, 1),
        })
        status = "PASS" if passed else "FAIL"
        print(
            f"  [{tc['id']}] {tc['slice']:<19} | {tc['name']:<41} | "
            f"Pred: {res['category']:<26} | {lat_ms:5.1f} ms | {status}"
        )

    gr_compliance = (sum(guardrail_pass_flags) / len(guardrail_pass_flags)) * 100.0 if guardrail_pass_flags else 0.0
    gr_precision = (tp / (tp + fp)) * 100.0 if (tp + fp) > 0 else 100.0
    gr_recall = (tp / (tp + fn)) * 100.0 if (tp + fn) > 0 else 100.0
    gr_specificity = (tn / (tn + fp)) * 100.0 if (tn + fp) > 0 else 100.0
    print(
        f"Stage 1 Summary: {_format_ci_pct(guardrail_pass_flags)} "
        f"({int(sum(guardrail_pass_flags))}/{len(guardrail_pass_flags)} passed) | "
        f"Block Precision: {gr_precision:.1f}% | Block Recall: {gr_recall:.1f}% | In-Domain Specificity: {gr_specificity:.1f}%"
    )

    # Stage 2: In-Domain Multi-Scenario RAGAS
    cases = list(IN_DOMAIN_BENCHMARK_CASES)
    if slice_filter:
        cases = [c for c in cases if c["slice"] == slice_filter]
    if limit is not None and limit > 0:
        cases = cases[:limit]

    print(f"\n[STAGE 2] IN-DOMAIN PHILIPPINE CIVIL & FAMILY LAW EVALUATION (n={len(cases)})")

    active_recalls: List[float] = []
    full_recalls: List[float] = []
    active_precisions: List[float] = []
    hit_at_k_flags: List[float] = []
    full_recall_flags: List[float] = []
    clause_complete_flags: List[float] = []
    ref_faithfulness_scores: List[float] = []
    ref_contradicted_total = 0
    ref_claims_total = 0

    live_faithfulness_scores: List[float] = []
    live_relevancies: List[float] = []
    live_similarities: List[float] = []
    live_contradicted_total = 0
    live_claims_total = 0
    llm_live_count = 0
    llm_failed_count = 0

    ret_latencies: List[float] = []
    gen_latencies: List[float] = []
    scenario_rows: List[Dict[str, Any]] = []

    for sc in cases:
        targets = list(sc.get("expected_articles", [])) + list(sc.get("expected_cases", []))
        t0 = time.perf_counter()
        chunks = embed_and_search(sc["query"])
        ret_ms = (time.perf_counter() - t0) * 1000.0
        ret_latencies.append(ret_ms)

        active_chunks = _select_chunks(chunks, active_only=True)
        active_ids = [str(c.get("parent_id", "")) for c in active_chunks]
        rec_active = calculate_context_recall(chunks, targets, active_only=True)
        rec_full = calculate_context_recall(chunks, targets, active_only=False)
        prec_active = calculate_context_precision(chunks, targets, active_only=True)

        hit_flag = 1.0 if rec_active > 0.0 else 0.0
        full_flag = 1.0 if rec_active >= 1.0 else 0.0

        req_sub = sc.get("required_substring")
        clause_ok = True
        if req_sub:
            clause_ok = any(req_sub in str(c.get("content", "")) for c in active_chunks)
            clause_complete_flags.append(1.0 if clause_ok else 0.0)

        active_recalls.append(rec_active)
        full_recalls.append(rec_full)
        active_precisions.append(prec_active)
        hit_at_k_flags.append(hit_flag)
        full_recall_flags.append(full_flag)

        # Deterministic reference-grounded NLI check (verifies context sufficiency & zero false contradictions)
        ref_nli = score_faithfulness(sc["ground_truth"], active_chunks, mode="symbolic")
        ref_faithfulness_scores.append(ref_nli.score)
        ref_contradicted_total += ref_nli.claims_contradicted
        ref_claims_total += ref_nli.claims_total

        live_faith = None
        live_rel = None
        live_sim = None
        live_contradicted = None
        live_engine = None
        live_nli_analysis = None
        gen_ms = None

        if mode == "full" and lm_online:
            t_gen = time.perf_counter()
            actual_response = llm_generate_response(
                sc["query"],
                active_chunks,
                allow_fallback=False,
                reasoning_effort="none",
            )
            gen_ms = (time.perf_counter() - t_gen) * 1000.0
            if actual_response:
                llm_live_count += 1
                gen_latencies.append(gen_ms)
                effective_nli_mode = nli_mode
                nli_res = score_faithfulness(actual_response, active_chunks, mode=effective_nli_mode)
                live_faith = nli_res.score
                live_contradicted = nli_res.claims_contradicted
                live_engine = nli_res.engine
                live_nli_analysis = nli_res.analysis
                live_contradicted_total += nli_res.claims_contradicted
                live_claims_total += nli_res.claims_total

                live_rel = calculate_answer_relevancy(sc["query"], actual_response, embedder)
                live_sim = calculate_answer_semantic_similarity(actual_response, sc["ground_truth"], embedder)

                live_faithfulness_scores.append(live_faith)
                live_relevancies.append(live_rel)
                live_similarities.append(live_sim)
            else:
                llm_failed_count += 1

        row = {
            "id": sc["id"],
            "slice": sc["slice"],
            "language": sc["language"],
            "category": sc["category"],
            "query": sc["query"],
            "expected_targets": targets,
            "active_retrieved": active_ids,
            "context_recall_active": round(rec_active, 4),
            "context_recall_full_pool": round(rec_full, 4),
            "context_precision_active": round(prec_active, 4),
            "clause_complete": clause_ok,
            "ref_nli_faithfulness": round(ref_nli.score, 4),
            "ref_nli_contradicted": ref_nli.claims_contradicted,
            "live_nli_faithfulness": round(live_faith, 4) if live_faith is not None else None,
            "live_nli_contradicted": live_contradicted,
            "live_nli_engine": live_engine,
            "live_nli_analysis": live_nli_analysis,
            "live_answer_relevancy": round(live_rel, 4) if live_rel is not None else None,
            "live_answer_similarity": round(live_sim, 4) if live_sim is not None else None,
            "retrieval_latency_ms": round(ret_ms, 1),
            "generation_latency_ms": round(gen_ms, 1) if gen_ms is not None else None,
        }
        scenario_rows.append(row)

        live_tag = ""
        if live_faith is not None and live_rel is not None and live_sim is not None:
            live_tag = (
                f" | Faith={live_faith * 100:5.1f}% (C={live_contradicted})"
                f" | Rel={live_rel * 100:5.1f}% | Sim={live_sim * 100:5.1f}%"
            )
        print(
            f"  [{sc['id']}] ({sc['language'].upper()}) {sc['slice']:<21} | "
            f"Rec={rec_active * 100:5.1f}% (Pool={rec_full * 100:5.1f}%) | "
            f"Prec={prec_active * 100:5.1f}% | RefNLI={ref_nli.score * 100:5.1f}% (C={ref_nli.claims_contradicted})"
            f"{live_tag} | {ret_ms:6.1f} ms"
        )

    # Per-Slice Breakdown
    print("\n[PER-SLICE BREAKDOWN]")
    print(f"{'Slice':<24} | {'n':>2} | {'Active Rec':>10} | {'Pool Rec':>8} | {'Active Prec':>11} | {'Ref NLI':>8} | {'Med ms':>7}")
    slices_seen: List[str] = []
    for r in scenario_rows:
        if r["slice"] not in slices_seen:
            slices_seen.append(r["slice"])

    slice_summary: Dict[str, Any] = {}
    for sl in slices_seen:
        sub = [r for r in scenario_rows if r["slice"] == sl]
        s_rec = statistics.mean([r["context_recall_active"] for r in sub]) * 100.0
        s_pool = statistics.mean([r["context_recall_full_pool"] for r in sub]) * 100.0
        s_prec = statistics.mean([r["context_precision_active"] for r in sub]) * 100.0
        s_rnli = statistics.mean([r["ref_nli_faithfulness"] for r in sub]) * 100.0
        s_med = statistics.median([r["retrieval_latency_ms"] for r in sub])
        slice_summary[sl] = {
            "n": len(sub),
            "context_recall_active_pct": round(s_rec, 1),
            "context_recall_pool_pct": round(s_pool, 1),
            "context_precision_active_pct": round(s_prec, 1),
            "ref_nli_faithfulness_pct": round(s_rnli, 1),
            "median_latency_ms": round(s_med, 1),
        }
        print(
            f"{sl:<24} | {len(sub):>2} | {s_rec:>9.1f}% | {s_pool:>7.1f}% | "
            f"{s_prec:>10.1f}% | {s_rnli:>7.1f}% | {s_med:>7.1f}"
        )

    # Bilingual Breakdown (EN vs TL)
    print("\n[LANGUAGE BREAKDOWN (EN vs TL)]")
    lang_summary: Dict[str, Any] = {}
    for lang in ("en", "tl"):
        sub = [r for r in scenario_rows if r["language"] == lang]
        if not sub:
            continue
        l_rec = statistics.mean([r["context_recall_active"] for r in sub]) * 100.0
        l_prec = statistics.mean([r["context_precision_active"] for r in sub]) * 100.0
        l_rnli = statistics.mean([r["ref_nli_faithfulness"] for r in sub]) * 100.0
        lang_summary[lang] = {
            "n": len(sub),
            "context_recall_active_pct": round(l_rec, 1),
            "context_precision_active_pct": round(l_prec, 1),
            "ref_nli_faithfulness_pct": round(l_rnli, 1),
        }
        print(
            f"  {lang.upper():<4} (n={len(sub):>2}) | Active Recall: {l_rec:5.1f}% | "
            f"Active Precision@K: {l_prec:5.1f}% | Ref NLI: {l_rnli:5.1f}%"
        )

    # Diagnostics for any misses or contradictions
    diagnostics = [
        r for r in scenario_rows
        if r["context_recall_active"] < 1.0
        or r["context_precision_active"] < 0.85
        or r["ref_nli_contradicted"] > 0
        or (r["live_nli_contradicted"] or 0) > 0
        or not r["clause_complete"]
    ]
    if diagnostics:
        print(f"\n[DIAGNOSTICS: {len(diagnostics)} SCENARIOS BELOW PERFECT THRESHOLD]")
        for r in diagnostics:
            print(
                f"  - [{r['id']}] {r['category']} | Rec={r['context_recall_active'] * 100:.1f}% "
                f"(Pool={r['context_recall_full_pool'] * 100:.1f}%) | Prec={r['context_precision_active'] * 100:.1f}% "
                f"| RefC={r['ref_nli_contradicted']} | Expected={r['expected_targets']} | Active={r['active_retrieved']}"
            )

    # Final Scorecard Summary
    avg_rec_active = statistics.mean(active_recalls) * 100.0 if active_recalls else 0.0
    avg_rec_full = statistics.mean(full_recalls) * 100.0 if full_recalls else 0.0
    avg_prec_active = statistics.mean(active_precisions) * 100.0 if active_precisions else 0.0
    avg_hit = statistics.mean(hit_at_k_flags) * 100.0 if hit_at_k_flags else 0.0
    avg_ref_faith = statistics.mean(ref_faithfulness_scores) * 100.0 if ref_faithfulness_scores else 0.0
    ref_halluc_rate = (ref_contradicted_total / ref_claims_total * 100.0) if ref_claims_total else 0.0
    med_ret_ms = statistics.median(ret_latencies) if ret_latencies else 0.0
    p95_ret_ms = float(np.percentile(ret_latencies, 95)) if ret_latencies else 0.0

    avg_live_faith = statistics.mean(live_faithfulness_scores) * 100.0 if live_faithfulness_scores else None
    avg_live_rel = statistics.mean(live_relevancies) * 100.0 if live_relevancies else None
    avg_live_sim = statistics.mean(live_similarities) * 100.0 if live_similarities else None
    live_halluc_rate = (live_contradicted_total / live_claims_total * 100.0) if live_claims_total else None

    print("\n[CIVIL-LEX RAGAS SCORECARD SUMMARY (95% BOOTSTRAP CI)]")
    print("| Metric / Stage                          | Target    | Score [95% CI]             | Outcome |")
    print("| :-------------------------------------- | :-------: | :------------------------: | :-----: |")
    print(f"| Stage 1: Guardrail Compliance (n={len(guardrail_pass_flags):<2})    |  100.0%   | {_format_ci_pct(guardrail_pass_flags):<26} | {'PASS' if gr_compliance >= 100.0 else 'FAIL':<7} |")
    print(f"| Stage 2: Active Context Recall (n={len(active_recalls):<2})   | >= 90.0%  | {_format_ci_pct(active_recalls):<26} | {'PASS' if avg_rec_active >= 90.0 else 'FAIL':<7} |")
    print(f"| Stage 2: Full-Pool Recall (diagnostic)  | >= 95.0%  | {_format_ci_pct(full_recalls):<26} | {'PASS' if avg_rec_full >= 95.0 else 'INFO':<7} |")
    print(f"| Stage 2: Active Context Precision@K     | >= 85.0%  | {_format_ci_pct(active_precisions):<26} | {'PASS' if avg_prec_active >= 85.0 else 'FAIL':<7} |")
    print(f"| Stage 2: Hit@K (Any Target Active)      | >= 95.0%  | {_format_ci_pct(hit_at_k_flags):<26} | {'PASS' if avg_hit >= 95.0 else 'FAIL':<7} |")
    print(f"| Stage 2: Ref-Answer Symbolic NLI        |   Info    | {_format_ci_pct(ref_faithfulness_scores):<26} | C={ref_contradicted_total:<5} |")
    if avg_live_faith is not None:
        print(f"| Stage 2: Live LLM Faithfulness ({nli_mode:<6}) | >= 90.0%  | {_format_ci_pct(live_faithfulness_scores):<26} | {'PASS' if avg_live_faith >= 90.0 else 'FAIL':<7} |")
        print(f"| Stage 2: Live Answer Relevancy (E5)     | >= 85.0%  | {_format_ci_pct(live_relevancies):<26} | {'PASS' if (avg_live_rel or 0) >= 85.0 else 'FAIL':<7} |")
        print(f"| Stage 2: Live Answer Similarity (GT)    | >= 80.0%  | {_format_ci_pct(live_similarities):<26} | {'PASS' if (avg_live_sim or 0) >= 80.0 else 'FAIL':<7} |")
        print(f"| Stage 2: Live NLI Contradiction Rate    |  <= 1.0%  | {live_halluc_rate:5.2f}% ({live_contradicted_total}/{live_claims_total} claims)       | {'PASS' if (live_halluc_rate or 0) <= 1.0 else 'FAIL':<7} |")
    else:
        print(f"| Stage 2: Live LLM Metrics               |   Live    | SKIPPED ({'LLM offline' if mode == 'full' else 'retrieval mode':<14})   | N/A     |")
    print(
        f"Latency: Retrieval median={med_ret_ms:.1f} ms, P95={p95_ret_ms:.1f} ms | "
        f"Ref Contradictions: {ref_contradicted_total}/{ref_claims_total} ({ref_halluc_rate:.2f}%)"
    )

    report = {
        "mode": mode,
        "nli_mode": nli_mode,
        "lm_studio_online": lm_online,
        "lm_studio_model": get_target_model_name() if lm_online else None,
        "llm_live_count": llm_live_count,
        "llm_failed_count": llm_failed_count,
        "stage1_guardrails": {
            "total": len(guardrail_pass_flags),
            "passed": int(sum(guardrail_pass_flags)),
            "compliance_pct": round(gr_compliance, 2),
            "block_precision_pct": round(gr_precision, 2),
            "block_recall_pct": round(gr_recall, 2),
            "in_domain_specificity_pct": round(gr_specificity, 2),
            "results": guardrail_rows,
        },
        "stage2_ragas": {
            "total_scenarios": len(scenario_rows),
            "context_recall_active_pct": round(avg_rec_active, 2),
            "context_recall_active_ci": [round(x * 100.0, 2) for x in bootstrap_ci(active_recalls)],
            "context_recall_full_pool_pct": round(avg_rec_full, 2),
            "context_precision_active_pct": round(avg_prec_active, 2),
            "context_precision_active_ci": [round(x * 100.0, 2) for x in bootstrap_ci(active_precisions)],
            "hit_at_k_pct": round(avg_hit, 2),
            "ref_nli_faithfulness_pct": round(avg_ref_faith, 2),
            "ref_nli_contradictions": ref_contradicted_total,
            "ref_nli_claims_total": ref_claims_total,
            "live_faithfulness_pct": round(avg_live_faith, 2) if avg_live_faith is not None else None,
            "live_faithfulness_ci": [round(x * 100.0, 2) for x in bootstrap_ci(live_faithfulness_scores)] if live_faithfulness_scores else None,
            "live_answer_relevancy_pct": round(avg_live_rel, 2) if avg_live_rel is not None else None,
            "live_answer_relevancy_ci": [round(x * 100.0, 2) for x in bootstrap_ci(live_relevancies)] if live_relevancies else None,
            "live_answer_similarity_pct": round(avg_live_sim, 2) if avg_live_sim is not None else None,
            "live_contradiction_rate_pct": round(live_halluc_rate, 2) if live_halluc_rate is not None else None,
            "retrieval_median_ms": round(med_ret_ms, 1),
            "retrieval_p95_ms": round(p95_ret_ms, 1),
            "generation_median_ms": round(statistics.median(gen_latencies), 1) if gen_latencies else None,
            "per_slice": slice_summary,
            "per_language": lang_summary,
            "scenarios": scenario_rows,
        },
    }

    if json_out:
        out_dir = os.path.dirname(os.path.abspath(json_out))
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        with open(json_out, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2, ensure_ascii=False)
        print(f"\nExported structured RAGAS report to: {json_out}")

    return report


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="CIVIL-LEX Multi-Scenario RAGAS Evaluation Benchmark")
    parser.add_argument(
        "--mode",
        choices=("full", "retrieval"),
        default="full",
        help="Run full live-LLM + retrieval benchmark (auto-skips LLM metrics if offline) or retrieval-only.",
    )
    parser.add_argument(
        "--nli-mode",
        choices=("hybrid", "symbolic"),
        default="hybrid",
        help="NLI verifier mode for live LLM responses.",
    )
    parser.add_argument("--slice", dest="slice_filter", default=None, help="Filter Stage 2 to a single slice name.")
    parser.add_argument("--limit", type=int, default=None, help="Maximum number of Stage 2 scenarios to run.")
    parser.add_argument("--json-out", default=None, help="Optional path to export full JSON benchmark results.")
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    run_ragas_evaluation(
        mode=args.mode,
        nli_mode=args.nli_mode,
        slice_filter=args.slice_filter,
        limit=args.limit,
        json_out=args.json_out,
    )
