#!/usr/bin/env bun
/**
 * E2E test: research Live tab — three-pane layout with seeded threads.
 *
 * Flow:
 * 1. Create a temp DB
 * 2. Seed research query + threads + findings via raw SQL
 * 3. Start the UI server
 * 4. Use Playwright to navigate to the research detail page
 * 5. Click the Live tab and verify the three-pane layout
 * 6. Click a thread and verify the detail pane updates
 * 7. Switch view modes (Tree / Flat)
 * 8. Navigate to Map and Settings tabs
 * 9. Tear down
 *
 * Comparison notes (agent-browser vs Playwright):
 * - agent-browser found: SSE stream prevents networkidle; use --text waits instead
 * - agent-browser found: Tab click works via direct click (not URL param)
 * - Playwright adds: repeatable assertions, seeded threads for full layout testing
 */

import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { nanoid } from 'nanoid';

const tmpDir = mkdtempSync(join(tmpdir(), 'construct-e2e-research-'));
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

async function setup() {
  const { db: _db, sqlite } = createDb(dbPath);

  // Apply both DDLs
  applyDDL(sqlite);
  applyResearchDDL(sqlite);

  // Webhooks table (required by UI server)
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

  // Seed research query
  const queryId = 'test-query-live-view';
  sqlite.exec(`
    INSERT INTO research_queries (id, title, prompt, status, config)
    VALUES (
      '${queryId}',
      'AI memory systems research',
      'How do AI memory systems work in production?',
      'active',
      '{}'
    )
  `);

  // Seed root thread
  const t1 = 'thread-root-1';
  sqlite.exec(`
    INSERT INTO research_threads (id, session_id, parent_thread_id, query, status, priority, depth, node_type)
    VALUES ('${t1}', '${queryId}', NULL, 'How do vector stores enable semantic memory?', 'completed', 0.9, 0, 'question')
  `);

  // Seed child thread
  const t2 = 'thread-child-1';
  sqlite.exec(`
    INSERT INTO research_threads (id, session_id, parent_thread_id, query, status, priority, depth, node_type)
    VALUES ('${t2}', '${queryId}', '${t1}', 'What is the role of embedding models?', 'active', 0.7, 1, 'question')
  `);

  // Seed a second root thread
  const t3 = 'thread-root-2';
  sqlite.exec(`
    INSERT INTO research_threads (id, session_id, parent_thread_id, query, status, priority, depth, node_type)
    VALUES ('${t3}', '${queryId}', NULL, 'How does episodic memory differ from semantic memory?', 'queued', 0.5, 0, 'question')
  `);

  // Seed a finding for the root thread
  sqlite.exec(`
    INSERT INTO research_findings (id, thread_id, session_id, content, summary, source_urls, source_quality, confidence, novelty, actionability)
    VALUES (
      'finding-1', '${t1}', '${queryId}',
      'Vector stores use approximate nearest neighbor algorithms to retrieve semantically similar content.',
      'ANN algorithms power semantic retrieval in vector stores.',
      '[]', 0.8, 0.85, 0.7, 0.6
    )
  `);

  sqlite.close();

  console.log(`[e2e] Seeded query: "${queryId}" with 3 threads + 1 finding`);

  server = await createApp({ dbUrl: dbPath });
  const address = await server.listen({ port: 0, host: '127.0.0.1' });
  const port = (server.server.address() as any).port;
  console.log(`[e2e] Server on port ${port}`);

  browser = await chromium.launch({ headless: true });

  return { port, queryId };
}

async function runTests(port: number, queryId: string) {
  const page = await browser!.newPage();
  const baseUrl = `http://127.0.0.1:${port}`;
  let passed = 0;
  let failed = 0;

  // Capture console errors
  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  function check(name: string, ok: boolean, detail?: string) {
    if (ok) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`);
      failed++;
    }
  }

  // --- Page load ---
  console.log('\n--- research query detail page ---');
  await page.goto(`${baseUrl}/research/${queryId}`);
  // Don't use waitForLoadState('networkidle') — SSE stream prevents it
  await page.waitForSelector('text=AI memory systems research', { timeout: 8000 });

  check('page loads', true);
  check('query title visible', await page.isVisible('text=AI memory systems research'));

  // Tab bar — scope to the border-b tab row to avoid matching content-area buttons
  const tabBar = page.locator('div.border-b').filter({ hasText: 'Document' }).filter({ hasText: 'Live' }).filter({ hasText: 'Map' });
  const docTab = tabBar.getByRole('button', { name: /^Document/, exact: false });
  const liveTab = tabBar.getByRole('button', { name: /^Live/, exact: false });
  const mapTab = tabBar.getByRole('button', { name: 'Map', exact: true });
  const settingsTab = tabBar.getByRole('button', { name: 'Settings', exact: true });
  check('Document tab exists', await docTab.isVisible());
  check('Live tab exists', await liveTab.isVisible());
  check('Map tab exists', await mapTab.isVisible());
  check('Settings tab exists', await settingsTab.isVisible());

  // Stats show correct counts (3 threads, 1 finding)
  const pageText = await page.locator('body').innerText();
  check('threads count shown', pageText.includes('Threads') && (pageText.includes('3') || pageText.includes('Threads: 3')));
  check('findings count shown', pageText.includes('Findings') && (pageText.includes('1') || pageText.includes('Findings: 1')));

  // --- Document tab (default) ---
  console.log('\n--- document tab ---');
  check('document tab active by default', await page.isVisible('text=Not enough findings yet') || await page.isVisible('text=AI memory systems'));

  // --- Live tab ---
  console.log('\n--- live tab (three-pane layout) ---');
  await liveTab.click();
  await page.waitForTimeout(500); // React state update

  // Thread list (left pane)
  check('thread list renders', await page.isVisible('text=How do vector stores enable semantic memory?'));
  check('child thread visible', await page.isVisible('text=What is the role of embedding models?'));
  check('second root thread visible', await page.isVisible('text=How does episodic memory differ from semantic memory?'));

  // Tree/Flat toggle (ThreadNavigator left pane — exact labels "Tree" and "Flat")
  // Note: LiveView (right pane) also renders "hierarchical"/"flat" buttons — scope to left pane
  const leftPane = page.locator('div.w-\\[280px\\]');
  const treeBtn = leftPane.getByRole('button', { name: 'Tree', exact: true });
  const flatBtn = leftPane.getByRole('button', { name: 'Flat', exact: true });
  check('Tree mode button exists in thread navigator', await treeBtn.isVisible());
  check('Flat mode button exists in thread navigator', await flatBtn.isVisible());

  // Click flat mode
  await flatBtn.click();
  await page.waitForTimeout(300);
  check('flat mode: all threads still visible', await page.isVisible('text=How do vector stores enable semantic memory?'));

  // Back to tree
  await treeBtn.click();
  await page.waitForTimeout(300);

  // --- Click a thread (left pane → detail pane) ---
  console.log('\n--- thread selection ---');
  // Two elements match (left pane span + right pane button) — click left pane item
  const rootThread = leftPane.locator('text=How do vector stores enable semantic memory?').first();
  await rootThread.click();
  await page.waitForTimeout(500);

  // Middle pane should show thread detail
  const bodyAfterClick = await page.locator('body').innerText();
  // Check finding appears (finding is associated with this thread)
  check('finding content shown after thread click', bodyAfterClick.includes('Vector stores') || bodyAfterClick.includes('ANN'));

  // --- No console errors ---
  console.log('\n--- stability ---');
  check('no JS console errors', consoleErrors.length === 0, consoleErrors.join('; ').substring(0, 200));

  // --- Map tab ---
  console.log('\n--- map tab ---');
  await mapTab.click();
  await page.waitForTimeout(500);
  // Map renders a canvas or SVG for the cytoscape graph
  const hasGraph = (await page.locator('canvas').count()) > 0 || (await page.locator('svg').count()) > 0;
  check('map tab renders graph element', hasGraph);

  // --- Settings tab ---
  console.log('\n--- settings tab ---');
  await settingsTab.click();
  await page.waitForTimeout(300);
  const settingsText = await page.locator('body').innerText();
  check('settings tab renders content', settingsText.includes('Delete') || settingsText.includes('Config') || settingsText.includes('Budget'));

  await page.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (consoleErrors.length > 0) {
    console.log(`\nConsole errors (${consoleErrors.length}):`);
    for (const e of consoleErrors) console.log('  ', e.substring(0, 200));
  }
  return failed;
}

async function teardown() {
  if (browser) await browser.close();
  if (server) await server.close();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
}

// --- Main ---
console.log('[e2e] Research Live View — three-pane layout test');

try {
  const { port, queryId } = await setup();
  const failures = await runTests(port, queryId);
  await teardown();
  process.exit(failures > 0 ? 1 : 0);
} catch (err) {
  console.error('[e2e] FATAL:', err);
  await teardown();
  process.exit(1);
}
