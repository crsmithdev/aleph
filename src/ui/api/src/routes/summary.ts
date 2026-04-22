import type { FastifyPluginAsync } from 'fastify';
import { getSummary, getTimeseries } from '@construct/goals';
import { execSync } from 'child_process';
import { resolve } from 'path';
import { existsSync } from 'fs';

function findRepoRoot(): string | null {
  let dir = resolve(import.meta.dirname, '../../../..');
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, '.git'))) return dir;
    dir = resolve(dir, '..');
  }
  return null;
}

function getGitStats(start: string, end: string) {
  const repoDir = findRepoRoot();
  if (!repoDir) return { commits: 0, added: 0, deleted: 0 };
  try {
    const since = `${start} 00:00:00`;
    const until = `${end} 23:59:59`;
    const logArgs = `--no-merges --since="${since}" --until="${until}"`;
    const commits = parseInt(
      execSync(`git -C "${repoDir}" rev-list --count ${logArgs} HEAD`, { encoding: 'utf-8', timeout: 5000 }).trim()
    );
    const numstat = execSync(
      `git -C "${repoDir}" log --numstat --format="" ${logArgs}`,
      { encoding: 'utf-8', timeout: 5000 }
    );
    let added = 0, deleted = 0;
    for (const line of numstat.trim().split('\n')) {
      const parts = line.trim().split('\t');
      const a = parseInt(parts[0]), d = parseInt(parts[1]);
      if (!isNaN(a) && !isNaN(d)) { added += a; deleted += d; }
    }
    return { commits, added, deleted };
  } catch {
    return { commits: 0, added: 0, deleted: 0 };
  }
}

export const summaryRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { start?: string; end?: string; tz?: string } }>('/', async (req, reply) => {
    const { start, end, tz } = req.query;
    if (!start || !end) {
      return reply.status(400).send({ error: 'start and end query params are required (ISO date YYYY-MM-DD)' });
    }
    const tzOffset = tz ? parseInt(tz, 10) : undefined;
    return getSummary(app.db, start, end, tzOffset);
  });

  app.get<{ Querystring: { start?: string; end?: string } }>('/git', async (req, reply) => {
    const { start, end } = req.query;
    if (!start || !end) {
      return reply.status(400).send({ error: 'start and end query params are required (ISO date YYYY-MM-DD)' });
    }
    return getGitStats(start, end);
  });

  app.get<{ Querystring: { start?: string; end?: string; tz?: string } }>('/timeseries', async (req, reply) => {
    const { start, end, tz } = req.query;
    if (!start || !end) {
      return reply.status(400).send({ error: 'start and end query params are required (ISO date YYYY-MM-DD)' });
    }
    const tzOffset = tz ? parseInt(tz, 10) : undefined;
    return getTimeseries(app.db, start, end, tzOffset);
  });
};
