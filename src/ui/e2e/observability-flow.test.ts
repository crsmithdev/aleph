#!/usr/bin/env bun
/**
 * E2E test: Observability dashboard with real JSONL data and a real browser.
 *
 * 1. Create temp DB with seeded obs_memory_snapshots
 * 2. Start API server (reads real ~/.claude/projects JSONL files)
 * 3. Start Vite dev server (proxies /api to API server)
 * 4. Playwright navigates /observability, verifies all tabs render with real data
 * 5. Tear down
 */

import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Database } from 'bun:sqlite';
import { spawn, type ChildProcess } from 'child_process';

const tmpDir = mkdtempSync(join(tmpdir(), 'construct-obs-e2e-'));
const dbPath = join(tmpDir, 'test.db');
process.env.CONSTRUCT_DB_PATH = dbPath;

const { chromium } = await import('playwright');
const { createApp } = await import('../api/src/app.js');

let server: Awaited<ReturnType<typeof createApp>> | null = null;
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
let viteProc: ChildProcess | null = null;
let passed = 0;
let failed = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    console.log(`  \u2713 ${name}`);
    passed++;
  } else {
    console.log(`  \u2717 ${name}`);
    failed++;
  }
}

async function setup() {
  // Seed DB
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS obs_memory_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      taken_at TEXT NOT NULL DEFAULT (datetime('now')),
      total INTEGER NOT NULL,
      by_type TEXT NOT NULL,
      health TEXT NOT NULL,
      by_tag TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_obs_memory_taken_at ON obs_memory_snapshots(taken_at);
  `);

  const insert = db.prepare(
    'INSERT INTO obs_memory_snapshots (taken_at, total, by_type, health, by_tag) VALUES (?, ?, ?, ?, ?)',
  );
  insert.run(
    '2026-03-20T10:00:00Z', 30,
    JSON.stringify({ decision: 10, pattern: 8, observation: 7, error: 5 }),
    JSON.stringify({ score: 0.85, stale: 4 }),
    JSON.stringify({ session_context: 15, decision: 10, preference: 5 }),
  );
  insert.run(
    '2026-03-21T10:00:00Z', 35,
    JSON.stringify({ decision: 12, pattern: 9, observation: 8, error: 6 }),
    JSON.stringify({ score: 0.88, stale: 3 }),
    JSON.stringify({ session_context: 18, decision: 12, preference: 5 }),
  );
  db.close();

  // Start API on port 3001 (matching vite proxy config)
  server = await createApp({ dbUrl: dbPath });
  await server.listen({ port: 3001, host: '127.0.0.1' });
  console.log('[e2e] API server on port 3001');

  // Start Vite dev server
  viteProc = spawn('npx', ['vite', '--port', '5199', '--strictPort'], {
    cwd: join(import.meta.dir, '../web'),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const vitePort = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Vite startup timeout')), 30000);
    let output = '';
    viteProc!.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/localhost:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(parseInt(match[1], 10));
      }
    });
    viteProc!.stderr!.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    viteProc!.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Vite exited with code ${code}: ${output}`));
    });
  });
  console.log(`[e2e] Vite dev server on port ${vitePort}`);

  browser = await chromium.launch({ headless: true });
  return { webPort: vitePort };
}

async function runTests(webPort: number) {
  const page = await browser!.newPage();
  const baseUrl = `http://127.0.0.1:${webPort}`;

  // === Overview Tab ===
  console.log('\n--- overview tab ---');
  await page.goto(`${baseUrl}/observability`);
  await page.waitForSelector('text=Observability', { timeout: 15000 });
  check('observability page loads', true);

  await page.waitForSelector('text=Messages', { timeout: 10000 });
  check('sessions stat card visible', await page.isVisible('text=Sessions'));
  check('messages stat card visible', await page.isVisible('text=Messages'));
  check('tool calls stat card visible', await page.isVisible('text=Tool Calls'));
  check('total cost stat card visible', await page.isVisible('text=Total Cost'));

  // Verify real data loaded (non-zero values) — locate Sessions stat card value
  const sessionEl = page.locator('div:has(div:text-is("Sessions")) .text-accent').first();
  const sessionText = await sessionEl.textContent({ timeout: 5000 }).catch(() => null);
  check('session count is non-zero', sessionText !== null && sessionText !== '0');

  check('daily activity chart exists', await page.isVisible('text=Daily Activity'));

  // === Tools Page ===
  console.log('\n--- tools page ---');
  await page.goto(`${baseUrl}/observability/tools`);
  await page.waitForSelector('th:has-text("Tool")', { timeout: 5000 });
  check('tools table loads', true);

  const toolsTable = await page.textContent('table');
  check('Bash tool in table', toolsTable?.includes('Bash') ?? false);
  check('Read tool in table', toolsTable?.includes('Read') ?? false);

  // === Hooks Page ===
  console.log('\n--- hooks page ---');
  await page.goto(`${baseUrl}/observability/hooks`);
  await page.waitForTimeout(1500);
  const hasHookTable = await page.isVisible('th:has-text("Hook")');
  const hasNoHooks = await page.isVisible('text=No hook data');
  check('hooks page shows data or empty message', hasHookTable || hasNoHooks);

  if (hasHookTable) {
    check('hook count column visible', await page.isVisible('th:has-text("Count")'));
    check('hook p95 column visible', await page.isVisible('th:has-text("P95")'));
  }

  // === Tokens Page ===
  console.log('\n--- tokens page ---');
  await page.goto(`${baseUrl}/observability/tokens`);
  await page.waitForSelector('text=Daily Tokens', { timeout: 5000 });
  check('tokens page loads', true);
  check('total cost card visible', await page.isVisible('text=Total Cost'));
  check('avg daily card visible', await page.isVisible('text=Avg / Day'));
  check('tokens chart visible', await page.isVisible('text=Daily Tokens'));
  check('cost chart visible', await page.isVisible('text=Daily Cost'));

  const modelTable = await page.isVisible('th:has-text("Model")');
  check('model breakdown table visible', modelTable);

  // === Memory Page ===
  console.log('\n--- memory page ---');
  await page.goto(`${baseUrl}/observability/memory`);
  await page.waitForSelector('text=Total Memories', { timeout: 5000 });
  check('memory page loads', true);
  check('total memories card visible', await page.isVisible('text=Total Memories'));
  check('health score card visible', await page.isVisible('text=Health Score'));
  check('stale card visible', await page.isVisible('text=Stale'));
  check('by type section visible', await page.isVisible('text=By Type'));
  check('top tags section visible', await page.isVisible('text=Top Tags'));
  check('take snapshot button visible', await page.isVisible('text=Take Snapshot'));

  // Check seeded data values — memory total stat card value
  const memoryTotal = await page.locator('div:has(div:text-is("Total Memories")) .text-accent').first().textContent({ timeout: 5000 }).catch(() => null);
  check('memory total shows 35', memoryTotal === '35');

  // Check trend chart (2 snapshots = shows trend)
  check('memory trend chart visible', await page.isVisible('text=Memory Count Over Time'));

  // === Time Range Selector ===
  console.log('\n--- time range selector ---');
  await page.goto(`${baseUrl}/observability/overview`);
  await page.waitForSelector('text=Messages', { timeout: 5000 });

  await page.click('button:has-text("7d")');
  await page.waitForTimeout(800);
  check('7d preset works', true);

  await page.click('button:has-text("30d")');
  await page.waitForTimeout(800);
  check('30d preset works', true);

  // === Console Errors Check ===
  console.log('\n--- console errors ---');
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  await page.goto(`${baseUrl}/observability/overview`);
  await page.waitForSelector('text=Messages', { timeout: 10000 });
  await page.waitForTimeout(1500);
  check('no console errors on reload', consoleErrors.length === 0);
  if (consoleErrors.length > 0) {
    console.log('  Console errors:', consoleErrors.slice(0, 5));
  }

  await page.close();
}

async function teardown() {
  if (browser) await browser.close();
  if (server) await server.close();
  if (viteProc) {
    viteProc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      viteProc!.on('exit', () => resolve());
      setTimeout(resolve, 3000);
    });
  }
  try { rmSync(tmpDir, { recursive: true }); } catch {}
}

// --- Main ---
console.log('[e2e] Observability dashboard E2E test with real data + real browser');

try {
  const { webPort } = await setup();
  await runTests(webPort);
  await teardown();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  console.error('[e2e] FATAL:', err);
  await teardown();
  process.exit(1);
}
