#!/usr/bin/env bun
/**
 * E2E test: v1 loop engine via the UI.
 *
 * Phase 1 whole-workflow gate. Drives the new loop engine end-to-end through
 * a real browser:
 *   1. Open /loops/new
 *   2. Submit a noop loop
 *   3. Land on /loops/:id, verify the three panels render
 *   4. Watch the live Activity panel populate via SSE
 *   5. Verify the loop reaches status=completed
 *
 * The kill-and-resume scenario is exercised by the Bun integration test
 * loops-resume.test.ts in src/ui/api/src/__tests__/; here we focus on the
 * browser-observable happy path.
 */
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const tmpDir = mkdtempSync(join(tmpdir(), 'construct-e2e-loop-'));
const dbPath = join(tmpDir, 'test.db');
process.env.CONSTRUCT_DB_PATH = dbPath;
process.env.NODE_ENV = 'production';
process.env.HOME = tmpDir; // research-logger writes NDJSON under $HOME/.construct

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

  // Webhooks table (createApp's onReady applies this too, but the test
  // server's onReady fires after setup so we mirror the create here to keep
  // the bootstrap idempotent across both paths).
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

  // --- Start a noop loop via the API + navigate to its detail page ---
  // The /loops/new compose page was removed when the UI bridge folded the
  // loops engine into /research (commit 67b693d). The compose box now only
  // submits the `research` template; non-research templates exercise the
  // engine directly via POST /api/loops/start, then we navigate to the
  // /research/:slug detail view to verify rendering.
  console.log('\n--- POST /api/loops/start (noop) ---');
  const startRes = await page.request.post(`${baseUrl}/api/loops/start`, {
    headers: { 'content-type': 'application/json' },
    data: { template_id: 'noop' },
  });
  check('POST /api/loops/start → 201', startRes.status() === 201, `got ${startRes.status()}`);
  const { id: loopId } = await startRes.json() as { id: string };
  check('start returned a slug id', /^[a-z]+-[a-z]+-[a-z]+-[a-f0-9]+$/.test(loopId), loopId);

  console.log('\n--- /research/:id ---');
  await page.goto(`${baseUrl}/research/${loopId}`);
  await page.waitForURL(new RegExp(`/research/${loopId}$`), { timeout: 8000 });
  check('navigated to /research/:id', page.url().endsWith(`/research/${loopId}`), page.url());

  // --- Detail page ---
  await page.waitForSelector('[data-testid="page-loop-detail"]', { timeout: 8000 });
  check('three panels render',
    (await page.locator('[data-testid="loop-activity"]').count()) === 1 &&
    (await page.locator('[data-testid="loop-schedule"]').count()) === 1 &&
    (await page.locator('[data-testid="loop-artifact"]').count()) === 1,
  );

  // --- Activity populates from SSE ---
  console.log('\n--- live activity ---');
  await page.waitForSelector('[data-testid="loop-activity-list"]', { timeout: 8000 });
  // The noop loop runs 5 cycles in ~10ms; by the time we get here the loop
  // is likely already complete and the activity list has 25+ events.
  const liItems = await page.locator('[data-testid="loop-activity-list"] li').count();
  check('activity list has events', liItems > 0, `got ${liItems}`);

  // --- Loop reaches completed status ---
  console.log('\n--- completion ---');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="loop-status"]')?.textContent === 'completed',
    null,
    { timeout: 10_000 },
  );
  const finalStatus = await page.locator('[data-testid="loop-status"]').textContent();
  check('loop reaches status=completed', finalStatus === 'completed', finalStatus ?? 'null');

  // --- Artifact panel populates ---
  const artifactText = await page.locator('[data-testid="loop-artifact"]').textContent();
  check('artifact panel renders cycle output',
    !!artifactText && artifactText.includes('noop_proc'),
    artifactText?.slice(0, 100) ?? '',
  );

  // --- No console errors ---
  console.log('\n--- stability ---');
  check('no JS console errors', consoleErrors.length === 0, consoleErrors.join('; ').substring(0, 200));

  await page.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  return failed;
}

async function teardown() {
  if (browser) await browser.close();
  if (server) await server.close();
  try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
}

console.log('[e2e] Loop noop — Phase 1 whole-workflow gate');

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
