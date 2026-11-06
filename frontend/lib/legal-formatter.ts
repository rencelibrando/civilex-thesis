/**
 * Formats legal document text for structured markdown presentation.
 * Reconstructs document titles, bold section headers, recitals, and paragraph flow.
 */
export function formatLegalDocumentMarkdown(rawText: string): string {
  if (!rawText || !rawText.trim()) return "";

  // Normalize line endings
  const normalized = rawText.replace(/\r\n/g, "\n");

  // Check if text already has markdown headings or formatting
  const hasMarkdown = /^#{1,6}\s+|^\*\*|```/m.test(normalized);
  if (hasMarkdown) {
    return normalized;
  }

  // Split into paragraphs by double newlines or single-line blocks
  const rawParagraphs = normalized.split(/\n{2,}/);
  const formattedParagraphs: string[] = [];

  for (let i = 0; i < rawParagraphs.length; i++) {
    const rawP = rawParagraphs[i].trim();
    if (!rawP) continue;

    // Detect document title at start of document
    if (i === 0 && rawP.length < 100 && (rawP.toUpperCase() === rawP || /^(contract|deed|agreement|affidavit|memorandum|republic)/i.test(rawP))) {
      formattedParagraphs.push(`# ${rawP}\n\n---`);
      continue;
    }

    // Detect Section / Article headers
    const isSectionHeader =
      /^(?:ARTICLE\s+[IVXLCDM\d]+|SECTION\s+\d+|PART\s+[IVXLCDM\d]+|\d+\.\s+[A-Z\s]{4,})/i.test(rawP) &&
      rawP.length < 120;

    if (isSectionHeader) {
      formattedParagraphs.push(`### ${rawP}`);
      continue;
    }

    // Detect Legal recitals and covenants
    let p = rawP;
    p = p.replace(/^(WHEREAS|WITNESSETH|NOW,?\s+THEREFORE|KNOW\s+ALL\s+MEN\s+BY\s+THESE\s+PRESENTS)\b/i, "**$1**");

    // Detect standard numbered stipulations (e.g. "1. Obligations", "2. Payment")
    p = p.replace(/^(\d+\.(?:\d+)?\s+[A-Z\s]{3,35}:)/m, "**$1**");

    // Recombine accidental hard line-wraps inside a single paragraph
    const lines = p.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      let merged = "";
      for (let j = 0; j < lines.length; j++) {
        const cur = lines[j];
        if (!merged) {
          merged = cur;
        } else {
          // If previous line ends with a period, colon, or is a heading, keep break
          const prevEndsSentence = /[.:;]$/.test(merged) && (cur.startsWith("-") || /^\d+\./.test(cur) || cur.toUpperCase() === cur);
          if (prevEndsSentence) {
            merged += "\n\n" + cur;
          } else {
            merged += " " + cur;
          }
        }
      }
      formattedParagraphs.push(merged);
    } else {
      formattedParagraphs.push(p);
    }
  }

  return formattedParagraphs.join("\n\n");
}

/**
 * Transforms document text into a structured formal Philippine legal / business letter format.
 */
export function formatDocumentAsFormalLetter(
  rawText: string,
  options: {
    senderName?: string;
    recipientName?: string;
    subject?: string;
    dateStr?: string;
  } = {}
): { html: string; text: string } {
  const currentDate = options.dateStr || new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const sender = options.senderName || "COMMUNITY LEGAL ADVOCATE / SENDER";
  const recipient = options.recipientName || "THE ADDRESSEE / CONCERNED PARTY";

  // Extract or synthesize a formal subject line
  let subject = options.subject || "";
  if (!subject) {
    const firstLine = rawText.trim().split("\n")[0].trim();
    if (
      firstLine.length < 90 &&
      (firstLine.toUpperCase() === firstLine || /contract|lease|demand|notice|deed|obligation/i.test(firstLine))
    ) {
      subject = firstLine.replace(/^[#*\s]+|[#*\s]+$/g, "");
    } else {
      subject = "FORMAL LEGAL NOTICE & STATUTORY DEMAND";
    }
  }

  // Extract body paragraphs (filtering out standalone titles/headers)
  const rawParagraphs = rawText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("#") && p !== subject);

  const cleanBodyParagraphs = rawParagraphs.length > 0 ? rawParagraphs : [rawText.trim()];

  // Plain Text representation
  const textOutput = [
    `${sender.toUpperCase()}`,
    "Republic of the Philippines",
    "",
    `${currentDate}`,
    "",
    `${recipient.toUpperCase()}`,
    "Metro Manila, Philippines",
    "",
    `SUBJECT: ${subject.toUpperCase()}`,
    "",
    "Sir/Madam:",
    "",
    ...cleanBodyParagraphs.map((p) => p.replace(/\n+/g, " ")),
    "",
    "Very truly yours,",
    "",
    "",
    `${sender.toUpperCase()}`,
    "Authorized Signatory / Affiant",
  ].join("\n");

  // High-fidelity HTML representation matching formal legal letterhead
  const bodyHtml = cleanBodyParagraphs
    .map(
      (p) =>
        `<p style="line-height: 1.8; text-align: justify; margin-bottom: 1.25rem; text-indent: 2.25rem; font-size: 11.5pt;">${p.replace(/\n+/g, " ")}</p>`
    )
    .join("\n");

  const htmlOutput = `
<div class="formal-letter-wrapper" style="font-family: 'Times New Roman', Times, Georgia, serif; font-size: 12pt; color: #111; max-width: 720px; margin: 0 auto; line-height: 1.6;">
  <div style="border-bottom: 2px solid #111; padding-bottom: 0.85rem; margin-bottom: 2rem; text-align: center;">
    <p style="margin: 0; font-size: 15pt; font-weight: bold; letter-spacing: 0.06em; text-transform: uppercase;">${sender}</p>
    <p style="margin: 0.35rem 0 0 0; font-size: 10pt; color: #444;">Republic of the Philippines</p>
    <p style="margin: 0.15rem 0 0 0; font-size: 9.5pt; color: #555;">CIVIL-LEX Legal Documentation Support</p>
  </div>

  <div style="text-align: right; margin-bottom: 1.75rem;">
    <p style="margin: 0; font-weight: 600; font-size: 11pt;">${currentDate}</p>
  </div>

  <div style="margin-bottom: 1.5rem;">
    <p style="margin: 0; font-weight: bold; text-transform: uppercase;">${recipient}</p>
    <p style="margin: 0.2rem 0 0 0; font-size: 11pt;">Authorized Representative / Party in Interest</p>
    <p style="margin: 0.2rem 0 0 0; font-size: 11pt;">Metro Manila, Philippines</p>
  </div>

  <div style="margin-bottom: 1.5rem; background-color: #f8fafc; padding: 0.6rem 0.85rem; border-left: 3px solid #100771;">
    <p style="margin: 0; font-weight: bold; font-size: 11pt;">RE: <span style="text-decoration: underline;">${subject.toUpperCase()}</span></p>
  </div>

  <div style="margin-bottom: 1.25rem;">
    <p style="margin: 0; font-weight: 600; font-size: 11pt;">Sir/Madam:</p>
  </div>

  <div style="margin-bottom: 2.25rem;">
    ${bodyHtml}
  </div>

  <div style="margin-top: 3rem; page-break-inside: avoid;">
    <p style="margin: 0 0 2.75rem 0; font-size: 11pt;">Very truly yours,</p>
    <p style="margin: 0; font-weight: bold; text-decoration: underline; text-transform: uppercase; font-size: 11.5pt;">${sender}</p>
    <p style="margin: 0.2rem 0 0 0; font-size: 10.5pt; color: #333;">Affiant / Authorized Party</p>
  </div>
</div>
`.trim();

  return { html: htmlOutput, text: textOutput };
}
