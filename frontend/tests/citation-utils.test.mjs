import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCitationArticleLabel,
  formatCitationModalTitle,
  formatSuitabilityPercent,
  ensureUniqueSuitability,
  isFamilyCodeCitation,
  isActiveCitation,
  filterActiveCitations,
  boldArticleReferences,
  resolveDocumentUploadProgress,
} from '../lib/citation-utils.ts';

test('formatCitationArticleLabel strips RA386 and EO209 prefixes cleanly', () => {
  assert.equal(
    formatCitationArticleLabel({ parent_type: 'article', parent_id: 'RA386-ART1156', metadata: { article_number: 1156 } }),
    'Article 1156'
  );
  assert.equal(
    formatCitationArticleLabel({ parent_type: 'article', parent_id: 'RA386-ART1191_0' }),
    'Article 1191'
  );
  assert.equal(
    formatCitationArticleLabel({ parent_type: 'article', parent_id: 'EO209-ART36', metadata: { article_number: 36 } }),
    'Family Code Art. 36'
  );
  assert.equal(
    formatCitationArticleLabel({ parent_type: 'article', parent_id: 'EO209-ART41_c0' }),
    'Family Code Art. 41'
  );
  assert.equal(
    formatCitationArticleLabel({ parent_type: 'user_document', parent_id: '22222222-2222-4222-8222-222222222222' }),
    'Uploaded Document'
  );
});

test('formatCitationArticleLabel maps all structural RA386 and EO209 IDs to readable titles', () => {
  assert.equal(formatCitationArticleLabel({ parent_type: 'article', parent_id: 'RA386-GENERAL-INFO' }), 'Civil Code Overview');
  assert.equal(formatCitationArticleLabel({ parent_type: 'article', parent_id: 'RA386-STRUCTURE-AND-ARTICLES' }), 'Civil Code Structure');
  assert.equal(formatCitationArticleLabel({ parent_type: 'article', parent_id: 'RA386-SPECIAL-LAWS-AND-AMENDMENTS' }), 'Special Laws');
  assert.equal(formatCitationArticleLabel({ parent_type: 'article', parent_id: 'EO209-GENERAL-INFO' }), 'Family Code Overview');
  assert.equal(formatCitationArticleLabel({ parent_type: 'article', parent_id: 'EO209-STRUCTURE-AND-ARTICLES' }), 'Family Code Structure');
  assert.equal(formatCitationArticleLabel({ parent_type: 'article', parent_id: 'EO209-PREAMBLE-AND-ENACTMENT' }), 'Family Code Preamble');
});

test('formatCitationModalTitle builds clean titles without raw code prefixes', () => {
  assert.equal(
    formatCitationModalTitle({ parent_type: 'article', parent_id: 'RA386-ART1156', metadata: { article_number: 1156 } }),
    'Civil Code of the Philippines — Article 1156'
  );
  assert.equal(
    formatCitationModalTitle({ parent_type: 'article', parent_id: 'EO209-ART36', metadata: { article_number: 36 } }),
    'Family Code of the Philippines — Article 36'
  );
  assert.equal(
    formatCitationModalTitle({ parent_type: 'article', parent_id: 'RA386-GENERAL-INFO' }),
    'Civil Code Overview'
  );
  assert.equal(
    formatCitationModalTitle({ parent_type: 'user_document', parent_id: 'abc-123' }),
    'Uploaded Document Excerpt'
  );
  assert.equal(isFamilyCodeCitation({ parent_id: 'EO209-ART36' }), true);
  assert.equal(isFamilyCodeCitation({ parent_id: 'RA386-ART36' }), false);
});

test('ensureUniqueSuitability deduplicates historical DB ties while remaining idempotent', () => {
  const historicalTies = [
    { parent_id: 'RA386-ART2176', suitability_percent: 98.5, is_in_context: true },
    { parent_id: 'RA386-ART2177', suitability_percent: 98.5, is_in_context: true },
    { parent_id: 'RA386-ART2206', suitability_percent: 98.5, is_in_context: true },
    { parent_id: 'RA386-ART2180', suitability_percent: 98.5, is_in_context: true },
    { parent_id: 'GR_1001', suitability_percent: 68.5, is_in_context: false, rank_status: 'out_of_rank' },
    { parent_id: 'GR_1002', suitability_percent: 68.5, is_in_context: false, rank_status: 'out_of_rank' },
  ];

  const deduped = ensureUniqueSuitability(historicalTies);
  const scores = deduped.map((c) => c.suitability_percent);
  assert.deepEqual(scores, [98.5, 98.0, 97.5, 97.0, 68.5, 68.2]);
  assert.equal(historicalTies[1].suitability_percent, 98.5);

  const secondPass = ensureUniqueSuitability(deduped);
  assert.deepEqual(secondPass.map((c) => c.suitability_percent), scores);
  assert.equal(formatSuitabilityPercent(98), '98.0%');
  assert.equal(formatSuitabilityPercent(98.5), '98.5%');
});

test('isActiveCitation and filterActiveCitations hide all out_of_rank citations', () => {
  const mixed = [
    { parent_id: 'RA386-ART1156', is_in_context: true, rank_status: 'primary', suitability_percent: 98.5 },
    { parent_id: 'RA386-ART1157', rank_status: 'retained', suitability_percent: 92.0 },
    { parent_id: 'RA386-ART1170', is_in_context: false, rank_status: 'primary', suitability_percent: 68.5 },
    { parent_id: 'RA386-ART1191', is_in_context: true, rank_status: 'out_of_rank', suitability_percent: 65.0 },
    { parent_id: 'GR_1001', is_in_context: false, rank_status: 'out_of_rank', suitability_percent: 62.0 },
    { parent_id: 'RA386-ART1305', suitability_percent: 85.0 },
  ];

  assert.equal(isActiveCitation(mixed[0]), true);
  assert.equal(isActiveCitation(mixed[1]), true);
  assert.equal(isActiveCitation(mixed[2]), false);
  assert.equal(isActiveCitation(mixed[3]), false);
  assert.equal(isActiveCitation(mixed[4]), false);
  assert.equal(isActiveCitation(mixed[5]), true);
  assert.equal(isActiveCitation(null), false);

  const visible = filterActiveCitations(mixed);
  assert.deepEqual(
    visible.map((c) => c.parent_id),
    ['RA386-ART1156', 'RA386-ART1157', 'RA386-ART1305']
  );
  assert.deepEqual(filterActiveCitations(null), []);
});

test('boldArticleReferences bolds prose articles while preserving existing bold spans, headings, and code', () => {
  const input = [
    '### Statutory Grounding & Provisions',
    '> **Article 1654 (Republic Act No. 386 - Civil Code of the Philippines)**',
    'Under Article 1658 of the Civil Code, you can suspend paying rent. You also have the right to ask for rescission (Article 1659).',
    'If you fail in your obligation under Article 1657(2), the lessor may file ejectment under Article 1673 or [Art. 1654].',
    '- **Governing Civil Code / Family Code Article(s)**: Article 1654 (Republic Act No. 386), Article 1657 (RA 386)',
    'Inline `Article 1156` and partial Article **1191**.',
  ].join('\n');

  const output = boldArticleReferences(input);
  assert.ok(output.includes('> **Article 1654 (Republic Act No. 386 - Civil Code of the Philippines)**'));
  assert.ok(output.includes('Under **Article 1658** of the Civil Code'));
  assert.ok(output.includes('(**Article 1659**)'));
  assert.ok(output.includes('under **Article 1657(2)**,'));
  assert.ok(output.includes('under **Article 1673** or [**Art. 1654**].'));
  assert.ok(output.includes('- **Governing Civil Code / Family Code Article(s)**: **Article 1654** (Republic Act No. 386), **Article 1657** (RA 386)'));
  assert.ok(output.includes('`Article 1156`'));
  assert.ok(output.includes('**Article 1191**'));
  assert.equal(boldArticleReferences(output), output);
});

test('resolveDocumentUploadProgress guarantees monotonic non-contradictory progress and stage text', () => {
  // Never shows "(0%)" when progress is 0 in DB; advances smoothly from prevProgress
  const step1 = resolveDocumentUploadProgress({ status: 'extracting', progress: 0, filename: 'Lease.pdf' }, 15, 'Lease.pdf');
  assert.equal(step1.progress, 21);
  assert.ok(step1.statusText.includes('(21%)'));
  assert.ok(!step1.statusText.includes('(0%)'));

  // Jumps immediately when backend reports higher milestone
  const step2 = resolveDocumentUploadProgress({ status: 'extracting', progress: 55, filename: 'Lease.pdf' }, step1.progress, 'Lease.pdf');
  assert.equal(step2.progress, 55);
  assert.ok(step2.statusText.includes('Validating Civil Code & Family Code relevance (55%)'));

  // Reaches 100% cleanly on completion
  const done = resolveDocumentUploadProgress({ status: 'completed', progress: 100, filename: 'Lease.pdf' }, step2.progress, 'Lease.pdf');
  assert.equal(done.progress, 100);
  assert.ok(done.statusText.includes('(100%)'));
});

