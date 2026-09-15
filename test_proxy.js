import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
app.use('/api/chat', createProxyMiddleware({
  target: 'http://localhost:8000',
  pathRewrite: { '^/api/chat': '/search' },
  logLevel: 'debug'
}));
app.listen(4001, () => console.log("running"));
