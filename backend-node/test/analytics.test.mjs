import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseScope,
  parseDays,
  roundPct,
  formatShortBook,
  formatArticleLabels,
  simplifyTargetDomain,
  buildAnalyticsOverview,
} from '../src/routes/analytics.js';
import { dbPool } from '../src/services/db.js';

const ZERO_USER_UUID = '00000000-0000-4000-8000-000000000000';

test('parameter sanitizers reject invalid scope and days safely', () => {
  assert.equal(parseScope('me'), 'me');
  assert.equal(parseScope('ME'), 'me');
  assert.equal(parseScope('all'), 'all');
  assert.equal(parseScope('invalid; DROP TABLE'), 'all');
  assert.equal(parseScope(undefined), 'all');

  assert.deepEqual(parseDays('7'), { daysKey: '7', daysInt: 7 });
  assert.deepEqual(parseDays('30'), { daysKey: '30', daysInt: 30 });
  assert.deepEqual(parseDays('all'), { daysKey: 'all', daysInt: null });
  assert.deepEqual(parseDays('999'), { daysKey: 'all', daysInt: null });
  assert.deepEqual(parseDays(undefined), { daysKey: 'all', daysInt: null });
});

test('formatting and percentage helpers handle edge cases cleanly', () => {
  assert.equal(roundPct(0, 0), 0);
  assert.equal(roundPct(5, 0), 0);
  assert.equal(roundPct(1, 3), 33.3);
  assert.equal(formatShortBook('BOOK IV - OBLIGATIONS AND CONTRACTS', 'RA386-ART1156'), 'Book IV: Obligations & Contracts');
  assert.equal(formatShortBook('THE FAMILY CODE OF THE PHILIPPINES (EXECUTIVE ORDER NO. 209)', 'EO209-ART36'), 'Family Code (E.O. 209)');
  assert.deepEqual(formatArticleLabels('EO209-ART36', 36), {
    label: 'FC Art. 36',
    full_label: 'Family Code Art. 36',
    statute: 'Family Code (E.O. 209)',
  });
  assert.deepEqual(formatArticleLabels('RA386-ART2180', 2180), {
    label: 'Art. 2180',
    full_label: 'Article 2180',
    statute: 'Civil Code (R.A. 386)',
  });
  assert.equal(simplifyTargetDomain('Philippine Criminal Law (Revised Penal Code / PNP)'), 'Criminal Law');
  assert.equal(simplifyTargetDomain('Philippine Data Privacy & Cybercrime (NPC)'), 'Data Privacy & Cybercrime');
});

test('buildAnalyticsOverview returns complete, fast, privacy-safe payload for scope=all', async () => {
  const start = performance.now();
  const data = await buildAnalyticsOverview({
    userId: ZERO_USER_UUID,
    scope: 'all',
    daysKey: 'all',
    daysInt: null,
  });
  const elapsedMs = performance.now() - start;

  assert.equal(data.scope, 'all');
  assert.equal(data.days, 'all');
  assert.ok(elapsedMs < 1000, `Expected analytics query under 1000ms, got ${elapsedMs.toFixed(1)}ms`);

  // Verify no PII keys exist anywhere in serialized payload
  const serialized = JSON.stringify(data);
  assert.ok(!serialized.includes('@'), 'Anonymized overview must never contain email addresses');
  assert.ok(!serialized.includes('user_id'), 'Anonymized overview must never expose user_id fields');
  assert.ok(!serialized.includes('filename'), 'Anonymized overview must never expose private document filenames');

  // Verify structural invariants across all 7 datasets
  assert.ok(Array.isArray(data.most_queried_articles));
  assert.ok(Array.isArray(data.most_answered_articles));
  assert.ok(Array.isArray(data.top_topics.items));
  assert.ok(Array.isArray(data.activity_timeline.points));
  assert.equal(data.nli_distribution.bands.length, 5);
  assert.ok(data.nli_distribution.bands.some((b) => b.key === 'contradicted'));
  assert.equal(data.language_mix.segments.length, 2);
  assert.equal(data.domain_intent_mix.segments.length, 3);
  assert.equal(data.document_funnel.stages.length, 3);

  // Verify math consistency
  const topicSum = data.top_topics.items.reduce((acc, item) => acc + item.count, 0);
  assert.equal(topicSum, data.top_topics.total_hits);

  const nliBandSum = data.nli_distribution.bands.reduce((acc, b) => acc + b.count, 0);
  assert.equal(nliBandSum, data.nli_distribution.total_classified);

  const langSum = data.language_mix.segments.reduce((acc, s) => acc + s.count, 0);
  assert.equal(langSum, data.language_mix.total);

  const intentSum = data.domain_intent_mix.segments.reduce((acc, s) => acc + s.count, 0);
  assert.equal(intentSum, data.domain_intent_mix.total);

  const docStageSum =
    data.document_funnel.stages.reduce((acc, s) => acc + s.count, 0) +
    data.document_funnel.in_progress;
  assert.equal(docStageSum, data.document_funnel.total_documents);

  // Family Code Art. 36 disambiguation check when present
  const art36 = data.most_queried_articles.find((a) => a.article_number === 36);
  if (art36) {
    assert.equal(art36.article_id, 'EO209-ART36');
  }
});

test('buildAnalyticsOverview handles empty user gracefully for scope=me with zero division bugs', async () => {
  for (const [daysKey, daysInt] of [['7', 7], ['30', 30], ['all', null]]) {
    const data = await buildAnalyticsOverview({
      userId: ZERO_USER_UUID,
      scope: 'me',
      daysKey,
      daysInt,
    });

    assert.equal(data.scope, 'me');
    assert.equal(data.days, daysKey);
    assert.equal(data.summary.total_queries, 0);
    assert.equal(data.summary.total_answers, 0);
    assert.equal(data.summary.total_documents, 0);
    assert.equal(data.summary.avg_nli_score, null);
    assert.equal(data.most_queried_articles.length, 0);
    assert.equal(data.most_answered_articles.length, 0);
    assert.equal(data.top_topics.items.length, 0);
    assert.equal(data.document_funnel.acceptance_rate, null);
    if (daysInt) {
      assert.equal(data.activity_timeline.points.length, daysInt);
    } else {
      assert.equal(data.activity_timeline.points.length, 0);
    }
  }
});

test('buildAnalyticsOverview scope=me returns strictly scoped counts for real active user', async () => {
  const userRes = await dbPool.query(
    'SELECT user_id FROM public.chat_sessions WHERE user_id IS NOT NULL GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 1'
  );
  if (userRes.rows.length === 0) return;

  const activeUserId = userRes.rows[0].user_id;
  const [globalData, personalData] = await Promise.all([
    buildAnalyticsOverview({ userId: activeUserId, scope: 'all', daysKey: 'all', daysInt: null }),
    buildAnalyticsOverview({ userId: activeUserId, scope: 'me', daysKey: 'all', daysInt: null }),
  ]);

  assert.ok(personalData.summary.total_sessions > 0);
  assert.ok(personalData.summary.total_sessions <= globalData.summary.total_sessions);
  assert.ok(personalData.summary.total_queries <= globalData.summary.total_queries);
  assert.ok(personalData.summary.total_documents <= globalData.summary.total_documents);
  assert.equal(personalData.summary.active_users, 1);

  for (const item of personalData.most_answered_articles) {
    assert.equal(item.count, item.my_count);
    assert.ok(item.my_count <= item.global_count);
  }
});

test('analytics_article_citations trigger syncs active article citations on insert and cascades on delete', async () => {
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const existingUser = await client.query(
      'SELECT user_id FROM public.chat_sessions WHERE user_id IS NOT NULL LIMIT 1'
    );
    const testUserId = existingUser.rows[0]?.user_id ?? null;

    const sessRes = await client.query(
      "INSERT INTO public.chat_sessions (user_id, title, session_type) VALUES ($1, 'Trigger Test', 'legal_chat') RETURNING id",
      [testUserId]
    );
    const sessionId = sessRes.rows[0].id;
    const sampleCitations = [
      { parent_type: 'article', parent_id: 'RA386-ART1156', is_in_context: true, rank_status: 'primary' },
      { parent_type: 'article', parent_id: 'RA386-ART1156', is_in_context: true, rank_status: 'primary' },
      { parent_type: 'article', parent_id: 'RA386-ART1157', is_in_context: false, rank_status: 'out_of_rank' },
      { parent_type: 'case', parent_id: 'CASE-123', is_in_context: true, rank_status: 'primary' },
    ];
    const msgRes = await client.query(
      "INSERT INTO public.chat_messages (session_id, role, content, citations) VALUES ($1, 'assistant', 'Test answer', $2::jsonb) RETURNING id",
      [sessionId, JSON.stringify(sampleCitations)]
    );
    const msgId = msgRes.rows[0].id;

    const projRes = await client.query(
      'SELECT article_id, user_id FROM public.analytics_article_citations WHERE message_id = $1',
      [msgId]
    );
    assert.equal(projRes.rows.length, 1);
    assert.equal(projRes.rows[0].article_id, 'RA386-ART1156');
    assert.equal(projRes.rows[0].user_id, testUserId);

    await client.query('DELETE FROM public.chat_sessions WHERE id = $1', [sessionId]);
    const afterDel = await client.query(
      'SELECT COUNT(*)::int AS cnt FROM public.analytics_article_citations WHERE message_id = $1',
      [msgId]
    );
    assert.equal(afterDel.rows[0].cnt, 0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

test.after(async () => {
  await dbPool.end();
});
