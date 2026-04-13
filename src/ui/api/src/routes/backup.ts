import type { FastifyPluginAsync } from 'fastify';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { dataPaths } from '@construct/data';

const DEFAULT_DB_PATH = dataPaths.db;

export const backupRoutes: FastifyPluginAsync = async (app) => {
  const dbPath = process.env.CONSTRUCT_DB_PATH || DEFAULT_DB_PATH;
  const backupDir = resolve(dbPath, '..', 'backups');

  app.post('/create', async () => {
    mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `construct-${timestamp}.db`;
    const dest = join(backupDir, filename);
    // Use serialize() for an atomic in-memory snapshot (WAL-safe)
    const snapshot = app.sqlite.serialize();
    await Bun.write(dest, snapshot);
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

      app.sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      copyFileSync(src, dbPath);
      return { restored: true, message: 'Restart required to complete restore' };
    }
  );
};
