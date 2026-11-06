import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { setupProxies } from './src/routes/proxy.js';
import civilCodeRoutes from './src/routes/civil-code.js';
import documentRoutes from './src/routes/documents.js';
import profileRoutes from './src/routes/profiles.js';
import sessionRoutes from './src/routes/sessions.js';
import systemRoutes from './src/routes/system.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootEnvPath = path.resolve(__dirname, '..', '.env');
dotenv.config({ path: rootEnvPath, quiet: true });
dotenv.config({ quiet: true });

const app = express();
const port = process.env.PORT || 4000;

if (!process.env.TZ) {
  process.env.TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Manila';
}

// Format local timestamp as YYYY-MM-DD HH:mm:ss matching the real current time
export function getLocalTimestamp(date = new Date()) {
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

function prependTimestamp(args) {
  if (args.length === 0) return args;
  if (typeof args[0] === 'string' && /^\[?\d{4}-\d{2}-\d{2}/.test(args[0])) {
    return args;
  }
  return [getLocalTimestamp(), ...args];
}

console.log = (...args) => originalLog(...prependTimestamp(args));
console.warn = (...args) => originalWarn(...prependTimestamp(args));
console.error = (...args) => originalError(...prependTimestamp(args));

// Lightweight high-signal HTTP request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const url = req.originalUrl || req.url;
    const pathname = url.split('?')[0];
    const status = res.statusCode;

    // Filter out high-frequency polling, CORS preflights, and static assets
    if (
      req.method === 'OPTIONS' ||
      pathname.startsWith('/uploads') ||
      ((pathname === '/api/system/online-users' ||
        pathname === '/api/system/heartbeat' ||
        pathname === '/api/system/offline' ||
        pathname === '/api/system/queue' ||
        pathname === '/health' ||
        pathname === '/') && status < 400)
    ) {
      return;
    }

    const timestamp = getLocalTimestamp();
    const method = req.method;
    const userTag = req.user ? ` [${req.user.email || req.user.id}]` : '';
    console.log(`${timestamp} [HTTP] ${method} ${url} ${status} in ${duration}ms${userTag}`);
  });
  next();
});

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : '*';

app.use(cors({
  origin: (origin, callback) => {
    // If wildcard or origin matches, allow and reflect origin header for credentials support
    if (!origin || allowedOrigins === '*' || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));


// Apply proxies before express.json() to prevent body consumption issues
setupProxies(app);

app.use(express.json());

// Apply internal routes
app.use('/api/civil-code', civilCodeRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/system', systemRoutes);

// Fallback alias for direct docx and pdf export
app.post('/export-docx', (req, res, next) => {
  req.url = '/export-docx';
  documentRoutes(req, res, next);
});

app.post('/export-pdf', (req, res, next) => {
  req.url = '/export-pdf';
  documentRoutes(req, res, next);
});

// Serve uploads statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'civilex-backend-gateway' });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'civilex-backend-gateway' });
});

const server = app.listen(port, () => {
  console.log(`${getLocalTimestamp()} [SYSTEM] Backend Node Gateway running on port ${port} (${process.env.TZ})`);
});

// Configure robust HTTP socket timeouts for reverse proxies and tunnels
server.keepAliveTimeout = 65000; // Keep-alive exceeds typical proxy timeout (60s)
server.headersTimeout = 66000;
server.requestTimeout = 300000; // 5-minute request timeout for deep legal reasoning streams
