import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const { Pool } = pg;

const dbPool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:54322/postgres',
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Suppress unhandled pool errors if DB restarts
dbPool.on('error', (err) => {
  console.warn('[PresenceService] Database pool connection notice:', err.message);
});

// In-memory active heartbeats map
// userId -> { userId, email, fullName, role, ip, client, lastActive, action }
const inMemoryHeartbeats = new Map();

// Helper to simplify user-agent string
export function parseClientDevice(userAgent) {
  if (!userAgent) return 'Web Client';
  const ua = userAgent.toLowerCase();
  let os = 'Unknown OS';
  if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('macintosh') || ua.includes('mac os')) os = 'macOS';
  else if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('linux')) os = 'Linux';

  let browser = 'Browser';
  if (ua.includes('edg')) browser = 'Edge';
  else if (ua.includes('chrome') || ua.includes('crios')) browser = 'Chrome';
  else if (ua.includes('firefox') || ua.includes('fxios')) browser = 'Firefox';
  else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'Safari';
  else if (ua.includes('curl')) browser = 'CLI/curl';

  return `${browser} (${os})`;
}

export class PresenceService {
  /**
   * Touch or register a user's active presence
   */
  static touch(user, req, action = 'Active') {
    if (!user || !user.id) return;

    const userId = user.id;
    const email = user.email || '';
    const fullName =
      user.user_metadata?.full_name ||
      (email ? email.split('@')[0] : 'User');
    const role = user.user_metadata?.role || 'Normal Citizen';

    let ip = '127.0.0.1';
    if (req) {
      ip =
        req.headers['x-forwarded-for']?.split(',')[0].trim() ||
        req.socket?.remoteAddress ||
        req.ip ||
        '127.0.0.1';
    }
    // Clean ipv6 loopback or prefix
    if (ip === '::1' || ip === '::ffff:127.0.0.1') ip = '127.0.0.1';
    if (ip.startsWith('::ffff:')) ip = ip.substring(7);

    const client = parseClientDevice(req?.headers?.['user-agent']);

    inMemoryHeartbeats.set(userId, {
      userId,
      email,
      fullName,
      role,
      ip,
      client,
      lastActive: Date.now(),
      action,
    });
  }

  /**
   * Mark user explicitly offline (e.g. on logout)
   */
  static setOffline(userId) {
    if (userId) {
      inMemoryHeartbeats.delete(userId);
    }
  }

  /**
   * Get all currently online and recently active users
   */
  static async getOnlineUsers() {
    const now = Date.now();
    const resultUsers = new Map();

    // 1. Prune and ingest active in-memory heartbeats (within last 90 seconds)
    for (const [userId, record] of inMemoryHeartbeats.entries()) {
      const elapsedSec = Math.floor((now - record.lastActive) / 1000);
      if (elapsedSec <= 90) {
        resultUsers.set(userId, {
          userId: record.userId,
          email: record.email,
          fullName: record.fullName,
          role: record.role,
          ip: record.ip,
          client: record.client,
          lastSeenSec: elapsedSec,
          status: record.action || 'Active',
          isLiveHeartbeat: true,
        });
      } else {
        inMemoryHeartbeats.delete(userId);
      }
    }

    // 2. Query Supabase Postgres for active sessions in last 30 minutes
    try {
      const dbQuery = `
        SELECT DISTINCT ON (s.user_id)
          s.user_id,
          u.email,
          COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)) as full_name,
          COALESCE(u.raw_user_meta_data->>'role', 'Normal Citizen') as role,
          ROUND(EXTRACT(EPOCH FROM (NOW() - s.updated_at)))::int as last_seen_sec,
          COALESCE(host(s.ip), 'local') as ip,
          s.user_agent
        FROM auth.sessions s
        JOIN auth.users u ON u.id = s.user_id
        WHERE s.updated_at >= NOW() - INTERVAL '30 minutes'
        ORDER BY s.user_id, s.updated_at DESC;
      `;
      const dbRes = await dbPool.query(dbQuery);

      for (const row of dbRes.rows) {
        const userId = row.user_id;
        const lastSeen = Math.max(0, parseInt(row.last_seen_sec, 10) || 0);

        if (!resultUsers.has(userId)) {
          let statusText = 'Active';
          if (lastSeen > 300) {
            statusText = `Idle (${Math.floor(lastSeen / 60)}m ago)`;
          } else if (lastSeen > 60) {
            statusText = `Idle (${lastSeen}s ago)`;
          }

          resultUsers.set(userId, {
            userId: row.user_id,
            email: row.email,
            fullName: row.full_name || row.email,
            role: row.role || 'User',
            ip: row.ip || 'local',
            client: parseClientDevice(row.user_agent),
            lastSeenSec: lastSeen,
            status: statusText,
            isLiveHeartbeat: lastSeen <= 90,
          });
        }
      }
    } catch (err) {
      // If DB query fails, in-memory heartbeats are still returned
      console.warn('[PresenceService] Warning querying DB for sessions:', err.message);
    }

    const usersList = Array.from(resultUsers.values()).sort(
      (a, b) => a.lastSeenSec - b.lastSeenSec
    );

    return {
      onlineCount: usersList.length,
      users: usersList,
      timestamp: new Date().toISOString(),
    };
  }
}
