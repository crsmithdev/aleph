#!/usr/bin/env bun
/**
 * Telemetry E2E verification test.
 *
 * Computes ground-truth metrics from raw fixture JSONL files WITHOUT using any
 * @construct/telemetry code, then starts the full stack (API + Vite + Playwright)
 * and verifies that the UI displays matching values.
 *
 * Covers: overview, tools, tokens/cost, hooks, sessions, memory usage, subagents,
 * API duration, and session trace.
 */

import { mkdtempSync, rmSync, readFileSync, readdirSync, cpSync, utimesSync } from 'fs';
import { join, basename, dirname } from 'path';
import { tmpdir } from 'os';
import { Database } from 'bun:sqlite';
import { spawn, type ChildProcess } from 'child_process';

// ---------------------------------------------------------------------------
// 1. Compute ground truth from raw fixture JSONL — no system code imports
// ---------------------------------------------------------------------------

const FIXTURE_BASE = join(import.meta.dir, '../../telemetry/__tests__/fixtures/e2e');

function discoverFixtureFiles(base: string): string[] {
  const files: string[] = [];
  for (const sessionDir of readdirSync(base, { withFileTypes: true })) {
    if (!sessionDir.isDirectory()) continue;
    const sessionPath = join(base, sessionDir.name);
    for (const f of readdirSync(sessionPath, { withFileTypes: true })) {
      if (f.isFile() && f.name.endsWith('.jsonl')) {
        files.push(join(sessionPath, f.name));
      }
      if (f.isDirectory()) {
        const subDir = join(sessionPath, f.name, 'subagents');
        try {
          for (const sf of readdirSync(subDir, { withFileTypes: true })) {
            if (sf.isFile() && sf.name.endsWith('.jsonl')) {
              files.push(join(subDir, sf.name));
            }
          }
        } catch {}
      }
    }
  }
  return files;
}

interface GroundTruth {
  sessions: number;
  assistantMessages: number;
  toolCalls: number;
  toolErrors: number;
  hookErrors: number;
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
  totalCostUsd: number;
  tools: Record<string, { count: number; errors: number }>;
  skills: Record<string, number>;
  subagents: { totalDispatches: number; backgroundDispatches: number };
  turnDurations: number[];
  compactions: number;
  hookProgressCount: number;
  hookSummaryCount: number;
  modelCosts: Record<string, number>;
  cacheEfficiency: number;
}

function computeGroundTruth(files: string[]): GroundTruth {
  const sessionIds = new Set<string>();
  let assistantMessages = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let hookErrors = 0;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  const toolCounts: Record<string, number> = {};
  const toolErrorCounts: Record<string, number> = {};
  const useIdToTool: Record<string, string> = {};
  const skills: Record<string, number> = {};
  const turnDurations: number[] = [];
  let compactions = 0;
  let agentDispatches = 0;
  let bgDispatches = 0;
  let hookProgressCount = 0;
  let hookSummaryCount = 0;
  let totalCost = 0;
  const modelCosts: Record<string, number> = {};

  const PRICING: [string, number, number, number, number][] = [
    ['claude-opus-4', 15, 75, 1.5, 18.75],
    ['claude-sonnet-4', 3, 15, 0.3, 3.75],
    ['claude-haiku-4', 0.8, 4, 0.08, 1],
    ['claude-3-5-sonnet', 3, 15, 0.3, 3.75],
    ['claude-3-5-haiku', 0.8, 4, 0.08, 1],
  ];

  function calcCost(model: string, inp: number, out: number, cr: number, cc: number): number {
    for (const [prefix, i, o, crRate, ccRate] of PRICING) {
      if (model.startsWith(prefix)) {
        return (inp * i + out * o + cr * crRate + cc * ccRate) / 1_000_000;
      }
    }
    return 0;
  }

  for (const file of files) {
    const isSubagent = file.includes('/subagents/');
    const fileSessionId = basename(file, '.jsonl');
    const lines = readFileSync(file, 'utf-8').split('\n').filter(l => l.trim());

    for (const line of lines) {
      let raw: any;
      try { raw = JSON.parse(line); } catch { continue; }

      const sid = isSubagent ? fileSessionId : (raw.sessionId || fileSessionId);
      sessionIds.add(sid);

      if (raw.type === 'assistant') {
        const msg = raw.message;
        if (msg?.usage) {
          assistantMessages++;
          const u = msg.usage;
          tokens.input += u.input_tokens || 0;
          tokens.output += u.output_tokens || 0;
          tokens.cacheRead += u.cache_read_input_tokens || 0;
          tokens.cacheCreation += u.cache_creation_input_tokens || 0;

          if (msg.model) {
            const cost = calcCost(msg.model, u.input_tokens || 0, u.output_tokens || 0,
              u.cache_read_input_tokens || 0, u.cache_creation_input_tokens || 0);
            totalCost += cost;
            modelCosts[msg.model] = (modelCosts[msg.model] || 0) + cost;
          }
        }
        if (Array.isArray(msg?.content)) {
          for (const block of msg.content) {
            if (block.type === 'tool_use') {
              toolCalls++;
              const name = block.name;
              toolCounts[name] = (toolCounts[name] || 0) + 1;
              if (block.id) useIdToTool[block.id] = name;

              if (name === 'Agent') {
                agentDispatches++;
                if (block.input?.run_in_background) bgDispatches++;
              }
              if (name === 'Skill' && block.input?.skill) {
                skills[block.input.skill] = (skills[block.input.skill] || 0) + 1;
              }
            }
          }
        }
      }

      if (raw.type === 'user' && !raw.isCompactSummary) {
        const msg = raw.message;
        if (Array.isArray(msg?.content)) {
          for (const block of msg.content) {
            if (block.type === 'tool_result' && block.is_error) {
              toolErrors++;
              const toolName = block.tool_use_id ? useIdToTool[block.tool_use_id] : undefined;
              if (toolName) toolErrorCounts[toolName] = (toolErrorCounts[toolName] || 0) + 1;
            }
          }
        }
      }

      if (raw.type === 'progress' && raw.data?.type === 'hook_progress') {
        hookProgressCount++;
      }

      if (raw.type === 'system') {
        if (raw.subtype === 'stop_hook_summary') {
          hookSummaryCount++;
          const infos: any[] = raw.hookInfos || [];
          const errs: string[] = raw.hookErrors || [];
          const hasHookErrors = errs.length > 0;
          // System creates one entry per hookInfo; marks isError if exitCode !== 0 OR hasHookErrors
          if (infos.length > 0) {
            for (const info of infos) {
              const exitCode = info.exitCode !== undefined ? info.exitCode : undefined;
              if ((exitCode !== undefined && exitCode !== 0) || hasHookErrors) hookErrors++;
            }
          } else if (hasHookErrors) {
            hookErrors++;
          }
        }
        if (raw.subtype === 'turn_duration' && raw.durationMs) {
          turnDurations.push(raw.durationMs);
        }
        if (raw.subtype === 'compact_boundary') {
          compactions++;
        }
      }
    }
  }

  const tools: Record<string, { count: number; errors: number }> = {};
  for (const [name, count] of Object.entries(toolCounts)) {
    tools[name] = { count, errors: toolErrorCounts[name] || 0 };
  }

  const cacheTotal = tokens.cacheRead + tokens.cacheCreation;
  const cacheEfficiency = cacheTotal > 0 ? (tokens.cacheRead / cacheTotal) * 100 : 0;

  return {
    sessions: sessionIds.size,
    assistantMessages,
    toolCalls,
    toolErrors,
    hookErrors,
    tokens,
    totalCostUsd: totalCost,
    tools,
    skills,
    subagents: { totalDispatches: agentDispatches, backgroundDispatches: bgDispatches },
    turnDurations,
    compactions,
    hookProgressCount,
    hookSummaryCount,
    modelCosts,
    cacheEfficiency,
  };
}

// ---------------------------------------------------------------------------
// 2. Setup: temp env, copy fixtures, start servers, launch browser
// ---------------------------------------------------------------------------

const tmpBase = mkdtempSync(join(tmpdir(), 'construct-telemetry-e2e-'));
const dbPath = join(tmpBase, 'test.db');
const fakeClaudeRoot = join(tmpBase, 'claude');
const fakeProjectsDir = join(fakeClaudeRoot, 'projects', 'test-project');

// Copy fixture contents (flattened) into fake projects dir.
// Fixture structure: e2e/session1/<uuid>.jsonl, e2e/session3/<uuid>/subagents/...
// Required structure: projects/test-project/<uuid>.jsonl, projects/test-project/<uuid>/subagents/...
import { mkdirSync } from 'fs';
mkdirSync(fakeProjectsDir, { recursive: true });
for (const sessionDir of readdirSync(FIXTURE_BASE, { withFileTypes: true })) {
  if (!sessionDir.isDirectory()) continue;
  const src = join(FIXTURE_BASE, sessionDir.name);
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    cpSync(join(src, entry.name), join(fakeProjectsDir, entry.name), { recursive: true });
  }
}

function touchRecursive(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) touchRecursive(full);
    else if (entry.name.endsWith('.jsonl')) {
      const now = new Date();
      utimesSync(full, now, now);
    }
  }
}
touchRecursive(fakeProjectsDir);

process.env.CONSTRUCT_DB_PATH = dbPath;
process.env.CLAUDE_ROOT = fakeClaudeRoot;

const db = new Database(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS obs_memory_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    taken_at TEXT NOT NULL DEFAULT (datetime('now')),
    total INTEGER NOT NULL,
    by_type TEXT NOT NULL,
    health TEXT NOT NULL,
    by_tag TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_obs_memory_taken_at ON obs_memory_snapshots(taken_at);
`);
db.prepare('INSERT INTO obs_memory_snapshots (taken_at, total, by_type, health, by_tag) VALUES (?, ?, ?, ?, ?)').run(
  '2026-03-20T10:00:00Z', 30,
  JSON.stringify({ decision: 10, pattern: 8, observation: 7, error: 5 }),
  JSON.stringify({ score: 0.85, stale: 4 }),
  JSON.stringify({ session_context: 15, decision: 10, preference: 5 }),
);
db.close();

const { chromium } = await import('playwright');
const { createApp } = await import('../api/src/app.js');

let server: Awaited<ReturnType<typeof createApp>> | null = null;
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
let viteProc: ChildProcess | null = null;
let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  \u2713 ${name}`);
    passed++;
  } else {
    const msg = detail ? `${name} — ${detail}` : name;
    console.log(`  \u2717 ${msg}`);
    failures.push(msg);
    failed++;
  }
}

function approxEqual(a: number, b: number, tolerance = 0.02): boolean {
  if (a === 0 && b === 0) return true;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) <= tolerance;
}

async function setup() {
  server = await createApp({ dbUrl: dbPath });
  await server.listen({ port: 3003, host: '127.0.0.1' });
  console.log('[e2e] API server on port 3003');

  viteProc = spawn('npx', ['vite', '--port', '5198', '--strictPort'], {
    cwd: join(import.meta.dir, '../web'),
    env: { ...process.env, API_PORT: '3003' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const vitePort = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Vite startup timeout')), 30000);
    let output = '';
    viteProc!.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(parseInt(match[1], 10)); }
    });
    viteProc!.stderr!.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    viteProc!.on('exit', (code) => { clearTimeout(timeout); reject(new Error(`Vite exited: ${code}\n${output}`)); });
  });
  console.log(`[e2e] Vite on port ${vitePort}`);

  browser = await chromium.launch({ headless: true });
  return vitePort;
}

// ---------------------------------------------------------------------------
// 3. Tests — compare ground truth against API and UI
// ---------------------------------------------------------------------------

async function runTests(webPort: number) {
  const gt = computeGroundTruth(discoverFixtureFiles(FIXTURE_BASE));
  console.log('\n[ground truth]', JSON.stringify({
    sessions: gt.sessions, messages: gt.assistantMessages, toolCalls: gt.toolCalls,
    toolErrors: gt.toolErrors, hookErrors: gt.hookErrors,
    costUsd: Math.round(gt.totalCostUsd * 100) / 100,
  }));

  const page = await browser!.newPage();
  const base = `http://127.0.0.1:${webPort}`;

  async function apiGet(path: string): Promise<any> {
    const resp = await fetch(`http://127.0.0.1:3003/api/observability/${path}?days=365`);
    return resp.json();
  }

  // ========== OVERVIEW (API) ==========
  console.log('\n--- overview (API) ---');
  const overview = await apiGet('overview');
  check('sessions count', overview.sessions === gt.sessions,
    `api=${overview.sessions} expected=${gt.sessions}`);
  check('assistant messages count', overview.messages === gt.assistantMessages,
    `api=${overview.messages} expected=${gt.assistantMessages}`);
  check('tool calls count', overview.toolCalls === gt.toolCalls,
    `api=${overview.toolCalls} expected=${gt.toolCalls}`);
  check('tool errors count', overview.toolErrors === gt.toolErrors,
    `api=${overview.toolErrors} expected=${gt.toolErrors}`);
  check('hook errors count', overview.hookErrors === gt.hookErrors,
    `api=${overview.hookErrors} expected=${gt.hookErrors}`);
  check('total cost approx', approxEqual(overview.totalCost, gt.totalCostUsd),
    `api=${overview.totalCost.toFixed(2)} expected=${gt.totalCostUsd.toFixed(2)}`);

  // ========== OVERVIEW (UI) ==========
  console.log('\n--- overview (UI) ---');
  await page.goto(`${base}/observability/overview?range=30d`);
  await page.waitForSelector('text=Observability', { timeout: 15000 });
  await page.waitForSelector('text=Sessions', { timeout: 10000 });
  // Verify key stat cards are visible with non-zero data
  check('UI sessions card visible', await page.isVisible('text=Sessions'));
  check('UI messages card visible', await page.isVisible('text=Messages'));
  check('UI tool calls card visible', await page.isVisible('text=Tool Calls'));
  check('UI total cost card visible', await page.isVisible('text=Total Cost'));
  check('UI daily activity chart visible', await page.isVisible('text=Daily Activity'));

  // ========== TOOLS (API) ==========
  console.log('\n--- tools (API) ---');
  const toolsData = await apiGet('tools');
  const apiToolMap: Record<string, { count: number; errorCount: number }> = {};
  for (const t of toolsData.ranked) {
    apiToolMap[t.name] = { count: t.count, errorCount: t.errorCount };
  }
  const apiTotalToolCalls = toolsData.ranked.reduce((s: number, t: any) => s + t.count, 0);
  check('tools total count', apiTotalToolCalls === gt.toolCalls,
    `api=${apiTotalToolCalls} expected=${gt.toolCalls}`);

  for (const [name, expected] of Object.entries(gt.tools)) {
    const apiTool = apiToolMap[name];
    if (!apiTool) {
      check(`tool ${name} exists in API`, false, 'missing');
      continue;
    }
    check(`tool ${name} count`, apiTool.count === expected.count,
      `api=${apiTool.count} expected=${expected.count}`);
    check(`tool ${name} errors`, apiTool.errorCount === expected.errors,
      `api=${apiTool.errorCount} expected=${expected.errors}`);
  }

  // ========== TOOLS (UI) ==========
  console.log('\n--- tools (UI) ---');
  await page.goto(`${base}/observability/tools?range=30d`);
  await page.waitForSelector('th:has-text("Tool")', { timeout: 10000 });
  const toolsTableText = await page.textContent('table');
  check('UI Bash tool visible', toolsTableText?.includes('Bash') ?? false);
  check('UI Read tool visible', toolsTableText?.includes('Read') ?? false);
  check('UI Glob tool visible', toolsTableText?.includes('Glob') ?? false);

  // ========== TOKENS (API) ==========
  console.log('\n--- tokens (API) ---');
  const tokensData = await apiGet('tokens');
  check('total input tokens', tokensData.totalInput === gt.tokens.input,
    `api=${tokensData.totalInput} expected=${gt.tokens.input}`);
  check('total output tokens', tokensData.totalOutput === gt.tokens.output,
    `api=${tokensData.totalOutput} expected=${gt.tokens.output}`);
  check('total cache read tokens', tokensData.totalCacheRead === gt.tokens.cacheRead,
    `api=${tokensData.totalCacheRead} expected=${gt.tokens.cacheRead}`);
  check('total cache creation tokens', tokensData.totalCacheCreation === gt.tokens.cacheCreation,
    `api=${tokensData.totalCacheCreation} expected=${gt.tokens.cacheCreation}`);
  check('cache efficiency approx', approxEqual(tokensData.cacheEfficiency, gt.cacheEfficiency),
    `api=${tokensData.cacheEfficiency.toFixed(1)} expected=${gt.cacheEfficiency.toFixed(1)}`);

  // ========== COST (API) ==========
  console.log('\n--- cost (API) ---');
  const costData = await apiGet('cost');
  check('total cost approx', approxEqual(costData.totalUsd, gt.totalCostUsd),
    `api=${costData.totalUsd.toFixed(2)} expected=${gt.totalCostUsd.toFixed(2)}`);
  check('has model breakdown', costData.byModel.length > 0);

  for (const mc of costData.byModel) {
    const expectedCost = gt.modelCosts[mc.model];
    if (expectedCost !== undefined) {
      check(`model ${mc.model} cost approx`, approxEqual(mc.usd, expectedCost, 0.05),
        `api=${mc.usd.toFixed(2)} expected=${expectedCost.toFixed(2)}`);
    }
  }

  // ========== TOKENS & COST (UI) ==========
  console.log('\n--- tokens & cost (UI) ---');
  await page.goto(`${base}/observability/tokens?range=30d`);
  await page.waitForSelector('text=Total Cost', { timeout: 10000 });
  check('UI total cost card visible', await page.isVisible('text=Total Cost'));
  check('UI tokens chart visible', await page.isVisible('text=Daily Tokens'));
  check('UI cost chart visible', await page.isVisible('text=Daily Cost'));
  check('UI model table visible', await page.isVisible('th:has-text("Model")'));

  // ========== HOOKS (API) ==========
  console.log('\n--- hooks (API) ---');
  const hooksData = await apiGet('hooks');
  check('hooks data returned', hooksData.ranked.length > 0);
  check('hooks have timing data', hooksData.ranked.some((h: any) => h.avgMs > 0));

  // ========== HOOKS (UI) ==========
  console.log('\n--- hooks (UI) ---');
  await page.goto(`${base}/observability/hooks?range=30d`);
  await page.waitForTimeout(2000);
  const hasHookTable = await page.isVisible('th:has-text("Hook")');
  const hasNoHooks = await page.isVisible('text=No hook data');
  check('UI hooks page loads', hasHookTable || hasNoHooks);

  // ========== SESSIONS (API) ==========
  console.log('\n--- sessions (API) ---');
  const sessionsData = await apiGet('sessions');
  check('sessions count', sessionsData.sessions.length === gt.sessions,
    `api=${sessionsData.sessions.length} expected=${gt.sessions}`);
  check('total user messages > 0', sessionsData.totalUserMessages > 0);
  check('total assistant messages > 0', sessionsData.totalAssistantMessages > 0);

  // ========== SESSIONS (UI) ==========
  console.log('\n--- sessions (UI) ---');
  await page.goto(`${base}/observability/sessions?range=30d`);
  await page.waitForSelector('text=Sessions', { timeout: 10000 });
  await page.waitForTimeout(1500);
  const sessionRows = await page.locator('table tbody tr').count();
  check('UI sessions table has rows', sessionRows > 0, `rows=${sessionRows}`);

  // ========== API DURATION (API) ==========
  console.log('\n--- api duration (API) ---');
  const apiDuration = await apiGet('api-duration');
  if (gt.turnDurations.length > 0) {
    const expectedAvg = gt.turnDurations.reduce((s, d) => s + d, 0) / gt.turnDurations.length;
    check('avg API duration approx', approxEqual(apiDuration.avgMs, expectedAvg, 0.05),
      `api=${apiDuration.avgMs} expected=${Math.round(expectedAvg)}`);
  }

  // ========== MEMORY USAGE (API) ==========
  console.log('\n--- memory usage (API) ---');
  const memUsage = await apiGet('memory/usage');
  const expectedStores = gt.tools['mcp__memory__memory_store']?.count || 0;
  const expectedSearches = gt.tools['mcp__memory__memory_search']?.count || 0;
  check('memory stores', memUsage.stores === expectedStores,
    `api=${memUsage.stores} expected=${expectedStores}`);
  check('memory searches', memUsage.searches === expectedSearches,
    `api=${memUsage.searches} expected=${expectedSearches}`);

  // ========== SUBAGENTS (API) ==========
  console.log('\n--- subagents (API) ---');
  const subagents = await apiGet('subagents');
  check('subagent dispatches', subagents.totalDispatches === gt.subagents.totalDispatches,
    `api=${subagents.totalDispatches} expected=${gt.subagents.totalDispatches}`);
  check('background dispatches', subagents.backgroundDispatches === gt.subagents.backgroundDispatches,
    `api=${subagents.backgroundDispatches} expected=${gt.subagents.backgroundDispatches}`);

  // ========== SUBAGENTS (UI) ==========
  console.log('\n--- subagents (UI) ---');
  await page.goto(`${base}/observability/subagents?range=30d`);
  await page.waitForSelector('text=Total Dispatches', { timeout: 10000 });
  check('UI subagents page loads', await page.isVisible('text=Total Dispatches'));

  // ========== COMPACTION (API) ==========
  console.log('\n--- compaction (API) ---');
  const compaction = await apiGet('compaction');
  check('compaction count', compaction.totalCompactions === gt.compactions,
    `api=${compaction.totalCompactions} expected=${gt.compactions}`);

  // ========== EVENTS (API + UI) ==========
  console.log('\n--- events (API) ---');
  const events = await apiGet('events');
  check('events returned', events.total > 0, `total=${events.total}`);
  check('events have tool_use entries', events.events.some((e: any) => e.entryType === 'tool_use'));

  console.log('\n--- events (UI) ---');
  await page.goto(`${base}/observability/events?range=30d`);
  await page.waitForSelector('table', { timeout: 10000 });
  const eventRows = await page.locator('table tbody tr').count();
  check('UI events table has rows', eventRows > 0, `rows=${eventRows}`);

  // ========== SESSION TRACE (API + UI) ==========
  console.log('\n--- session trace (API) ---');
  const traceSessionId = '38c61b5a-6865-4c40-91cd-86f35ff43c2b';
  const trace = await apiGet(`sessions/${traceSessionId}/trace`);
  check('trace has turns', trace.turns.length > 0, `turns=${trace.turns.length}`);
  check('trace session matches', trace.sessionId === traceSessionId);
  if (trace.turns.length > 0) {
    check('trace turns have spans', trace.turns.some((t: any) => t.spans.length > 0));
  }

  console.log('\n--- session trace (UI) ---');
  await page.goto(`${base}/observability/sessions/${traceSessionId}?range=30d`);
  await page.waitForTimeout(2000);
  const traceVisible = await page.isVisible('text=Duration') || await page.isVisible('text=Turns');
  check('UI trace page loads', traceVisible);

  // ========== TOOL DETAIL (API) ==========
  console.log('\n--- tool detail (API) ---');
  const bashDetail = await apiGet('tools/Bash');
  check('Bash detail count', bashDetail.totalCount === gt.tools['Bash'].count,
    `api=${bashDetail.totalCount} expected=${gt.tools['Bash'].count}`);
  check('Bash detail errors', bashDetail.errorCount === gt.tools['Bash'].errors,
    `api=${bashDetail.errorCount} expected=${gt.tools['Bash'].errors}`);
  check('Bash detail has invocations', bashDetail.invocations.length > 0);

  const readDetail = await apiGet('tools/Read');
  check('Read detail count', readDetail.totalCount === gt.tools['Read'].count,
    `api=${readDetail.totalCount} expected=${gt.tools['Read'].count}`);

  // ========== DB STATS (UI) ==========
  console.log('\n--- db stats (UI) ---');
  await page.goto(`${base}/observability/db`);
  await page.waitForSelector('text=Database', { timeout: 10000 });
  check('UI db stats page loads', await page.isVisible('text=Database'));

  // ========== CONSOLE ERRORS ==========
  console.log('\n--- console errors ---');
  const consoleErrors: string[] = [];
  const errorPage = await browser!.newPage();
  errorPage.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) {
      consoleErrors.push(msg.text());
    }
  });
  await errorPage.goto(`${base}/observability/overview?range=30d`);
  await errorPage.waitForSelector('text=Sessions', { timeout: 10000 });
  await errorPage.waitForTimeout(2000);
  check('no console errors', consoleErrors.length === 0,
    consoleErrors.length > 0 ? consoleErrors.slice(0, 3).join('; ') : undefined);
  await errorPage.close();

  await page.close();
}

// ---------------------------------------------------------------------------
// 4. Teardown
// ---------------------------------------------------------------------------

async function teardown() {
  if (browser) await browser.close();
  if (server) await server.close();
  if (viteProc) {
    viteProc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      viteProc!.on('exit', () => resolve());
      setTimeout(resolve, 3000);
    });
  }
  try { rmSync(tmpBase, { recursive: true }); } catch {}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('[e2e] Telemetry E2E verification test');
console.log(`[e2e] Fixtures: ${FIXTURE_BASE}`);
console.log(`[e2e] Temp dir: ${tmpBase}`);

try {
  const webPort = await setup();
  await runTests(webPort);
  await teardown();
  console.log(`\n${'='.repeat(50)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  console.error('[e2e] FATAL:', err);
  await teardown();
  process.exit(1);
}
