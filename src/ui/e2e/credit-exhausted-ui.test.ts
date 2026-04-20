#!/usr/bin/env bun
/**
 * E2E: seed a credit_exhausted step, verify the banner and row indicator
 * render on the relevant pages. Proves the engine→API→UI path works end-to-end.
 */

import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

const nanoid = () => randomBytes(12).toString('hex');

const tmpDir = mkdtempSync(join(tmpdir(), 'construct-credit-e2e-'));
const dbPath = join(tmpDir, 'test.db');
process.env.CONSTRUCT_DB_PATH = dbPath;
process.env.NODE_ENV = 'production';

const { chromium } = await import('playwright');
const { createDb } = await import('@construct/data');
const { applyDDL } = await import('@construct/goals');
const { applyResearchDDL } = await import('@construct/research');
const { createApp } = await import('../api/src/app.js');

let server: Awaited<ReturnType<typeof createApp>> | null = null;
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
let passed = 0;
let failed = 0;

function check(name: string, ok: boolean) {
  if (ok) { console.log(`  \u2713 ${name}`); passed++; }
  else    { console.log(`  \u2717 ${name}`); failed++; }
}

async function setup() {
  const { sqlite } = createDb(dbPath);
  applyDDL(sqlite);
  applyResearchDDL(sqlite);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY, url TEXT NOT NULL, events TEXT NOT NULL DEFAULT '[]',
    secret TEXT, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')));`);

  const sessionId = nanoid();
  const threadId = nanoid();
  sqlite.prepare(`
    INSERT INTO research_queries (id, title, prompt, status, created_at, updated_at)
    VALUES (?, ?, ?, 'active', datetime('now'), datetime('now'))
  `).run(sessionId, 'Stuck on credits', 'Investigate renewable energy policy trends');

  sqlite.prepare(`
    INSERT INTO research_threads (id, session_id, query, status, priority, depth, origin, created_at, updated_at)
    VALUES (?, ?, ?, 'queued', 1.0, 0, 'seed', datetime('now'), datetime('now'))
  `).run(threadId, sessionId, 'test thread');

  // Credit exhaustion hit — recent
  for (let i = 0; i < 3; i++) {
    sqlite.prepare(`
      INSERT INTO research_steps
        (id, thread_id, session_id, model, prompt_tokens, completion_tokens, cost_usd, tool_calls, duration_ms, error, error_kind, created_at)
      VALUES (?, ?, ?, 'openrouter/deepseek', 0, 0, 0, '[]', 0, ?, 'credit_exhausted', datetime('now', ?))
    `).run(
      nanoid(), threadId, sessionId,
      'OpenRouter 402: requires more credits, or fewer max_tokens. You requested up to 8192 tokens, but can only afford 3439',
      `-${i * 30} seconds`,
    );
  }

  sqlite.close();

  server = await createApp({ dbUrl: dbPath, workerCount: 0 });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const port = (server.server.address() as any).port;
  console.log(`[e2e] server on :${port}`);
  browser = await chromium.launch({ headless: true });
  return { port, sessionId };
}

async function teardown() {
  if (browser) await browser.close();
  if (server) await server.close();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
}

console.log('[e2e] credit_exhausted UI surfacing\n');

let exitCode = 0;
try {
  const { port, sessionId } = await setup();
  const page = await browser!.newPage();
  const base = `http://127.0.0.1:${port}`;

  // --- API check: error-status endpoint returns the seeded error ---
  // First navigate so subsequent fetch() calls come from a same-origin context
  // (api CORS rejects null origin from blank pages).
  await page.goto(`${base}/summary`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const apiResponse = await page.evaluate(async () => {
    const r = await fetch(`/api/research/error-status`);
    return { status: r.status, body: await r.json() };
  });
  check('GET /api/research/error-status → 200', apiResponse.status === 200);
  check('  worst = credit_exhausted', apiResponse.body.worst === 'credit_exhausted');
  check('  returns 1 session entry', Array.isArray(apiResponse.body.sessions) && apiResponse.body.sessions.length === 1);
  check('  session_id matches seeded session', apiResponse.body.sessions?.[0]?.session_id === sessionId);

  // --- Queries list: row indicator ---
  console.log('\n--- queries list row indicator ---');
  await page.goto(`${base}/research/queries`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('text=Stuck on credits', { timeout: 10_000 });
  check('queries list renders seeded session', await page.isVisible('text=Stuck on credits'));
  check('row shows "Credits exhausted" badge', (await page.locator('text=Credits exhausted').count()) >= 1);

  // --- Global banner on any page ---
  console.log('\n--- global banner on /summary ---');
  await page.goto(`${base}/summary`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('[role="alert"]', { timeout: 10_000 });
  const bannerText = await page.locator('[role="alert"]').first().innerText();
  check('banner visible with "Credits exhausted"', bannerText.includes('Credits exhausted'));
  check('banner mentions affected session title', bannerText.includes('Stuck on credits'));
  check('banner has "Top up" link', (await page.locator('a:has-text("Top up")').count()) >= 1);

  // --- Session detail page still shows the banner (via Layout) ---
  console.log('\n--- session detail banner ---');
  await page.goto(`${base}/research/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('[role="alert"]', { timeout: 10_000 });
  check('banner visible on session detail', await page.isVisible('[role="alert"]'));

  await page.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  exitCode = failed > 0 ? 1 : 0;
} catch (err) {
  console.error('[e2e] FATAL:', err);
  exitCode = 1;
}

await teardown();
process.exit(exitCode);
