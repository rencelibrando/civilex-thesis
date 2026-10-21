/**
 * CIVIL-LEX: Automated User Teardown Script
 * 
 * Purpose:
 *   Safely deletes all load test user accounts (emails matching `stress_user_*` or
 *   metadata `load_test === true`) from Supabase Auth in parallel batches.
 * 
 * Usage:
 *   node scripts/cleanup-users.mjs
 * 
 * Examples:
 *   node scripts/cleanup-users.mjs
 *   SUPABASE_URL="http://192.168.100.76:54321" node scripts/cleanup-users.mjs
 */

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

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: Missing SUPABASE_SERVICE_ROLE_KEY.');
  console.error(
    'Please ensure SUPABASE_SERVICE_ROLE_KEY is defined in backend-node/.env or passed via environment variables.'
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function cleanup() {
  console.log(`========================================================================`);
  console.log(` CIVIL-LEX: HIGH-SPEED PARALLEL USER CLEANUP`);
  console.log(` Target Supabase : ${SUPABASE_URL}`);
  console.log(`========================================================================\n`);

  let totalDeleted = 0;
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error('Failed to list users:', error.message);
      break;
    }

    const testUsers = (data?.users || []).filter(
      (u) =>
        u.email?.includes('stress_user_') ||
        u.email?.includes('civilex-loadtest') ||
        u.user_metadata?.load_test === true
    );

    if (testUsers.length === 0) {
      if (!data.users || data.users.length < perPage) break;
      page++;
      continue;
    }

    console.log(`Found ${testUsers.length} test accounts in batch. Deleting in parallel...`);

    // Concurrent batches of 25 for rapid cleanup
    const BATCH_SIZE = 25;
    for (let i = 0; i < testUsers.length; i += BATCH_SIZE) {
      const slice = testUsers.slice(i, i + BATCH_SIZE);
      await Promise.all(
        slice.map(async (u) => {
          try {
            await admin.auth.admin.deleteUser(u.id);
            totalDeleted++;
          } catch (_) {}
        })
      );
      process.stdout.write(`\rDeleted: ${totalDeleted} test users...`);
    }

    if (data.users.length < perPage) break;
  }

  console.log(`\n\n========================================================================`);
  console.log(` CLEANUP COMPLETE!`);
  console.log(` Total test accounts removed : ${totalDeleted.toLocaleString()}`);
  console.log(`========================================================================\n`);
}

cleanup().catch((err) => {
  console.error('Fatal cleanup error:', err);
  process.exit(1);
});
