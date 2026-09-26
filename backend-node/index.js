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

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

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

// Serve uploads statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'civilex-backend-gateway' });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'civilex-backend-gateway' });
});

app.listen(port, () => {
  console.log(`Backend Node Gateway running on port ${port}`);
});
