import { createApp } from './app.js';
import { config } from './config.js';
import { resolve } from 'path';
import { join } from 'path';

const isDev = config.nodeEnv === 'development';
const port = isDev ? parseInt(process.env.PORT || '3001', 10) : config.port;

const app = await createApp({ skipStatic: isDev, workerCount: isDev ? 0 : undefined });

if (isDev) {
  const webDir = resolve(import.meta.dirname, '../../web');
  const apiDir = resolve(import.meta.dirname, '..');
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
}

await app.listen({ port, host: config.host });

if (isDev) {
  console.log(`\ndev server ready`);
  console.log(`  ui    http://localhost:${port}`);
  console.log(`  api   http://localhost:${port}/api`);
  console.log(`  data  ${join(process.env.HOME!, '.construct')}`);
}
