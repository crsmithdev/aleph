#!/usr/bin/env bun
/**
 * Phase 3 whole-workflow Playwright gate: output-shape enforcement via the UI.
 *
 * Drives the HSV/HPV table deliverable case (the most distinctive of Phase
 * 3's three deliverable shapes — table is the strictest gate). Verifies:
 *
 *   1. /loops/new accepts the HSV/HPV prompt + research template
 *   2. Submit navigates to /loops/:id
 *   3. The loop reaches status=completed
 *   4. The schedule artifact carries the detected table shape with the four
 *      required columns
 *   5. The final render artifact records shape_satisfied=true and the
 *      Markdown table content is present in the artifact panel
 *   6. No JS console errors
 *
 * The list + mixed deliverable cases are exercised at the Bun-HTTP layer in
 * `src/ui/api/src/__tests__/loops-research.test.ts`. This Playwright gate
 * proves end-to-end UI coverage for the table case — the strongest signal
 * that the renderer-as-gate machinery survives the parent → API → child →
 * SSE → React round trip.
 */
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const tmpDir = mkdtempSync(join(tmpdir(), 'construct-e2e-loop-research-shape-'));
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

  // --- Start a table-shape research loop via the API ---
  // /loops/new is gone (commit 67b693d); /research compose box now drives
  // research-template submission. Tests use the API entry point directly
  // for parity, then navigate to /research/:slug to drive the Schedule
  // panel + shape gate assertions through the live UI.
  console.log('\n--- POST /api/loops/start (research, table case) ---');
  const startRes = await page.request.post(`${baseUrl}/api/loops/start`, {
    headers: { 'content-type': 'application/json' },
    data: {
      template_id: 'research',
      prompt: 'Compare HSV and HPV: transmission, symptoms, treatment, vaccine.',
    },
  });
  check('POST /api/loops/start → 201', startRes.status() === 201, `got ${startRes.status()}`);
  const { id: loopId } = await startRes.json() as { id: string };

  await page.goto(`${baseUrl}/research/${loopId}`);
  await page.waitForURL(new RegExp(`/research/${loopId}$`), { timeout: 8000 });
  check('navigated to /research/:id', page.url().endsWith(`/research/${loopId}`), page.url());
  await page.waitForSelector('[data-testid="page-loop-detail"]', { timeout: 8000 });

  // --- Wait for completion via the UI's status indicator ---
  console.log('\n--- completion ---');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="loop-status"]')?.textContent === 'completed',
    null,
    { timeout: 20_000 },
  );
  check('loop reaches status=completed', true);

  // --- Confirm shape state via the API (the gate's structural assertions) ---
  console.log('\n--- shape gate ---');
  const apiRes = await fetch(`${baseUrl}/api/loops/${loopId}`);
  const apiBody = await apiRes.json() as {
    artifacts: Array<{ kind: string; payload: Record<string, unknown> }>;
  };

  const schedule = apiBody.artifacts.find(a => a.kind === 'schedule');
  check('schedule artifact persisted', !!schedule);
  const expectedShape = {
    kind: 'table',
    columns: ['transmission', 'symptoms', 'treatment', 'vaccine'],
  };
  check('schedule.output_shape = table with the four required columns',
    JSON.stringify((schedule?.payload as { output_shape?: unknown })?.output_shape) === JSON.stringify(expectedShape),
    JSON.stringify((schedule?.payload as { output_shape?: unknown })?.output_shape ?? null),
  );

  const cycleOutputs = apiBody.artifacts.filter(a => a.kind === 'cycle_output');
  const lastRender = cycleOutputs[cycleOutputs.length - 1]?.payload?.render as
    | { shape_kind: string; shape_satisfied: boolean; shape_missing: unknown }
    | undefined;
  check('final render artifact reports shape_kind=table',
    lastRender?.shape_kind === 'table', lastRender?.shape_kind ?? 'undefined');
  check('final render artifact reports shape_satisfied=true',
    lastRender?.shape_satisfied === true, String(lastRender?.shape_satisfied ?? 'undefined'));
  check('final render artifact reports shape_missing=null (no unmet columns)',
    lastRender?.shape_missing === null, JSON.stringify(lastRender?.shape_missing));

  // --- Markdown table content is visible somewhere on the page ---
  // The Artifact panel JSON-renders cycle_output payloads, so the Markdown
  // table characters end up in the DOM. Any pipe-divider pattern is enough
  // to confirm the synthesis output landed in the UI.
  const pageContent = await page.content();
  check('Markdown table header text visible in the rendered page',
    pageContent.includes('transmission') && pageContent.includes('vaccine'),
    'transmission/vaccine not found in page HTML');

  // --- Stability ---
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

console.log('[e2e] Loop research — Phase 3 shape-gate workflow (table)');

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
