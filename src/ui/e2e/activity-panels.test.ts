#!/usr/bin/env bun
/**
 * Activity-tab end-to-end verification.
 *
 * Spins up the API in-process against a fake OpenRouter, starts a research
 * loop with a 3-cycle envelope so milestones fire (engine emits at 25/50/75%
 * of cycles_count), waits for completion, and asserts that all four Activity
 * panels render in the browser:
 *
 *   - post-mortem        — written by run.ts on natural completion
 *   - iteration-checks   — written by engine at each milestone
 *   - source-extraction  — derived from the latest render artifact's sources
 *   - decisions          — accumulated from planner + derivation emissions
 *
 * The KPI strip + Cycle Lifecycle + Branch State + Event Log are sanity-
 * checked too (they were already shipping; this just confirms they didn't
 * regress under the panel additions).
 */
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const tmpDir = mkdtempSync(join(tmpdir(), 'construct-e2e-activity-'));
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

  // Cycles-based envelope: milestones cross 25/50/75% of 4 cycles → fire at
  // cycle 1, 2, 3. That gives the engine 3 iteration_check artifacts to
  // write, and the loop's stop_rule (cycles_target=3) terminates naturally
  // before envelope exhaustion → post_mortem fires.
  console.log('\n--- POST /api/loops/start (research, cycles envelope) ---');
  const startRes = await page.request.post(`${baseUrl}/api/loops/start`, {
    headers: { 'content-type': 'application/json' },
    data: {
      template_id: 'research',
      prompt: 'how does a sourdough starter develop?',
      envelope: { cycles: { count: 4 } },
      cycles_target: 3,
    },
  });
  check('POST /api/loops/start → 201', startRes.status() === 201, `got ${startRes.status()}`);
  const { id: loopId } = await startRes.json() as { id: string };
  check('start returned a slug id', /^[a-z]+-[a-z]+-[a-z]+-[a-f0-9]+$/.test(loopId), loopId);

  console.log('\n--- /research/:id#tab=activity ---');
  await page.goto(`${baseUrl}/research/${loopId}#tab=activity`);
  await page.waitForSelector('[data-testid="page-research-detail"]', { timeout: 8000 });
  await page.waitForSelector('[data-testid="activity-tab"]', { timeout: 8000 });
  check('navigated to Activity tab', true);

  // --- Wait for completion ---
  console.log('\n--- completion ---');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="loop-status"]')?.textContent === 'completed',
    null,
    { timeout: 25_000 },
  );
  const finalStatus = await page.locator('[data-testid="loop-status"]').textContent();
  check('loop reaches status=completed', finalStatus === 'completed', finalStatus ?? 'null');

  // The frontend's auto-refetch on terminal status is 8s delayed (to let the
  // optional document polish land). Wait that window out, then force a fresh
  // page load so the snapshot includes the post_mortem + all cycle_outputs.
  await page.waitForTimeout(9000);
  await page.goto(`${baseUrl}/research/${loopId}#tab=activity`);
  await page.waitForSelector('[data-testid="activity-tab"]', { timeout: 8000 });
  await page.waitForTimeout(2000);

  // --- Sanity: pre-existing panels still render ---
  console.log('\n--- sanity (existing panels) ---');
  check('activity-kpis renders',         (await page.locator('[data-testid="activity-kpis"]').count()) === 1);
  check('cycle-lifecycle renders',       (await page.locator('[data-testid="cycle-lifecycle"]').count()) === 1);
  check('branch-state renders',          (await page.locator('[data-testid="branch-state"]').count()) === 1);
  check('event-log renders',             (await page.locator('[data-testid="event-log"]').count()) === 1);

  // --- The four new panels ---
  console.log('\n--- new panels ---');
  check('post-mortem panel renders',     (await page.locator('[data-testid="post-mortem"]').count()) === 1,
        await page.locator('[data-testid="activity-tab"]').textContent().then(t => t?.slice(0, 200) ?? ''));
  check('iteration-checks panel renders',(await page.locator('[data-testid="iteration-checks"]').count()) === 1);
  check('decisions panel renders',       (await page.locator('[data-testid="decisions"]').count()) === 1);

  // Source extraction renders ONLY when the LATEST render artifact carries
  // sources. The latest-render lookup walks artifacts in insertion order and
  // takes the last eligible entry (SQLite second-precision created_at means
  // same-second cycles tie, so strict-greater comparisons would lock onto
  // cycle 0's empty render). Assert that contract here.
  const apiResp = await page.request.get(`${baseUrl}/api/loops/${loopId}`);
  const apiData = await apiResp.json() as { artifacts: Array<{ kind: string; payload: Record<string, unknown> }> };
  let latestSourceCount = 0;
  for (const a of apiData.artifacts) {
    if (a.kind === 'render') {
      latestSourceCount = ((a.payload as { sources?: unknown[] }).sources?.length ?? 0);
    } else if (a.kind === 'cycle_output') {
      const renderInner = (a.payload as { render?: { sources?: unknown[]; findings?: unknown[] } }).render;
      if (renderInner && Array.isArray(renderInner.findings)) {
        latestSourceCount = renderInner.sources?.length ?? 0;
      }
    }
  }
  const sourcePanelCount = await page.locator('[data-testid="source-extraction"]').count();
  check('source-extraction panel renders iff latest render has sources',
        (latestSourceCount > 0) === (sourcePanelCount === 1),
        `latestSources=${latestSourceCount} panelMounted=${sourcePanelCount === 1}`);

  // --- Cost KPI carries a non-zero number (validates the cost-sum engine fix) ---
  console.log('\n--- cost flowed into envelope ---');
  const costCell = await page.locator('[data-testid="kpi-cost"]').textContent();
  check('Cost KPI is non-zero', !!costCell && /\$[0-9]+\.[0-9]+/.test(costCell) && !/\$0\.0000/.test(costCell),
        costCell ?? 'null');

  // --- Iteration checks: at least one verdict row ---
  const iterCount = await page.locator('[data-testid="iteration-checks-list"] li').count();
  check('iteration-checks lists at least one verdict', iterCount >= 1, `${iterCount} rows`);

  // --- Decisions: at least one decision row ---
  const decCount = await page.locator('[data-testid="decisions-list"] li').count();
  check('decisions list has at least one row', decCount >= 1, `${decCount} rows`);

  // --- Event log shows decision events ---
  const decisionFilter = page.locator('[data-testid="event-log-filters"] button', { hasText: 'decision' });
  check('event log has a decision filter pill', (await decisionFilter.count()) >= 1);

  // --- No console errors ---
  console.log('\n--- stability ---');
  // Filter out non-fatal console warnings from sub-mounting flows.
  const fatal = consoleErrors.filter(e => !/<favicon>|preload|hot-update/.test(e));
  check('no JS console errors', fatal.length === 0, fatal.join('; ').substring(0, 300));

  // --- Screenshot for the record ---
  await page.screenshot({ path: '/tmp/activity-panels.png', fullPage: true });
  console.log('\n[e2e] Screenshot → /tmp/activity-panels.png');

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

console.log('[e2e] Activity tab — four-panel render gate');

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
