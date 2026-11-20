import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDocketSignals } from '../src/services/jurisprudenceSearch.js';

test('extractDocketSignals normalizes messy G.R. docket strings with fused months and artifacts', () => {
  const fused = extractDocketSignals('G.R. No. L-38278June 28', false);
  assert.ok(fused.series.has('GR'));
  assert.ok(fused.codes.has('l-38278'));
  assert.ok(fused.codes.has('l38278'));
  assert.ok(fused.numbers.has('38278'));

  const slashArtifact = extractDocketSignals('G.R. No. 140836/G', false);
  assert.ok(slashArtifact.series.has('GR'));
  assert.ok(slashArtifact.numbers.has('140836'));

  const consolidated = extractDocketSignals('G.R. Nos. 94188-89 December 17, 1992', false);
  assert.ok(consolidated.numbers.has('94188'));
  assert.ok(consolidated.numbers.has('94189'));
});

test('extractDocketSignals normalizes unformatted user docket queries', () => {
  for (const q of ['188289', 'gr 188289', 'gr188289', 'G.R. 188289', 'GR-188289']) {
    const sig = extractDocketSignals(q, true);
    assert.ok(sig.numbers.has('188289'), `Failed to extract 188289 from "${q}"`);
  }

  for (const q of ['l10033', 'L-10033', 'gr l 10033', 'GR-L-10033']) {
    const sig = extractDocketSignals(q, true);
    assert.ok(sig.numbers.has('10033'), `Failed to extract 10033 from "${q}"`);
  }

  const am = extractDocketSignals('am 804', true);
  assert.ok(am.series.has('AM'));
  assert.ok(am.numbers.has('804'));
});
