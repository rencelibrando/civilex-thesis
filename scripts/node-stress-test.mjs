/**
 * CIVIL-LEX: Node.js Native Stress Test Runner
 * 
 * Purpose:
 *   A standalone, pure Node.js high-concurrency test harness that does not require
 *   Grafana k6. Simulates concurrent virtual users issuing heartbeats, TOC retrieval,
 *   virtualized scrolling, search, and chat queries.
 * 
 * Usage:
 *   # Run with 500 concurrent VUs for 60 seconds
 *   node scripts/node-stress-test.mjs
 * 
 *   # Custom parameters
 *   CONCURRENCY=1000 DURATION=120 BACKEND_URL="http://192.168.100.76:4000" node scripts/node-stress-test.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const usersPath = path.resolve(__dirname, 'stress-users.json');

if (!fs.existsSync(usersPath)) {
  console.error('Error: scripts/stress-users.json not found.');
  console.error('Run first: node scripts/inject-users.mjs 1000');
  process.exit(1);
}

const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
if (users.length === 0) {
  console.error('Error: No users found in stress-users.json');
  process.exit(1);
}

const BACKEND_URL = process.env.BACKEND_URL || 'http://192.168.100.76:4000';
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '500', 10);
const DURATION_SEC = parseInt(process.env.DURATION || '60', 10);

const sampleArticles = [
  'RA386-STRUCTURE-AND-ARTICLES',
  'RA386-SPECIAL-LAWS-AND-AMENDMENTS',
  'RA386-GENERAL-INFO',
  'RA386-ART1',
  'RA386-ART2',
  'RA386-ART3',
  'RA386-ART1156',
  'RA386-ART1157',
  'RA386-ART1305',
  'RA386-ART1318',
];

const sampleSearches = [
  'obligation',
  'contract',
  'rescission',
  'damages',
  'marriage',
  '1156',
  '1318',
];

const sampleLegalQueries = [
  'What are the essential requisites of a valid contract under the Civil Code?',
  'Explain the concept of an obligation under Article 1156.',
  'What are the grounds for legal separation under Philippine law?',
  'How does mora solvendi differ from mora accipiendi in civil obligations?',
];

// Metrics Store
const categories = ['heartbeat', 'toc', 'article_scroll', 'search', 'legal_chat'];

const metrics = {
  overall: { total: 0, success: 0, failed: 0, latencies: [] },
};

categories.forEach((cat) => {
  metrics[cat] = { total: 0, success: 0, failed: 0, latencies: [] };
});

function recordMetric(category, latencyMs, success) {
  metrics.overall.total++;
  metrics[category].total++;

  if (success) {
    metrics.overall.success++;
    metrics[category].success++;
  } else {
    metrics.overall.failed++;
    metrics[category].failed++;
  }

  metrics.overall.latencies.push(latencyMs);
  metrics[category].latencies.push(latencyMs);
}

function calculateStats(latencies) {
  if (!latencies || latencies.length === 0) {
    return { min: 0, avg: 0, p95: 0, p99: 0, max: 0 };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avg = Math.round(sum / sorted.length);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || max;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || max;
  return { min, avg, p95, p99, max };
}

let keepRunning = true;
let activeVUs = 0;
let peakVUs = 0;

async function simulateUserLifecycle(vuIndex) {
  const staggerMs = Math.min(vuIndex * 20, 10000);
  await new Promise((r) => setTimeout(r, staggerMs));

  if (!keepRunning) return;

  const user = users[vuIndex % users.length];
  const headers = {
    Authorization: `Bearer ${user.token}`,
    'X-Tunnel-Skip-AntiPhishing-Page': 'true',
  };

  activeVUs++;
  if (activeVUs > peakVUs) peakVUs = activeVUs;

  let iteration = 0;

  while (keepRunning) {
    iteration++;

    // 1. Presence Heartbeat
    try {
      const abortCtrl = new AbortController();
      const t = setTimeout(() => abortCtrl.abort(), 6000);
      const t0 = Date.now();
      const hbRes = await fetch(`${BACKEND_URL}/api/system/heartbeat`, {
        method: 'POST',
        signal: abortCtrl.signal,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Browsing Civil Code (Stress Load)' }),
      });
      clearTimeout(t);
      recordMetric('heartbeat', Date.now() - t0, hbRes.ok);
    } catch (_) {
      recordMetric('heartbeat', 6000, false);
    }

    // 2. Table of Contents (TOC)
    try {
      const abortCtrl = new AbortController();
      const t = setTimeout(() => abortCtrl.abort(), 6000);
      const t0 = Date.now();
      const tocRes = await fetch(`${BACKEND_URL}/api/civil-code/toc`, {
        signal: abortCtrl.signal,
        headers,
      });
      clearTimeout(t);
      recordMetric('toc', Date.now() - t0, tocRes.ok);
    } catch (_) {
      recordMetric('toc', 6000, false);
    }

    // 3. Article Virtual Scrolling
    try {
      const artId = sampleArticles[Math.floor(Math.random() * sampleArticles.length)];
      const abortCtrl = new AbortController();
      const t = setTimeout(() => abortCtrl.abort(), 6000);
      const t0 = Date.now();
      const artRes = await fetch(`${BACKEND_URL}/api/civil-code/article/${artId}`, {
        signal: abortCtrl.signal,
        headers,
      });
      clearTimeout(t);
      recordMetric('article_scroll', Date.now() - t0, artRes.ok);
    } catch (_) {
      recordMetric('article_scroll', 6000, false);
    }

    // 4. Codal Search (Every 2nd iteration)
    if (iteration % 2 === 0) {
      try {
        const query = sampleSearches[Math.floor(Math.random() * sampleSearches.length)];
        const abortCtrl = new AbortController();
        const t = setTimeout(() => abortCtrl.abort(), 6000);
        const t0 = Date.now();
        const searchRes = await fetch(
          `${BACKEND_URL}/api/civil-code/search?q=${encodeURIComponent(query)}`,
          {
            signal: abortCtrl.signal,
            headers,
          }
        );
        clearTimeout(t);
        recordMetric('search', Date.now() - t0, searchRes.ok);
      } catch (_) {
        recordMetric('search', 6000, false);
      }
    }

    // 5. Legal AI Chat Query (Every 10th iteration)
    if (iteration % 10 === 0) {
      try {
        const query = sampleLegalQueries[Math.floor(Math.random() * sampleLegalQueries.length)];
        const abortCtrl = new AbortController();
        const t = setTimeout(() => abortCtrl.abort(), 30000);
        const t0 = Date.now();
        const chatRes = await fetch(`${BACKEND_URL}/api/chat`, {
          method: 'POST',
          signal: abortCtrl.signal,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            session_id: `node-stress-${user.id}`,
            history: [],
          }),
        });
        clearTimeout(t);
        recordMetric('legal_chat', Date.now() - t0, chatRes.ok);
      } catch (_) {
        recordMetric('legal_chat', 30000, false);
      }
    }

    // User think-time simulation (1.0 to 2.5 seconds)
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1500));
  }

  activeVUs--;
}

async function main() {
  console.log(`========================================================================`);
  console.log(` CIVIL-LEX: NATIVE NODE.JS STRESS TEST HARNESS`);
  console.log(` Target Gateway  : ${BACKEND_URL}`);
  console.log(` Provisioned VUs : ${users.length.toLocaleString()} users available`);
  console.log(` Target Concur.  : ${CONCURRENCY} active simulated users`);
  console.log(` Test Duration   : ${DURATION_SEC} seconds`);
  console.log(`========================================================================\n`);

  const startTime = Date.now();

  const vuPromises = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    vuPromises.push(simulateUserLifecycle(i));
  }

  const ticker = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const rps = (metrics.overall.total / Math.max(elapsed, 1)).toFixed(1);
    const successRate = metrics.overall.total
      ? ((metrics.overall.success / metrics.overall.total) * 100).toFixed(1)
      : '100.0';

    process.stdout.write(
      `\r[Time: ${elapsed}s / ${DURATION_SEC}s] ` +
        `VUs: ${activeVUs}/${CONCURRENCY} | ` +
        `Reqs: ${metrics.overall.total.toLocaleString()} | ` +
        `Throughput: ${rps} RPS | ` +
        `Success: ${successRate}%    `
    );
  }, 1000);

  await new Promise((r) => setTimeout(r, DURATION_SEC * 1000));
  keepRunning = false;
  clearInterval(ticker);

  console.log('\n\nTest period concluded. Awaiting pending in-flight requests...');
  await Promise.all(vuPromises);

  const durationSec = Math.max((Date.now() - startTime) / 1000, 1);
  const throughputRps = (metrics.overall.total / durationSec).toFixed(2);
  const overallStats = calculateStats(metrics.overall.latencies);

  console.log(`\n========================================================================`);
  console.log(` CIVIL-LEX EMPIRICAL TEST RESULTS`);
  console.log(` Total Elapsed Time   : ${durationSec.toFixed(1)}s`);
  console.log(` Total Requests       : ${metrics.overall.total.toLocaleString()}`);
  console.log(` Overall Throughput   : ${throughputRps} RPS`);
  console.log(` Total Succeeded      : ${metrics.overall.success.toLocaleString()}`);
  console.log(` Total Failed         : ${metrics.overall.failed.toLocaleString()}`);
  console.log(
    ` Overall Success Rate : ${((metrics.overall.success / (metrics.overall.total || 1)) * 100).toFixed(2)}%`
  );
  console.log(`========================================================================\n`);

  console.log(`Endpoint Granular Breakdown:`);
  console.log(`---------------------------------------------------------------------------------------------------`);
  console.log(
    `Endpoint / Feature`.padEnd(25) +
      `Total`.padStart(10) +
      `Success`.padStart(10) +
      `Failed`.padStart(10) +
      `Success %`.padStart(12) +
      `Avg Latency`.padStart(14) +
      `p95 Latency`.padStart(14)
  );
  console.log(`---------------------------------------------------------------------------------------------------`);

  categories.forEach((cat) => {
    const m = metrics[cat];
    const s = calculateStats(m.latencies);
    const rate = m.total ? ((m.success / m.total) * 100).toFixed(2) + '%' : 'N/A';
    console.log(
      cat.padEnd(25) +
        m.total.toLocaleString().padStart(10) +
        m.success.toLocaleString().padStart(10) +
        m.failed.toLocaleString().padStart(10) +
        rate.padStart(12) +
        `${s.avg} ms`.padStart(14) +
        `${s.p95} ms`.padStart(14)
    );
  });
  console.log(`---------------------------------------------------------------------------------------------------\n`);
}

main().catch((err) => {
  console.error('Fatal stress test runner error:', err);
  process.exit(1);
});
