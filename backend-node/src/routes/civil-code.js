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

    const treeDict = {};

    rows.forEach(art => {
      const h = art.hierarchy;
      const bookName = h.book_name || "Uncategorized Book";
      const titleName = h.title_name || "Uncategorized Title";
      const chapterName = h.chapter_name || "Uncategorized Chapter";

      if (!treeDict[bookName]) treeDict[bookName] = {};
      if (!treeDict[bookName][titleName]) treeDict[bookName][titleName] = {};
      if (!treeDict[bookName][titleName][chapterName]) treeDict[bookName][titleName][chapterName] = [];

      treeDict[bookName][titleName][chapterName].push({
        id: art.article_id,
        title: art.article_number ? `Article ${art.article_number}` : art.article_id,
        article_number: art.article_number
      });
    });

    const resultTree = [];
    let bIdx = 0;

    for (const [bookName, titles] of Object.entries(treeDict)) {
      bIdx++;
      const bookNode = {
        id: `book-${bIdx}`,
        title: bookName,
        children: []
      };

      let tIdx = 0;
      for (const [titleName, chapters] of Object.entries(titles)) {
        tIdx++;
        const titleNode = {
          id: `book-${bIdx}-title-${tIdx}`,
          title: titleName,
          children: []
        };

        let cIdx = 0;
        for (const [chapterName, arts] of Object.entries(chapters)) {
          cIdx++;

          if (chapterName === "Uncategorized Chapter") {
            const sortedArts = arts.sort((a, b) => (a.article_number || 999999) - (b.article_number || 999999));
            sortedArts.forEach(a => {
              titleNode.children.push({ id: a.id, title: a.title });
            });
          } else {
            const chapterNode = {
              id: `book-${bIdx}-title-${tIdx}-chapter-${cIdx}`,
              title: chapterName,
              children: []
            };

            const sortedArts = arts.sort((a, b) => (a.article_number || 999999) - (b.article_number || 999999));
            sortedArts.forEach(a => {
              chapterNode.children.push({ id: a.id, title: a.title });
            });

            titleNode.children.push(chapterNode);
          }
        }

        bookNode.children.push(titleNode);
      }

      resultTree.push(bookNode);
    }

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
        .select('case_uid, title, gr_number, decision_date, content_summary, source_url')
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

export default router;
