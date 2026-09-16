import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: 'backend-node/.env' });
const sb = createClient(process.env.SUPABASE_URL || 'http://localhost:54321', process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy');
async function run() {
  const { data, error } = await sb.from('user_documents').select('*').limit(1);
  console.log("data:", data, "error:", error);
}
run();
