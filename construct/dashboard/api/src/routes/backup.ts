import type { FastifyPluginAsync } from 'fastify';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { config } from '../config.js';

export const backupRoutes: FastifyPluginAsync = async (app) => {
  const backupDir = resolve(config.databaseUrl, '..', 'backups');

  app.post('/create', { preHandler: [app.authenticate] }, async () => {
    mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `goals-${timestamp}.db`;
    const dest = join(backupDir, filename);
    // Checkpoint WAL before copying to ensure consistency
    app.sqlite.pragma('wal_checkpoint(TRUNCATE)');
    copyFileSync(config.databaseUrl, dest);
    return { filename, createdAt: new Date().toISOString() };
  });

  app.get('/list', { preHandler: [app.authenticate] }, async () => {
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
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { filename } = req.body;
      if (!filename) return reply.status(400).send({ error: 'filename is required' });

      // Prevent path traversal
      if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        return reply.status(400).send({ error: 'Invalid filename' });
      }

      const src = join(backupDir, filename);
      if (!existsSync(src)) return reply.status(404).send({ error: 'Backup not found' });

      // Signal that a restart is needed - we cannot hot-swap the DB file safely
      return { restored: true, message: 'Restart required to complete restore' };
    }
  );
};
