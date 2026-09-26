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
      pathRewrite: {
        '^/api/chat': '/search',
      },
      on: {
        proxyReq: (proxyReq, req, res) => {
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
            } catch (_) {}
          }
        }
      }
    })
  );


  // (Removed /api/civil-code proxy)
};
