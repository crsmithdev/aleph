#!/usr/bin/env bun
/**
 * Phase 2 whole-workflow Playwright gate: research template via the UI.
 *
 *   1. Start a fake OpenRouter+Tavily server, point env at it
 *   2. Boot the API
 *   3. Open /loops/new in a real browser
 *   4. Pick 'research' from the template dropdown, type a prompt
 *   5. Submit, navigate to /loops/:id
 *   6. Watch the live Activity panel populate via SSE
 *   7. Verify the loop reaches status=completed
 *   8. Verify the Artifact panel renders the cycle's processor text (Markdown)
 *   9. Verify the fake LLM server was hit (search + complete counts > 0)
 *
 * The cycles_target override is enforced via a URL query param on the submit
 * page in case we want deterministic short runs in CI; the default of 3
 * cycles takes ~50ms against the in-process fake.
 */
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const tmpDir = mkdtempSync(join(tmpdir(), 'aleph-e2e-loop-research-'));
const dbPath = join(tmpDir, 'test.db');

// Start fake LLM BEFORE app boot — Bun.spawn snapshots env via the supervisor's
// explicit env: { ...process.env } so any mutation up to spawn time is visible
// to the child run.ts.
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
  console.log(`[e2e] Server on port ${port}; fake LLM on ${fake.baseUrl}`);

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

  const baseSearchCount = fake.searchCount();
  const baseCompleteCount = fake.completeCount();

  // --- Start a research loop via the API + navigate to /research/:slug ---
  // /loops/new is gone (commit 67b693d). The /research compose box submits
  // research-template loops directly to /api/loops/start; tests use the same
  // API entry point for parity with production and to avoid coupling to UI
  // form selectors that may evolve.
  console.log('\n--- POST /api/loops/start (research) ---');
  const startRes = await page.request.post(`${baseUrl}/api/loops/start`, {
    headers: { 'content-type': 'application/json' },
    data: { template_id: 'research', prompt: 'how does a sourdough starter develop?' },
  });
  check('POST /api/loops/start → 201', startRes.status() === 201, `got ${startRes.status()}`);
  const { id: loopId } = await startRes.json() as { id: string };
  check('start returned a slug id', /^[a-z]+-[a-z]+-[a-z]+-[a-f0-9]+$/.test(loopId), loopId);

  console.log('\n--- /research/:id ---');
  await page.goto(`${baseUrl}/research/${loopId}`);
  await page.waitForURL(new RegExp(`/research/${loopId}$`), { timeout: 8000 });
  check('navigated to /research/:id', page.url().endsWith(`/research/${loopId}`), page.url());
  await page.waitForSelector('[data-testid="page-loop-detail"]', { timeout: 8000 });
  check('three panels render',
    (await page.locator('[data-testid="loop-activity"]').count()) === 1 &&
    (await page.locator('[data-testid="loop-schedule"]').count()) === 1 &&
    (await page.locator('[data-testid="loop-artifact"]').count()) === 1,
  );

  // --- Activity populates from SSE ---
  console.log('\n--- live activity ---');
  await page.waitForSelector('[data-testid="loop-activity-list"]', { timeout: 8000 });
  const liItems = await page.locator('[data-testid="loop-activity-list"] li').count();
  check('activity list has events', liItems > 0, `got ${liItems}`);

  // --- Loop reaches completed status ---
  console.log('\n--- completion ---');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="loop-status"]')?.textContent === 'completed',
    null,
    { timeout: 15_000 },
  );
  const finalStatus = await page.locator('[data-testid="loop-status"]').textContent();
  check('loop reaches status=completed', finalStatus === 'completed', finalStatus ?? 'null');

  // --- Artifact panel reflects research output ---
  // Phase 3+: the panel renders processor.text as Markdown, not raw JSON.
  // Assert the synthesized text from the fake LLM (sourdough microbiology
  // boilerplate) lands in the panel.
  const artifactText = await page.locator('[data-testid="loop-artifact"]').textContent();
  check('artifact panel renders synthesized processor text',
    !!artifactText && /sourdough/i.test(artifactText),
    artifactText?.slice(0, 200) ?? '',
  );

  // --- Fake LLM server was actually hit (proves env redirection through the
  //     parent → API → child process chain worked) ---
  const finalSearchCount = fake.searchCount();
  const finalCompleteCount = fake.completeCount();
  check('fake LLM searchWeb path was hit',
    finalSearchCount > baseSearchCount,
    `search ${baseSearchCount} -> ${finalSearchCount}`);
  check('fake LLM complete path was hit',
    finalCompleteCount > baseCompleteCount,
    `complete ${baseCompleteCount} -> ${finalCompleteCount}`);

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
  fake.stop();
  try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
}

console.log('[e2e] Loop research — Phase 2 whole-workflow gate');

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
