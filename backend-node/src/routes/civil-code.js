import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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
            children: arts.map(a => ({ id: a.article_id, title: a.article_number ? `Article ${a.article_number}` : a.article_id }))
          };
          titleNode.children.push(chapterNode);
        }

        titleObj.arts.forEach(a => {
          titleNode.children.push({ id: a.article_id, title: a.article_number ? `Article ${a.article_number}` : a.article_id });
        });

        bookNode.children.push(titleNode);
      }

      let bcIdx = 0;
      for (const [chapterName, arts] of bookObj.chaptersMap.entries()) {
        bcIdx++;
        const chapterNode = {
          id: `book-${bIdx}-direct-chapter-${bcIdx}`,
          title: chapterName,
          children: arts.map(a => ({ id: a.article_id, title: a.article_number ? `Article ${a.article_number}` : a.article_id }))
        };
        bookNode.children.push(chapterNode);
      }

      bookObj.arts.forEach(a => {
        bookNode.children.push({ id: a.article_id, title: a.article_number ? `Article ${a.article_number}` : a.article_id });
      });

      resultTree.push(bookNode);
    }

    const bookOrder = {
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

export default router;
