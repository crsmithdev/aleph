import type { FastifyPluginAsync } from 'fastify';
import { execFile } from 'child_process';
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { promisify } from 'util';
import { dataPaths } from '@aleph/data';

const execFileAsync = promisify(execFile);
const DEFAULT_DB_PATH = dataPaths.db;

/**
 * Backups capture the whole Aleph data root (DB, memory, sessions, signals,
 * telemetry events) as a single gzipped tarball — not just the SQLite file.
 * Legacy `.db` snapshots are still listed and restorable.
 */
export const backupRoutes: FastifyPluginAsync = async (app) => {
  const dbPath = process.env.ALEPH_DB_PATH || DEFAULT_DB_PATH;
  const dataRoot = dirname(dbPath);
  const backupDir = resolve(dataRoot, 'backups');

  app.post('/create', async () => {
    mkdirSync(backupDir, { recursive: true });
    // Flush WAL into the main DB file so the tarball captures a consistent DB.
    app.sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `aleph-${timestamp}.tar.gz`;
    const dest = join(backupDir, filename);
    // Archive the data root relative to itself, excluding the backups dir so
    // the in-progress tarball never recurses into itself.
    await execFileAsync('tar', [
      '-czf', dest,
      '-C', dataRoot,
      '--exclude=./backups',
      '.',
    ]);
    return { filename, createdAt: new Date().toISOString() };
  });

  app.get('/list', async () => {
    if (!existsSync(backupDir)) return [];
    const files = readdirSync(backupDir)
      .filter((f) => f.endsWith('.tar.gz') || f.endsWith('.db'))
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

      if (filename.endsWith('.tar.gz')) {
        // Extract the archive back over the data root.
        await execFileAsync('tar', ['-xzf', src, '-C', dataRoot]);
      } else {
        // Legacy single-DB snapshot.
        copyFileSync(src, dbPath);
      }
      return { restored: true, message: 'Restart required to complete restore' };
    }
  );
};
