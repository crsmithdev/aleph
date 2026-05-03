/**
 * System info — single source of truth for git revision, install metadata, and
 * data paths. Consumed by both the `/api/system/info` route and the dev-server
 * boot banner so the CLI prints exactly what the UI status page shows.
 *
 * In dev (no install manifest), git is read live from the worktree. In prod,
 * values are pinned in `claudePaths.manifest` at install time.
 */

import { existsSync, readFileSync, statSync, lstatSync, readlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { claudePaths, dataPaths, getMemoryDbPath } from '@construct/data';
import { config } from './config.js';

export interface SystemInfo {
  git: {
    revision: string;
    short: string;
    dirty: boolean;
    branch: string;
    commitCount: string;
    commitsSinceTag: string;
    lastCommit: string;
    lastCommitDate: string;
  };
  paths: {
    repo: string;
    claudeRoot: string;
    dataRoot: string;
    construct: string;
    commands: string;
    skills: string;
    db: string;
    memoryDb: string;
    sessions: string;
    telemetry: string;
    signals: string;
    ratings: string;
    backups: string;
    devLogs: string;
  };
  install: {
    timestamp: string;
    bunVersion: string;
    platform: string;
    arch: string;
  };
  runtime: {
    nodeEnv: string;
    port: number;
    dbSizeBytes: number;
  };
}

function git(cmd: string, cwd?: string): string {
  try { return execSync(`git ${cmd}`, { cwd, encoding: 'utf-8', timeout: 5000 }).trim(); }
  catch { return ''; }
}

function liveGitInfo(repoDir: string): Record<string, string> {
  const short = git('rev-parse --short HEAD', repoDir);
  if (!short) return {};

  const logLine = git('log -1 --format=%H%n%D%n%s%n%ci', repoDir);
  const [revision, refs, last_commit, last_commit_date] = logLine.split('\n');

  const branchMatch = refs?.match(/HEAD -> ([^,]+)/);
  const branch = branchMatch ? branchMatch[1] : git('rev-parse --abbrev-ref HEAD', repoDir);

  const dirty = String(git('status --porcelain', repoDir).length > 0);
  const commit_count = git('rev-list --count HEAD', repoDir);

  const latestTag = git('describe --tags --abbrev=0 HEAD', repoDir);
  const commits_since_tag = latestTag ? git(`rev-list --count ${latestTag}..HEAD`, repoDir) : 'n/a';

  return { revision, short, dirty, branch, commit_count, commits_since_tag, last_commit, last_commit_date };
}

function pathWithSymlink(p: string): string {
  try { const s = lstatSync(p); if (s.isSymbolicLink()) return `${p} → ${readlinkSync(p)}`; } catch { /* ignore */ }
  return p;
}

function parseManifest(): Record<string, Record<string, string>> {
  try {
    const content = readFileSync(claudePaths.manifest, 'utf-8');
    const manifest: Record<string, Record<string, string>> = {};
    let current = '';
    for (const line of content.split('\n')) {
      if (line.startsWith('#') || !line.trim()) continue;
      const sectionMatch = line.match(/^\[(.+)]$/);
      if (sectionMatch) { current = sectionMatch[1]; manifest[current] = {}; continue; }
      const kvMatch = line.match(/^(\S+) = (.*)$/);
      if (kvMatch && current) manifest[current][kvMatch[1]] = kvMatch[2];
    }
    return manifest;
  } catch { return {}; }
}

import { join } from 'node:path';
const devLogsDir = join(process.env.HOME ?? '/tmp', '.construct', 'logs');

export function getSystemInfo(runtimeDbPath: string): SystemInfo {
  const manifest = parseManifest();
  const hasManifest = Object.keys(manifest).length > 0;

  const repoDir = manifest.paths?.repo ?? (() => {
    const candidate = resolve(import.meta.dirname || '.', '../../../..');
    return existsSync(resolve(candidate, '.git')) ? candidate : undefined;
  })();

  const liveGit = !hasManifest && repoDir ? liveGitInfo(repoDir) : {};
  const g = hasManifest ? manifest.git ?? {} : liveGit;

  const dbSize = (() => {
    try { return statSync(runtimeDbPath).size; } catch { return 0; }
  })();

  return {
    git: {
      revision: g.revision ?? 'unknown',
      short: g.short ?? 'unknown',
      dirty: g.dirty === 'true',
      branch: g.branch ?? 'unknown',
      commitCount: g.commit_count ?? 'unknown',
      commitsSinceTag: g.commits_since_tag ?? 'n/a',
      lastCommit: g.last_commit ?? 'unknown',
      lastCommitDate: g.last_commit_date ?? 'unknown',
    },
    paths: {
      repo: repoDir ?? 'unknown',
      claudeRoot: manifest.paths?.claude_root ?? claudePaths.root,
      dataRoot: manifest.paths?.data_root ?? dataPaths.root,
      construct: pathWithSymlink(manifest.paths?.construct ?? claudePaths.construct),
      commands: pathWithSymlink(manifest.paths?.commands ?? claudePaths.commands),
      skills: pathWithSymlink(manifest.paths?.skills ?? claudePaths.skills),
      db: runtimeDbPath,
      memoryDb: manifest.paths?.memory_db ?? getMemoryDbPath(),
      sessions: manifest.paths?.sessions ?? dataPaths.sessions,
      telemetry: claudePaths.projects,
      signals: dataPaths.signals,
      ratings: manifest.paths?.ratings ?? dataPaths.ratings,
      backups: manifest.paths?.backups ?? dataPaths.backups,
      devLogs: devLogsDir,
    },
    install: {
      timestamp: manifest.install?.timestamp ?? 'unknown',
      bunVersion: manifest.install?.bun_version ?? Bun.version,
      platform: manifest.install?.platform ?? process.platform,
      arch: manifest.install?.arch ?? process.arch,
    },
    runtime: {
      nodeEnv: process.env.NODE_ENV || 'development',
      port: config.port,
      dbSizeBytes: dbSize,
    },
  };
}
