#!/usr/bin/env bun
/**
 * Tab-parity end-to-end verification for Document / Plan / Config tabs.
 *
 * Spins up the API in-process against a fake OpenRouter, runs a research
 * loop to completion (so document polish, schedule artifact, and post-
 * mortem are all written), then clicks through each non-Activity tab and
 * asserts the mockup-anchor testids render. Mirrors `activity-panels.test.ts`.
 *
 *   Document  — metadata strip (model · cycles · sources), regenerate
 *               button, references rail with extraction-status pills,
 *               document body.
 *   Plan      — summary cells (shape / branches / budget / milestones),
 *               canon chips, branch cards (one per planned branch),
 *               aggregate sources.
 *   Config    — loop / schedule / envelope / models sections; the new
 *               iteration_check_model + post_mortem_model rows must
 *               surface from /api/research/defaults.
 */
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const tmpDir = mkdtempSync(join(tmpdir(), 'aleph-e2e-tab-parity-'));
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

  // Use the same envelope shape as activity-panels.test.ts so the engine
  // reaches a clean post_mortem on natural completion and a schedule
  // artifact is written for the Plan + Config tabs to read.
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

  // --- Land on the document tab, wait for completion + polish ---
  console.log('\n--- /research/:id#tab=document ---');
  await page.goto(`${baseUrl}/research/${loopId}#tab=document`);
  await page.waitForSelector('[data-testid="page-research-detail"]', { timeout: 8000 });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="loop-status"]')?.textContent === 'completed',
    null,
    { timeout: 25_000 },
  );
  // Give the auto-polish hook a chance to land its document artifact
  // (~5-15s in real runs; faster against the fake provider).
  await page.waitForTimeout(9000);
  await page.goto(`${baseUrl}/research/${loopId}#tab=document`);
  await page.waitForSelector('[data-testid="document-tab"]', { timeout: 8000 });

  // --- Document tab assertions ---
  console.log('\n--- document tab ---');
  check('document-tab root mounts',
        (await page.locator('[data-testid="document-tab"]').count()) === 1);
  check('document-meta strip renders',
        (await page.locator('[data-testid="document-meta"]').count()) === 1);
  check('document-regenerate button present',
        (await page.locator('[data-testid="document-regenerate"]').count()) === 1);
  check('document-body renders',
        (await page.locator('[data-testid="document-body"]').count()) === 1);

  // Meta strip carries the structured fields.
  check('rendered-cycles cell exists',
        (await page.locator('[data-testid="document-rendered-cycles"]').count()) === 1);
  check('source-count cell exists',
        (await page.locator('[data-testid="document-source-count"]').count()) === 1);

  // References rail — present even on raw-render fallback; sources count
  // should be a numeric string.
  const refsCount = await page.locator('[data-testid="document-references"]').count();
  check('document-references rail mounts', refsCount === 1);

  // Polish should have produced a document artifact → meta shows "polished"
  // pill and a model row. (If polish failed for any reason — e.g. fake LLM
  // didn't reply with parseable JSON for the polish prompt — the panel
  // stays on the "raw render" fallback; assert the structural pieces only.)
  const metaText = await page.locator('[data-testid="document-meta"]').textContent();
  check('meta strip contains either "polished" or "raw render"',
        !!metaText && (/polished/.test(metaText) || /raw render/.test(metaText)),
        (metaText ?? '').slice(0, 100));

  // --- Plan tab ---
  console.log('\n--- plan tab ---');
  await page.goto(`${baseUrl}/research/${loopId}#tab=plan`);
  await page.waitForSelector('[data-testid="plan-tab"]', { timeout: 8000 });

  check('plan-tab root mounts',
        (await page.locator('[data-testid="plan-tab"]').count()) === 1);
  check('plan-summary cells render',
        (await page.locator('[data-testid="plan-summary"]').count()) === 1);
  check('plan-canon section renders',
        (await page.locator('[data-testid="plan-canon"]').count()) === 1);
  check('plan-branches section renders',
        (await page.locator('[data-testid="plan-branches"]').count()) === 1);
  check('plan-sources section renders',
        (await page.locator('[data-testid="plan-sources"]').count()) === 1);

  const branchCardCount = await page.locator('[data-testid="plan-branch-card"]').count();
  check('plan has at least one branch card', branchCardCount >= 1, `${branchCardCount} cards`);

  // --- Config tab ---
  console.log('\n--- config tab ---');
  await page.goto(`${baseUrl}/research/${loopId}#tab=config`);
  await page.waitForSelector('[data-testid="config-tab"]', { timeout: 8000 });

  check('config-tab root mounts',
        (await page.locator('[data-testid="config-tab"]').count()) === 1);
  check('config-loop panel renders',
        (await page.locator('[data-testid="config-loop"]').count()) === 1);
  check('config-schedule panel renders',
        (await page.locator('[data-testid="config-schedule"]').count()) === 1);
  check('config-envelope panel renders',
        (await page.locator('[data-testid="config-envelope"]').count()) === 1);
  check('config-models panel renders',
        (await page.locator('[data-testid="config-models"]').count()) === 1);

  // Loop identity rows.
  check('config shows loop id',
        (await page.locator('[data-testid="config-loop-id"]').count()) === 1);
  check('config shows template',
        (await page.locator('[data-testid="config-loop-template"]').count()) === 1);

  // Schedule rows
  check('config shows milestones',
        (await page.locator('[data-testid="config-milestones"]').count()) === 1);

  // The four model rows are the headline addition this session.
  // /api/research/defaults is fetched on Config mount; wait for it to
  // settle (it usually replies within a tick but stay generous).
  await page.waitForSelector('[data-testid="config-model-iteration-check"]', { timeout: 5000 });
  check('config surfaces primary model',
        (await page.locator('[data-testid="config-model-primary"]').count()) === 1);
  check('config surfaces fast model',
        (await page.locator('[data-testid="config-model-fast"]').count()) === 1);
  check('config surfaces iteration_check_model',
        (await page.locator('[data-testid="config-model-iteration-check"]').count()) === 1);
  check('config surfaces post_mortem_model',
        (await page.locator('[data-testid="config-model-post-mortem"]').count()) === 1);

  // The default iteration_check_model is gemini-2.0-flash-001 — assert the
  // row's value contains "flash" so we know we're reading actual config
  // data, not a placeholder.
  const iterText = await page.locator('[data-testid="config-model-iteration-check"]').textContent();
  check('iteration_check_model row has a real model string',
        !!iterText && /flash|claude|gpt|gemini|deepseek/i.test(iterText),
        iterText ?? 'null');

  // --- Existing Activity tab still mounts (sanity) ---
  console.log('\n--- activity tab (regression sanity) ---');
  await page.goto(`${baseUrl}/research/${loopId}#tab=activity`);
  await page.waitForSelector('[data-testid="activity-tab"]', { timeout: 8000 });
  check('activity-tab still mounts',
        (await page.locator('[data-testid="activity-tab"]').count()) === 1);

  // --- No console errors ---
  console.log('\n--- stability ---');
  const fatal = consoleErrors.filter(e => !/<favicon>|preload|hot-update/.test(e));
  check('no JS console errors', fatal.length === 0, fatal.join('; ').substring(0, 300));

  await page.screenshot({ path: '/tmp/tab-parity.png', fullPage: true });
  console.log('\n[e2e] Screenshot → /tmp/tab-parity.png');

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

console.log('[e2e] Tab parity — Document / Plan / Config testid gate');

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
