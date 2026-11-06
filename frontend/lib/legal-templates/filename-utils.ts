/**
 * Utility functions for validating, sanitizing, and deduplicating document filenames
 * across the Document Format Picker and Document Builder.
 * Strips out '.txt' extensions so builder documents have clean, human-readable legal titles.
 */

export interface FilenameValidationResult {
  isValid: boolean;
  error?: string;
  sanitizedFilename: string;
}

/**
 * Remove standard document extensions (.txt, .docx, .doc, .pdf, .png, .jpg, .jpeg) from a filename.
 */
export function stripExtension(filename: string): string {
  if (!filename) return "";
  return filename.trim().replace(/\.(txt|docx|doc|pdf|png|jpe?g)$/i, "").trim();
}

/**
 * Extract the extension including the dot (e.g. '.docx', '.txt'), or return empty string.
 */
export function getExtension(filename: string): string {
  if (!filename) return "";
  const match = filename.trim().match(/\.(txt|docx|doc|pdf|png|jpe?g)$/i);
  return match ? match[0].toLowerCase() : "";
}

/**
 * Sanitize illegal filesystem and URL characters, collapsing duplicate whitespace.
 * Explicitly strips out trailing .txt extension.
 */
export function sanitizeDocumentFilename(name: string): string {
  if (!name) return "";
  const withoutTxt = name.trim().replace(/\.txt$/i, "");
  return withoutTxt
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Helper to normalize document objects or strings into a clean list of filenames.
 * Excludes documents matching currentDocIdOrFilename (by id or filename) so a document never collides with itself.
 */
export function extractDocumentFilenames(
  existingDocuments?: Array<{ filename?: string; id?: string } | string> | null,
  currentDocIdOrFilename?: string | string[] | null
): string[] {
  if (!existingDocuments || !Array.isArray(existingDocuments)) return [];

  const excludeSet = new Set<string>();
  if (currentDocIdOrFilename) {
    if (Array.isArray(currentDocIdOrFilename)) {
      currentDocIdOrFilename.forEach((val) => {
        if (val && typeof val === "string") {
          excludeSet.add(val.toLowerCase().trim());
          excludeSet.add(stripExtension(val).toLowerCase().trim());
        }
      });
    } else if (typeof currentDocIdOrFilename === "string") {
      excludeSet.add(currentDocIdOrFilename.toLowerCase().trim());
      excludeSet.add(stripExtension(currentDocIdOrFilename).toLowerCase().trim());
    }
  }

  const names: string[] = [];
  for (const item of existingDocuments) {
    if (!item) continue;
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed && !excludeSet.has(trimmed.toLowerCase()) && !excludeSet.has(stripExtension(trimmed).toLowerCase())) {
        names.push(trimmed);
      }
    } else if (typeof item === "object") {
      const itemId = item.id ? item.id.toLowerCase().trim() : null;
      const itemFilename = item.filename ? item.filename.toLowerCase().trim() : null;
      const itemStripped = item.filename ? stripExtension(item.filename).toLowerCase().trim() : null;

      if (
        (itemId && excludeSet.has(itemId)) ||
        (itemFilename && excludeSet.has(itemFilename)) ||
        (itemStripped && excludeSet.has(itemStripped))
      ) {
        continue;
      }

      if (item.filename && typeof item.filename === "string") {
        const trimmed = item.filename.trim();
        if (trimmed) names.push(trimmed);
      }
    }
  }
  return names;
}

/**
 * Validate candidate filename against existing filenames:
 * - Automatically strips out '.txt'.
 * - Checks for non-empty string.
 * - Checks length limit (max 120 characters).
 * - Distinguishes between different file formats (.pdf vs clean builder title).
 * - Excludes the current document being edited (by ID or previous filename).
 */
export function validateDocumentFilename(
  candidate: string,
  existingDocuments?: Array<{ filename?: string; id?: string } | string> | null,
  currentDocIdOrFilename?: string | string[] | null
): FilenameValidationResult {
  const sanitized = sanitizeDocumentFilename(candidate);

  if (!sanitized) {
    return {
      isValid: false,
      error: "Document name cannot be empty.",
      sanitizedFilename: "",
    };
  }

  if (sanitized.length > 120) {
    return {
      isValid: false,
      error: "Document name is too long (maximum 120 characters).",
      sanitizedFilename: sanitized,
    };
  }

  const candBase = stripExtension(sanitized).toLowerCase();
  const candExt = getExtension(sanitized);

  const existingList = extractDocumentFilenames(existingDocuments, currentDocIdOrFilename);

  for (const existing of existingList) {
    const existExt = getExtension(existing);
    const existBase = stripExtension(existing).toLowerCase();

    // If existing document has a specific format like .pdf or .docx, do not collide with clean title
    if (existExt && existExt !== ".txt" && existExt !== candExt) {
      continue;
    }

    if (existBase === candBase) {
      return {
        isValid: false,
        error: `A document named "${stripExtension(existing)}" already exists.`,
        sanitizedFilename: sanitized,
      };
    }
  }

  return {
    isValid: true,
    sanitizedFilename: sanitized,
  };
}

/**
 * Generate a unique filename without '.txt' by appending auto-incrementing numbers (e.g. 'Contract of Lease (1)')
 * when a collision is detected.
 */
export function generateUniqueDocumentFilename(
  baseCandidate: string,
  existingDocuments?: Array<{ filename?: string; id?: string } | string> | null,
  defaultExtension = ""
): string {
  // Strip out .txt from candidate name
  const candidateClean = (baseCandidate || "").replace(/\.txt$/i, "");
  const sanitized = sanitizeDocumentFilename(candidateClean) || "Untitled Document";
  const existingExt = getExtension(sanitized);
  const ext = existingExt === ".txt" ? "" : (existingExt || defaultExtension);
  const base = stripExtension(sanitized);

  const existingList = extractDocumentFilenames(existingDocuments);
  const existingBases = new Set<string>();

  for (const existing of existingList) {
    const existExt = getExtension(existing);
    // Only collide with documents of the same format or plain builder documents
    if (!existExt || existExt === ".txt" || existExt === ext) {
      existingBases.add(stripExtension(existing).toLowerCase());
    }
  }

  if (!existingBases.has(base.toLowerCase())) {
    return `${base}${ext}`;
  }

  // Parse existing trailing counter like "(1)" if already present
  const match = base.match(/^(.*?)(?:\s*\((\d+)\))?$/);
  const root = match && match[1] ? match[1].trim() : base;
  let counter = match && match[2] ? parseInt(match[2], 10) + 1 : 1;

  while (existingBases.has(`${root} (${counter})`.toLowerCase())) {
    counter++;
  }

  return `${root} (${counter})${ext}`;
}
