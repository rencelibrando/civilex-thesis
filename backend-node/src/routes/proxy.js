import { createProxyMiddleware } from 'http-proxy-middleware';
import { requireAuth } from '../middleware/auth.js';
import { PresenceService } from '../services/presence.js';

export const setupProxies = (app) => {
  const ragServiceUrl = process.env.RAG_SERVICE_URL || 'http://localhost:8000';

  // Proxy cancel requests to Python RAG service
  app.post(
    '/api/chat/cancel',
    requireAuth,
    createProxyMiddleware({
      target: ragServiceUrl,
      changeOrigin: true,
      pathRewrite: {
        '^/api/chat/cancel': '/cancel',
      },
    })
  );

  // Apply proxy middleware to chat endpoint
  app.post(
    '/api/chat',
    requireAuth,
    createProxyMiddleware({
      target: ragServiceUrl,
      changeOrigin: true,
      timeout: 0, // Disable proxy socket timeout for continuous SSE streaming
      proxyTimeout: 0, // Disable response timeout for long-running legal reasoning
      pathRewrite: {
        '^/api/chat': '/search',
      },
      on: {
        proxyReq: (proxyReq, req, res) => {
          // Disable socket timeout on outgoing proxy request for continuous SSE streaming
          if (proxyReq.socket) {
            proxyReq.socket.setTimeout(0);
          } else {
            proxyReq.on('socket', (socket) => {
              socket.setTimeout(0);
            });
          }
          proxyReq.setHeader('Connection', 'keep-alive');

          if (req.user) {
            proxyReq.setHeader('x-user-id', req.user.id);
            if (req.user.email) {
              proxyReq.setHeader('x-user-email', req.user.email);
            }
            const fullName =
              req.user.user_metadata?.full_name ||
              (req.user.email ? req.user.email.split('@')[0] : 'User');
            proxyReq.setHeader('x-user-name', encodeURIComponent(fullName));

            try {
              PresenceService.touch(req.user, req, 'Running Legal Query');
            } catch (_) { }
          }
        },
        proxyRes: (proxyRes, req, res) => {
          // Prevent proxy buffering on SSE streams so chunks and heartbeats reach the frontend immediately
          res.setHeader('X-Accel-Buffering', 'no');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('Connection', 'keep-alive');
          req.socket.setTimeout(0);
          if (proxyRes.socket) {
            proxyRes.socket.setTimeout(0);
          }
        },
        error: (err, req, res) => {
          // If the downstream client disconnected or aborted, this error is an expected result of proxyReq.destroy()
          if (res.writableEnded || res.destroyed) {
            return;
          }
          console.error('[Chat Proxy Error]:', err.message);
          if (!res.headersSent) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'The AI legal engine is currently unavailable. Please verify the service is running and try again.',
              })
            );
          } else if (!res.writableEnded) {
            res.end();
          }
        },
      }
    })
  );


  const supabaseUrl = process.env.SUPABASE_URL || 'http://localhost:54321';

  // Proxy Supabase storage public bucket requests through backend
  // Injects X-Tunnel-Skip-AntiPhishing-Page header to automatically suppress
  // Microsoft Dev Tunnels anti-phishing interstitial warning pages
  app.use(
    ['/storage', '/api/storage'],
    createProxyMiddleware({
      target: `${supabaseUrl}/storage`,
      changeOrigin: true,
      pathRewrite: {
        '^/api/storage': '',
        '^/storage': '',
      },
      on: {
        proxyReq: (proxyReq) => {
          proxyReq.setHeader('X-Tunnel-Skip-AntiPhishing-Page', 'true');
        },
        proxyRes: (proxyRes, req, res) => {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        },
        error: (err, req, res) => {
          console.error('[Storage Proxy Error]:', err.message);
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Storage proxy unavailable' }));
          }
        },
      },
    })
  );
};
