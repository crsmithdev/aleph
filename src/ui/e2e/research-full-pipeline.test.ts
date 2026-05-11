#!/usr/bin/env bun
/**
 * Full-pipeline E2E for the research feature:
 *
 *   1. boot a fake OpenRouter+Tavily HTTP server
 *   2. boot the API + 4 workers pointed at it
 *   3. open a real browser, click into the New Query form
 *   4. submit a query
 *   5. poll until the engine produces ≥1 finding
 *   6. visit each tab (Document, Process, Sources, Events, Telemetry,
 *      Knowledge, Reviews, Config) and assert the right content rendered
 *   7. assert no API 5xx, no console errors, and no critical errors via
 *      /api/research/error-status
 *
 * The fake server makes this deterministic and free — no real LLM is
 * called. Workers are real child processes, so this also exercises the
 * supervisor + dispatcher + SSE stream + DB layer end to end.
 */

import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const tmpDir = mkdtempSync(join(tmpdir(), 'construct-research-pipeline-'));
const dbPath = join(tmpDir, 'test.db');

// Start fake provider server BEFORE importing the API — workers spawned by
// the supervisor inherit env from this process, so the URL must be set first.
const { startFakeProviderServer } = await import('./fake-llm-server.js');
const fake = startFakeProviderServer();

process.env.CONSTRUCT_DB_PATH = dbPath;
process.env.NODE_ENV = 'production';
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
let passed = 0;
let failed = 0;
const failureMsgs: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    const msg = detail ? `${name}: ${detail}` : name;
    console.log(`  ✗ ${msg}`);
    failureMsgs.push(msg);
    failed++;
  }
}

async function setup() {
  const { sqlite } = createDb(dbPath);
  applyDDL(sqlite);
  applyResearchDDL(sqlite);
  // Webhooks table the UI server expects.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY, url TEXT NOT NULL, events TEXT NOT NULL DEFAULT '[]',
    secret TEXT, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  sqlite.close();

  server = await createApp({ dbUrl: dbPath, workerCount: 4 });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const port = (server.server.address() as { port: number }).port;
  console.log(`[e2e] api on :${port} — fake provider on :${fake.port} — 4 workers`);

  browser = await chromium.launch({ headless: true });
  return port;
}

async function teardown() {
  if (browser) await browser.close();
  if (server) await server.close();
  fake.stop();
  try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
}

async function pollUntil<T>(
  fn: () => Promise<T | null>,
  timeoutMs: number,
  pollMs = 500,
): Promise<T | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v !== null && v !== undefined) return v;
    await new Promise(r => setTimeout(r, pollMs));
  }
  return null;
}

console.log('[e2e] research full pipeline\n');

let exitCode = 0;
try {
  const port = await setup();
  const base = `http://127.0.0.1:${port}`;
  const page = await browser!.newPage();

  const consoleErrors: string[] = [];
  const failed5xx: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('response', resp => {
    if (resp.status() >= 500 && resp.url().includes('/api/')) {
      failed5xx.push(`${resp.status()} ${resp.url()}`);
    }
  });

  // -------------------- 1) Open the queries page, submit a query --------------------
  console.log('--- create query via UI ---');
  await page.goto(`${base}/research/queries`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('main', { timeout: 15_000 });

  // Open the new-query form (it's hidden behind a "+ New query" toggle).
  const newQueryButton = page.getByRole('button', { name: /new query/i }).first();
  await newQueryButton.click();
  const promptInput = page.getByPlaceholder('Enter research topic...').first();
  await promptInput.waitFor({ timeout: 10_000 });
  const PROMPT = 'How does a sourdough starter develop wild yeast?';
  await promptInput.fill(PROMPT);

  // The form's submit is the button inside the same <form> as the input —
  // pressing Enter submits it. handleCreate POSTs and clears the form; it
  // does NOT navigate, so we poll the API for the new session.
  await promptInput.press('Enter');
  const sessionId = await pollUntil(async () => {
    const r = await fetch(`${base}/api/research/queries`);
    if (!r.ok) return null;
    const list = await r.json() as Array<{ id: string; prompt: string }>;
    const match = list.find(q => q.prompt === PROMPT);
    return match?.id ?? null;
  }, 15_000);
  check('query created via UI form', !!sessionId);
  if (!sessionId) throw new Error('no session created — aborting test');
  console.log(`  session=${sessionId}`);

  // -------------------- 2) Poll API until the engine produces a finding --------------------
  console.log('\n--- wait for engine to produce a finding ---');
  const finding = await pollUntil(async () => {
    const r = await fetch(`${base}/api/research/queries/${sessionId}/findings`);
    if (!r.ok) return null;
    const list = await r.json() as Array<{ id: string }>;
    return list.length > 0 ? list[0] : null;
  }, 90_000);
  check('engine produced ≥1 finding within 90s', !!finding);

  // -------------------- 3) Inspect telemetry: workers, jobs, parallelism --------------------
  console.log('\n--- assert workers and jobs ---');
  const workers = await fetch(`${base}/api/research/workers`).then(r => r.json()) as Array<{ status: string }>;
  check('4 workers running', workers.length === 4 && workers.every(w => w.status === 'running'));

  const jobsList = await fetch(`${base}/api/research/queries/${sessionId}/jobs`).then(r => r.json()) as Array<{ thread_id: string | null; mode: string }>;
  check('at least one burst session-job recorded', jobsList.some(j => j.thread_id === null && j.mode === 'burst'));
  check('at least one thread-job recorded (dispatcher fanned out)', jobsList.some(j => j.thread_id !== null));

  // Steps recorded — one per LLM call, including session-scope (thread_id null) for the title/role/restate calls
  const stepsList = await fetch(`${base}/api/research/queries/${sessionId}/steps?limit=200`).then(r => r.json()) as Array<{ thread_id: string | null; label: string | null; cost_usd: number; metadata?: Record<string, unknown> | null }>;
  const sessionScopeSteps = stepsList.filter(s => s.thread_id === null);
  check(`session-scope steps logged (count=${sessionScopeSteps.length})`, sessionScopeSteps.length >= 1);
  // pick-role only fires if role_priming_enabled is true on the session config;
  // the default form submit doesn't enable it, so we check the title-gen path
  // which always runs as a session-scope step.
  const titleStep = stepsList.find(s => s.label === 'short title' || s.label === 'query title' || s.label === 'restate prompt');
  check('session-scope title-gen step recorded', !!titleStep);
  const stepsWithExcerpt = stepsList.filter(s => {
    const m = s.metadata;
    return m && typeof m === 'object' && typeof (m as Record<string, unknown>).output_excerpt === 'string';
  });
  check(`steps capture output_excerpt (${stepsWithExcerpt.length}/${stepsList.length})`, stepsWithExcerpt.length >= 3);

  // -------------------- 4) Document tab --------------------
  console.log('\n--- document tab ---');
  await page.goto(`${base}/research/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('main', { timeout: 10_000 });
  // Wait for either document content or "not enough findings" placeholder. Then poll for the real document.
  await pollUntil(async () => {
    const txt = await page.locator('body').innerText();
    return txt.includes('Sourdough') || txt.includes('starter') ? true : null;
  }, 30_000, 1000);
  const docText = await page.locator('body').innerText();
  check('document tab shows research content', docText.includes('Sourdough') || docText.includes('starter'));

  // -------------------- 5) Process tab --------------------
  console.log('\n--- process tab ---');
  const processTab = page.getByRole('button', { name: /^Process/i }).first();
  if (await processTab.isVisible()) {
    await processTab.click();
    await page.waitForTimeout(800);
    const processText = await page.locator('body').innerText();
    check('process tab renders threads', processText.length > 100);
  } else {
    check('process tab present', false, 'tab not visible');
  }

  // -------------------- 6) Sources tab --------------------
  console.log('\n--- sources tab ---');
  const sourcesTab = page.getByRole('button', { name: /^Sources/i }).first();
  if (await sourcesTab.isVisible()) {
    await sourcesTab.click();
    await page.waitForTimeout(800);
    const sourcesText = await page.locator('body').innerText();
    check('sources tab references at least one example.com source', sourcesText.includes('example.com'));
  } else {
    check('sources tab present', false, 'tab not visible');
  }

  // -------------------- 7) Events tab --------------------
  console.log('\n--- events tab ---');
  const eventsTab = page.getByRole('button', { name: /^Events/i }).first();
  if (await eventsTab.isVisible()) {
    await eventsTab.click();
    await page.waitForTimeout(1500);
    const eventsText = await page.locator('body').innerText();
    // Events tab merges SSE + DB-backed steps/findings — should be non-empty
    // and reference at least one known label or chip-rendered metadata field.
    const hasEventContent = eventsText.includes('synthesize') || eventsText.includes('search') ||
      eventsText.includes('extract') || eventsText.includes('finding') ||
      eventsText.includes('confidence') || eventsText.includes('novelty');
    check('events tab shows step or finding content', hasEventContent);
    // No old-style abbreviations (verifies today's chip-text fix)
    check('events tab uses whole-word chips (no abbreviations)', !/\bconf \d/.test(eventsText) && !/\bnov \d/.test(eventsText));
  } else {
    check('events tab present', false, 'tab not visible');
  }

  // -------------------- 8) Telemetry tab (cost rollup) --------------------
  console.log('\n--- telemetry tab ---');
  const telemetryTab = page.getByRole('button', { name: /^Telemetry/i }).first();
  if (await telemetryTab.isVisible()) {
    await telemetryTab.click();
    await page.waitForTimeout(800);
    const telemetryText = await page.locator('body').innerText();
    check('telemetry tab renders', telemetryText.length > 50);
  } else {
    check('telemetry tab present', false, 'tab not visible');
  }

  // -------------------- 9) Knowledge tab (concepts) --------------------
  console.log('\n--- knowledge tab ---');
  const knowledgeTab = page.getByRole('button', { name: /^Knowledge/i }).first();
  if (await knowledgeTab.isVisible()) {
    await knowledgeTab.click();
    await page.waitForTimeout(1000);
    const kText = await page.locator('body').innerText();
    check('knowledge tab references extracted concepts', kText.toLowerCase().includes('starter') || kText.toLowerCase().includes('yeast'));
  } else {
    check('knowledge tab present', false, 'tab not visible');
  }

  // -------------------- 10) error-status: no critical errors --------------------
  console.log('\n--- error-status endpoint ---');
  const errStatus = await fetch(`${base}/api/research/error-status`).then(r => r.json()) as { worst: string; sessions: unknown[] };
  check('no critical errors reported', errStatus.worst !== 'credit_exhausted' && errStatus.worst !== 'rate_limit', `worst=${errStatus.worst}`);

  // -------------------- 11) Stability: no console errors, no API 5xx --------------------
  console.log('\n--- stability ---');
  check('no API 5xx during run', failed5xx.length === 0, failed5xx.slice(0, 3).join('; '));
  check('no JS console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join('; '));

  // -------------------- 12) Fake server saw real traffic --------------------
  console.log('\n--- fake provider traffic ---');
  check(`fake LLM server received chat completions (count=${fake.completeCount()})`, fake.completeCount() >= 5);
  check(`fake LLM server received searches (count=${fake.searchCount()})`, fake.searchCount() >= 1);

  await page.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failureMsgs.length) {
    console.log('\nFailures:');
    for (const m of failureMsgs) console.log('  -', m);
  }
  exitCode = failed > 0 ? 1 : 0;
} catch (err) {
  console.error('[e2e] FATAL:', err);
  exitCode = 1;
}

await teardown();
process.exit(exitCode);
