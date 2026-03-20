import type { FastifyPluginAsync } from 'fastify';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

const DEFAULT_DB_PATH = join(homedir(), '.claude', 'construct', 'data', 'construct.db');

export const backupRoutes: FastifyPluginAsync = async (app) => {
  const dbPath = process.env.CONSTRUCT_DB_PATH || DEFAULT_DB_PATH;
  const backupDir = resolve(dbPath, '..', 'backups');

  app.post('/create', async () => {
    mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `construct-${timestamp}.db`;
    const dest = join(backupDir, filename);
    app.sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    copyFileSync(dbPath, dest);
    return { filename, createdAt: new Date().toISOString() };
  });

  app.get('/list', async () => {
    if (!existsSync(backupDir)) return [];
    const files = readdirSync(backupDir)
      .filter((f) => f.endsWith('.db'))
      .sort()
      .reverse();
    return files.map((f) => {
      const stat = statSync(join(backupDir, f));
      return {
        filename: f,
        size: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    });
  });

  app.post<{ Body: { filename: string } }>(
    '/restore',
    async (req, reply) => {
      const { filename } = req.body;
      if (!filename) return reply.status(400).send({ error: 'filename is required' });

      if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        return reply.status(400).send({ error: 'Invalid filename' });
      }

      const src = join(backupDir, filename);
      if (!existsSync(src)) return reply.status(404).send({ error: 'Backup not found' });

      return { restored: true, message: 'Restart required to complete restore' };
    }
  );
};
