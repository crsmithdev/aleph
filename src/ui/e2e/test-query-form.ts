#!/usr/bin/env bun
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const tmpDir = mkdtempSync(join(tmpdir(), 'construct-form-test-'));
const dbPath = join(tmpDir, 'test.db');
process.env.CONSTRUCT_DB_PATH = dbPath;
process.env.NODE_ENV = 'production';

const { chromium } = await import('playwright');
const { createDb } = await import('@construct/data');
const { applyDDL } = await import('@construct/goals');
const { applyResearchDDL } = await import('@construct/research');
const { createApp } = await import('./api/src/app.js');

const { db: _db, sqlite } = createDb(dbPath);
applyDDL(sqlite);
applyResearchDDL(sqlite);
sqlite.exec(`CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, url TEXT NOT NULL, events TEXT NOT NULL DEFAULT '[]', secret TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
sqlite.close();

const server = await createApp({ dbUrl: dbPath });
await server.listen({ port: 0, host: '127.0.0.1' });
const port = (server.server.address() as any).port;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', m => m.type() === 'error' && console.log('JS ERROR:', m.text()));

await page.goto(`http://127.0.0.1:${port}/research`);
await page.waitForSelector('text=Deep Research', { timeout: 5000 });

// Open form
await page.click('button:has-text("New query")');
await page.waitForTimeout(300);

// Check form is visible
const formVisible = await page.isVisible('input[placeholder="Enter research topic..."]');
console.log('form opens:', formVisible);

// Try typing
if (formVisible) {
  await page.fill('input[placeholder="Enter research topic..."]', 'Test query about AI');
  const val = await page.inputValue('input[placeholder="Enter research topic..."]');
  console.log('input value after fill:', val);
  
  // Click Start
  const consoleErrors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1000);
  console.log('console errors:', consoleErrors);
  
  // Check if query was created
  const queries = await page.evaluate(async () => {
    const r = await fetch('/api/research/queries');
    return r.json();
  });
  console.log('queries after submit:', queries.length, queries.map((q: any) => q.seed_query));
}

await browser.close();
await server.close();
rmSync(tmpDir, { recursive: true });
