import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
app.post('/api/chat', createProxyMiddleware({
  target: 'http://localhost:8000',
  changeOrigin: true,
  pathRewrite: {
    '^/api/chat': '/search',
  },
}));
app.listen(4005, () => console.log('Proxy on 4005'));
