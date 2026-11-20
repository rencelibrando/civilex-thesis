import test from 'node:test';
import assert from 'node:assert/strict';
import { extractArticleNumber } from '../src/routes/civil-code.js';

test('extractArticleNumber parses non-standard formats, symbols, thousands commas, Tagalog, and postfix statutes', () => {
  const cases = [
    ['1191', 1191],
    ['#1191', 1191],
    ['art#1191', 1191],
    ['art # 1191', 1191],
    ['art-1191', 1191],
    ['art: 1191', 1191],
    ['Art 1,191', 1191],
    ['Article 2,176', 2176],
    ['artikulo 1191', 1191],
    ['artilce 99', 99],
    ['atr 1191', 1191],
    ['arts 36', 36],
    ['probisyon 1191', 1191],
    ['eo 209 36', 36],
    ['family code 36', 36],
    ['fc 36', 36],
    ['ra 386 1191', 1191],
    ['cc 1191', 1191],
    ['36 family code', 36],
    ['36 of the family code', 36],
    ['1191 civil code', 1191],
    ['1191 of the civil code', 1191],
    ['sec 36 family code', 36],
  ];

  for (const [input, expected] of cases) {
    assert.equal(extractArticleNumber(input), expected, `Failed for input: "${input}"`);
  }
});

test('extractArticleNumber rejects G.R. numbers, enactment years, statute numbers, and currency', () => {
  const nonArticles = [
    '188289',
    'G.R. No. 188289',
    'gr188289',
    'Executive Order No. 209 Family Code',
    'Republic Act 386 Civil Code',
    '1987 Family Code',
    'worth 1,500 pesos',
    'PHP 1,200',
  ];

  for (const input of nonArticles) {
    assert.equal(extractArticleNumber(input), null, `Unexpected article extracted from: "${input}"`);
  }
});
