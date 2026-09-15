import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
app.use('/api/chat', createProxyMiddleware({
  target: 'http://localhost:8000',
  changeOrigin: true,
  pathRewrite: {
    '^/': '/search',
  },
}));
app.listen(4005, () => console.log('Proxy on 4005'));
