/**
 * Backend utility functions for document filename sanitization, validation,
 * and deduplication without '.txt' extension.
 */

export function stripExtension(filename) {
  if (!filename || typeof filename !== 'string') return '';
  return filename.trim().replace(/\.(txt|docx|doc|pdf|png|jpe?g)$/i, '').trim();
}

export function getExtension(filename) {
  if (!filename || typeof filename !== 'string') return '';
  const match = filename.trim().match(/\.(txt|docx|doc|pdf|png|jpe?g)$/i);
  return match ? match[0].toLowerCase() : '';
}

export function sanitizeDocumentFilename(name) {
  if (!name || typeof name !== 'string') return '';
  const withoutTxt = name.trim().replace(/\.txt$/i, '');
  return withoutTxt
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function generateUniqueDocumentFilename(baseCandidate, existingFilenames = [], defaultExtension = '') {
  const candidateClean = (baseCandidate || '').toString().replace(/\.txt$/i, '');
  const sanitized = sanitizeDocumentFilename(candidateClean) || 'Untitled Document';
  const existingExt = getExtension(sanitized);
  const ext = existingExt === '.txt' ? '' : (existingExt || defaultExtension);
  const base = stripExtension(sanitized);

  const existingBases = new Set();
  for (const existing of existingFilenames) {
    if (!existing) continue;
    const existExt = getExtension(String(existing));
    if (!existExt || existExt === '.txt' || existExt === ext) {
      existingBases.add(stripExtension(String(existing)).toLowerCase());
    }
  }

  if (!existingBases.has(base.toLowerCase())) {
    return `${base}${ext}`;
  }

  const match = base.match(/^(.*?)(?:\s*\((\d+)\))?$/);
  const root = match && match[1] ? match[1].trim() : base;
  let counter = match && match[2] ? parseInt(match[2], 10) + 1 : 1;

  while (existingBases.has(`${root} (${counter})`.toLowerCase())) {
    counter++;
  }

  return `${root} (${counter})${ext}`;
}
