import { createApp } from './app.js';
import { config } from './config.js';
import { createServer as createViteServer } from 'vite';
import middie from '@fastify/middie';
import { resolve } from 'path';

const app = await createApp({ skipStatic: true });
await app.register(middie);

const vite = await createViteServer({
  root: resolve(import.meta.dirname, '../../web'),
  server: { middlewareMode: true },
  appType: 'spa',
});

// @ts-ignore — vite middleware is Connect-compatible
await app.use(vite.middlewares);

await app.listen({ port: config.port, host: config.host });
console.log(`dev server running at http://localhost:${config.port}`);
