import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_ANON_KEY || 'dummy'
);

router.get('/stats', async (req, res) => {
  try {
    const [casesRes, artsRes, relsRes] = await Promise.all([
      supabase.from('jurisprudence_cases').select('*', { count: 'exact', head: true }),
      supabase.from('civil_code_articles').select('*', { count: 'exact', head: true }).gt('article_number', 0),
      supabase.from('article_jurisprudence_relations').select('*', { count: 'exact', head: true })
    ]);

    res.json({
      total_cases: casesRes.count ?? 11879,
      total_articles: artsRes.count ?? 2270,
      total_relations: relsRes.count ?? 11639
    });
  } catch (err) {
    console.error("Error fetching stats:", err);
    res.json({ total_cases: 11879, total_articles: 2270, total_relations: 11639 });
  }
});

function extractArticleNumber(q) {
  if (!q) return null;
  // If pure number: must be whole number 1 to 2270 (not a 5-6 digit G.R. number)
  const pureNumMatch = q.trim().match(/^#?\s*(\d{1,4})$/);
  if (pureNumMatch) {
    const num = parseInt(pureNumMatch[1], 10);
    if (num >= 1 && num <= 2270) return num;
    return null;
  }
  // If prefixed with article/art/artile/etc.
  const prefixMatch = q.match(/\b(?:art(?:icle|ile|cl|icel)?\.?\s*)(\d{1,4})\b/i);
  if (prefixMatch) {
    const num = parseInt(prefixMatch[1], 10);
    if (num >= 1 && num <= 2270) return num;
  }
  return null;
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

router.get('/search', async (req, res) => {
  const query = (req.query.q || '').toString().trim();
  const limit = Math.min(parseInt(req.query.limit || '15', 10), 50);

  if (!query) {
    return res.json({ query: '', exact_article: null, articles: [], toc_sections: [], total_matches: 0 });
  }

  try {
    const articleNum = extractArticleNumber(query);
    const seenArticleIds = new Set();
    const articles = [];
    let exactArticle = null;

    // 1. Exact article lookup by parsed article number
    if (articleNum) {
      const { data: numArts, error: numErr } = await supabase
        .from('civil_code_articles')
        .select('article_id, article_number, hierarchy, content')
        .eq('article_number', articleNum)
        .limit(1);

      if (!numErr && numArts && numArts.length > 0) {
        const art = numArts[0];
        exactArticle = {
          article_id: art.article_id,
          article_number: art.article_number,
          title: `Article ${art.article_number}`,
          hierarchy: art.hierarchy || {},
          content: art.content || '',
          snippet: art.content ? (art.content.length > 160 ? art.content.slice(0, 160) + '...' : art.content) : '',
          match_type: 'exact_number'
        };
        seenArticleIds.add(art.article_id);
        articles.push(exactArticle);
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

    // 4. Search Jurisprudence Cases (G.R. Number, Title, or summary keywords)
    let cases = [];
    const caseSearchTerm = query.replace(/^art[a-z]*\.?\s*\d+\s*/i, '').trim() || query;
    if (caseSearchTerm && caseSearchTerm.length >= 2) {
      const { data: casesData, error: casesErr } = await supabase
        .from('jurisprudence_cases')
        .select('case_uid, title, gr_number, decision_date, content_summary')
        .or(`title.ilike.%${caseSearchTerm}%,gr_number.ilike.%${caseSearchTerm}%,content_summary.ilike.%${caseSearchTerm}%`)
        .limit(4);

      if (!casesErr && casesData) {
        cases = casesData.map(c => ({
          case_uid: c.case_uid,
          title: c.title,
          gr_number: c.gr_number || '',
          decision_date: c.decision_date || '',
          snippet: c.content_summary ? (c.content_summary.length > 150 ? c.content_summary.slice(0, 150) + '...' : c.content_summary) : ''
        }));
      }
    }

    res.json({
      query,
      exact_article: exactArticle,
      articles,
      toc_sections: Array.from(tocMap.values()).slice(0, 5),
      cases,
      total_matches: articles.length + cases.length
    });
  } catch (err) {
    console.error('Error in /api/civil-code/search:', err);
    res.status(500).json({ error: 'Search failed', articles: [], total_matches: 0 });
  }
});

router.get('/toc', async (req, res) => {
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

    const resultTree = [];
    let bIdx = 0;

    for (const [bookName, bookObj] of booksMap.entries()) {
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

    const bookOrder = {
      "GENERAL OVERVIEW & FOUNDATIONAL PRINCIPLES": -1,
      "PRELIMINARY TITLE": 0,
      "BOOK I - PERSONS": 1,
      "BOOK II - PROPERTY, OWNERSHIP, AND ITS MODIFICATIONS": 2,
      "BOOK III - DIFFERENT MODES OF ACQUIRING OWNERSHIP": 3,
      "BOOK IV - OBLIGATIONS AND CONTRACTS": 4
    };
    resultTree.sort((a, b) => (bookOrder[a.title] ?? 99) - (bookOrder[b.title] ?? 99));

    res.json({ toc: resultTree });
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

    // Fetch related cases via the junction table using Supabase join syntax
    // Since we don't have explicit foreign key setup defined in this snippet, 
    // we can do a two-step query or a join if configured. Let's do a simple two-step to be safe.
    const { data: relationRows, error: relationError } = await supabase
      .from('article_jurisprudence_relations')
      .select('case_uid')
      .eq('article_id', articleId)
      .limit(5);
      
    if (relationError) throw relationError;
    
    if (relationRows && relationRows.length > 0) {
      const caseUids = relationRows.map(r => r.case_uid);
      const { data: casesRows, error: casesError } = await supabase
        .from('jurisprudence_cases')
        .select('case_uid, title, gr_number, decision_date, content_summary, source_url, full_text')
        .in('case_uid', caseUids);
        
      if (casesError) throw casesError;
      article.related_cases = casesRows || [];
    } else {
      article.related_cases = [];
    }

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
