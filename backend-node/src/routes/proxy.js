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

  const injectUserAndKeepAlive = (proxyReq, req) => {
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

      if (req.method === 'POST') {
        try {
          PresenceService.touch(req.user, req, 'Running Legal Query');
        } catch (_) { }
      }
    }
  };

  const disableBuffering = (proxyRes, req, res) => {
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }
    req.socket.setTimeout(0);
    if (proxyRes.socket) {
      proxyRes.socket.setTimeout(0);
    }
  };

  const handleSseProxyError = (err, req, res) => {
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
  };

  const sseProxy = (pathRewrite) => createProxyMiddleware({
    target: ragServiceUrl,
    changeOrigin: true,
    timeout: 0,
    proxyTimeout: 0,
    pathRewrite,
    on: {
      proxyReq: injectUserAndKeepAlive,
      proxyRes: disableBuffering,
      error: handleSseProxyError,
    },
  });

  app.post('/api/chat', requireAuth, sseProxy({ '^/api/chat': '/search' }));
  app.get('/api/chat/stream/active', requireAuth, sseProxy({ '^/api/chat/stream/active': '/stream/active' }));
  app.get('/api/chat/stream/:jobId', requireAuth, sseProxy({ '^/api/chat/stream': '/stream' }));


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
