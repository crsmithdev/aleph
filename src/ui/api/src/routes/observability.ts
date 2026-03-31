import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { resolve } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { claudePaths, dataPaths, getMemoryDbPath } from '@construct/data';
import { Database } from 'bun:sqlite';
import {
  parseSessionsForDays,
  aggregateOverview,
  aggregateTools,
  aggregateHooks,
  aggregateSkills,
  aggregateTokens,
  aggregateCost,
  aggregateSessions,
  aggregateToolDetail,
  aggregateHookDetail,
  aggregateSkillDetail,
  aggregateMemoryUsage,
  aggregateHookEvents,
  aggregateCompaction,
  aggregateApiDuration,
  aggregateSessionTrace,
  getRecentEvents,
  aggregateSubagents,
} from '@construct/telemetry';
import type { Granularity, TelemetryEvent } from '@construct/telemetry';

type QueryParams = { days?: string; range?: string; granularity?: string; session?: string };
type ObsRequest = FastifyRequest<{ Querystring: QueryParams }> & {
  telemetryEntries: TelemetryEvent[];
  granularity: Granularity;
};

function parseGranularity(raw?: string): Granularity {
  if (raw === 'minute' || raw === 'hour' || raw === 'day') return raw;
  return 'day';
}

function rangeToDays(range?: string): number | undefined {
  switch (range) {
    case '1h': return 1;      // parse 1 day, filter later
    case '1d': return 1;
    case '7d': return 7;
    case '30d': return 30;
    case 'session': return 7; // parse 7 days, filter to latest session
    default: return undefined;
  }
}

function parseDaysPreHandler(
  req: FastifyRequest<{ Querystring: QueryParams }>,
  reply: { code: (n: number) => { send: (body: unknown) => void } },
  done: () => void,
) {
  const range = req.query.range;
  const days = range ? rangeToDays(range) : parseInt(req.query.days || '30', 10);
  if (!days || Number.isNaN(days) || days < 1 || days > 365) {
    reply.code(400).send({ error: 'invalid days or range parameter' });
    return;
  }
  let entries = parseSessionsForDays(days);

  // For 1h range, filter to entries within the last hour
  if (range === '1h') {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    entries = entries.filter((e) => e.ts >= oneHourAgo);
  }

  // For session range, filter to the most recent session
  if (range === 'session') {
    const latest = entries.reduce((best, e) => (e.ts > best ? e.ts : best), '');
    if (latest) {
      const latestSession = entries.find((e) => e.ts === latest)?.sid;
      if (latestSession) {
        entries = entries.filter((e) => e.sid === latestSession);
      }
    }
  }

  // Filter by explicit session if provided
  const sessionFilter = req.query.session;
  if (sessionFilter) {
    entries = entries.filter((e) => e.sid === sessionFilter);
  }

  (req as ObsRequest).telemetryEntries = entries;
  (req as ObsRequest).granularity = parseGranularity(req.query.granularity);
  done();
}

function timed<T>(fn: () => T): { result: T; queryTimeMs: number } {
  const start = performance.now();
  const result = fn();
  const queryTimeMs = Math.round((performance.now() - start) * 100) / 100;
  return { result, queryTimeMs };
}

function extractHookPath(fullCommand: string): string | undefined {
  const parts = fullCommand.split(/\s+/);
  for (const part of parts) {
    if (part.startsWith('/') && (part.endsWith('.ts') || part.endsWith('.js') || part.endsWith('.sh'))) {
      return part;
    }
  }
  return undefined;
}

function checkHookActive(fullCommand: string): boolean {
  const path = extractHookPath(fullCommand);
  return path ? existsSync(path) : false;
}

function tryRead(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try { return readFileSync(path, 'utf-8'); } catch { return undefined; }
}

function readHookSource(fullCommand: string): string | undefined {
  const path = extractHookPath(fullCommand);
  if (!path) return undefined;
  return tryRead(path);
}

interface SessionGateInfo {
  inlineOverride: boolean;
  dispatchBlocks: number;
  dispatchAllows: number;
}

function readSessionGateInfo(): Map<string, SessionGateInfo> {
  const map = new Map<string, SessionGateInfo>();
  const hookEventsPath = resolve(dataPaths.signals, 'hook-events.jsonl');
  if (!existsSync(hookEventsPath)) return map;
  try {
    const lines = readFileSync(hookEventsPath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { ts: string; hook: string; event: string; sessionId?: string };
        const sid = entry.sessionId;
        if (!sid) continue;
        if (!map.has(sid)) map.set(sid, { inlineOverride: false, dispatchBlocks: 0, dispatchAllows: 0 });
        const info = map.get(sid)!;
        if (entry.hook === 'inline-override') {
          info.inlineOverride = true;
        } else if (entry.hook === 'dispatch-pre-require-subagent' && entry.event === 'PreToolUse') {
          info.dispatchBlocks++;
        } else if (entry.hook === 'dispatch-pre-require-subagent:inline-override') {
          info.inlineOverride = true;
          info.dispatchAllows++;
        }
      } catch {}
    }
  } catch {}
  return map;
}

function toGateInfo(info: SessionGateInfo | undefined): { inlineOverride: boolean; dispatchBlocks: number; dispatchAllows: number; mode: 'dispatched' | 'inline' | 'none' } | undefined {
  if (!info) return undefined;
  if (!info.inlineOverride && info.dispatchBlocks === 0 && info.dispatchAllows === 0) return undefined;
  const mode = info.inlineOverride ? 'inline' : info.dispatchBlocks > 0 ? 'dispatched' : 'none';
  return { ...info, mode };
}

function readSelfReportedHookCounts(startDate?: string): Map<string, { count: number; event: string }> {
  const counts = new Map<string, { count: number; event: string }>();
  const hookEventsPath = resolve(dataPaths.signals, 'hook-events.jsonl');
  if (!existsSync(hookEventsPath)) return counts;
  try {
    const lines = readFileSync(hookEventsPath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { ts: string; hook: string; event: string };
        if (startDate && entry.ts < startDate) continue;
        const key = entry.hook.endsWith('.ts') ? entry.hook : entry.hook + '.ts';
        const cur = counts.get(key) || { count: 0, event: entry.event };
        cur.count++;
        counts.set(key, cur);
      } catch {}
    }
  } catch {}
  return counts;
}

function getRegisteredSkills(): string[] {
  const rulesPath = resolve(claudePaths.skills, 'skill-rules.json');
  if (!existsSync(rulesPath)) return [];
  try {
    const data = JSON.parse(readFileSync(rulesPath, 'utf-8'));
    return (data.rules || []).map((r: { skill: string }) => r.skill);
  } catch (e) {
    console.error(`Failed to parse skill-rules.json: ${(e as Error).message}`);
    return [];
  }
}

function projectIdToPath(projectId: string): string | undefined {
  // -home-crsmi-construct → /home/crsmi/construct
  // Try progressively joining segments with / vs -
  const raw = projectId.replace(/^-/, '/').replace(/-/g, '/');
  if (existsSync(raw)) return raw;
  // Fallback: try keeping last segments hyphenated
  const parts = projectId.replace(/^-/, '').split('-');
  for (let split = 3; split <= parts.length; split++) {
    const path = '/' + parts.slice(0, split).join('/');
    if (existsSync(path)) return path;
  }
  return undefined;
}

function getCommandNames(): Set<string> {
  const names = new Set<string>();
  // Global commands
  try {
    for (const f of readdirSync(claudePaths.commands)) {
      if (f.endsWith('.md')) names.add(f.replace(/\.md$/, ''));
    }
  } catch {}
  // Project-local commands: scan known project dirs
  try {
    for (const dir of readdirSync(claudePaths.projects)) {
      const projectPath = projectIdToPath(dir);
      if (!projectPath) continue;
      const localCmds = resolve(projectPath, '.claude', 'commands');
      try {
        for (const f of readdirSync(localCmds)) {
          if (f.endsWith('.md')) names.add(f.replace(/\.md$/, ''));
        }
      } catch {}
    }
  } catch {}
  return names;
}

function findSkillSource(name: string, projects?: string[]): string | undefined {
  const normalized = name.startsWith('/') ? name.slice(1) : name;
  // Check skill SKILL.md
  const skillMd = tryRead(resolve(claudePaths.skills, normalized, 'SKILL.md'));
  if (skillMd) return skillMd;
  // Check global command
  const globalCmd = tryRead(resolve(claudePaths.commands, `${normalized}.md`));
  if (globalCmd) return globalCmd;
  // Check project-local commands
  const projectDirs = projects ?? [];
  for (const projectId of projectDirs) {
    const projectPath = projectIdToPath(projectId);
    if (!projectPath) continue;
    const localCmd = tryRead(resolve(projectPath, '.claude', 'commands', `${normalized}.md`));
    if (localCmd) return localCmd;
  }
  return undefined;
}

function getRegisteredHooks(): Array<{ command: string; event: string }> {
  const settingsPath = resolve(claudePaths.root, 'settings.json');
  if (!existsSync(settingsPath)) return [];
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const hooks: Array<{ command: string; event: string }> = [];
    for (const [event, entries] of Object.entries(settings.hooks || {})) {
      for (const entry of entries as Array<{ hooks?: Array<{ command: string }>; command?: string }>) {
        const cmds = entry.hooks?.map(h => h.command) ?? (entry.command ? [entry.command] : []);
        for (const raw of cmds) {
          const cmd = raw.split('/').pop()?.replace(/\.ts$/, '') || raw;
          hooks.push({ command: cmd, event });
        }
      }
    }
    return hooks;
  } catch (e) {
    console.error(`Failed to parse settings.json hooks: ${(e as Error).message}`);
    return [];
  }
}

function checkToolActive(_toolName: string, lastUsed?: string): boolean {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  if (lastUsed) {
    return new Date(lastUsed) >= sevenDaysAgo;
  }
  return false;
}

type HookMeta = {
  blocking: boolean;
  gate?: string;
  markerFile?: string;
  description: string;
};

const HOOK_METADATA: Record<string, HookMeta> = {
  'dispatch-pre-require-subagent': {
    blocking: true,
    gate: 'dispatch',
    description: 'Blocks Edit/Write in main session unless inline override or subagent',
  },
  'dispatch-stop-remind': {
    blocking: false,
    gate: 'dispatch',
    description: 'Reminds to dispatch tasks to background agents',
  },
  'isolation-pre-block-prod-edit': {
    blocking: true,
    description: 'Blocks edits to production ~/.claude paths from dev repo',
  },
  'isolation-pre-block-destructive-sql': {
    blocking: true,
    description: 'Blocks destructive SQL (DROP, TRUNCATE, DELETE without WHERE)',
  },
  'quality-stop-check-e2e': {
    blocking: false,
    gate: 'e2e-verification',
    markerFile: 'require-e2e',
    description: 'Checks for e2e verification evidence; writes marker when missing',
  },
  'quality-pre-require-e2e': {
    blocking: true,
    gate: 'e2e-verification',
    markerFile: 'require-e2e',
    description: 'Blocks Edit/Write when e2e verification marker is present',
  },
  'git-pre-require-commit': {
    blocking: true,
    gate: 'commit-nudge',
    markerFile: 'git-pre-require-commit-{sessionId}',
    description: 'Groups dirty files by directory; warns at 3 groups, blocks at 5',
  },
  'quality-post-format': {
    blocking: false,
    description: 'Post-tool formatting quality checks',
  },
  'quality-post-typecheck': {
    blocking: false,
    description: 'Runs tsc type-check after Edit/Write on .ts files',
  },
  'routing-submit-classify': {
    blocking: false,
    gate: 'dispatch',
    description: 'Classifies prompt depth, matches skills, writes directives',
  },
  'context-stop-monitor': {
    blocking: false,
    description: 'Monitors context window usage at stop',
  },
  'context-precompact-backup': {
    blocking: false,
    description: 'Backs up transcript before context compaction',
  },
  'notify-event-toast': {
    blocking: false,
    description: 'Sends desktop toast notifications for events',
  },
};

function readMarkerFileStats(): Record<string, { writes: number; clears: number; activeNow: boolean }> {
  const stats: Record<string, { writes: number; clears: number; activeNow: boolean }> = {};
  // Check require-e2e marker
  const e2eMarker = resolve(dataPaths.signals, 'require-e2e');
  stats['require-e2e'] = { writes: 0, clears: 0, activeNow: existsSync(e2eMarker) };

  // Read hook trace log for marker write/clear counts
  const traceLog = resolve(dataPaths.signals, 'hook-trace.log');
  if (existsSync(traceLog)) {
    try {
      const content = readFileSync(traceLog, 'utf-8');
      const e2eWrites = (content.match(/marker written/g) || []).length;
      const e2eClears = (content.match(/cleared marker/g) || []).length;
      stats['require-e2e'].writes = e2eWrites;
      stats['require-e2e'].clears = e2eClears;
    } catch {}
  }

  // Check git commit markers
  try {
    const signalFiles = readdirSync(dataPaths.signals);
    const commitMarkers = signalFiles.filter(f => f.startsWith('git-pre-require-commit-'));
    stats['git-pre-require-commit'] = {
      writes: 0,
      clears: 0,
      activeNow: commitMarkers.length > 0,
    };
  } catch {
    stats['git-pre-require-commit'] = { writes: 0, clears: 0, activeNow: false };
  }

  return stats;
}

export const observabilityRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: QueryParams }>('/overview', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateOverview(obsReq.telemetryEntries, obsReq.granularity));
    return { ...result, queryTimeMs };
  });

  app.get<{ Querystring: QueryParams }>('/tools', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateTools(obsReq.telemetryEntries, obsReq.granularity));
    // Add active status
    const ranked = result.ranked.map((t) => ({
      ...t,
      active: checkToolActive(t.name, t.lastUsed),
    }));
    return { ...result, ranked, queryTimeMs };
  });

  app.get<{ Querystring: QueryParams }>('/hooks', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateHooks(obsReq.telemetryEntries, obsReq.granularity));

    // Merge self-reported hook events (for hooks on events Claude Code doesn't log)
    const days = rangeToDays(req.query.range) || rangeToDays(req.query.days ? `${req.query.days}d` : undefined) || 30;
    const startDate = new Date(Date.now() - days * 86400000).toISOString();
    const selfReported = readSelfReportedHookCounts(startDate);
    const rankedMap = new Map(result.ranked.map((h) => [h.command, h]));
    for (const [hook, { count, event }] of selfReported) {
      const existing = rankedMap.get(hook);
      if (existing) {
        existing.count = Math.max(existing.count, count);
        if (!existing.event) existing.event = event;
      } else {
        rankedMap.set(hook, { command: hook, event, count, avgMs: 0, p50Ms: 0, p95Ms: 0, errors: 0, fullCommand: hook });
      }
    }
    const merged = [...rankedMap.values()].sort((a, b) => b.count - a.count);

    const markerStats = readMarkerFileStats();
    const ranked = merged.map((h) => {
      const name = h.command.replace(/\.ts$/, '');
      const meta = HOOK_METADATA[name];
      return {
        ...h,
        active: h.fullCommand ? checkHookActive(h.fullCommand) : false,
        blocking: meta?.blocking ?? false,
        gate: meta?.gate,
        markerFile: meta?.markerFile,
        description: meta?.description,
      };
    });
    const registered = getRegisteredHooks();
    const normalize = (cmd: string) => cmd.replace(/\.(ts|sh)$/, '');
    const usedCommands = new Set(ranked.map(h => normalize(h.command)));
    const unused = registered.filter(h => !usedCommands.has(normalize(h.command))).map(h => {
      const meta = HOOK_METADATA[normalize(h.command)];
      return {
        ...h,
        blocking: meta?.blocking ?? false,
        gate: meta?.gate,
        markerFile: meta?.markerFile,
        description: meta?.description,
      };
    });
    return { ...result, ranked, unused, markerStats, queryTimeMs };
  });

  app.get<{ Querystring: QueryParams }>('/skills', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateSkills(obsReq.telemetryEntries, obsReq.granularity));
    const registeredSkills = new Set(getRegisteredSkills());
    const commandNames = getCommandNames();
    const usedNames = new Set(result.ranked.map(s => s.skill.replace(/^\//, '')));
    const unusedSkills = [...registeredSkills].filter(s => !usedNames.has(s)).map(s => ({ name: s, type: 'skill' as const }));
    const unusedCommands = [...commandNames].filter(s => !usedNames.has(s) && !registeredSkills.has(s)).map(s => ({ name: s, type: 'command' as const }));
    const unused = [...unusedSkills, ...unusedCommands];
    const ranked = result.ranked.map(s => {
      const bare = s.skill.replace(/^\//, '');
      const isSkill = registeredSkills.has(bare);
      const isCommand = commandNames.has(bare) && !isSkill;
      return {
        ...s,
        type: isCommand ? 'command' as const : 'skill' as const,
        registered: isCommand || isSkill,
      };
    });
    return { ...result, ranked, unused, queryTimeMs };
  });

  app.get<{ Querystring: QueryParams }>('/tokens', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateTokens(obsReq.telemetryEntries, obsReq.granularity));
    return { ...result, queryTimeMs };
  });

  app.get<{ Querystring: QueryParams }>('/cost', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateCost(obsReq.telemetryEntries, obsReq.granularity));
    return { ...result, queryTimeMs };
  });

  app.get<{ Querystring: QueryParams }>('/sessions', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateSessions(obsReq.telemetryEntries, obsReq.granularity));
    const gateMap = readSessionGateInfo();
    for (const session of result.sessions) {
      session.gateInfo = toGateInfo(gateMap.get(session.sessionId));
    }
    return { ...result, queryTimeMs };
  });

  app.get<{ Params: { id: string }; Querystring: QueryParams }>(
    '/sessions/:id/trace',
    { preHandler: parseDaysPreHandler },
    async (req) => {
      const sessionId = decodeURIComponent(req.params.id);
      const { result, queryTimeMs } = timed(() => aggregateSessionTrace((req as ObsRequest).telemetryEntries, sessionId));
      const gateMap = readSessionGateInfo();
      result.gateInfo = toGateInfo(gateMap.get(sessionId));
      return { ...result, queryTimeMs };
    },
  );

  app.get<{ Params: { name: string }; Querystring: QueryParams }>(
    '/tools/:name',
    { preHandler: parseDaysPreHandler },
    async (req) => {
      const toolName = decodeURIComponent(req.params.name);
      const { result, queryTimeMs } = timed(() => aggregateToolDetail((req as ObsRequest).telemetryEntries, toolName));
      return { ...result, queryTimeMs };
    },
  );

  app.get<{ Querystring: QueryParams }>('/hooks/events', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateHookEvents(obsReq.telemetryEntries));
    return { ...result, queryTimeMs };
  });

  app.get<{ Params: { name: string }; Querystring: QueryParams }>(
    '/hooks/:name',
    { preHandler: parseDaysPreHandler },
    async (req) => {
      const hookName = decodeURIComponent(req.params.name);
      const obsReq = req as ObsRequest;
      const { result, queryTimeMs } = timed(() => aggregateHookDetail(obsReq.telemetryEntries, hookName));
      const active = result.fullCommand ? checkHookActive(result.fullCommand) : false;
      const sourceCode = result.fullCommand ? readHookSource(result.fullCommand) : undefined;
      return { ...result, active, sourceCode, queryTimeMs };
    },
  );

  app.get<{ Params: { name: string }; Querystring: QueryParams }>(
    '/skills/:name',
    { preHandler: parseDaysPreHandler },
    async (req) => {
      const skillName = decodeURIComponent(req.params.name);
      const obsReq = req as ObsRequest;
      const { result, queryTimeMs } = timed(() => aggregateSkillDetail(obsReq.telemetryEntries, skillName));
      const projects = [...new Set(result.invocations?.map((i: { project: string }) => i.project) ?? [])];
      const sourceContent = findSkillSource(skillName, projects);
      const commandNames = getCommandNames();
      const bare = skillName.startsWith('/') ? skillName.slice(1) : skillName;
      const type = commandNames.has(bare) ? 'command' as const : 'skill' as const;
      return { ...result, sourceContent, type, queryTimeMs };
    },
  );

  app.get<{ Querystring: QueryParams }>(
    '/memory/usage',
    { preHandler: parseDaysPreHandler },
    async (req) => {
      const obsReq = req as ObsRequest;
      const { result, queryTimeMs } = timed(() => aggregateMemoryUsage(obsReq.telemetryEntries, obsReq.granularity));
      return { ...result, queryTimeMs };
    },
  );

  app.get<{ Querystring: { type?: string; tag?: string; q?: string; limit?: string } }>(
    '/memory/items',
    async (req) => {
      const dbPath = getMemoryDbPath();
      if (!existsSync(dbPath)) {
        return { items: [] };
      }

      const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10) || 50, 1), 500);
      const conditions: string[] = [];
      const params: (string | number)[] = [];
      const useFts = !!req.query.q;

      if (req.query.type) {
        conditions.push('m.memory_type = ?');
        params.push(req.query.type);
      }
      if (req.query.tag) {
        // tags column has no FTS index; use instr to avoid LIKE wildcard interpretation
        conditions.push('instr(m.tags, ?) > 0');
        params.push(req.query.tag);
      }
      if (req.query.q) {
        // memory_content_fts is an FTS5 content table (trigram tokenizer) kept in sync
        // by triggers on the memories table. Join it instead of scanning content with LIKE.
        conditions.push('memory_content_fts MATCH ?');
        params.push(req.query.q);
      }

      const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
      // When FTS is active, join the virtual table so MATCH applies to the right context.
      const from = useFts
        ? 'memories m JOIN memory_content_fts ON memory_content_fts.rowid = m.id'
        : 'memories m';
      const sql = `SELECT m.id, m.content, m.memory_type, m.tags, m.created_at, m.updated_at FROM ${from}${where} ORDER BY m.created_at DESC LIMIT ?`;
      params.push(limit);

      let db: Database | null = null;
      try {
        db = new Database(dbPath, { readonly: true });
        const rows = db.query(sql).all(...params) as Array<Record<string, unknown>>;
        const items = rows.map((row) => ({
          ...row,
          created_at: typeof row.created_at === 'number'
            ? new Date(row.created_at * 1000).toISOString()
            : row.created_at,
          updated_at: typeof row.updated_at === 'number'
            ? new Date(row.updated_at * 1000).toISOString()
            : row.updated_at,
        }));
        return { items };
      } catch (err) {
        app.log.error(`memory/items query failed: ${(err as Error).message}`);
        return { items: [], error: 'query failed' };
      } finally {
        db?.close();
      }
    },
  );

  app.get<{ Querystring: QueryParams }>('/compaction', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateCompaction(obsReq.telemetryEntries, obsReq.granularity));
    return { ...result, queryTimeMs };
  });

  app.get<{ Querystring: QueryParams }>('/api-duration', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateApiDuration(obsReq.telemetryEntries, obsReq.granularity));
    return { ...result, queryTimeMs };
  });

  app.get<{ Querystring: QueryParams & { type?: string; search?: string; limit?: string; offset?: string } }>(
    '/events',
    { preHandler: parseDaysPreHandler },
    async (req) => {
      const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10) || 100, 1), 500);
      const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
      const filters: { entryType?: string; search?: string } = {};
      if (req.query.type) filters.entryType = req.query.type;
      if (req.query.search) filters.search = req.query.search;
      const { result, queryTimeMs } = timed(() =>
        getRecentEvents((req as ObsRequest).telemetryEntries, limit, offset, filters),
      );
      return { ...result, queryTimeMs };
    },
  );

  app.get('/memory', async () => {
    const rows = app.sqlite
      .query('SELECT taken_at, total, by_type, health, by_tag FROM obs_memory_snapshots ORDER BY taken_at DESC LIMIT 100')
      .all() as Array<{ taken_at: string; total: number; by_type: string; health: string; by_tag: string }>;

    return {
      snapshots: rows.map((r) => ({
        takenAt: r.taken_at,
        total: r.total,
        byType: JSON.parse(r.by_type),
        health: JSON.parse(r.health),
        byTag: JSON.parse(r.by_tag),
      })),
    };
  });

  app.get('/db-stats', async () => {
    const constructDbPath = dataPaths.db;
    const memoryDbPath = getMemoryDbPath();

    type DbInfo = {
      name: string;
      path: string;
      sizeBytes: number;
      walSizeBytes: number;
      tables: Array<{ name: string; rows: number }>;
    };

    function getDbInfo(name: string, dbPath: string): DbInfo | null {
      if (!existsSync(dbPath)) return null;
      const stat = statSync(dbPath);
      const walPath = dbPath + '-wal';
      const walSize = existsSync(walPath) ? statSync(walPath).size : 0;
      let db: Database | null = null;
      try {
        db = new Database(dbPath, { readonly: true });
        const tableNames = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
        const tables = tableNames.map((t) => {
          const countRow = db!.query(`SELECT count(*) as c FROM "${t.name}"`).get() as { c: number };
          return { name: t.name, rows: countRow.c };
        });
        return { name, path: dbPath, sizeBytes: stat.size, walSizeBytes: walSize, tables };
      } catch {
        return { name, path: dbPath, sizeBytes: stat.size, walSizeBytes: walSize, tables: [] };
      } finally {
        db?.close();
      }
    }

    const databases = [
      getDbInfo('construct', constructDbPath),
      getDbInfo('memory', memoryDbPath),
    ].filter(Boolean);

    return { databases };
  });

  app.get('/db-schema/:db/:table', async (request) => {
    const { db: dbName, table } = request.params as { db: string; table: string };
    const dbPath = dbName === 'construct' ? dataPaths.db : dbName === 'memory' ? getMemoryDbPath() : null;
    if (!dbPath || !existsSync(dbPath)) return { columns: [] };

    let db: Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true });
      const columns = db.query(`PRAGMA table_info("${table.replace(/"/g, '')}")`).all() as Array<{
        cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number;
      }>;
      return { columns: columns.map(c => ({ name: c.name, type: c.type, notnull: !!c.notnull, pk: !!c.pk, defaultValue: c.dflt_value })) };
    } catch {
      return { columns: [] };
    } finally {
      db?.close();
    }
  });

  app.get<{ Querystring: QueryParams }>('/subagents', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateSubagents(obsReq.telemetryEntries, obsReq.granularity));
    return { ...result, queryTimeMs };
  });

  app.post('/memory/snapshot', async () => {
    const { execFileSync } = await import('child_process');
    try {
      const scriptPath = resolve(import.meta.dirname, '../../../../memory/obs-snapshot.ts');
      execFileSync('bun', [scriptPath], {
        timeout: 5000,
        stdio: 'pipe',
      });
      return { status: 'ok' };
    } catch (err) {
      return { status: 'error', message: String(err) };
    }
  });
};
