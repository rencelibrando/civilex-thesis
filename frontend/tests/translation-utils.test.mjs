import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectMessageLanguage,
  getDisplayedMessageState,
  getEffectiveTranslationState,
  getNextTargetLanguage,
  getTranslateButtonLabel,
} from '../lib/translation-utils.ts';

test('detectMessageLanguage classifies English, Tagalog, and Taglish legal responses accurately', () => {
  assert.equal(
    detectMessageLanguage(
      '### Legal Basis\n\nUnder **Article 1191** of the Philippine Civil Code (R.A. 386), the aggrieved party may choose between fulfillment or rescission [Art. 1191].'
    ),
    'en'
  );

  assert.equal(
    detectMessageLanguage(
      '### Batayang Legal\n\nAyon sa **Article 1191** ng Kodigo Sibil (R.A. 386), maaari po kayong pumili kung ipagpapatuloy ang kasunduan o ipapawalang-bisa ito dahil hindi tumupad ang kabilang panig.'
    ),
    'tl'
  );

  assert.equal(
    detectMessageLanguage(
      'Sa ilalim ng **Article 1156**, ang obligation ay isang legal duty na dapat sundin ng mga parties, at pwede kayong humingi ng tulong sa Barangay o PAO.'
    ),
    'tl'
  );

  // English response referencing Filipino statutory/tribunal terms stays English
  assert.equal(
    detectMessageLanguage(
      'Before filing a complaint in the MTC, the parties must undergo mandatory conciliation before the Katarungang Pambarangay under the Local Government Code.'
    ),
    'en'
  );

  assert.equal(detectMessageLanguage(''), 'en');
});

test('getDisplayedMessageState resolves default, translated, and original-reverted states safely', () => {
  const original = 'Under Article 1156, an obligation is a juridical necessity to give, to do or not to do.';

  const initial = getDisplayedMessageState(original, null);
  assert.equal(initial.content, original);
  assert.equal(initial.originalLang, 'en');
  assert.equal(initial.activeLang, 'en');
  assert.equal(initial.isTranslated, false);
  assert.equal(initial.hasCachedAlternate, false);

  const translatedCache = {
    originalContent: original,
    originalLang: 'en',
    activeLang: 'tl',
    en: original,
    tl: 'Sa ilalim ng Article 1156, ang obligasyon ay isang juridical necessity.',
    isTranslating: false,
    error: null,
  };

  const translatedView = getDisplayedMessageState(original, translatedCache);
  assert.equal(translatedView.content, translatedCache.tl);
  assert.equal(translatedView.activeLang, 'tl');
  assert.equal(translatedView.isTranslated, true);
  assert.equal(translatedView.hasCachedAlternate, true);

  const revertedView = getDisplayedMessageState(original, { ...translatedCache, activeLang: 'en' });
  assert.equal(revertedView.content, original);
  assert.equal(revertedView.isTranslated, false);
  assert.equal(revertedView.hasCachedAlternate, true);

  // Stale cache from another session with identical numeric message ID must be ignored
  const differentMsg = 'Under Article 1318, there is no contract unless consent, object, and cause concur.';
  assert.equal(getEffectiveTranslationState(differentMsg, translatedCache), null);
  const staleProtected = getDisplayedMessageState(differentMsg, translatedCache);
  assert.equal(staleProtected.content, differentMsg);
  assert.equal(staleProtected.isTranslated, false);
  assert.equal(staleProtected.hasCachedAlternate, false);
});

test('getNextTargetLanguage and getTranslateButtonLabel produce exact toggle labels', () => {
  assert.equal(getNextTargetLanguage('en'), 'tl');
  assert.equal(getNextTargetLanguage('tl'), 'en');
  assert.equal(getTranslateButtonLabel('en', false), 'Translate to Tagalog');
  assert.equal(getTranslateButtonLabel('tl', false), 'Translate to English');
  assert.equal(getTranslateButtonLabel('en', true), 'Translating to Tagalog...');
  assert.equal(getTranslateButtonLabel('tl', true), 'Translating to English...');
});
