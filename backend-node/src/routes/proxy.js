import { createProxyMiddleware } from 'http-proxy-middleware';
import { requireAuth } from '../middleware/auth.js';

export const setupProxies = (app) => {
  const ragServiceUrl = 'http://localhost:8000';

  // Apply proxy middleware to chat endpoint
  app.use(
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
          }
        }
      }
    })
  );


  // (Removed /api/civil-code proxy)
};
