import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { dbPool } from '../services/db.js';

const router = express.Router();

const CACHE_TTL_MS = 15000;
const MAX_CACHE_ENTRIES = 200;
const overviewCache = new Map();

const FAMILY_CODE_CONTEXT_REGEX =
  '\\y(family|marriage|kasal|asawa|annulment|nullity|psychological\\s+incapacity|filiation|custody|support|conjugal|community|spouse|husband|wife|parental|adoption|presumptive\\s+death|eo\\s*209|e\\.o\\.\\s*209)\\y';

const TAGALOG_LEXICON_REGEX =
  '\\y(ano|anong|paano|bakit|kailan|saan|sino|pwede|puwede|maaari|batas|kontrata|asawa|kasal|utang|lupa|bahay|mana|naman|yung|yun|akin|aking|ko|mo|niya|nila|namin|natin|tayo|kami|sila|kanya|kanyang|ako|ikaw|ka|siya|ang|mga|sa|ng|nang|kung|kapag|dahil|kasi|kase|pero|subalit|ngunit|hindi|wala|meron|mayroon|dapat|gusto|kailangan|karapatan|obligasyon|pinsala|bayad|danyos|reklamo|demanda|sinampal|magnanakaw|pangalan|artikulo|paikliin|buod)\\y';

const TOPIC_CASE_SQL = `
  CASE
    WHEN a.article_id LIKE 'EO209-%'
      OR COALESCE(a.hierarchy->>'book_name', '') ILIKE '%FAMILY CODE%'
      OR COALESCE(a.hierarchy->>'title_name', '') ~* '(MARRIAGE|FAMILY|HUSBAND AND WIFE|PARENTAL|PATERNITY|FILIATION|SUPPORT|ADOPTION)'
      THEN 'Family Code (E.O. 209)'
    WHEN COALESCE(a.hierarchy->>'title_name', '') ~* '(EXTRA-CONTRACTUAL|DAMAGES|QUASI-DELICT|TORT)'
      OR (a.article_id LIKE 'RA386-%' AND a.article_number BETWEEN 2142 AND 2235)
      THEN 'Torts & Damages'
    WHEN COALESCE(a.hierarchy->>'title_name', '') ~* '(SALES|BARTER|LEASE)'
      THEN 'Sales & Lease'
    WHEN COALESCE(a.hierarchy->>'book_name', '') ILIKE '%OBLIGATIONS AND CONTRACTS%'
      THEN 'Obligations & Contracts'
    WHEN COALESCE(a.hierarchy->>'book_name', '') ILIKE '%PROPERTY%'
      THEN 'Property & Ownership'
    WHEN COALESCE(a.hierarchy->>'book_name', '') ILIKE '%ACQUIRING OWNERSHIP%'
      OR COALESCE(a.hierarchy->>'title_name', '') ~* '(SUCCESSION|DONATION|PRESCRIPTION)'
      THEN 'Succession & Donations'
    ELSE 'Persons & Civil Rights'
  END
`;

const BUILDER_DOC_CONDITION = `
  (d.canvas_html IS NOT NULL AND left(ltrim(d.canvas_html), 1) = '{' AND d.canvas_html LIKE '%"template_id"%')
`;

export function parseScope(raw) {
  return String(raw || '').toLowerCase() === 'me' ? 'me' : 'all';
}

export function parseDays(raw) {
  const val = String(raw ?? 'all').toLowerCase();
  if (val === '7') return { daysKey: '7', daysInt: 7 };
  if (val === '30') return { daysKey: '30', daysInt: 30 };
  return { daysKey: 'all', daysInt: null };
}

export function roundPct(part, total) {
  if (!total || total <= 0 || !part) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export function formatShortBook(bookName, articleId = '') {
  if (articleId.startsWith('EO209-') || /family code/i.test(bookName || '')) {
    return 'Family Code (E.O. 209)';
  }
  const b = (bookName || '').toUpperCase();
  if (b.includes('OBLIGATIONS AND CONTRACTS')) return 'Book IV: Obligations & Contracts';
  if (b.includes('ACQUIRING OWNERSHIP')) return 'Book III: Succession & Ownership';
  if (b.includes('PROPERTY')) return 'Book II: Property & Ownership';
  if (b.includes('PERSONS')) return 'Book I: Persons';
  if (b.includes('PRELIMINARY')) return 'Preliminary Title';
  return 'Civil Code (R.A. 386)';
}

export function formatArticleLabels(articleId, articleNumber) {
  const isFamily = String(articleId || '').startsWith('EO209-');
  const num = Number(articleNumber) || 0;
  return {
    label: isFamily ? `FC Art. ${num}` : `Art. ${num}`,
    full_label: isFamily ? `Family Code Art. ${num}` : `Article ${num}`,
    statute: isFamily ? 'Family Code (E.O. 209)' : 'Civil Code (R.A. 386)',
  };
}

export function simplifyTargetDomain(raw) {
  const text = String(raw || '').trim();
  if (!text) return 'Other Specialized Law';
  if (/criminal|penal|pnp|prosecutor/i.test(text)) return 'Criminal Law';
  if (/labor|nlrc|dole|employment/i.test(text)) return 'Labor Law';
  if (/tax|bir|nirc/i.test(text)) return 'Taxation Law';
  if (/privacy|cybercrime|npc/i.test(text)) return 'Data Privacy & Cybercrime';
  if (/corporat|sec\b|commercial/i.test(text)) return 'Corporate & Commercial';
  if (/intellectual|copyright|trademark|patent/i.test(text)) return 'Intellectual Property';
  return text.replace(/^Philippine\s+/i, '').split('(')[0].trim() || 'Other Specialized Law';
}

function getCachedOverview(cacheKey) {
  const entry = overviewCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    overviewCache.delete(cacheKey);
    return null;
  }
  return entry.data;
}

function setCachedOverview(cacheKey, data) {
  if (overviewCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = overviewCache.keys().next().value;
    overviewCache.delete(oldestKey);
  }
  overviewCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function formatTimelineLabel(isoDate, granularity) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const short = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return granularity === 'week' ? `Wk ${short}` : short;
}

export async function buildAnalyticsOverview({ userId, scope, daysKey, daysInt }) {
  const scopeUserId = scope === 'me' ? userId : null;
  const params = [scopeUserId, daysInt];

  // 1. Most queried articles extracted from deduplicated user messages
  const queriedArticlesSql = `
    WITH deduped_user_msgs AS (
      SELECT
        m.id,
        m.content,
        LAG(m.content) OVER (PARTITION BY m.session_id ORDER BY m.created_at) AS prev_content,
        EXTRACT(EPOCH FROM (m.created_at - LAG(m.created_at) OVER (PARTITION BY m.session_id ORDER BY m.created_at))) AS diff_sec
      FROM public.chat_messages m
      JOIN public.chat_sessions s ON s.id = m.session_id
      WHERE m.role = 'user'
        AND m.content IS NOT NULL
        AND length(trim(m.content)) > 0
        AND ($1::uuid IS NULL OR s.user_id = $1::uuid)
        AND ($2::int IS NULL OR m.created_at >= NOW() - make_interval(days => $2::int))
    ),
    clean_msgs AS (
      SELECT id, content
      FROM deduped_user_msgs
      WHERE prev_content IS NULL OR content <> prev_content OR diff_sec >= 30
    ),
    raw_mentions AS (
      SELECT
        cm.id AS msg_id,
        (rm[1])::int AS art_num,
        (cm.content ~* $3) AS is_family_ctx
      FROM clean_msgs cm,
           regexp_matches(cm.content, '(?:^|[^a-zA-Z0-9])(?:art(?:icle|ikulo|ile|cl|icel)?\\.?\\s*)(\\d{1,4})(?:\\y)', 'gi') rm
      WHERE (rm[1])::int BETWEEN 1 AND 2270
      UNION ALL
      SELECT
        cm.id AS msg_id,
        (rm[1])::int AS art_num,
        FALSE AS is_family_ctx
      FROM clean_msgs cm,
           regexp_matches(trim(cm.content), '^#?\\s*(\\d{1,4})$', 'g') rm
      WHERE (rm[1])::int BETWEEN 1 AND 2270
    ),
    resolved_mentions AS (
      SELECT DISTINCT
        r.msg_id,
        COALESCE(
          CASE WHEN r.is_family_ctx AND r.art_num <= 257 THEN eo.article_id ELSE ra.article_id END,
          ra.article_id,
          eo.article_id
        ) AS article_id
      FROM raw_mentions r
      LEFT JOIN public.civil_code_articles ra ON ra.article_id = 'RA386-ART' || r.art_num::text
      LEFT JOIN public.civil_code_articles eo ON eo.article_id = 'EO209-ART' || r.art_num::text
      WHERE ra.article_id IS NOT NULL OR eo.article_id IS NOT NULL
    ),
    counted AS (
      SELECT
        rm.article_id,
        a.article_number,
        a.hierarchy->>'book_name' AS book_name,
        a.hierarchy->>'title_name' AS title_name,
        COUNT(*)::int AS query_count
      FROM resolved_mentions rm
      JOIN public.civil_code_articles a ON a.article_id = rm.article_id
      WHERE a.article_number IS NOT NULL AND a.article_number > 0
      GROUP BY rm.article_id, a.article_number, a.hierarchy->>'book_name', a.hierarchy->>'title_name'
    )
    SELECT
      article_id,
      article_number,
      book_name,
      title_name,
      query_count,
      SUM(query_count) OVER ()::int AS total_mentions
    FROM counted
    ORDER BY query_count DESC, article_number ASC
    LIMIT 10;
  `;

  // 2. Most answered/cited articles via normalized projection (avoids TOAST JSONB scans)
  // Always passes req.user.id ($1) so personal comparison count is isolated strictly to the caller
  const answeredArticlesSql = `
    WITH aggregated AS (
      SELECT
        c.article_id,
        a.article_number,
        a.hierarchy->>'book_name' AS book_name,
        a.hierarchy->>'title_name' AS title_name,
        COUNT(*)::int AS global_count,
        COUNT(*) FILTER (WHERE c.user_id = $1::uuid)::int AS my_count
      FROM public.analytics_article_citations c
      JOIN public.civil_code_articles a ON a.article_id = c.article_id
      WHERE a.article_number IS NOT NULL AND a.article_number > 0
        AND ($2::int IS NULL OR c.created_at >= NOW() - make_interval(days => $2::int))
      GROUP BY c.article_id, a.article_number, a.hierarchy->>'book_name', a.hierarchy->>'title_name'
    ),
    scoped AS (
      SELECT
        article_id,
        article_number,
        book_name,
        title_name,
        global_count,
        my_count,
        CASE WHEN $3::text = 'me' THEN my_count ELSE global_count END AS active_count
      FROM aggregated
      WHERE ($3::text = 'all' AND global_count > 0) OR ($3::text = 'me' AND my_count > 0)
    )
    SELECT
      article_id,
      article_number,
      book_name,
      title_name,
      global_count,
      my_count,
      active_count,
      SUM(active_count) OVER ()::int AS total_citations,
      COUNT(*) OVER ()::int AS unique_articles_count
    FROM scoped
    ORDER BY active_count DESC, global_count DESC, article_number ASC
    LIMIT 10;
  `;

  // 3. Top legal topics / Civil Code books aggregated from active cited articles
  const topicsSql = `
    WITH categorized AS (
      SELECT
        ${TOPIC_CASE_SQL} AS topic,
        a.article_id,
        a.article_number
      FROM public.analytics_article_citations c
      JOIN public.civil_code_articles a ON a.article_id = c.article_id
      WHERE a.article_number IS NOT NULL AND a.article_number > 0
        AND ($1::uuid IS NULL OR c.user_id = $1::uuid)
        AND ($2::int IS NULL OR c.created_at >= NOW() - make_interval(days => $2::int))
    ),
    article_rank_per_topic AS (
      SELECT
        topic,
        article_id,
        article_number,
        COUNT(*)::int AS art_hits,
        ROW_NUMBER() OVER (PARTITION BY topic ORDER BY COUNT(*) DESC, article_number ASC) AS rn
      FROM categorized
      GROUP BY topic, article_id, article_number
    ),
    topic_totals AS (
      SELECT
        topic,
        COUNT(*)::int AS hits
      FROM categorized
      GROUP BY topic
    )
    SELECT
      tt.topic,
      tt.hits,
      SUM(tt.hits) OVER ()::int AS total_hits,
      ar.article_id AS top_article_id,
      ar.article_number AS top_article_number
    FROM topic_totals tt
    LEFT JOIN article_rank_per_topic ar ON ar.topic = tt.topic AND ar.rn = 1
    ORDER BY tt.hits DESC, tt.topic ASC;
  `;

  // 4. Activity timeline (consultations vs document analyses + user queries)
  const timelineSql = `
    WITH bounds AS (
      SELECT
        LEAST(
          (
            SELECT MIN(s.created_at AT TIME ZONE 'Asia/Manila')
            FROM public.chat_sessions s
            WHERE ($1::uuid IS NULL OR s.user_id = $1::uuid)
          ),
          (
            SELECT MIN(d.created_at AT TIME ZONE 'Asia/Manila')
            FROM public.user_documents d
            WHERE ($1::uuid IS NULL OR d.user_id = $1::uuid)
          )
        ) AS earliest_local,
        (NOW() AT TIME ZONE 'Asia/Manila') AS now_local
    ),
    config AS (
      SELECT
        CASE
          WHEN $2::int IS NOT NULL THEN 'day'
          WHEN earliest_local IS NULL THEN 'day'
          WHEN EXTRACT(DAY FROM (now_local - earliest_local)) > 45 THEN 'week'
          ELSE 'day'
        END AS granularity,
        CASE
          WHEN $2::int IS NOT NULL THEN date_trunc('day', now_local) - make_interval(days => ($2::int - 1))
          WHEN earliest_local IS NULL THEN NULL
          WHEN EXTRACT(DAY FROM (now_local - earliest_local)) > 45 THEN date_trunc('week', earliest_local)
          ELSE date_trunc('day', earliest_local)
        END AS start_bucket,
        CASE
          WHEN $2::int IS NOT NULL THEN date_trunc('day', now_local)
          WHEN earliest_local IS NULL THEN NULL
          WHEN EXTRACT(DAY FROM (now_local - earliest_local)) > 45 THEN date_trunc('week', now_local)
          ELSE date_trunc('day', now_local)
        END AS end_bucket
      FROM bounds
    ),
    series AS (
      SELECT
        gs::timestamp AS bucket,
        c.granularity
      FROM config c,
           LATERAL generate_series(
             c.start_bucket,
             c.end_bucket,
             CASE WHEN c.granularity = 'week' THEN interval '1 week' ELSE interval '1 day' END
           ) gs
      WHERE c.start_bucket IS NOT NULL
    ),
    session_counts AS (
      SELECT
        date_trunc(c.granularity, s.created_at AT TIME ZONE 'Asia/Manila') AS bucket,
        COUNT(*) FILTER (
          WHERE NOT (s.session_type IN ('document', 'document_analysis') OR s.document_id IS NOT NULL)
        )::int AS consultations,
        COUNT(*) FILTER (
          WHERE s.session_type IN ('document', 'document_analysis') OR s.document_id IS NOT NULL
        )::int AS doc_sessions
      FROM public.chat_sessions s
      CROSS JOIN config c
      WHERE ($1::uuid IS NULL OR s.user_id = $1::uuid)
        AND ($2::int IS NULL OR s.created_at >= NOW() - make_interval(days => $2::int))
      GROUP BY 1
    ),
    rejected_docs AS (
      SELECT
        date_trunc(c.granularity, d.created_at AT TIME ZONE 'Asia/Manila') AS bucket,
        COUNT(*)::int AS rejected_uploads
      FROM public.user_documents d
      CROSS JOIN config c
      WHERE ($1::uuid IS NULL OR d.user_id = $1::uuid)
        AND ($2::int IS NULL OR d.created_at >= NOW() - make_interval(days => $2::int))
        AND NOT ${BUILDER_DOC_CONDITION}
        AND d.status IN ('rejected_unrelated', 'error')
      GROUP BY 1
    ),
    deduped_user_msgs AS (
      SELECT
        m.created_at,
        m.content,
        LAG(m.content) OVER (PARTITION BY m.session_id ORDER BY m.created_at) AS prev_content,
        EXTRACT(EPOCH FROM (m.created_at - LAG(m.created_at) OVER (PARTITION BY m.session_id ORDER BY m.created_at))) AS diff_sec
      FROM public.chat_messages m
      JOIN public.chat_sessions s ON s.id = m.session_id
      WHERE m.role = 'user'
        AND m.content IS NOT NULL
        AND length(trim(m.content)) > 0
        AND ($1::uuid IS NULL OR s.user_id = $1::uuid)
        AND ($2::int IS NULL OR m.created_at >= NOW() - make_interval(days => $2::int))
    ),
    query_counts AS (
      SELECT
        date_trunc(c.granularity, dm.created_at AT TIME ZONE 'Asia/Manila') AS bucket,
        COUNT(*)::int AS queries
      FROM deduped_user_msgs dm
      CROSS JOIN config c
      WHERE dm.prev_content IS NULL OR dm.content <> dm.prev_content OR dm.diff_sec >= 30
      GROUP BY 1
    )
    SELECT
      to_char(sr.bucket, 'YYYY-MM-DD') AS date_key,
      sr.granularity,
      COALESCE(sc.consultations, 0)::int AS consultations,
      (COALESCE(sc.doc_sessions, 0) + COALESCE(rd.rejected_uploads, 0))::int AS document_analyses,
      COALESCE(qc.queries, 0)::int AS queries
    FROM series sr
    LEFT JOIN session_counts sc ON sc.bucket = sr.bucket
    LEFT JOIN rejected_docs rd ON rd.bucket = sr.bucket
    LEFT JOIN query_counts qc ON qc.bucket = sr.bucket
    ORDER BY sr.bucket ASC;
  `;

  // 5. NLI statutory grounding score bands + domain intent mix
  const nliAndDomainSql = `
    WITH base AS (
      SELECT
        m.legal_analytics,
        CASE
          WHEN (m.legal_analytics->>'nli_score') ~ '^[0-9]+(\\.[0-9]+)?$'
          THEN (m.legal_analytics->>'nli_score')::numeric
          ELSE NULL
        END AS nli_score,
        CASE
          WHEN (m.legal_analytics->>'claims_contradicted') ~ '^[0-9]+$'
          THEN (m.legal_analytics->>'claims_contradicted')::int
          ELSE 0
        END AS claims_contradicted,
        COALESCE((m.legal_analytics->>'is_out_of_domain')::boolean, false) AS is_ood,
        COALESCE((m.legal_analytics->>'is_clarification')::boolean, false) AS is_clarification,
        COALESCE(m.legal_analytics->>'domain_category', '') AS domain_category,
        COALESCE(m.legal_analytics->>'nli_status', '') AS nli_status
      FROM public.chat_messages m
      JOIN public.chat_sessions s ON s.id = m.session_id
      WHERE m.role = 'assistant'
        AND ($1::uuid IS NULL OR s.user_id = $1::uuid)
        AND ($2::int IS NULL OR m.created_at >= NOW() - make_interval(days => $2::int))
    )
    SELECT
      COUNT(*)::int AS total_answers,
      COUNT(*) FILTER (WHERE legal_analytics IS NOT NULL)::int AS total_with_analytics,
      COUNT(*) FILTER (
        WHERE legal_analytics IS NOT NULL
          AND NOT (is_ood OR nli_status = 'Out of Domain')
          AND claims_contradicted = 0
          AND nli_score IS NOT NULL AND nli_score >= 85
      )::int AS strict_entailment,
      COUNT(*) FILTER (
        WHERE legal_analytics IS NOT NULL
          AND NOT (is_ood OR nli_status = 'Out of Domain')
          AND claims_contradicted = 0
          AND nli_score IS NOT NULL AND nli_score >= 70 AND nli_score < 85
      )::int AS substantially_consistent,
      COUNT(*) FILTER (
        WHERE legal_analytics IS NOT NULL
          AND NOT (is_ood OR nli_status = 'Out of Domain')
          AND claims_contradicted = 0
          AND nli_score IS NOT NULL AND nli_score < 70
      )::int AS generalized,
      COUNT(*) FILTER (
        WHERE legal_analytics IS NOT NULL
          AND NOT (is_ood OR nli_status = 'Out of Domain')
          AND claims_contradicted > 0
      )::int AS contradicted,
      COUNT(*) FILTER (
        WHERE legal_analytics IS NOT NULL
          AND (is_ood OR nli_status = 'Out of Domain')
      )::int AS out_of_domain,
      COUNT(*) FILTER (
        WHERE legal_analytics IS NOT NULL
          AND NOT (is_ood OR nli_status = 'Out of Domain')
          AND claims_contradicted = 0
          AND nli_score IS NULL
      )::int AS unscored,
      ROUND(AVG(nli_score) FILTER (
        WHERE NOT (is_ood OR nli_status = 'Out of Domain') AND nli_score IS NOT NULL
      ), 1) AS avg_nli_score,
      ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY nli_score) FILTER (
        WHERE NOT (is_ood OR nli_status = 'Out of Domain') AND nli_score IS NOT NULL
      ))::numeric, 1) AS median_nli_score,
      COUNT(*) FILTER (
        WHERE legal_analytics IS NOT NULL
          AND (domain_category = 'civil' OR (NOT is_ood AND NOT is_clarification AND nli_status <> 'Out of Domain'))
      )::int AS in_domain_civil,
      COUNT(*) FILTER (
        WHERE legal_analytics IS NOT NULL AND domain_category = 'other_legal'
      )::int AS non_civil_legal,
      COUNT(*) FILTER (
        WHERE legal_analytics IS NOT NULL
          AND (
            domain_category IN ('non_legal', 'unsupported_dialect')
            OR ((is_ood OR nli_status = 'Out of Domain') AND domain_category <> 'other_legal')
          )
      )::int AS non_legal_refusal,
      COUNT(*) FILTER (
        WHERE legal_analytics IS NOT NULL AND is_clarification AND NOT is_ood AND domain_category <> 'civil'
      )::int AS clarification_prompts
    FROM base;
  `;

  // 5b. Non-civil redirect target breakdown (anonymized specialized statute buckets)
  const redirectTargetsSql = `
    SELECT
      m.legal_analytics->>'target_domain' AS target_domain,
      COUNT(*)::int AS count
    FROM public.chat_messages m
    JOIN public.chat_sessions s ON s.id = m.session_id
    WHERE m.role = 'assistant'
      AND m.legal_analytics IS NOT NULL
      AND m.legal_analytics->>'domain_category' = 'other_legal'
      AND ($1::uuid IS NULL OR s.user_id = $1::uuid)
      AND ($2::int IS NULL OR m.created_at >= NOW() - make_interval(days => $2::int))
    GROUP BY 1
    ORDER BY 2 DESC;
  `;

  // 6. Language mix & deduplicated query/session totals
  const languageAndSummarySql = `
    WITH deduped_user_msgs AS (
      SELECT
        m.id,
        m.content,
        LAG(m.content) OVER (PARTITION BY m.session_id ORDER BY m.created_at) AS prev_content,
        EXTRACT(EPOCH FROM (m.created_at - LAG(m.created_at) OVER (PARTITION BY m.session_id ORDER BY m.created_at))) AS diff_sec
      FROM public.chat_messages m
      JOIN public.chat_sessions s ON s.id = m.session_id
      WHERE m.role = 'user'
        AND m.content IS NOT NULL
        AND length(trim(m.content)) > 0
        AND ($1::uuid IS NULL OR s.user_id = $1::uuid)
        AND ($2::int IS NULL OR m.created_at >= NOW() - make_interval(days => $2::int))
    ),
    clean_msgs AS (
      SELECT id, content
      FROM deduped_user_msgs
      WHERE prev_content IS NULL OR content <> prev_content OR diff_sec >= 30
    ),
    session_stats AS (
      SELECT
        COUNT(*)::int AS total_sessions,
        COUNT(DISTINCT s.user_id)::int AS active_users
      FROM public.chat_sessions s
      WHERE ($1::uuid IS NULL OR s.user_id = $1::uuid)
        AND ($2::int IS NULL OR s.created_at >= NOW() - make_interval(days => $2::int))
    )
    SELECT
      (SELECT COUNT(*)::int FROM clean_msgs) AS total_queries,
      (SELECT COUNT(*) FILTER (WHERE content ~* $3)::int FROM clean_msgs) AS tagalog_queries,
      (SELECT COUNT(*) FILTER (WHERE NOT (content ~* $3))::int FROM clean_msgs) AS english_queries,
      ss.total_sessions,
      ss.active_users
    FROM session_stats ss;
  `;

  // 7. Document analysis validation funnel (uploaded Civil Law vs rejected vs Document Builder drafts)
  const documentFunnelSql = `
    SELECT
      COUNT(*)::int AS total_documents,
      COUNT(*) FILTER (WHERE NOT ${BUILDER_DOC_CONDITION} AND d.status = 'completed')::int AS accepted_civil,
      COUNT(*) FILTER (WHERE NOT ${BUILDER_DOC_CONDITION} AND d.status IN ('rejected_unrelated', 'error'))::int AS rejected_out_of_domain,
      COUNT(*) FILTER (WHERE ${BUILDER_DOC_CONDITION})::int AS builder_drafts,
      COUNT(*) FILTER (WHERE NOT ${BUILDER_DOC_CONDITION} AND COALESCE(d.status, '') NOT IN ('completed', 'rejected_unrelated', 'error'))::int AS in_progress
    FROM public.user_documents d
    WHERE ($1::uuid IS NULL OR d.user_id = $1::uuid)
      AND ($2::int IS NULL OR d.created_at >= NOW() - make_interval(days => $2::int));
  `;

  const [
    queriedRes,
    answeredRes,
    topicsRes,
    timelineRes,
    nliRes,
    redirectsRes,
    langSummaryRes,
    docsRes,
  ] = await Promise.all([
    dbPool.query(queriedArticlesSql, [scopeUserId, daysInt, FAMILY_CODE_CONTEXT_REGEX]),
    dbPool.query(answeredArticlesSql, [userId, daysInt, scope]),
    dbPool.query(topicsSql, params),
    dbPool.query(timelineSql, params),
    dbPool.query(nliAndDomainSql, params),
    dbPool.query(redirectTargetsSql, params),
    dbPool.query(languageAndSummarySql, [scopeUserId, daysInt, TAGALOG_LEXICON_REGEX]),
    dbPool.query(documentFunnelSql, params),
  ]);

  const queriedTotalMentions = queriedRes.rows[0]?.total_mentions ?? 0;
  const mostQueriedArticles = queriedRes.rows.map((row) => {
    const labels = formatArticleLabels(row.article_id, row.article_number);
    return {
      article_id: row.article_id,
      article_number: Number(row.article_number),
      label: labels.label,
      full_label: labels.full_label,
      statute: labels.statute,
      book_name: row.book_name || '',
      short_book: formatShortBook(row.book_name, row.article_id),
      title_name: row.title_name || '',
      count: Number(row.query_count),
      share_percent: roundPct(Number(row.query_count), queriedTotalMentions),
    };
  });

  const answeredTotalCitations = answeredRes.rows[0]?.total_citations ?? 0;
  const uniqueArticlesCited = answeredRes.rows[0]?.unique_articles_count ?? 0;
  const mostAnsweredArticles = answeredRes.rows.map((row) => {
    const labels = formatArticleLabels(row.article_id, row.article_number);
    return {
      article_id: row.article_id,
      article_number: Number(row.article_number),
      label: labels.label,
      full_label: labels.full_label,
      statute: labels.statute,
      book_name: row.book_name || '',
      short_book: formatShortBook(row.book_name, row.article_id),
      title_name: row.title_name || '',
      count: Number(row.active_count),
      global_count: Number(row.global_count),
      my_count: Number(row.my_count),
      share_percent: roundPct(Number(row.active_count), answeredTotalCitations),
    };
  });

  const totalTopicHits = topicsRes.rows[0]?.total_hits ?? 0;
  const topTopics = topicsRes.rows.map((row) => {
    const topLabels = row.top_article_id
      ? formatArticleLabels(row.top_article_id, row.top_article_number)
      : null;
    return {
      topic: row.topic,
      count: Number(row.hits),
      share_percent: roundPct(Number(row.hits), totalTopicHits),
      top_article_id: row.top_article_id || null,
      top_article_label: topLabels ? topLabels.label : null,
    };
  });

  const timelineGranularity = timelineRes.rows[0]?.granularity || 'day';
  const activityTimeline = timelineRes.rows.map((row) => ({
    date: row.date_key,
    label: formatTimelineLabel(row.date_key, row.granularity),
    consultations: Number(row.consultations),
    document_analyses: Number(row.document_analyses),
    queries: Number(row.queries),
  }));

  const nliRow = nliRes.rows[0] || {};
  const strictEntailment = Number(nliRow.strict_entailment || 0);
  const substantiallyConsistent = Number(nliRow.substantially_consistent || 0);
  const generalized = Number(nliRow.generalized || 0);
  const contradicted = Number(nliRow.contradicted || 0);
  const outOfDomain = Number(nliRow.out_of_domain || 0);
  const unscored = Number(nliRow.unscored || 0);
  const totalScoredInDomain = strictEntailment + substantiallyConsistent + generalized + contradicted;
  const totalNliClassified = totalScoredInDomain + outOfDomain;
  const highGroundingRate = totalScoredInDomain > 0
    ? roundPct(strictEntailment + substantiallyConsistent, totalScoredInDomain)
    : null;

  const nliDistribution = {
    bands: [
      {
        key: 'strict_entailment',
        label: 'Strict Entailment',
        range: '>= 85% (0 conflicts)',
        count: strictEntailment,
        share_percent: roundPct(strictEntailment, totalNliClassified),
      },
      {
        key: 'substantially_consistent',
        label: 'Substantially Consistent',
        range: '70 - 84% (0 conflicts)',
        count: substantiallyConsistent,
        share_percent: roundPct(substantiallyConsistent, totalNliClassified),
      },
      {
        key: 'generalized',
        label: 'Generalized',
        range: '< 70% (0 conflicts)',
        count: generalized,
        share_percent: roundPct(generalized, totalNliClassified),
      },
      {
        key: 'contradicted',
        label: 'Contradicted',
        range: '>= 1 conflicting claim',
        count: contradicted,
        share_percent: roundPct(contradicted, totalNliClassified),
      },
      {
        key: 'out_of_domain',
        label: 'Out-of-Domain',
        range: 'Redirected',
        count: outOfDomain,
        share_percent: roundPct(outOfDomain, totalNliClassified),
      },
    ],
    total_classified: totalNliClassified,
    total_scored_in_domain: totalScoredInDomain,
    unscored_count: unscored,
    avg_score: nliRow.avg_nli_score !== null && nliRow.avg_nli_score !== undefined
      ? Number(nliRow.avg_nli_score)
      : null,
    median_score: nliRow.median_nli_score !== null && nliRow.median_nli_score !== undefined
      ? Number(nliRow.median_nli_score)
      : null,
    high_grounding_rate: highGroundingRate,
  };

  const langRow = langSummaryRes.rows[0] || {};
  const englishQueries = Number(langRow.english_queries || 0);
  const tagalogQueries = Number(langRow.tagalog_queries || 0);
  const totalQueries = Number(langRow.total_queries || 0);

  const languageMix = {
    total: totalQueries,
    segments: [
      {
        key: 'english',
        label: 'English',
        count: englishQueries,
        share_percent: roundPct(englishQueries, totalQueries),
      },
      {
        key: 'tagalog',
        label: 'Tagalog / Taglish',
        count: tagalogQueries,
        share_percent: roundPct(tagalogQueries, totalQueries),
      },
    ],
  };

  const inDomainCivil = Number(nliRow.in_domain_civil || 0);
  const nonCivilLegal = Number(nliRow.non_civil_legal || 0);
  const nonLegalRefusal = Number(nliRow.non_legal_refusal || 0);
  const clarificationPrompts = Number(nliRow.clarification_prompts || 0);
  const domainIntentTotal = inDomainCivil + nonCivilLegal + nonLegalRefusal;

  const redirectCounts = new Map();
  for (const r of redirectsRes.rows) {
    const label = simplifyTargetDomain(r.target_domain);
    redirectCounts.set(label, (redirectCounts.get(label) || 0) + Number(r.count || 0));
  }
  const redirectBreakdown = Array.from(redirectCounts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const domainIntentMix = {
    total: domainIntentTotal,
    clarification_count: clarificationPrompts,
    segments: [
      {
        key: 'in_domain_civil',
        label: 'In-Domain Civil Law',
        count: inDomainCivil,
        share_percent: roundPct(inDomainCivil, domainIntentTotal),
      },
      {
        key: 'non_civil_legal',
        label: 'Non-Civil Legal Redirects',
        count: nonCivilLegal,
        share_percent: roundPct(nonCivilLegal, domainIntentTotal),
      },
      {
        key: 'non_legal_refusal',
        label: 'Non-Legal Refusals',
        count: nonLegalRefusal,
        share_percent: roundPct(nonLegalRefusal, domainIntentTotal),
      },
    ],
    redirect_breakdown: redirectBreakdown,
  };

  const docRow = docsRes.rows[0] || {};
  const acceptedCivil = Number(docRow.accepted_civil || 0);
  const rejectedOutOfDomain = Number(docRow.rejected_out_of_domain || 0);
  const builderDrafts = Number(docRow.builder_drafts || 0);
  const inProgressDocs = Number(docRow.in_progress || 0);
  const totalDocuments = Number(docRow.total_documents || 0);
  const totalUploadedValidated = acceptedCivil + rejectedOutOfDomain;
  const acceptanceRate = totalUploadedValidated > 0
    ? roundPct(acceptedCivil, totalUploadedValidated)
    : null;

  const documentFunnel = {
    total_documents: totalDocuments,
    total_uploaded: totalUploadedValidated + inProgressDocs,
    in_progress: inProgressDocs,
    acceptance_rate: acceptanceRate,
    stages: [
      {
        key: 'accepted_civil',
        label: 'Civil Law Accepted',
        count: acceptedCivil,
        share_percent: roundPct(acceptedCivil, totalDocuments),
      },
      {
        key: 'rejected_out_of_domain',
        label: 'Rejected (Out-of-Domain)',
        count: rejectedOutOfDomain,
        share_percent: roundPct(rejectedOutOfDomain, totalDocuments),
      },
      {
        key: 'builder_drafts',
        label: 'Document Builder Drafts',
        count: builderDrafts,
        share_percent: roundPct(builderDrafts, totalDocuments),
      },
    ],
  };

  return {
    scope,
    days: daysKey,
    generated_at: new Date().toISOString(),
    summary: {
      total_queries: totalQueries,
      total_answers: Number(nliRow.total_answers || 0),
      total_sessions: Number(langRow.total_sessions || 0),
      active_users: Number(langRow.active_users || 0),
      unique_articles_cited: uniqueArticlesCited,
      total_article_queries: queriedTotalMentions,
      total_article_citations: answeredTotalCitations,
      avg_nli_score: nliDistribution.avg_score,
      high_grounding_rate: highGroundingRate,
      total_documents: totalDocuments,
    },
    most_queried_articles: mostQueriedArticles,
    most_answered_articles: mostAnsweredArticles,
    top_topics: {
      total_hits: totalTopicHits,
      items: topTopics,
    },
    activity_timeline: {
      granularity: timelineGranularity,
      points: activityTimeline,
    },
    nli_distribution: nliDistribution,
    language_mix: languageMix,
    domain_intent_mix: domainIntentMix,
    document_funnel: documentFunnel,
  };
}

router.get('/overview', requireAuth, async (req, res) => {
  try {
    const scope = parseScope(req.query.scope);
    const { daysKey, daysInt } = parseDays(req.query.days);
    const userId = req.user.id;
    const bypassCache = req.query.fresh === '1';
    const cacheKey = `${scope}:${userId}:${daysKey}`;

    if (!bypassCache) {
      const cached = getCachedOverview(cacheKey);
      if (cached) {
        return res.json(cached);
      }
    }

    const payload = await buildAnalyticsOverview({ userId, scope, daysKey, daysInt });
    setCachedOverview(cacheKey, payload);
    return res.json(payload);
  } catch (err) {
    console.error('[Analytics] Failed to aggregate dashboard overview:', err);
    return res.status(500).json({ error: 'Failed to load legal usage analytics' });
  }
});

export default router;
