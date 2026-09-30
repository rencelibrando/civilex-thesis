import { createProxyMiddleware } from 'http-proxy-middleware';
import { requireAuth } from '../middleware/auth.js';
import { PresenceService } from '../services/presence.js';

export const setupProxies = (app) => {
  const ragServiceUrl = process.env.RAG_SERVICE_URL || 'http://localhost:8000';

  // Apply proxy middleware to chat endpoint
  app.post(
    '/api/chat',
    requireAuth,
    createProxyMiddleware({
      target: ragServiceUrl,
      changeOrigin: true,
      timeout: 180000, // 3-minute socket timeout
      proxyTimeout: 180000, // 3-minute response timeout
      pathRewrite: {
        '^/api/chat': '/search',
      },
      on: {
        proxyReq: (proxyReq, req, res) => {
          // If the downstream client disconnects (tab closed, refreshed, or request aborted),
          // immediately abort the upstream request to Python RAG so it frees the GPU/queue slot!
          req.on('close', () => {
            if (!res.writableEnded) {
              try {
                proxyReq.destroy();
              } catch (_) { }
            }
          });

          if (req.user) {
            proxyReq.setHeader('x-user-id', req.user.id);
            if (req.user.email) {
              proxyReq.setHeader('x-user-email', req.user.email);
            }
            const fullName =
              req.user.user_metadata?.full_name ||
              (req.user.email ? req.user.email.split('@')[0] : 'User');
            proxyReq.setHeader('x-user-name', encodeURIComponent(fullName));
            const role = req.user.user_metadata?.role || 'Normal Citizen';
            proxyReq.setHeader('x-user-role', encodeURIComponent(role));

            try {
              PresenceService.touch(req.user, req, 'Running Legal Query');
            } catch (_) { }
          }
        },
        proxyRes: (proxyRes, req, res) => {
          // Prevent proxy buffering on SSE streams so chunks reach the frontend immediately
          res.setHeader('X-Accel-Buffering', 'no');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          req.socket.setTimeout(0);
        },
        error: (err, req, res) => {
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


  // (Removed /api/civil-code proxy)
};
