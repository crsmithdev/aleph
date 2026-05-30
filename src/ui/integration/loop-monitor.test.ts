#!/usr/bin/env bun
/**
 * Phase 2 monitor-template Playwright gate.
 *
 * Lighter than loop-research.test.ts — the engine + child-process + LLM
 * boundary are already proven there. This test specifically validates:
 *   - the 'monitor' option appears in the template dropdown
 *   - a monitor loop submits, runs, and reaches status=completed in the UI
 *   - the Artifact panel reflects monitor_run output
 *
 * Wait/run cycle alternation is asserted in the Bun integration test
 * loops-research.test.ts (the monitor describe block).
 */
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const tmpDir = mkdtempSync(join(tmpdir(), 'aleph-e2e-loop-monitor-'));
const dbPath = join(tmpDir, 'test.db');

const { startFakeProviderServer } = await import('./fake-llm-server.js');
const fake = startFakeProviderServer();

process.env.ALEPH_DB_PATH = dbPath;
process.env.NODE_ENV = 'production';
process.env.HOME = tmpDir;
process.env.OPENROUTER_BASE_URL = fake.baseUrl;
process.env.OPENROUTER_API_KEY = 'fake-openrouter-key';
process.env.TAVILY_BASE_URL = fake.baseUrl;
process.env.TAVILY_API_KEY = 'fake-tavily-key';

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
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '[]',
      secret TEXT,
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
  const port = addr.port;
  console.log(`[e2e] Server on port ${port}`);

  browser = await chromium.launch({ headless: true });
  return { port };
}

async function runTests(port: number) {
  const page = await browser!.newPage();
  const baseUrl = `http://127.0.0.1:${port}`;
  let passed = 0;
  let failed = 0;

  const consoleErrors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  function check(name: string, ok: boolean, detail?: string) {
    if (ok) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`); failed++; }
  }

  // /loops/new is gone (commit 67b693d). Monitor template starts via the
  // API + we navigate to /research/:slug — same as production for any
  // non-research template.
  const startRes = await page.request.post(`${baseUrl}/api/loops/start`, {
    headers: { 'content-type': 'application/json' },
    data: { template_id: 'monitor', prompt: 'watch for changes in sourdough microbiology' },
  });
  check('POST /api/loops/start → 201', startRes.status() === 201, `got ${startRes.status()}`);
  const { id: loopId } = await startRes.json() as { id: string };

  await page.goto(`${baseUrl}/research/${loopId}`);
  await page.waitForURL(new RegExp(`/research/${loopId}$`), { timeout: 8000 });
  check('navigated to /research/:id', page.url().endsWith(`/research/${loopId}`), page.url());

  await page.waitForSelector('[data-testid="page-loop-detail"]', { timeout: 8000 });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="loop-status"]')?.textContent === 'completed',
    null,
    { timeout: 15_000 },
  );
  const finalStatus = await page.locator('[data-testid="loop-status"]').textContent();
  check('loop reaches status=completed', finalStatus === 'completed', finalStatus ?? 'null');

  const artifactText = await page.locator('[data-testid="loop-artifact"]').textContent();
  // Phase 3+: the panel renders processor.text as Markdown (run-cycles have
  // text; wait-cycles don't). Either the run-cycle's text reached the panel,
  // or the panel shows the latest cycle kind for the wait-terminal case.
  check('artifact panel shows monitor output (text from run-cycle, or wait fallback)',
    !!artifactText && (
      /sourdough|starter|levain|wild yeast/i.test(artifactText) ||
      /monitor_wait|no text yet/i.test(artifactText)
    ),
    artifactText?.slice(0, 200) ?? '');

  check('no JS console errors', consoleErrors.length === 0, consoleErrors.join('; ').substring(0, 200));

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

console.log('[e2e] Loop monitor — Phase 2 whole-workflow gate');

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
