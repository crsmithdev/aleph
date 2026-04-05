import { lstatSync } from 'fs';
import { claudePaths } from '@construct/data';
import { createApp } from './app.js';
import { config } from './config.js';

function isLinked(): boolean {
  try { return lstatSync(claudePaths.construct).isSymbolicLink(); } catch { return false; }
}

const app = await createApp({ skipStatic: isLinked() });

if (isLinked()) {
  const { createServer: createViteServer } = await import('vite');
  const middie = await import('@fastify/middie');
  const { resolve } = await import('path');
  await app.register(middie.default);
  const vite = await createViteServer({
    root: resolve(import.meta.dirname, '../../web'),
    server: { middlewareMode: true },
    appType: 'spa',
  });
  // Skip Vite middleware for API routes so Fastify handlers take precedence
  await app.use((req: any, res: any, next: any) => {
    if (req.url?.startsWith('/api/')) return next();
    vite.middlewares(req, res, next);
  });
  console.log(`linked mode: serving with vite middleware at http://localhost:${config.port}`);
}

await app.listen({ port: config.port, host: config.host });
