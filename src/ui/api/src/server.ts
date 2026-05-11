import './env.js';
import { createApp } from './app.js';
import { config } from './config.js';
import { resolve } from 'path';
import { log, createViteLogger } from './logger.js';
import { getSystemInfo } from './system-info.js';

const isDev = config.nodeEnv === 'development';
const port = config.port;

const app = await createApp({ skipStatic: isDev });

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
    server: { middlewareMode: true, hmr: { server: app.server } },
    appType: 'spa',
    customLogger: createViteLogger(),
  });
  await app.use((req: any, res: any, next: any) => {
    if (req.url?.startsWith('/api/') || req.url?.startsWith('/public')) return next();
    vite.middlewares(req, res, next);
  });
}

await app.listen({ port, host: config.host });

if (isDev) {
  printBootBanner();
}

function printBootBanner(): void {
  const info = getSystemInfo(app.sqlite.filename);
  const dirty = info.git.dirty ? ' (dirty)' : '';

  log({ source: 'dev', msg: `ready  http://localhost:${port}` });
  log({ source: 'dev', msg: `       api  http://localhost:${port}/api` });
  log({ source: 'dev', msg: `       docs http://localhost:${port}/api/docs` });
  log({ source: 'dev', msg: '' });
  log({ source: 'dev', msg: `git    ${info.git.short}${dirty} on ${info.git.branch} (${info.git.commitCount} commits)` });
  log({ source: 'dev', msg: `       last ${info.git.lastCommit}` });
  log({ source: 'dev', msg: `       at   ${info.git.lastCommitDate}` });
  log({ source: 'dev', msg: '' });
  log({ source: 'dev', msg: `runtime ${info.install.platform}/${info.install.arch} bun ${info.install.bunVersion}` });
  log({ source: 'dev', msg: '' });
  log({ source: 'dev', msg: `data    ${info.paths.dataRoot}` });
  log({ source: 'dev', msg: `db      ${info.paths.db} (${(info.runtime.dbSizeBytes / 1024 / 1024).toFixed(1)} MB)` });
  log({ source: 'dev', msg: `memory  ${info.paths.memoryDb}` });
  log({ source: 'dev', msg: `sessions ${info.paths.sessions}` });
  log({ source: 'dev', msg: `signals ${info.paths.signals}` });
  log({ source: 'dev', msg: `ratings ${info.paths.ratings}` });
  log({ source: 'dev', msg: `backups ${info.paths.backups}` });
  log({ source: 'dev', msg: `telemetry ${info.paths.telemetry}` });
  log({ source: 'dev', msg: `logs    ${info.paths.devLogs}` });
}
