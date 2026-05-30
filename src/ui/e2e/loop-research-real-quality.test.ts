#!/usr/bin/env bun
/**
 * Phase 8 real-LLM quality gate.
 *
 * Runs the HSV/HPV corpus prompt against live OpenRouter (default mode,
 * cycles capped to 3 for cost) and asserts the v1 acceptance behavior:
 * output_shape was detected as 'table', renderer-as-gate produced an
 * actual markdown table, the artifact mentions the requested entities.
 *
 * Tavily is faked. Skips with exit 0 when OPENROUTER_API_KEY is missing
 * or placeholder.
 */
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

const realKey = process.env.OPENROUTER_API_KEY;
if (!realKey || realKey.startsWith('fake-') || realKey.startsWith('sk-test-')) {
  console.log('[e2e] OPENROUTER_API_KEY not set (or placeholder) — skipping real-LLM quality');
  process.exit(0);
}

const webDir = resolve(import.meta.dirname, '../web');
if (!existsSync(join(webDir, 'dist'))) {
  console.log('[quality] Building UI bundle…');
  const r = spawnSync('bun', ['run', 'build'], { cwd: webDir, stdio: 'inherit' });
  if (r.status !== 0) { console.error('[quality] FATAL: ui build failed'); process.exit(1); }
}

const tmpDir = mkdtempSync(join(tmpdir(), 'aleph-e2e-real-quality-'));
const dbPath = join(tmpDir, 'test.db');

const { startFakeProviderServer } = await import('./fake-llm-server.js');
const fake = startFakeProviderServer();

process.env.ALEPH_DB_PATH = dbPath;
process.env.NODE_ENV = 'production';
process.env.HOME = tmpDir;
process.env.TAVILY_BASE_URL = fake.baseUrl;
process.env.TAVILY_API_KEY = 'fake-tavily-key';
delete process.env.OPENROUTER_BASE_URL;

const { chromium } = await import('playwright');
const { createDb } = await import('@aleph/data');
const { applyDDL } = await import('@aleph/goals');
const { applyResearchDDL } = await import('@aleph/research');
const { createApp } = await import('../api/src/app.js');

let server: Awaited<ReturnType<typeof createApp>> | null = null;
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

async function setup() {
  const { sqlite } = createDb(dbPath);
  applyDDL(sqlite);
  applyResearchDDL(sqlite);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY, url TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '[]', secret TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  sqlite.close();

  server = await createApp({ dbUrl: dbPath });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const addr = server.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  const port = (addr as { port: number }).port;
  console.log(`[e2e] API port ${port}; real OpenRouter; fake Tavily on ${fake.baseUrl}`);
  browser = await chromium.launch({ headless: true });
  return { port };
}

const QUALITY_PROMPT =
  'Produce a markdown table comparing HSV-1, HSV-2, and HPV. ' +
  'Columns: primary route of transmission, vaccine availability, ' +
  'known association with cancer. One row per virus.';

async function runTests(port: number) {
  const page = await browser!.newPage();
  const baseUrl = `http://127.0.0.1:${port}`;
  let passed = 0, failed = 0;
  function check(name: string, ok: boolean, detail?: string) {
    if (ok) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`); failed++; }
  }

  console.log('\n--- POST /api/loops/start (HSV/HPV quality run, 3-cycle cap) ---');
  const t0 = Date.now();
  const startRes = await page.request.post(`${baseUrl}/api/loops/start`, {
    headers: { 'content-type': 'application/json' },
    data: {
      template_id: 'research',
      prompt: QUALITY_PROMPT,
      mode: 'default',
      envelope: { cycles: { count: 3 }, cost: { usd: 0.20 } },
    },
  });
  check('POST /api/loops/start → 201', startRes.status() === 201, `got ${startRes.status()}`);
  const { id: loopId } = await startRes.json() as { id: string };

  console.log('\n--- /research/:id and wait for completion ---');
  await page.goto(`${baseUrl}/research/${loopId}`);
  await page.waitForSelector('[data-testid="page-research-detail"]', { timeout: 20_000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="loop-status"]');
      return el && (el.textContent === 'completed' || el.textContent === 'failed');
    },
    null,
    { timeout: 360_000 },
  );
  const finalStatus = await page.locator('[data-testid="loop-status"]').textContent();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  check(`loop completed (${elapsed}s)`, finalStatus === 'completed', finalStatus ?? 'null');

  // Ensure a document artifact exists; the engine's post-completion polish
  // sometimes fails under transient OpenRouter 504s. Retry up to 3x.
  async function snapshot() {
    const r = await page.request.get(`${baseUrl}/api/loops/${loopId}`);
    return await r.json() as {
      loop: { envelope_consumed?: { cycles_count?: number; cost_usd?: number } };
      artifacts: Array<{ kind: string; payload: Record<string, unknown> }>;
    };
  }
  let body = await snapshot();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (body.artifacts.some(a => a.kind === 'document')) break;
    console.log(`  [regen ${attempt + 1}/3] no document artifact; calling regenerate-document`);
    await page.request.post(`${baseUrl}/api/loops/${loopId}/regenerate-document`);
    await new Promise(r => setTimeout(r, 3000));
    body = await snapshot();
  }

  check('cost_usd > 0', (body.loop.envelope_consumed?.cost_usd ?? 0) > 0,
    `cost_usd=${body.loop.envelope_consumed?.cost_usd ?? 0}`);
  check('at least one cycle ran', (body.loop.envelope_consumed?.cycles_count ?? 0) >= 1,
    `cycles=${body.loop.envelope_consumed?.cycles_count ?? 0}`);

  // Shape detection: schedule artifact must have output_shape kind 'table'.
  const schedule = body.artifacts.find(a => a.kind === 'schedule');
  const outputShape = (schedule?.payload as { output_shape?: { kind?: string } } | undefined)
    ?.output_shape?.kind;
  check('output_shape detected as table', outputShape === 'table',
    `output_shape=${outputShape ?? 'undefined'}`);

  // Markdown table syntax: a real table renders as pipe-delimited rows with a
  // header separator (`---`). The renderer-as-gate (Phase 3) is meant to
  // refuse "done" without one. Per-cycle output lives in cycle_output
  // artifacts (payload.render), final article in document artifacts.
  const allText = body.artifacts
    .filter(a => a.kind === 'cycle_output' || a.kind === 'document' || a.kind === 'milestone')
    .map(a => JSON.stringify(a.payload)).join('\n');
  const hasTablePipes = /\|.+\|/.test(allText);
  const hasTableSeparator = /\|\s*-{3,}\s*\|/.test(allText);
  check('rendered output contains markdown table syntax',
    hasTablePipes && hasTableSeparator,
    `pipes=${hasTablePipes}, separator=${hasTableSeparator}, len=${allText.length}, kinds=${body.artifacts.map(a => a.kind).join(',')}`);

  // Topical: the table should reference the requested entities.
  const mentionsHSV = /hsv-?[12]|herpes/i.test(allText);
  const mentionsHPV = /hpv|papilloma/i.test(allText);
  check('output mentions HSV-1/HSV-2 (or herpes)', mentionsHSV, `excerpt: ${allText.slice(0, 300)}`);
  check('output mentions HPV (or papilloma)', mentionsHPV);

  await page.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  return failed;
}

async function teardown() {
  if (browser) await browser.close();
  if (server) await server.close();
  fake.stop();
  try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
}

console.log('[e2e] Real-LLM quality — Phase 8 acceptance gate');
try {
  const { port } = await setup();
  const failures = await runTests(port);
  await teardown();
  process.exit(failures > 0 ? 1 : 0);
} catch (err) {
  console.error('[e2e] FATAL:', err);
  await teardown();
  process.exit(1);
}
