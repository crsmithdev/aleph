#!/usr/bin/env bun
/**
 * Phase 8 real-LLM smoke gate.
 *
 * Hits live OpenRouter (engine default: google/gemini-2.0-flash-001) to
 * prove the loop round-trips a real provider end-to-end. Tavily is faked
 * — this gate is about LLM connectivity; search infrastructure is already
 * exercised by the fake-LLM suite.
 *
 * Skips with exit 0 when OPENROUTER_API_KEY is missing or looks like a
 * test placeholder, so CI on forked PRs without secrets doesn't fail.
 */
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

const realKey = process.env.OPENROUTER_API_KEY;
if (!realKey || realKey.startsWith('fake-') || realKey.startsWith('sk-test-')) {
  console.log('[e2e] OPENROUTER_API_KEY not set (or placeholder) — skipping real-LLM smoke');
  process.exit(0);
}

const webDir = resolve(import.meta.dirname, '../web');
if (!existsSync(join(webDir, 'dist'))) {
  console.log('[smoke] Building UI bundle…');
  const r = spawnSync('bun', ['run', 'build'], { cwd: webDir, stdio: 'inherit' });
  if (r.status !== 0) { console.error('[smoke] FATAL: ui build failed'); process.exit(1); }
}

const tmpDir = mkdtempSync(join(tmpdir(), 'aleph-e2e-real-smoke-'));
const dbPath = join(tmpDir, 'test.db');

// Only Tavily is faked. Do NOT set OPENROUTER_BASE_URL — provider falls
// through to openrouter.ai.
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

async function runTests(port: number) {
  const page = await browser!.newPage();
  const baseUrl = `http://127.0.0.1:${port}`;
  let passed = 0, failed = 0;
  function check(name: string, ok: boolean, detail?: string) {
    if (ok) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`); failed++; }
  }

  console.log('\n--- POST /api/loops/start (1-cycle smoke) ---');
  const t0 = Date.now();
  const startRes = await page.request.post(`${baseUrl}/api/loops/start`, {
    headers: { 'content-type': 'application/json' },
    data: {
      template_id: 'research',
      prompt: 'Briefly: what is sourdough fermentation?',
      envelope: { cycles: { count: 1 }, cost: { usd: 0.10 } },
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
    { timeout: 240_000 },
  );
  const finalStatus = await page.locator('[data-testid="loop-status"]').textContent();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  check(`loop completed against real OpenRouter (${elapsed}s)`,
    finalStatus === 'completed', finalStatus ?? 'null');

  // Engine-level invariants: cycle ran, at least one artifact persisted,
  // topical text reached the artifact store. UI rendering is tested by
  // ui:smoke — here we care that the real provider produced durable output.
  const loopRes = await page.request.get(`${baseUrl}/api/loops/${loopId}`);
  const body = await loopRes.json() as {
    loop: { envelope_consumed?: { cycles_count?: number; cost_usd?: number } };
    artifacts: Array<{ kind: string; payload: unknown }>;
  };
  check('at least one cycle completed',
    (body.loop.envelope_consumed?.cycles_count ?? 0) >= 1,
    `cycles=${body.loop.envelope_consumed?.cycles_count ?? 0}`);
  check('cost_usd > 0 (priced LLM call landed)',
    (body.loop.envelope_consumed?.cost_usd ?? 0) > 0,
    `cost_usd=${body.loop.envelope_consumed?.cost_usd ?? 0}`);

  const kinds = body.artifacts.map(a => a.kind);
  check('engine emitted artifacts', body.artifacts.length > 0,
    `kinds=${kinds.join(',')}`);

  // Topicality: any artifact's serialized payload should mention the topic.
  // A real-LLM run on "sourdough fermentation" emits extraction, synthesis,
  // render, or document text that hits at least one of these keywords.
  const allText = body.artifacts.map(a => JSON.stringify(a.payload)).join('\n');
  const topical = /(sourdough|ferment|yeast|bacteria|starter|microb|dough|flour)/i.test(allText);
  check('artifact corpus is topical (real LLM produced relevant content)',
    topical, `corpus length=${allText.length}, kinds=${kinds.join(',')}`);

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

console.log('[e2e] Real-LLM smoke — Phase 8 acceptance gate');
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
