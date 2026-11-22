export interface StandardLegalClause {
  id: string;
  title: string;
  summary: string;
  text: string;
}

export const STANDARD_LEGAL_CLAUSES: StandardLegalClause[] = [
  {
    id: "force_majeure",
    title: "Force Majeure (Art. 1174)",
    summary: "Excuses delay from fortuitous events beyond party control",
    text:
      "FORTUITOUS EVENTS AND FORCE MAJEURE: Neither party shall be held liable for any delay or failure to perform its obligations under this instrument caused by fortuitous events or force majeure pursuant to Article 1174 of the Civil Code of the Philippines, including acts of God, natural calamities, war, civil disturbances, or government-mandated lockdowns, provided written notice is given within five (5) calendar days from occurrence.",
  },
  {
    id: "venue_attorneys_fees",
    title: "Venue & Attorney's Fees",
    summary: "Sets exclusive court venue and 25% litigation fee recovery",
    text:
      "VENUE OF ACTION AND ATTORNEY'S FEES: Any judicial action or proceeding arising out of or in connection with this instrument shall be brought exclusively before the proper courts of the City/Municipality where this instrument was executed, to the exclusion of all other venues. In the event either party is constrained to litigate to enforce its rights hereunder, the defaulting party shall pay attorney's fees equivalent to twenty-five percent (25%) of the amount claimed, in addition to costs of suit.",
  },
  {
    id: "separability",
    title: "Separability Clause",
    summary: "Preserves remaining provisions if one clause is invalidated",
    text:
      "SEPARABILITY CLAUSE: Should any term, condition, or provision of this instrument be declared invalid, illegal, or unenforceable by a court of competent jurisdiction, the validity, legality, and enforceability of the remaining provisions shall not in any way be affected or impaired thereby.",
  },
  {
    id: "non_waiver",
    title: "Non-Waiver of Rights",
    summary: "Prevents tolerance of breach from waiving contractual rights",
    text:
      "NON-WAIVER OF RIGHTS: The failure or delay of either party to insist upon strict performance of any covenant or condition of this instrument, or to exercise any right or option herein conferred, shall not be construed as a waiver or relinquishment for the future of any such covenant, condition, right, or option.",
  },
  {
    id: "sublease_prohibition",
    title: "Sublease Restriction (Art. 1650)",
    summary: "Requires written lessor consent prior to subletting or assignment",
    text:
      "PROHIBITION AGAINST SUBLEASE OR ASSIGNMENT: Pursuant to Article 1650 of the Civil Code of the Philippines, the LESSEE is expressly prohibited from subleasing, assigning, or transferring all or any portion of the Leased Premises or his/her rights under this Contract without the prior written consent of the LESSOR.",
  },
  {
    id: "data_privacy",
    title: "Data Privacy Notice (R.A. 10173)",
    summary: "Permits lawful processing of personal data for execution",
    text:
      "DATA PRIVACY COMPLIANCE: In accordance with Republic Act No. 10173 (Data Privacy Act of 2012), the parties consent to the collection, processing, and retention of their personal information and competent evidence of identity solely for the execution, notarization, registration, and enforcement of this instrument.",
  },
  {
    id: "entire_agreement",
    title: "Entire Agreement & Amendments",
    summary: "Supersedes prior oral understandings; requires signed writing",
    text:
      "ENTIRE AGREEMENT AND AMENDMENTS: This instrument constitutes the entire understanding between the parties with respect to the subject matter hereof and supersedes all prior negotiations, representations, or agreements, whether oral or written. No amendment or modification hereof shall be valid unless reduced into writing and signed by all parties.",
  },
];

// Insert clause immediately before IN WITNESS WHEREOF / execution block when present
export function insertClauseIntoDocumentText(content: string, clauseText: string): string {
  const markers = [
    "\nIN WITNESS WHEREOF",
    "\nSIGNED IN THE PRESENCE OF:",
    "\nACKNOWLEDGMENT",
    "\nJURAT",
    "\nSUBSCRIBED AND SWORN",
  ];

  let insertIndex = -1;
  for (const marker of markers) {
    const idx = content.indexOf(marker);
    if (idx !== -1 && (insertIndex === -1 || idx < insertIndex)) {
      insertIndex = idx;
    }
  }

  if (insertIndex !== -1) {
    const before = content.slice(0, insertIndex).trimEnd();
    const after = content.slice(insertIndex).trimStart();
    return `${before}\n\n${clauseText}\n\n${after}`;
  }

  return `${content.trimEnd()}\n\n${clauseText}`;
}
