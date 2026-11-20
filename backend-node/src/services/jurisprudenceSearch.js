// Flexible jurisprudence docket & case-title search engine with in-memory normalized index

const INDEX_TTL_MS = 30 * 60 * 1000;

const MONTH_FUSED_REGEX = /(?<=[0-9A-Za-z-])(?:January|February|March|April|May|June|July|August|September|October|November|December)\s*\d{0,2}(?:\s*,\s*\d{4})?/g;
const MONTH_DATE_REGEX = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:\s*,\s*\d{4})?\b/gi;
const SIDE_SPLIT_REGEX = /\s+(?:vs?\.?|versus|contra)\s+|\s*vs\.(?=[A-Za-z])/i;
const DOCKET_HEADER_REGEX = /\b(?:G\.?\s*R\.?|A\.?\s*[MC]\.?|B\.?\s*M\.?|R-C\.?\s*A\.?)\s*(?:Nos?\.?)?\s*((?:[A-Z]{1,4}-)?\d+(?:-\d+)?(?:-[A-Z]{1,4})?)/gi;

const STOP_WORDS = new Set([
  'of', 'the', 'and', 'in', 'on', 'at', 'to', 'by', 'for', 'or', 'an', 'a',
  'et', 'al', 'etc', 'vs', 'v', 'versus', 'contra', 'no', 'nos', 'hon'
]);

const SINGLE_CHAR_OK_PREFIX = new Set(['l', 'p', 'u', 'm', 'r']);

const TOKEN_ALIASES = {
  sps: ['spouses'],
  spouses: ['sps'],
  hrs: ['heirs'],
  heirs: ['hrs'],
  corp: ['corporation'],
  corporation: ['corp'],
  inc: ['incorporated'],
  incorporated: ['inc'],
  co: ['company'],
  company: ['co'],
  assn: ['association'],
  association: ['assn'],
  mfg: ['manufacturing'],
  manufacturing: ['mfg'],
  dev: ['development'],
  development: ['dev'],
  govt: ['government'],
  government: ['govt'],
  natl: ['national'],
  national: ['natl'],
  intl: ['international'],
  international: ['intl'],
  phil: ['philippine', 'philippines'],
  philippine: ['phil'],
  philippines: ['phil'],
  dept: ['department'],
  department: ['dept'],
  educ: ['education'],
  education: ['educ'],
  br: ['branch'],
  branch: ['br'],
  atty: ['attorney'],
  attorney: ['atty'],
  hon: ['honorable'],
  honorable: ['hon'],
  ma: ['maria'],
  maria: ['ma'],
  sta: ['santa'],
  santa: ['sta'],
  sto: ['santo'],
  santo: ['sto'],
  st: ['saint', 'street']
};

const PHRASE_ACRONYMS = [
  { phrase: 'development bank of the philippines', acronym: 'dbp' },
  { phrase: 'philippine national bank', acronym: 'pnb' },
  { phrase: 'bank of the philippine islands', acronym: 'bpi' },
  { phrase: 'banco de oro', acronym: 'bdo' },
  { phrase: 'court of appeals', acronym: 'ca' },
  { phrase: 'supreme court', acronym: 'sc' },
  { phrase: 'regional trial court', acronym: 'rtc' },
  { phrase: 'metropolitan trial court', acronym: 'mtc' },
  { phrase: 'municipal trial court', acronym: 'mtc' },
  { phrase: 'republic of the philippines', acronym: 'rp' },
  { phrase: 'office of the solicitor general', acronym: 'osg' },
  { phrase: 'government service insurance system', acronym: 'gsis' },
  { phrase: 'social security system', acronym: 'sss' },
  { phrase: 'national labor relations commission', acronym: 'nlrc' },
  { phrase: 'securities and exchange commission', acronym: 'sec' },
  { phrase: 'bureau of internal revenue', acronym: 'bir' },
  { phrase: 'commission on elections', acronym: 'comelec' },
  { phrase: 'people of the philippines', acronym: 'people' }
];

function stripAccents(str) {
  return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function cleanText(str) {
  return stripAccents(str)
    .replace(/&amp;?/gi, ' & ')
    .replace(/vs\.(?=[A-Za-z])/gi, 'vs. ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeWords(str) {
  const cleaned = cleanText(str).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return cleaned ? cleaned.split(/\s+/) : [];
}

function stripDatesFromDocket(raw) {
  return cleanText(raw)
    .replace(MONTH_FUSED_REGEX, ' ')
    .replace(MONTH_DATE_REGEX, ' ')
    .replace(/\/[A-Za-z]\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DOCKET_SERIES_STRIP_REGEX = /\b(?:g\.\s*r\.|a\.\s*[mc]\.|b\.\s*m\.|r-c\.\s*a\.|c\.\s*a\.)(?:\s*nos?\.?)?|\b(?:gr|am|ac|bm)(?=\s*\.|\s*nos?\.?(?:\s|$)|\s*[a-z]{0,3}-?\d|\s+[a-z]-?\d)/gi;

function detectDocketSeries(raw) {
  const s = String(raw || '').toLowerCase();
  const series = new Set();
  if (/\bg\.\s*r\.|\bgr(?=\s*\.|\s*nos?\.?(?:\s|$)|\s*(?:[a-z]-)?\d)/i.test(s)) series.add('GR');
  if (/\ba\.\s*m\.|\bam(?=\s*\.|\s*nos?\.?(?:\s|$)|\s*(?:[a-z]{1,4}-)?\d)/i.test(s)) series.add('AM');
  if (/\ba\.\s*c\.|\bac(?=\s*\.|\s*nos?\.?(?:\s|$)|\s*(?:[a-z]{1,4}-)?\d)/i.test(s)) series.add('AC');
  if (/\bb\.\s*m\.|\bbm(?=\s*\.|\s*nos?\.?(?:\s|$)|\s*(?:[a-z]{1,4}-)?\d)/i.test(s)) series.add('BM');
  if (/\b(?:r-)?c\.\s*a\./i.test(s)) series.add('CA');
  return series;
}

function expandRangeNumbers(code, numbersOut, codesOut) {
  // Expand consolidated ranges such as 94188-89 -> 94188, 94189 or l-11319-20 -> 11319, 11320
  const m = code.match(/^(?:([a-z]+)-)?(\d{3,6})-(\d{1,6})(?:-[a-z]+)?$/);
  if (!m) return;
  const prefix = m[1] ? `${m[1]}-` : '';
  const startStr = m[2];
  const endRaw = m[3];
  const startNum = parseInt(startStr, 10);

  if (endRaw.length < startStr.length) {
    const basePrefix = startStr.slice(0, startStr.length - endRaw.length);
    const expandedStr = basePrefix + endRaw;
    const endNum = parseInt(expandedStr, 10);
    if (endNum > startNum && endNum - startNum <= 10) {
      for (let n = startNum; n <= endNum; n++) {
        const s = String(n);
        numbersOut.add(s);
        codesOut.add(`${prefix}${s}`);
        if (prefix) codesOut.add(`${m[1]}${s}`);
      }
      return;
    }
  }

  const endNum = parseInt(endRaw, 10);
  if (endNum > startNum && endNum - startNum <= 10) {
    for (let n = startNum; n <= endNum; n++) {
      const s = String(n);
      numbersOut.add(s);
      codesOut.add(`${prefix}${s}`);
      if (prefix) codesOut.add(`${m[1]}${s}`);
    }
  }
}

export function extractDocketSignals(rawText, isQuery = false) {
  const cleaned = stripDatesFromDocket(rawText);
  const series = detectDocketSeries(cleaned);

  // Remove docket prefix boilerplate before reading alphanumeric docket codes
  let body = cleaned
    .replace(DOCKET_SERIES_STRIP_REGEX, ' ')
    .replace(/\bno(?:s)?\.?\b/gi, ' ');

  // Normalize "L 10033" or "P 02 1651" -> "L-10033" / "P-02-1651"
  body = body
    .replace(/\b([a-z]{1,4})\s+(\d{2,6}(?:\s*-\s*\d{1,6})?)\b/gi, '$1-$2')
    .replace(/\s*-\s*/g, '-');

  const rawTokens = body.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || [];
  const codes = new Set();
  const numbers = new Set();

  for (const tok of rawTokens) {
    if (!/\d/.test(tok)) continue;
    // Skip standalone 4-digit years only when extracting from titles/headers if preceded by commas; docket strings rarely contain years after stripDatesFromDocket
    if (/^\d{4}$/.test(tok) && !isQuery) {
      const n = parseInt(tok, 10);
      // Keep 4-digit numbers (many L-series & A.M. numbers are 4 digits); date years already stripped by stripDatesFromDocket
      if (n === 0) continue;
    }

    codes.add(tok);
    const joined = tok.replace(/-/g, '');
    if (joined !== tok) codes.add(joined);

    expandRangeNumbers(tok, numbers, codes);

    // Extract letter-stripped numeric core for prefixed codes like "l-10033" or "804-cj" or "p-02-1651"
    const numericOnly = tok.replace(/^[a-z]+-?|-?[a-z]+$/g, '').replace(/-/g, '');
    if (numericOnly) {
      codes.add(numericOnly);
      numbers.add(numericOnly);
    }

    const digitGroups = tok.match(/\d+/g) || [];
    for (const dg of digitGroups) {
      // Avoid tiny 1-2 digit sub-parts like "02" in "p-02-1651" unless the whole query only has 2 digits
      if (dg.length >= 3 || digitGroups.length === 1) {
        numbers.add(dg);
        codes.add(dg);
      }
    }
  }

  return { series, codes, numbers };
}

function buildSideData(sideText) {
  const tokens = tokenizeWords(sideText);
  const meaningful = tokens.filter((t) => !STOP_WORDS.has(t));
  return {
    text: tokens.join(' '),
    tokenSet: new Set(tokens),
    meaningfulSet: new Set(meaningful)
  };
}

function levenshteinBounded(a, b, maxDist) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > maxDist) return maxDist + 1;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const val = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr[j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDist) return maxDist + 1;
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

let cachedIndex = null;
let indexExpiresAt = 0;
let loadingPromise = null;

async function fetchAllCaseMetadata(supabase) {
  const allRows = [];
  const PAGE_SIZE = 1000;
  for (let from = 0; from < 50000; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('jurisprudence_cases')
      .select('case_uid, gr_number, title, decision_date')
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  // Hydrate docket numbers from content_summary header for rows whose gr_number lacks digits (e.g. "G.R. Nos")
  const noDigitUids = [];
  for (const row of allRows) {
    if (!/\d/.test(row.gr_number || '')) {
      noDigitUids.push(row.case_uid);
    }
  }

  const headerMap = new Map();
  const BATCH = 200;
  for (let i = 0; i < noDigitUids.length; i += BATCH) {
    const slice = noDigitUids.slice(i, i + BATCH);
    const { data: sumRows, error: sumErr } = await supabase
      .from('jurisprudence_cases')
      .select('case_uid, content_summary')
      .in('case_uid', slice);

    if (!sumErr && sumRows) {
      for (const s of sumRows) {
        if (s.content_summary) {
          headerMap.set(s.case_uid, s.content_summary.slice(0, 260));
        }
      }
    }
  }

  return { allRows, headerMap };
}

function buildSearchIndex(allRows, headerMap) {
  const docFreq = new Map();
  const entries = new Array(allRows.length);

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    const gr = row.gr_number || '';
    const title = row.title || '';
    const cleanedTitle = cleanText(title);
    const titleWords = tokenizeWords(cleanedTitle);
    const compactTitle = titleWords.join('');
    const titleText = titleWords.join(' ');

    const allTokens = new Set(titleWords);
    const aliasTokens = new Set();

    for (const w of titleWords) {
      const expansions = TOKEN_ALIASES[w];
      if (expansions) {
        for (const exp of expansions) aliasTokens.add(exp);
      }
    }
    for (const entry of PHRASE_ACRONYMS) {
      if (titleText.includes(entry.phrase)) {
        aliasTokens.add(entry.acronym);
      }
    }

    for (const t of allTokens) {
      docFreq.set(t, (docFreq.get(t) || 0) + 1);
    }

    const docketSignals = extractDocketSignals(gr, false);
    const isDocketTitle = /^(?:g\.?\s*r\.?|a\.?\s*[mc]\.?|b\.?\s*m\.?)/i.test(title.trim());
    if (isDocketTitle) {
      const fromTitle = extractDocketSignals(title, false);
      for (const s of fromTitle.series) docketSignals.series.add(s);
      for (const c of fromTitle.codes) docketSignals.codes.add(c);
      for (const n of fromTitle.numbers) docketSignals.numbers.add(n);
    }

    const headerSnippet = headerMap.get(row.case_uid);
    if (headerSnippet) {
      let match;
      DOCKET_HEADER_REGEX.lastIndex = 0;
      while ((match = DOCKET_HEADER_REGEX.exec(headerSnippet)) !== null) {
        const fromHeader = extractDocketSignals(match[0], false);
        for (const s of fromHeader.series) docketSignals.series.add(s);
        for (const c of fromHeader.codes) docketSignals.codes.add(c);
        for (const n of fromHeader.numbers) docketSignals.numbers.add(n);
      }
    }

    const sides = cleanedTitle.split(SIDE_SPLIT_REGEX);
    const leftSide = sides.length >= 2 ? buildSideData(sides[0]) : null;
    const rightSide = sides.length >= 2 ? buildSideData(sides.slice(1).join(' ')) : null;

    entries[i] = {
      case_uid: row.case_uid,
      title: row.title,
      gr_number: row.gr_number || '',
      decision_date: row.decision_date || '',
      isDocketTitle,
      titleText,
      compactTitle,
      titleTokens: allTokens,
      aliasTokens,
      leftSide,
      rightSide,
      series: docketSignals.series,
      docketCodes: docketSignals.codes,
      docketNumbers: docketSignals.numbers
    };
  }

  const totalDocs = entries.length || 1;
  const idf = new Map();
  for (const [tok, df] of docFreq.entries()) {
    idf.set(tok, Math.log(1 + totalDocs / (1 + df)));
  }

  // Group vocabulary by length for fast fuzzy lookup during queries
  const vocabByLen = new Map();
  for (const tok of docFreq.keys()) {
    if (tok.length < 3 || /^\d+$/.test(tok)) continue;
    let list = vocabByLen.get(tok.length);
    if (!list) {
      list = [];
      vocabByLen.set(tok.length, list);
    }
    list.push(tok);
  }

  return { entries, idf, vocabByLen };
}

async function getJurisprudenceIndex(supabase) {
  const now = Date.now();
  if (cachedIndex && now < indexExpiresAt) {
    return cachedIndex;
  }
  if (loadingPromise) {
    if (cachedIndex) return cachedIndex;
    return loadingPromise;
  }

  loadingPromise = (async () => {
    try {
      const { allRows, headerMap } = await fetchAllCaseMetadata(supabase);
      cachedIndex = buildSearchIndex(allRows, headerMap);
      indexExpiresAt = Date.now() + INDEX_TTL_MS;
      return cachedIndex;
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

function resolveFuzzyMatchesForToken(qt, vocabByLen) {
  const matches = [];
  if (qt.length < 4 || /^\d+$/.test(qt)) return matches;

  const maxDist = qt.length >= 7 ? 2 : 1;
  const minLen = Math.max(3, qt.length - maxDist);
  const maxLen = qt.length + maxDist;

  for (let len = minLen; len <= maxLen; len++) {
    const candidates = vocabByLen.get(len);
    if (!candidates) continue;
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      if (cand === qt) continue;
      // Same initial char or shared 2nd char prunes almost all unrelated words in < 1ms
      if (cand[0] !== qt[0] && cand[1] !== qt[1]) continue;
      const dist = levenshteinBounded(qt, cand, maxDist);
      if (dist <= maxDist) {
        matches.push({ token: cand, weight: dist === 1 ? 0.65 : 0.45 });
      }
    }
  }
  return matches;
}

function parseQueryParties(rawQuery) {
  const cleaned = cleanText(rawQuery);
  const parts = cleaned.split(SIDE_SPLIT_REGEX);
  const hasTwoSides = parts.length >= 2;

  const queryDocket = extractDocketSignals(cleaned, true);
  const hasExplicitSeries = queryDocket.series.size > 0;
  const isExplicitArticleOnly = /^\s*(?:art(?:icle|ile|cl|icel)?\.?)\s*\d{1,4}\s*$/i.test(rawQuery);

  // Strip leading docket labels when building title search tokens so "gr 188289 noveras" still finds Noveras
  const titleQueryRaw = cleaned
    .replace(DOCKET_SERIES_STRIP_REGEX, ' ')
    .replace(/\bno(?:s)?\.?\b/gi, ' ');

  const allWords = tokenizeWords(titleQueryRaw);
  const meaningfulWords = allWords.filter((w) => {
    if (STOP_WORDS.has(w)) return false;
    if (/^\d+$/.test(w)) return false;
    if (w.length === 1 && !SINGLE_CHAR_OK_PREFIX.has(w)) return false;
    return true;
  });

  // Exclude docket-shaped tokens (e.g. "l", "l10033", "gr188289", "p021651") so docket-only queries skip slow summary scans
  const filteredTitleWords = meaningfulWords.filter((w) => {
    if (w === 'l' && queryDocket.numbers.size > 0) return false;
    if (queryDocket.codes.has(w)) return false;
    if (queryDocket.numbers.size > 0 && (/^[a-z]{1,4}\d+[a-z0-9]*$/i.test(w) || /^\d+[a-z]{1,4}$/i.test(w))) {
      return false;
    }
    return true;
  });

  const leftWords = hasTwoSides
    ? tokenizeWords(parts[0]).filter((w) => !STOP_WORDS.has(w) && !/^\d+$/.test(w))
    : [];
  const rightWords = hasTwoSides
    ? tokenizeWords(parts.slice(1).join(' ')).filter((w) => !STOP_WORDS.has(w) && !/^\d+$/.test(w))
    : [];

  const isDocketOnly =
    !isExplicitArticleOnly &&
    queryDocket.numbers.size > 0 &&
    filteredTitleWords.length === 0;

  return {
    cleaned,
    phraseText: filteredTitleWords.join(' '),
    compactQuery: filteredTitleWords.join(''),
    titleTokens: filteredTitleWords,
    hasTwoSides,
    leftWords,
    rightWords,
    queryDocket,
    hasExplicitSeries,
    isExplicitArticleOnly,
    isDocketOnly
  };
}

function tokenMatchesEntry(qt, fuzzyMap, entry, idfMap) {
  const idf = idfMap.get(qt) || (qt.length >= 6 ? 7.0 : 4.5);

  if (entry.titleTokens.has(qt)) {
    return { hit: true, exact: true, score: idf * 18 };
  }
  if (entry.aliasTokens.has(qt)) {
    return { hit: true, exact: true, score: idf * 16 };
  }

  const aliases = TOKEN_ALIASES[qt];
  if (aliases) {
    for (const a of aliases) {
      if (entry.titleTokens.has(a) || entry.aliasTokens.has(a)) {
        return { hit: true, exact: true, score: idf * 15 };
      }
    }
  }

  // Prefix match (useful while typing or partial surnames like "Quir" or "Nover")
  if (qt.length >= 3) {
    for (const tt of entry.titleTokens) {
      if (tt.startsWith(qt)) {
        const ratio = Math.min(1, qt.length / tt.length);
        return { hit: true, exact: false, score: idf * (10 + 5 * ratio) };
      }
    }
  }

  // Typo / fuzzy match
  const fuzzies = fuzzyMap.get(qt);
  if (fuzzies && fuzzies.length > 0) {
    for (const f of fuzzies) {
      if (entry.titleTokens.has(f.token)) {
        const fIdf = idfMap.get(f.token) || idf;
        return { hit: true, exact: false, score: fIdf * 13 * f.weight };
      }
    }
  }

  return { hit: false, exact: false, score: 0 };
}

function sideHasToken(side, tok, fuzzyMap) {
  if (!side) return false;
  if (side.tokenSet.has(tok)) return true;
  const aliases = TOKEN_ALIASES[tok];
  if (aliases && aliases.some((a) => side.tokenSet.has(a))) return true;
  if (tok.length >= 3) {
    for (const st of side.tokenSet) {
      if (st.startsWith(tok)) return true;
    }
  }
  const fuzzies = fuzzyMap.get(tok);
  if (fuzzies && fuzzies.some((f) => side.tokenSet.has(f.token))) return true;
  return false;
}

function scoreEntry(entry, parsed, fuzzyMap, idfMap) {
  let score = 0;
  let docketHit = false;
  let strongTitleHit = false;

  // 1. Docket matching (unless user explicitly asked "Article <num>")
  const { queryDocket, hasExplicitSeries, isExplicitArticleOnly } = parsed;
  if (!isExplicitArticleOnly && (queryDocket.codes.size > 0 || queryDocket.numbers.size > 0)) {
    let bestDocket = 0;

    for (const qc of queryDocket.codes) {
      if (entry.docketCodes.has(qc)) {
        bestDocket = Math.max(bestDocket, 1000);
      }
    }

    if (bestDocket < 900) {
      for (const qn of queryDocket.numbers) {
        if (entry.docketNumbers.has(qn)) {
          bestDocket = Math.max(bestDocket, 880);
        } else if (qn.length >= 3) {
          for (const dn of entry.docketNumbers) {
            if (dn.startsWith(qn)) {
              bestDocket = Math.max(bestDocket, 420);
            } else if (qn.length >= 4 && dn.includes(qn)) {
              bestDocket = Math.max(bestDocket, 220);
            }
          }
        }
      }
    }

    if (bestDocket > 0) {
      docketHit = true;
      if (hasExplicitSeries) {
        let seriesMatch = false;
        for (const s of queryDocket.series) {
          if (entry.series.has(s)) {
            seriesMatch = true;
            break;
          }
        }
        bestDocket += seriesMatch ? 160 : -140;
      }
      score += bestDocket;
    }
  }

  // 2. Title & Party matching
  if (parsed.titleTokens.length > 0) {
    if (parsed.phraseText.length >= 3 && entry.titleText.includes(parsed.phraseText)) {
      score += 480;
      if (entry.titleText.startsWith(parsed.phraseText)) score += 90;
      strongTitleHit = true;
    } else if (parsed.compactQuery.length >= 4 && entry.compactTitle.includes(parsed.compactQuery)) {
      score += 440;
      strongTitleHit = true;
    }

    let matchedCount = 0;
    let exactCount = 0;
    let tokenScore = 0;

    for (const qt of parsed.titleTokens) {
      const m = tokenMatchesEntry(qt, fuzzyMap, entry, idfMap);
      if (m.hit) {
        matchedCount++;
        if (m.exact) exactCount++;
        tokenScore += m.score;
      }
    }

    const totalTokens = parsed.titleTokens.length;
    const coverage = matchedCount / totalTokens;

    if (matchedCount > 0) {
      score += tokenScore;

      if (matchedCount === totalTokens) {
        score += totalTokens >= 2 ? 420 : 120;
        if (exactCount === totalTokens) score += 60;
        strongTitleHit = true;
      } else if (totalTokens >= 2 && coverage >= 0.5) {
        score += 120 * coverage;
        strongTitleHit = true;
      }
    }

    // Two-sided party bonus ("People v Batis", "Noveras v Noveras") or repeated surname ("Noveras Noveras")
    if (entry.leftSide && entry.rightSide) {
      if (parsed.hasTwoSides && parsed.leftWords.length > 0 && parsed.rightWords.length > 0) {
        const leftHit = parsed.leftWords.some((lw) => sideHasToken(entry.leftSide, lw, fuzzyMap));
        const rightHit = parsed.rightWords.some((rw) => sideHasToken(entry.rightSide, rw, fuzzyMap));
        if (leftHit && rightHit) {
          score += 320;
          strongTitleHit = true;
        }
      } else if (totalTokens >= 2) {
        const tokenCounts = new Map();
        for (const qt of parsed.titleTokens) tokenCounts.set(qt, (tokenCounts.get(qt) || 0) + 1);
        for (const [qt, count] of tokenCounts.entries()) {
          if (count >= 2 && sideHasToken(entry.leftSide, qt, fuzzyMap) && sideHasToken(entry.rightSide, qt, fuzzyMap)) {
            score += 240;
            strongTitleHit = true;
          }
        }
      }
    }

    // Filter out single generic-word accidents on multi-word queries unless docket hit
    if (!docketHit && totalTokens >= 2 && coverage < 0.5 && tokenScore < 100) {
      return 0;
    }
  }

  if (!docketHit && !strongTitleHit && score < 40) {
    return 0;
  }

  // Prefer cases with real party names over duplicate raw docket-number titles
  if (score > 0 && !entry.isDocketTitle) {
    score += 35;
  }

  return score;
}

function makeCaseSnippet(summary) {
  if (!summary) return '';
  return summary.length > 180 ? summary.slice(0, 180).trimEnd() + '...' : summary;
}

async function fallbackSummarySearch(supabase, rawQuery, parsed, excludeUids, neededCount) {
  if (neededCount <= 0 || parsed.isDocketOnly) return [];

  let phrase = parsed.isExplicitArticleOnly
    ? rawQuery.trim()
    : (parsed.phraseText || rawQuery.trim());

  if (phrase.length < 3) return [];

  // Keep fallback safe against PostgREST syntax characters
  const safeTerms = phrase
    .replace(/[,()%'*]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 4);

  if (safeTerms.length === 0) return [];

  let q = supabase
    .from('jurisprudence_cases')
    .select('case_uid, title, gr_number, decision_date, content_summary');

  for (const term of safeTerms) {
    q = q.ilike('content_summary', `%${term}%`);
  }

  const { data, error } = await q.limit(neededCount + excludeUids.size);
  if (error || !data) return [];

  const results = [];
  for (const row of data) {
    if (excludeUids.has(row.case_uid)) continue;
    results.push({
      case_uid: row.case_uid,
      title: row.title,
      gr_number: row.gr_number || '',
      decision_date: row.decision_date || '',
      snippet: makeCaseSnippet(row.content_summary),
      content_summary: makeCaseSnippet(row.content_summary)
    });
    if (results.length >= neededCount) break;
  }
  return results;
}

export async function searchJurisprudence(supabase, rawQuery, maxResults = 6) {
  const query = String(rawQuery || '').trim();
  if (query.length < 2) return [];

  const parsed = parseQueryParties(query);
  if (
    parsed.titleTokens.length === 0 &&
    parsed.queryDocket.codes.size === 0 &&
    parsed.queryDocket.numbers.size === 0 &&
    !parsed.isExplicitArticleOnly
  ) {
    return [];
  }

  let topMatches = [];
  let topScore = 0;
  try {
    const index = await getJurisprudenceIndex(supabase);
    const fuzzyMap = new Map();
    for (const qt of parsed.titleTokens) {
      fuzzyMap.set(qt, resolveFuzzyMatchesForToken(qt, index.vocabByLen));
    }

    const scored = [];
    for (let i = 0; i < index.entries.length; i++) {
      const entry = index.entries[i];
      const s = scoreEntry(entry, parsed, fuzzyMap, index.idf);
      if (s > 0) {
        scored.push({ entry, score: s });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    topScore = scored[0]?.score || 0;
    topMatches = scored.slice(0, maxResults).map((x) => ({
      case_uid: x.entry.case_uid,
      title: x.entry.title,
      gr_number: x.entry.gr_number,
      decision_date: x.entry.decision_date,
      snippet: '',
      content_summary: ''
    }));
  } catch (err) {
    console.error('[JurisprudenceSearch] Index search error:', err?.message || err);
  }

  // Hydrate concise summaries for matched index rows in a single lightweight IN query
  if (topMatches.length > 0) {
    const uids = topMatches.map((m) => m.case_uid);
    const { data: sumData, error: sumErr } = await supabase
      .from('jurisprudence_cases')
      .select('case_uid, content_summary')
      .in('case_uid', uids);

    if (!sumErr && sumData) {
      const sumMap = new Map(sumData.map((r) => [r.case_uid, makeCaseSnippet(r.content_summary)]));
      for (const item of topMatches) {
        const s = sumMap.get(item.case_uid) || '';
        item.snippet = s;
        item.content_summary = s;
      }
    }
  }

  // Top up from content_summary only when no strong docket or party-title match was found
  if (topMatches.length < maxResults && (topMatches.length === 0 || topScore < 200)) {
    const seen = new Set(topMatches.map((m) => m.case_uid));
    const fallbackMatches = await fallbackSummarySearch(
      supabase,
      query,
      parsed,
      seen,
      maxResults - topMatches.length
    );
    topMatches.push(...fallbackMatches);
  }

  return topMatches;
}
