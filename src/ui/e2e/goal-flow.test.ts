#!/usr/bin/env bun
/**
 * E2E test: create a goal via MCP (simulating /goal), verify it appears in the web UI.
 *
 * Flow:
 * 1. Create a temp DB
 * 2. Insert a goal via @aleph/goals service functions (same path as MCP)
 * 3. Start the UI server against the same DB
 * 4. Use Playwright to navigate to /goals and verify the goal title appears
 * 5. Click into the goal detail page and verify title + priority
 * 6. Tear down
 */

import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const tmpDir = mkdtempSync(join(tmpdir(), 'aleph-e2e-'));
const dbPath = join(tmpDir, 'test.db');
process.env.ALEPH_DB_PATH = dbPath;
process.env.NODE_ENV = 'production';

// Dynamic imports after env vars are set
const { chromium } = await import('playwright');
const { createDb } = await import('@aleph/data');
const { applyDDL, createGoal, createTodo, EventBus, HistoryService } = await import('@aleph/goals');
const { createApp } = await import('../api/src/app.js');

let server: Awaited<ReturnType<typeof createApp>> | null = null;
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

async function setup() {
  // 1. Create DB and seed data via service functions (same as MCP path)
  const { db, sqlite } = createDb(dbPath);
  applyDDL(sqlite);

  // Webhooks DDL (needed by UI server)
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

  const eventBus = new EventBus();
  new HistoryService(db, eventBus).start();

  // Create test data
  const goal = createGoal(db, { title: 'Ship v2 release', priority: 'high' }, eventBus);
  const goal2 = createGoal(db, { title: 'Write documentation', priority: 'medium' }, eventBus);
  createTodo(db, { title: 'Review PR #42', dueDate: new Date().toISOString().slice(0, 10) }, eventBus);

  sqlite.close();

  console.log(`[e2e] Created test goals: "${goal.title}" (${goal.id}), "${goal2.title}" (${goal2.id})`);

  // 2. Start UI server
  server = await createApp({ dbUrl: dbPath });
  const address = await server.listen({ port: 0, host: '127.0.0.1' });
  const port = (server.server.address() as any).port;
  console.log(`[e2e] UI server listening on port ${port}`);

  // 3. Launch browser
  browser = await chromium.launch({ headless: true });

  return { port, goalId: goal.id, goal2Id: goal2.id };
}

async function runTests(port: number, goalId: string) {
  const page = await browser!.newPage();
  const baseUrl = `http://127.0.0.1:${port}`;
  let passed = 0;
  let failed = 0;

  function check(name: string, ok: boolean) {
    if (ok) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.log(`  ✗ ${name}`);
      failed++;
    }
  }

  // Test 1: Goals page loads and shows the goals
  console.log('\n--- goals page ---');
  await page.goto(`${baseUrl}/goals`);
  await page.waitForSelector('text=Ship v2 release', { timeout: 5000 });

  check('goals page loads', true);
  check('goal "Ship v2 release" visible', await page.isVisible('text=Ship v2 release'));
  check('goal "Write documentation" visible', await page.isVisible('text=Write documentation'));
  const highBadge = await page.locator('text=high').count();
  check('high priority badge visible', highBadge > 0);

  // Test 2: Click into goal detail
  console.log('\n--- goal detail ---');
  await page.click('text=Ship v2 release');
  await page.waitForSelector('text=Notes', { timeout: 5000 });

  check('goal detail page loads', await page.isVisible('text=Ship v2 release'));
  const detailHighBadge = await page.locator('text=high').count();
  check('priority shown on detail', detailHighBadge > 0);
  check('notes section exists', await page.isVisible('text=Notes'));
  check('history section exists', await page.isVisible('text=History'));

  // Test 3: Navigate to todos page
  console.log('\n--- todos page ---');
  await page.click('a[href="/todos"]');
  await page.waitForSelector('text=Review PR #42', { timeout: 5000 });

  check('todos page loads', true);
  check('todo "Review PR #42" visible', await page.isVisible('text=Review PR #42'));

  // Test 4: Navigate back to goals
  console.log('\n--- navigation ---');
  await page.click('a[href="/goals"]');
  await page.waitForSelector('text=Ship v2 release', { timeout: 5000 });
  check('back to goals works', await page.isVisible('text=Ship v2 release'));

  // Test 5: API returns correct data
  console.log('\n--- api ---');
  const apiResponse = await page.evaluate(async () => {
    const res = await fetch('/api/goals');
    return res.json();
  });
  check('API returns goals array', Array.isArray(apiResponse));
  check('API returns 2 goals', apiResponse.length === 2);
  check('API goal has correct title', apiResponse.some((g: any) => g.title === 'Ship v2 release'));

  await page.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  return failed;
}

async function teardown() {
  if (browser) await browser.close();
  if (server) await server.close();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
}

// --- Main ---
console.log('[e2e] Goal flow: MCP → UI end-to-end test');

try {
  const { port, goalId } = await setup();
  const failures = await runTests(port, goalId);
  await teardown();
  process.exit(failures > 0 ? 1 : 0);
} catch (err) {
  console.error('[e2e] FATAL:', err);
  await teardown();
  process.exit(1);
}
