/**
 * CIVIL-LEX: High-Concurrency Stress Test Runner (Grafana k6)
 * 
 * Purpose:
 *   Simulates multi-tier concurrent virtual users (VUs) executing representative
 *   user workloads: presence heartbeats, Table of Contents navigation, virtualized
 *   codal article reading, full-text statutory search, and AI chat queries.
 * 
 * Usage:
 *   # Run Tier 1 (1,000 VUs Optimal Operating Zone)
 *   k6 run -e TIER=1 -e BACKEND_URL="http://192.168.100.76:4000" scripts/k6-stress-test.js
 * 
 *   # Run Tier 2 (3,500 VUs Peak Hardware Ceiling)
 *   k6 run -e TIER=2 -e BACKEND_URL="http://192.168.100.76:4000" scripts/k6-stress-test.js
 * 
 *   # Run Custom VUs (e.g. 500 VUs for 2 minutes)
 *   k6 run -e VUS=500 -e DURATION=2m -e BACKEND_URL="http://192.168.100.76:4000" scripts/k6-stress-test.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Trend } from 'k6/metrics';

// Granular latency breakdown trends
const heartbeatTrend = new Trend('heartbeat_duration');
const tocTrend = new Trend('toc_duration');
const scrollTrend = new Trend('scroll_duration');
const searchTrend = new Trend('search_duration');
const chatTrend = new Trend('chat_duration');

// Load user authentication tokens from JSON
const users = new SharedArray('users', function () {
  return JSON.parse(open('./stress-users.json'));
});

// Configure testing profile based on -e TIER environment variable
const tier = __ENV.TIER || '2';
const customVus = __ENV.VUS ? parseInt(__ENV.VUS, 10) : null;
const customDuration = __ENV.DURATION || '3m';

function getStages() {
  if (customVus) {
    return [
      { duration: '20s', target: Math.floor(customVus / 2) },
      { duration: customDuration, target: customVus },
      { duration: '20s', target: 0 },
    ];
  }
  if (tier === '1') {
    // Tier 1: 1,000 VUs Optimal Zone
    return [
      { duration: '30s', target: 500 },
      { duration: '2m',  target: 1000 },
      { duration: '30s', target: 0 },
    ];
  }
  // Tier 2: 3,500 VUs Hardware Ceiling
  return [
    { duration: '30s', target: 500 },
    { duration: '1m',  target: 1500 },
    { duration: '1m',  target: 2500 },
    { duration: '1m',  target: 3500 },
    { duration: '30s', target: 0 },
  ];
}

export const options = {
  stages: getStages(),
  thresholds: {
    http_req_failed: ['rate<0.10'], // Maximum acceptable error rate < 10%
    scroll_duration: ['p(95)<6000'],
  },
};

const BACKEND_URL = __ENV.BACKEND_URL || 'http://192.168.100.76:4000';

const sampleLegalQueries = [
  'What are the essential requisites of a contract under Civil Code Article 1318?',
  'Explain the definition of an obligation under Article 1156.',
  'What constitutes a void marriage under Article 35 of the Family Code?',
  'How does mora solvendi differ from mora accipiendi in civil obligations?',
  'What are the legal grounds for rescission under Article 1191?',
];

function extractLeafIds(nodes, bucket = []) {
  if (!nodes || !Array.isArray(nodes)) return bucket;
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      extractLeafIds(node.children, bucket);
    } else if (node.id) {
      bucket.push(node.id);
    }
  }
  return bucket;
}

export default function () {
  const user = users[__VU % users.length];
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${user.token}`,
    'X-Tunnel-Skip-AntiPhishing-Page': 'true',
  };

  // 1. Presence Heartbeat
  const hbRes = http.post(
    `${BACKEND_URL}/api/system/heartbeat`,
    JSON.stringify({ status: 'Browsing Civil Code (Stress Load)' }),
    { headers: authHeaders, timeout: '15s' }
  );
  check(hbRes, { 'heartbeat 200': (r) => r.status === 200 });
  heartbeatTrend.add(hbRes.timings.duration);

  // 2. Civil Code Table of Contents (TOC)
  const tocRes = http.get(`${BACKEND_URL}/api/civil-code/toc`, {
    headers: authHeaders,
    timeout: '15s',
  });
  const tocOk = check(tocRes, { 'toc 200': (r) => r.status === 200 });
  tocTrend.add(tocRes.timings.duration);

  let articleIds = [];
  if (tocOk) {
    try {
      const data = JSON.parse(tocRes.body);
      articleIds = extractLeafIds(data.toc || []);
    } catch (_) {}
  }

  if (articleIds.length === 0) {
    articleIds = [
      'RA386-STRUCTURE-AND-ARTICLES',
      'RA386-SPECIAL-LAWS-AND-AMENDMENTS',
      'RA386-GENERAL-INFO',
      'RA386-ART1156',
      'RA386-ART1305',
    ];
  }

  // 3. Virtualized Scrolling Article Fetch
  const randomId = articleIds[Math.floor(Math.random() * articleIds.length)];
  const artRes = http.get(`${BACKEND_URL}/api/civil-code/article/${randomId}`, {
    headers: authHeaders,
    timeout: '15s',
  });
  check(artRes, { 'article 200': (r) => r.status === 200 });
  scrollTrend.add(artRes.timings.duration);

  // 4. Statutory Full-Text Search (Every 2nd iteration)
  if (__ITER % 2 === 0) {
    const searchRes = http.get(`${BACKEND_URL}/api/civil-code/search?q=obligation`, {
      headers: authHeaders,
      timeout: '15s',
    });
    check(searchRes, { 'search 200': (r) => r.status === 200 });
    searchTrend.add(searchRes.timings.duration);
  }

  // 5. Legal AI Chat Query (Simulates 5% realistic prompt traffic distribution)
  if (__ITER % 15 === 0 && Math.random() < 0.25) {
    const query = sampleLegalQueries[Math.floor(Math.random() * sampleLegalQueries.length)];
    const chatPayload = JSON.stringify({
      query,
      session_id: `k6-chat-${user.id}`,
      history: [],
    });

    const chatRes = http.post(`${BACKEND_URL}/api/chat`, chatPayload, {
      headers: authHeaders,
      timeout: '60s',
    });
    check(chatRes, { 'chat 200': (r) => r.status === 200 });
    chatTrend.add(chatRes.timings.duration);
  }

  // Human think-time simulation (1.2 to 3.0 seconds between interactions)
  sleep(1.2 + Math.random() * 1.8);
}
