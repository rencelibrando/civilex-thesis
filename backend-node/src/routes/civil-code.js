import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { searchJurisprudence } from '../services/jurisprudenceSearch.js';

dotenv.config({ quiet: true });

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_ANON_KEY || 'dummy'
);

let cachedStats = null;
let cachedStatsExpiry = 0;
const STATS_CACHE_TTL_MS = 600000;

router.get('/stats', async (req, res) => {
  if (cachedStats && Date.now() < cachedStatsExpiry) {
    return res.json(cachedStats);
  }
  try {
    const [casesRes, civilArtsRes, familyArtsRes, relsRes] = await Promise.all([
      supabase.from('jurisprudence_cases').select('*', { count: 'exact', head: true }),
      supabase.from('civil_code_articles').select('*', { count: 'exact', head: true }).like('article_id', 'RA386-ART%'),
      supabase.from('civil_code_articles').select('*', { count: 'exact', head: true }).like('article_id', 'EO209-ART%'),
      supabase.from('article_jurisprudence_relations').select('*', { count: 'exact', head: true })
    ]);

    const civilCount = civilArtsRes.count ?? 2270;
    const familyCount = familyArtsRes.count ?? 257;

    cachedStats = {
      total_cases: casesRes.count ?? 11879,
      total_articles: civilCount,
      civil_code_articles: civilCount,
      family_code_articles: familyCount,
      total_relations: relsRes.count ?? 11639
    };
    cachedStatsExpiry = Date.now() + STATS_CACHE_TTL_MS;

    res.json(cachedStats);
  } catch (err) {
    console.error("Error fetching stats:", err);
    res.json({ total_cases: 11879, total_articles: 2270, civil_code_articles: 2270, family_code_articles: 257, total_relations: 11639 });
  }
});

const ENACTMENT_YEARS = new Set([1949, 1950, 1987, 1988]);
const DOCKET_QUERY_REGEX = /\b(?:g\.?\s*r\.?|a\.?\s*[mc]\.?|b\.?\s*m\.?)\s*(?:nos?\.?)?\s*[#:\-=]?\s*[a-z]?-?\d/i;
const CURRENCY_QUERY_REGEX = /(?:php|₱|\$|pesos?|dollars?)/i;

function normalizeThousandsArticles(q) {
  return q.replace(/(?<![\d,.])\b([12]),(\d{3})\b(?![\d,])/g, (match, d1, d234, offset, str) => {
    const before = str.slice(Math.max(0, offset - 12), offset);
    const after = str.slice(offset + match.length, offset + match.length + 12);
    if (CURRENCY_QUERY_REGEX.test(before) || CURRENCY_QUERY_REGEX.test(after)) {
      return match;
    }
    const val = parseInt(`${d1}${d234}`, 10);
    return val >= 1000 && val <= 2270 ? `${d1}${d234}` : match;
  });
}

export function extractArticleNumber(q) {
  if (!q) return null;
  const trimmed = String(q).trim();
  if (!trimmed || DOCKET_QUERY_REGEX.test(trimmed)) return null;

  const normalized = normalizeThousandsArticles(trimmed);

  const pureNumMatch = normalized.match(/^#?\s*(\d{1,4})\??$/);
  if (pureNumMatch) {
    const num = parseInt(pureNumMatch[1], 10);
    return num >= 1 && num <= 2270 ? num : null;
  }

  // Prefix form: art#1191, artikulo 1191, artilce 99, atr 1191, eo 209 36, family code 36, ra 386 1191, fc 36, cc 1191
  const prefixMatch = normalized.match(
    /\b(?:art(?:icles?|ilces?|iles?|cles?|icels?|cls?|ikulos?|s)?\.?|atr(?:icles?|cles?|ikulos?|s)?\.?|probisyon(?:\s+(?:blg|bilang|no)\.?)?|civil\s+code(?:\s+(?:articles?|arts?\.?|sec(?:tion)?\.?))?|family\s+code(?:\s+(?:articles?|arts?\.?|sec(?:tion)?\.?))?|r\.?a\.?\s*(?:no\.?\s*)?386(?:\s+(?:articles?|arts?\.?|sec(?:tion)?\.?))?|e\.?o\.?\s*(?:no\.?\s*)?209(?:\s+(?:articles?|arts?\.?|sec(?:tion)?\.?))?|kodigo\s+sibil(?:\s+(?:artikulo|articles?|arts?\.?))?|batas\s+sibil(?:\s+(?:artikulo|articles?|arts?\.?))?|fc(?:\s+(?:articles?|arts?\.?|sec(?:tion)?\.?))?|cc(?:\s+(?:articles?|arts?\.?|sec(?:tion)?\.?))?)\s*(?:(?:nos?|bilang|blg)\b\.?)?\s*[#:\-–=]?\s*(\d{1,4})\b/i
  );
  if (prefixMatch) {
    const num = parseInt(prefixMatch[1], 10);
    if (num >= 1 && num <= 2270) return num;
  }

  // Postfix form: "36 family code", "1191 of the civil code", "sec 36 family code"
  const postfixMatch = normalized.match(
    /(?<![\d.])\b(\d{1,4})\b\s*(?:(?:of\s+(?:the\s+)?|ng\s+|sa\s+|in\s+(?:the\s+)?|under\s+(?:the\s+)?))?(?:civil\s+code|family\s+code|r\.?a\.?\s*(?:no\.?\s*)?386|e\.?o\.?\s*(?:no\.?\s*)?209|kodigo\s+sibil|batas\s+sibil|f\.?c\.?|c\.?c\.?)\b/i
  );
  if (postfixMatch) {
    const num = parseInt(postfixMatch[1], 10);
    const before = normalized.slice(Math.max(0, postfixMatch.index - 30), postfixMatch.index);
    const isStatuteNum = /\b(?:executive\s+order|e\.?\s*o\.?|republic\s+act|r\.?\s*a\.?|act|order|p\.?\s*d\.?|b\.?\s*p\.?)\s*(?:nos?\.?\s*)?$/i.test(before);
    const isBareEnactmentYear = ENACTMENT_YEARS.has(num) && !/\b(?:art(?:icle)?s?|artikulo|sec(?:tion)?|probisyon)\b\s*$/i.test(before);
    if (!isStatuteNum && !isBareEnactmentYear && num >= 1 && num <= 2270) {
      return num;
    }
  }

  return null;
}

const RAW_DOCKET_TITLE_REGEX = /^(?:g\.?\s*r\.?|a\.?\s*[mc]\.?|b\.?\s*m\.?)/i;

async function fetchLinkedArticleCases(articleIds, limit = 6) {
  if (!articleIds || articleIds.length === 0) return [];
  const { data: rels, error: relErr } = await supabase
    .from('article_jurisprudence_relations')
    .select('case_uid, citation_type')
    .in('article_id', articleIds)
    .limit(30);

  if (relErr || !rels || rels.length === 0) return [];

  // Prioritize explicit Family Code relations when present.
  rels.sort((a, b) => (b.citation_type === 'family_code_explicit' ? 1 : 0) - (a.citation_type === 'family_code_explicit' ? 1 : 0));
  const uniqueUids = Array.from(new Set(rels.map((r) => r.case_uid)));

  const { data: rows, error: caseErr } = await supabase
    .from('jurisprudence_cases')
    .select('case_uid, title, gr_number, decision_date, content_summary, source_url')
    .in('case_uid', uniqueUids);

  if (caseErr || !rows) return [];

  const named = rows.filter((r) => r.title && !RAW_DOCKET_TITLE_REGEX.test(r.title.trim()));
  const pool = named.length > 0 ? named : rows;
  const uidOrder = new Map(uniqueUids.map((u, idx) => [u, idx]));
  pool.sort((a, b) => (uidOrder.get(a.case_uid) ?? 999) - (uidOrder.get(b.case_uid) ?? 999));

  return pool.slice(0, limit).map((r) => {
    const summary = r.content_summary && r.content_summary !== 'Summary unavailable.' ? r.content_summary : '';
    const snippet = summary.length > 180 ? summary.slice(0, 180).trimEnd() + '...' : summary;
    return {
      case_uid: r.case_uid,
      title: r.title,
      gr_number: r.gr_number || '',
      decision_date: r.decision_date || '',
      source_url: r.source_url || '',
      snippet,
      content_summary: snippet
    };
  });
}

function makeSnippet(content, query) {
  if (!content) return '';
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) {
    return content.length > 150 ? content.slice(0, 150) + '...' : content;
  }
  const start = Math.max(0, idx - 45);
  const end = Math.min(content.length, idx + query.length + 85);
  let snippet = content.slice(start, end).trim();
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';
  return snippet;
}

// In-memory LRU/TTL cache for search queries
const searchCache = new Map();
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SEARCH_CACHE_SIZE = 250;

function getCachedSearch(cacheKey) {
  const entry = searchCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > SEARCH_CACHE_TTL_MS) {
    searchCache.delete(cacheKey);
    return null;
  }
  return entry.data;
}

function setCachedSearch(cacheKey, data) {
  if (searchCache.size >= MAX_SEARCH_CACHE_SIZE) {
    const oldestKey = searchCache.keys().next().value;
    searchCache.delete(oldestKey);
  }
  searchCache.set(cacheKey, { timestamp: Date.now(), data });
}

// In-memory cache for static TOC structure (1 hour TTL)
let cachedToc = null;
let cachedTocTimestamp = 0;
const TOC_CACHE_TTL_MS = 60 * 60 * 1000;

router.get('/search', async (req, res) => {
  const query = (req.query.q || '').toString().trim();
  const limit = Math.min(parseInt(req.query.limit || '15', 10), 50);

  if (!query) {
    return res.json({ query: '', exact_article: null, articles: [], toc_sections: [], total_matches: 0 });
  }

  const cacheKey = `${query.toLowerCase()}_${limit}`;
  const cached = getCachedSearch(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  try {
    const articleNum = extractArticleNumber(query);
    const seenArticleIds = new Set();
    const articles = [];
    let exactArticle = null;

    // 1. Exact article lookup by parsed article number
    if (articleNum) {
      const isFamilyQuery = /\b(?:family|marriage|kasal|asawa|annulment|nullity|filiation|adoption|custody|support|separation|eo\s*209|conjugal|community|psychological|incapacity|spouse|husband|wife|parental|emancipation)\b/i.test(query);
      const targetArticleIds = isFamilyQuery
        ? [`EO209-ART${articleNum}`, `RA386-ART${articleNum}`]
        : [`RA386-ART${articleNum}`, `EO209-ART${articleNum}`];

      const { data: numArts, error: numErr } = await supabase
        .from('civil_code_articles')
        .select('article_id, article_number, hierarchy, content')
        .in('article_id', targetArticleIds)
        .limit(2);

      if (!numErr && numArts && numArts.length > 0) {
        // Sort so the preferred ID comes first
        numArts.sort((a, b) => targetArticleIds.indexOf(a.article_id) - targetArticleIds.indexOf(b.article_id));
        const art = numArts[0];
        const isFC = art.article_id.startsWith('EO209-');
        exactArticle = {
          article_id: art.article_id,
          article_number: art.article_number,
          title: `Article ${art.article_number}${isFC ? ' (The Family Code)' : ''}`,
          hierarchy: art.hierarchy || {},
          content: art.content || '',
          snippet: art.content ? (art.content.length > 160 ? art.content.slice(0, 160) + '...' : art.content) : '',
          match_type: 'exact_number'
        };
        seenArticleIds.add(art.article_id);
        articles.push(exactArticle);

        // If both exist, also push the alternative
        if (numArts.length > 1) {
          const alt = numArts[1];
          const altIsFC = alt.article_id.startsWith('EO209-');
          seenArticleIds.add(alt.article_id);
          articles.push({
            article_id: alt.article_id,
            article_number: alt.article_number,
            title: `Article ${alt.article_number}${altIsFC ? ' (The Family Code)' : ''}`,
            hierarchy: alt.hierarchy || {},
            content: alt.content || '',
            snippet: alt.content ? (alt.content.length > 160 ? alt.content.slice(0, 160) + '...' : alt.content) : '',
            match_type: 'exact_number'
          });
        }
      }
    }

    // 2. Phrase & keyword search in article content
    // Strip leading "article 554" or "artile 554" if there's trailing phrase text, e.g. "article 554 possession"
    const cleanedPhrase = query.replace(/^(?:art(?:icle|ile|cl|icel)?\.?\s*)?\d+\s*/i, '').trim();
    const searchPhrase = cleanedPhrase.length >= 2 ? cleanedPhrase : (articleNum ? null : (query.length >= 2 ? query : null));

    if (searchPhrase) {
      const remainingLimit = limit - articles.length;
      if (remainingLimit > 0) {
        const { data: contentArts, error: contentErr } = await supabase
          .from('civil_code_articles')
          .select('article_id, article_number, hierarchy, content')
          .ilike('content', `%${searchPhrase}%`)
          .limit(remainingLimit);

        if (!contentErr && contentArts) {
          for (const art of contentArts) {
            if (!seenArticleIds.has(art.article_id)) {
              seenArticleIds.add(art.article_id);
              articles.push({
                article_id: art.article_id,
                article_number: art.article_number,
                title: art.article_number > 0 ? `Article ${art.article_number}` : (art.hierarchy?.chapter_name || art.article_id),
                hierarchy: art.hierarchy || {},
                content: art.content || '',
                snippet: makeSnippet(art.content, searchPhrase),
                match_type: 'phrase'
              });
            }
          }
        }
      }

      // 3. Search TOC hierarchy (chapter name, title name)
      const hierRemaining = limit - articles.length;
      if (hierRemaining > 0) {
        const { data: hierArts, error: hierErr } = await supabase
          .from('civil_code_articles')
          .select('article_id, article_number, hierarchy, content')
          .or(`hierarchy->>chapter_name.ilike.%${searchPhrase}%,hierarchy->>title_name.ilike.%${searchPhrase}%`)
          .limit(hierRemaining);

        if (!hierErr && hierArts) {
          for (const art of hierArts) {
            if (!seenArticleIds.has(art.article_id)) {
              seenArticleIds.add(art.article_id);
              articles.push({
                article_id: art.article_id,
                article_number: art.article_number,
                title: art.article_number > 0 ? `Article ${art.article_number}` : (art.hierarchy?.chapter_name || art.article_id),
                hierarchy: art.hierarchy || {},
                content: art.content || '',
                snippet: art.content ? (art.content.length > 150 ? art.content.slice(0, 150) + '...' : art.content) : '',
                match_type: 'toc_topic'
              });
            }
          }
        }
      }
    }

    // Extract distinct TOC sections matched
    const tocMap = new Map();
    for (const art of articles) {
      const h = art.hierarchy || {};
      const chapter = h.chapter_name;
      const title = h.title_name;
      const book = h.book_name;
      if (chapter && !tocMap.has(chapter)) {
        tocMap.set(chapter, {
          type: 'chapter',
          name: chapter,
          book_name: book,
          sample_article_id: art.article_id
        });
      } else if (title && !tocMap.has(title)) {
        tocMap.set(title, {
          type: 'title',
          name: title,
          book_name: book,
          sample_article_id: art.article_id
        });
      }
    }

    // 4. Search Jurisprudence Cases (article graph links + flexible docket/party/summary index)
    const strippedArtTerm = query
      .replace(/^(?:art(?:icles?|ilces?|iles?|cles?|icels?|cls?|ikulos?|s)?\.?|atr(?:icles?|s)?\.?|probisyon)\s*(?:(?:nos?|bilang|blg)\b\.?)?\s*[#:\-–=]?\s*\d{1,4}\s*/i, '')
      .trim();
    const caseSearchTerm = strippedArtTerm || query;

    let linkedArticleCases = [];
    if (articleNum) {
      const isFamilyQuery = /\b(?:family|marriage|kasal|asawa|annulment|nullity|filiation|adoption|custody|support|separation|eo\s*209|e\.?o\.?\s*209|fc\b|conjugal|community|psychological|incapacity|spouse|husband|wife|parental|emancipation)\b/i.test(query);
      const relationIds = isFamilyQuery
        ? [`EO209-ART${articleNum}`, `RA386-ART${articleNum}`]
        : [`RA386-ART${articleNum}`, `EO209-ART${articleNum}`];
      linkedArticleCases = await fetchLinkedArticleCases(relationIds, 6);
    }

    const searchedCases = await searchJurisprudence(supabase, caseSearchTerm, 6);
    const mergedCaseMap = new Map();
    for (const c of linkedArticleCases) {
      if (!mergedCaseMap.has(c.case_uid)) mergedCaseMap.set(c.case_uid, c);
    }
    for (const c of searchedCases) {
      if (!mergedCaseMap.has(c.case_uid)) mergedCaseMap.set(c.case_uid, c);
    }
    const cases = Array.from(mergedCaseMap.values()).slice(0, 6);

    const payload = {
      query,
      exact_article: exactArticle,
      articles,
      toc_sections: Array.from(tocMap.values()).slice(0, 5),
      cases,
      total_matches: articles.length + cases.length
    };
    setCachedSearch(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error('Error in /api/civil-code/search:', err);
    res.status(500).json({ error: 'Search failed', articles: [], total_matches: 0 });
  }
});

router.get('/toc', async (req, res) => {
  if (cachedToc && Date.now() - cachedTocTimestamp < TOC_CACHE_TTL_MS) {
    return res.json(cachedToc);
  }

  try {
    let rows = [];
    let from = 0;
    const step = 1000;
    
    while (true) {
      const { data, error } = await supabase
        .from('civil_code_articles')
        .select('article_id, article_number, hierarchy')
        .order('article_number', { ascending: true })
        .range(from, from + step - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      
      rows = rows.concat(data);
      if (data.length < step) break;
      from += step;
    }

    const booksMap = new Map();

    rows.forEach(art => {
      const h = art.hierarchy || {};
      const bookName = h.book_name || 'PRELIMINARY TITLE';
      const titleName = h.title_name || null;
      const chapterName = h.chapter_name || null;

      if (!booksMap.has(bookName)) {
        booksMap.set(bookName, { titlesMap: new Map(), chaptersMap: new Map(), arts: [] });
      }
      const bookObj = booksMap.get(bookName);

      if (titleName) {
        if (!bookObj.titlesMap.has(titleName)) {
          bookObj.titlesMap.set(titleName, { chaptersMap: new Map(), arts: [] });
        }
        const titleObj = bookObj.titlesMap.get(titleName);
        if (chapterName) {
          if (!titleObj.chaptersMap.has(chapterName)) {
            titleObj.chaptersMap.set(chapterName, []);
          }
          titleObj.chaptersMap.get(chapterName).push(art);
        } else {
          titleObj.arts.push(art);
        }
      } else if (chapterName) {
        if (!bookObj.chaptersMap.has(chapterName)) {
          bookObj.chaptersMap.set(chapterName, []);
        }
        bookObj.chaptersMap.get(chapterName).push(art);
      } else {
        bookObj.arts.push(art);
      }
    });

    const getArticleTitle = (a) => {
      if (a.article_number && a.article_number > 0) {
        return `Article ${a.article_number}`;
      }
      return a.hierarchy?.chapter_name || a.hierarchy?.title_name || a.article_id;
    };

    const bookOrder = {
      "GENERAL OVERVIEW & FOUNDATIONAL PRINCIPLES": -1,
      "PRELIMINARY TITLE": 0,
      "BOOK I - PERSONS": 1,
      "THE FAMILY CODE OF THE PHILIPPINES (EXECUTIVE ORDER NO. 209)": 1.5,
      "BOOK II - PROPERTY, OWNERSHIP, AND ITS MODIFICATIONS": 2,
      "BOOK III - DIFFERENT MODES OF ACQUIRING OWNERSHIP": 3,
      "BOOK IV - OBLIGATIONS AND CONTRACTS": 4
    };

    const sortedBookEntries = Array.from(booksMap.entries()).sort(
      ([aTitle], [bTitle]) => (bookOrder[aTitle] ?? 99) - (bookOrder[bTitle] ?? 99)
    );

    const resultTree = [];
    let bIdx = 0;

    for (const [bookName, bookObj] of sortedBookEntries) {
      bIdx++;
      const bookNode = {
        id: `book-${bIdx}`,
        title: bookName,
        children: []
      };

      let tIdx = 0;
      for (const [titleName, titleObj] of bookObj.titlesMap.entries()) {
        tIdx++;
        const titleNode = {
          id: `book-${bIdx}-title-${tIdx}`,
          title: titleName,
          children: []
        };

        let cIdx = 0;
        for (const [chapterName, arts] of titleObj.chaptersMap.entries()) {
          cIdx++;
          const chapterNode = {
            id: `book-${bIdx}-title-${tIdx}-chapter-${cIdx}`,
            title: chapterName,
            children: arts.map(a => ({ id: a.article_id, title: getArticleTitle(a) }))
          };
          titleNode.children.push(chapterNode);
        }

        titleObj.arts.forEach(a => {
          titleNode.children.push({ id: a.article_id, title: getArticleTitle(a) });
        });

        bookNode.children.push(titleNode);
      }

      let bcIdx = 0;
      for (const [chapterName, arts] of bookObj.chaptersMap.entries()) {
        bcIdx++;
        const chapterNode = {
          id: `book-${bIdx}-direct-chapter-${bcIdx}`,
          title: chapterName,
          children: arts.map(a => ({ id: a.article_id, title: getArticleTitle(a) }))
        };
        bookNode.children.push(chapterNode);
      }

      bookObj.arts.forEach(a => {
        bookNode.children.push({ id: a.article_id, title: getArticleTitle(a) });
      });

      resultTree.push(bookNode);
    }

    cachedToc = { toc: resultTree };
    cachedTocTimestamp = Date.now();
    res.json(cachedToc);
  } catch (err) {
    console.error("Error fetching TOC:", err);
    res.status(500).json({ error: "Failed to load table of contents" });
  }
});

router.get('/article/:id', async (req, res) => {
  const articleId = req.params.id;
  try {
    const { data: articleRows, error: articleError } = await supabase
      .from('civil_code_articles')
      .select('article_id, article_number, hierarchy, content')
      .eq('article_id', articleId);

    if (articleError) throw articleError;

    if (!articleRows || articleRows.length === 0) {
      return res.status(404).json({ error: "Article not found" });
    }

    const article = articleRows[0];

    // Fetch related cases via junction table, bridging EO209 <-> RA386 when direct edges are absent.
    const relationIds = [articleId];
    const eoMatch = articleId.match(/^EO209-ART(\d+)$/i);
    let linkedCases = await fetchLinkedArticleCases(relationIds, 5);
    if (linkedCases.length === 0 && eoMatch) {
      linkedCases = await fetchLinkedArticleCases([`RA386-ART${eoMatch[1]}`], 5);
    }
    article.related_cases = linkedCases;

    res.json(article);
  } catch (err) {
    console.error("Error fetching article:", err);
    res.status(500).json({ error: "Failed to load article details" });
  }
});

router.get('/case/:uid', async (req, res) => {
  const caseUid = req.params.uid;
  try {
    const { data: caseRows, error: caseError } = await supabase
      .from('jurisprudence_cases')
      .select('case_uid, title, gr_number, decision_date, source_url, content_summary, full_text')
      .eq('case_uid', caseUid);

    if (caseError) throw caseError;
    if (!caseRows || caseRows.length === 0) {
      return res.status(404).json({ error: "Jurisprudence case not found" });
    }
    res.json(caseRows[0]);
  } catch (err) {
    console.error("Error fetching jurisprudence case:", err);
    res.status(500).json({ error: "Failed to load jurisprudence case details" });
  }
});

export default router;
