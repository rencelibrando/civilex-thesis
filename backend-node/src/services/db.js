import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ quiet: true });

const { Pool } = pg;

export const dbPool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    process.env.POSTGRES_DB_URL ||
    'postgresql://postgres:postgres@localhost:54322/postgres',
  max: parseInt(process.env.DB_POOL_MAX || '25', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

dbPool.on('error', (err) => {
  console.warn('[DBPool] Database pool connection notice:', err.message);
});
