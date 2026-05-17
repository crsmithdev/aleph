import type { FastifyPluginAsync } from 'fastify';
import { getSummary, getTimeseries } from '@construct/goals';
import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { existsSync } from 'fs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function findRepoRoot(): string | null {
  let dir = resolve(import.meta.dirname, '../../../..');
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, '.git'))) return dir;
    dir = resolve(dir, '..');
  }
  return null;
}

type TopCommit = { sha: string; subject: string; added: number; deleted: number };
type GitStats = { commits: number; added: number; deleted: number; topCommits: TopCommit[] };

function getGitStats(start: string, end: string): GitStats {
  const repoDir = findRepoRoot();
  if (!repoDir) return { commits: 0, added: 0, deleted: 0, topCommits: [] };
  try {
    const since = `${start} 00:00:00`;
    const until = `${end} 23:59:59`;
    const countResult = spawnSync(
      'git', ['-C', repoDir, 'rev-list', '--count', '--no-merges', `--since=${since}`, `--until=${until}`, 'HEAD'],
      { encoding: 'utf-8', timeout: 5000 }
    );
    const commits = parseInt(countResult.stdout?.trim() || '0');

    const logResult = spawnSync(
      'git', ['-C', repoDir, 'log', '--numstat', '--format===COMMIT==%H\t%s', '--no-merges', `--since=${since}`, `--until=${until}`],
      { encoding: 'utf-8', timeout: 5000 }
    );
    const out = logResult.stdout ?? '';

    let added = 0, deleted = 0;
    const perCommit: TopCommit[] = [];
    let current: TopCommit | null = null;
    for (const line of out.split('\n')) {
      if (line.startsWith('==COMMIT==')) {
        if (current) perCommit.push(current);
        const [sha, ...subjParts] = line.slice('==COMMIT=='.length).split('\t');
        current = { sha: sha.slice(0, 7), subject: subjParts.join('\t'), added: 0, deleted: 0 };
        continue;
      }
      const parts = line.split('\t');
      if (parts.length < 2) continue;
      const a = parseInt(parts[0]);
      const d = parseInt(parts[1]);
      if (isNaN(a) || isNaN(d)) continue;
      added += a;
      deleted += d;
      if (current) { current.added += a; current.deleted += d; }
    }
    if (current) perCommit.push(current);

    const topCommits = perCommit
      .sort((x, y) => (y.added + y.deleted) - (x.added + x.deleted))
      .slice(0, 5);

    return { commits, added, deleted, topCommits };
  } catch {
    return { commits: 0, added: 0, deleted: 0, topCommits: [] };
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
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      return reply.status(400).send({ error: 'start and end must be YYYY-MM-DD' });
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
