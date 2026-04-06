#!/usr/bin/env bun
// Dev server — port 3001, Vite HMR, live from src/
// Data shared with production: ~/.construct/construct.db
// Usage: bun dev-server.ts

import { createApp } from './src/ui/api/src/app.js';
import { resolve, join } from 'path';

const PORT = parseInt(process.env.PORT || '3001', 10);
const webDir = resolve(import.meta.dirname, 'src/ui/web');
const apiDir = resolve(import.meta.dirname, 'src/ui/api');

// workerCount: 0 — research workers are managed by the production service
const app = await createApp({ skipStatic: true, workerCount: 0 });

const vitePath = Bun.resolveSync('vite', webDir);
const middiePath = Bun.resolveSync('@fastify/middie', apiDir);
const { createServer: createViteServer } = await import(vitePath);
const middie = await import(middiePath);
await app.register(middie.default);

const vite = await createViteServer({
  root: webDir,
  server: { middlewareMode: true },
  appType: 'spa',
});

await app.use((req: any, res: any, next: any) => {
  if (req.url?.startsWith('/api/')) return next();
  vite.middlewares(req, res, next);
});

await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`\ndev server ready`);
console.log(`  ui    http://localhost:${PORT}`);
console.log(`  api   http://localhost:${PORT}/api`);
console.log(`  data  ${join(process.env.HOME!, '.construct')}`);
