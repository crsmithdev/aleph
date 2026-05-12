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

const tmpDir = mkdtempSync(join(tmpdir(), 'construct-e2e-loop-monitor-'));
const dbPath = join(tmpDir, 'test.db');

const { startFakeProviderServer } = await import('./fake-llm-server.js');
const fake = startFakeProviderServer();

process.env.CONSTRUCT_DB_PATH = dbPath;
process.env.NODE_ENV = 'production';
process.env.HOME = tmpDir;
process.env.OPENROUTER_BASE_URL = fake.baseUrl;
process.env.OPENROUTER_API_KEY = 'fake-openrouter-key';
process.env.TAVILY_BASE_URL = fake.baseUrl;
process.env.TAVILY_API_KEY = 'fake-tavily-key';

const { chromium } = await import('playwright');
const { createDb } = await import('@construct/data');
const { applyDDL } = await import('@construct/goals');
const { applyResearchDDL } = await import('@construct/research');
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

  server = await createApp({ dbUrl: dbPath, workerCount: 0 });
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

  await page.goto(`${baseUrl}/loops/new`);
  await page.waitForSelector('[data-testid="loop-new-form"]', { timeout: 8000 });

  await page.locator('[data-testid="loop-new-template"]').selectOption('monitor');
  check('template select has monitor option',
    (await page.locator('[data-testid="loop-new-template"]').inputValue()) === 'monitor');
  await page.locator('[data-testid="loop-new-prompt"]').fill('watch for changes in sourdough microbiology');

  await page.locator('[data-testid="loop-new-submit"]').click();
  await page.waitForURL(/\/loops\/[a-f0-9-]{36}$/, { timeout: 8000 });
  check('navigated to /loops/:id', true);

  await page.waitForSelector('[data-testid="page-loop-detail"]', { timeout: 8000 });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="loop-status"]')?.textContent === 'completed',
    null,
    { timeout: 15_000 },
  );
  const finalStatus = await page.locator('[data-testid="loop-status"]').textContent();
  check('loop reaches status=completed', finalStatus === 'completed', finalStatus ?? 'null');

  const artifactText = await page.locator('[data-testid="loop-artifact"]').textContent();
  check('artifact panel shows monitor output',
    !!artifactText && (artifactText.includes('monitor_run') || artifactText.includes('monitor_wait')),
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
