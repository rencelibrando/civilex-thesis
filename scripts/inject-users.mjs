/**
 * CIVIL-LEX: Automated User Provisioning Script
 * 
 * Purpose:
 *   Provisions N authenticated user accounts into Supabase Auth with JWT access tokens
 *   and saves credentials to scripts/stress-users.json for high-concurrency stress testing.
 * 
 * Usage:
 *   node scripts/inject-users.mjs [count]
 * 
 * Examples:
 *   node scripts/inject-users.mjs 1000
 *   node scripts/inject-users.mjs 10000
 *   SUPABASE_URL="http://192.168.100.76:54321" node scripts/inject-users.mjs 500
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dynamically resolve Supabase client from backend-node
let createClient;
try {
  const mod = await import('../backend-node/node_modules/@supabase/supabase-js/dist/index.mjs');
  createClient = mod.createClient;
} catch (_) {
  try {
    const mod = await import('@supabase/supabase-js');
    createClient = mod.createClient;
  } catch (err) {
    console.error('Error: Could not locate @supabase/supabase-js.');
    console.error('Run: cd backend-node && npm install');
    process.exit(1);
  }
}

// Dynamically load environment variables from backend-node/.env or root .env
try {
  const dotenv = await import('../backend-node/node_modules/dotenv/lib/main.js');
  dotenv.config({ path: path.resolve(__dirname, '../backend-node/.env') });
} catch (_) {
  try {
    const dotenv = await import('dotenv');
    dotenv.config();
  } catch (_) {}
}

// Configuration from environment variables (Zero hardcoded secrets)
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.SUPABASE_PUBLIC_URL || 'http://localhost:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  console.error('Error: Missing required Supabase credentials.');
  console.error(
    'Please ensure SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY are defined in backend-node/.env or passed via environment variables.'
  );
  process.exit(1);
}

const argsCount = process.argv[2] ? parseInt(process.argv[2], 10) : null;
const TARGET_TOTAL = argsCount || parseInt(process.env.USERS_COUNT || '10000', 10);
const DEFAULT_PASSWORD = 'TestPassword123!';
const BATCH_CONCURRENCY = parseInt(process.env.CONCURRENCY || '20', 10);

const outPath = path.resolve(__dirname, 'stress-users.json');

// Load existing users if present to resume without recreating existing accounts
let existingUsers = [];
const existingEmails = new Set();
if (fs.existsSync(outPath)) {
  try {
    existingUsers = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    existingUsers.forEach((u) => existingEmails.add(u.email));
  } catch (_) {
    existingUsers = [];
  }
}

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function processUser(index, retries = 3) {
  const email = `stress_user_${index}@civilex-loadtest.local`;
  const fullName = `Stress User ${index}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // 1. Create or verify user in Supabase Auth
      const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
        email,
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          role: 'student',
          load_test: true,
        },
      });

      let userId = created?.user?.id;

      if (createErr) {
        const msg = (createErr.message || '').toLowerCase();
        const isRegistered =
          msg.includes('already') || msg.includes('registered') || msg.includes('exists');
        if (!isRegistered) {
          throw new Error(`Create error: ${createErr.message}`);
        }
      }

      // 2. Authenticate to obtain active session JWT
      const { data: loginData, error: loginErr } = await authClient.auth.signInWithPassword({
        email,
        password: DEFAULT_PASSWORD,
      });

      if (loginErr || !loginData?.session?.access_token) {
        throw new Error(`Login error: ${loginErr?.message}`);
      }

      return {
        id: userId || loginData.session.user?.id,
        email,
        fullName,
        token: loginData.session.access_token,
      };
    } catch (err) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, attempt * 500));
      } else {
        console.warn(`\n[!] Skipped user ${index} after ${retries} attempts: ${err.message}`);
        return null;
      }
    }
  }
}

async function run() {
  console.log(`========================================================================`);
  console.log(` CIVIL-LEX: AUTOMATED USER PROVISIONER`);
  console.log(` Target Supabase  : ${SUPABASE_URL}`);
  console.log(` Target Total     : ${TARGET_TOTAL.toLocaleString()} users`);
  console.log(` Existing Loaded  : ${existingUsers.length.toLocaleString()} users`);
  console.log(` Parallel Workers : ${BATCH_CONCURRENCY} concurrent threads`);
  console.log(`========================================================================\n`);

  if (existingUsers.length >= TARGET_TOTAL) {
    console.log(`Target already satisfied! You have ${existingUsers.length.toLocaleString()} users in stress-users.json.`);
    return;
  }

  // Queue missing user numbers
  const queue = [];
  for (let i = 1; i <= TARGET_TOTAL; i++) {
    const email = `stress_user_${i}@civilex-loadtest.local`;
    if (!existingEmails.has(email)) {
      queue.push(i);
    }
  }

  console.log(`Injecting remaining ${queue.length.toLocaleString()} users...\n`);

  const startTime = Date.now();
  let completed = existingUsers.length;
  let newSuccessCount = 0;
  const allUsers = [...existingUsers];

  let qIndex = 0;

  async function worker() {
    while (qIndex < queue.length) {
      const idx = queue[qIndex++];
      const result = await processUser(idx);
      if (result) {
        allUsers.push(result);
        existingEmails.add(result.email);
        newSuccessCount++;
      }
      completed++;

      if (completed % 100 === 0 || completed >= TARGET_TOTAL) {
        const elapsedSec = (Date.now() - startTime) / 1000;
        const rate = (newSuccessCount / Math.max(elapsedSec, 1)).toFixed(1);
        const remainingUsers = TARGET_TOTAL - completed;
        const etaMin = (remainingUsers / (parseFloat(rate) || 1) / 60).toFixed(1);

        process.stdout.write(
          `\r[✔] Progress: ${completed.toLocaleString()}/${TARGET_TOTAL.toLocaleString()} users ` +
            `(${((completed / TARGET_TOTAL) * 100).toFixed(1)}%) | ` +
            `Speed: ${rate} users/sec | ` +
            `ETA: ~${Math.max(parseFloat(etaMin), 0).toFixed(1)} min   `
        );

        if (completed % 500 === 0) {
          fs.writeFileSync(outPath, JSON.stringify(allUsers, null, 2));
        }
      }
    }
  }

  const workers = [];
  for (let w = 0; w < BATCH_CONCURRENCY; w++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  fs.writeFileSync(outPath, JSON.stringify(allUsers, null, 2));
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n\n========================================================================`);
  console.log(` PROVISIONING COMPLETE!`);
  console.log(` Total Active Users in File : ${allUsers.length.toLocaleString()}`);
  console.log(` New Users Added            : ${newSuccessCount.toLocaleString()}`);
  console.log(` Elapsed Time               : ${totalDuration}s (~${(totalDuration / 60).toFixed(1)} mins)`);
  console.log(` Output File                : ${outPath}`);
  console.log(`========================================================================\n`);
}

run().catch((err) => {
  console.error('Fatal provisioning error:', err);
  process.exit(1);
});
