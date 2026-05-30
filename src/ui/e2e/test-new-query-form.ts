#!/usr/bin/env bun
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const tmpDir = mkdtempSync(join(tmpdir(), 'aleph-form-'));
const dbPath = join(tmpDir, 'test.db');
process.env.ALEPH_DB_PATH = dbPath;
process.env.NODE_ENV = 'production';

const { chromium } = await import('playwright');
const { createDb } = await import('@aleph/data');
const { applyDDL } = await import('@aleph/goals');
const { applyResearchDDL } = await import('@aleph/research');
const { createApp } = await import('../api/src/app.js');

const { db: _db, sqlite } = createDb(dbPath);
applyDDL(sqlite);
applyResearchDDL(sqlite);
sqlite.exec(`CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, url TEXT NOT NULL, events TEXT NOT NULL DEFAULT '[]', secret TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
sqlite.close();

const server = await createApp({ dbUrl: dbPath });
await server.listen({ port: 0, host: '127.0.0.1' });
const port = (server.server.address() as any).port;
console.log(`server on ${port}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const jsErrors: string[] = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });

await page.goto(`http://127.0.0.1:${port}/research`);
await page.waitForSelector('text=Deep Research', { timeout: 5000 });
console.log('✓ page loaded');

// Open new query form
await page.getByRole('button', { name: '+ New query' }).click();
await page.waitForTimeout(300);

const input = page.locator('input[placeholder="Enter research topic..."]');
console.log('form visible:', await input.isVisible());

// Type a query
await input.fill('What is the role of AI in scientific discovery?');
const val = await input.inputValue();
console.log('input value:', val);

// Submit
await page.getByRole('button', { name: 'Start' }).click();
await page.waitForTimeout(1500);

// Check query was created via API
const queries = await page.evaluate(async () => {
  const r = await fetch('/api/research/queries');
  return r.json();
});
console.log('queries created:', queries.length);
if (queries.length > 0) console.log('✓ query created:', queries[0].prompt.substring(0, 50));
else console.log('✗ no query created');

if (jsErrors.length) console.log('JS errors:', jsErrors);

await browser.close();
await server.close();
rmSync(tmpDir, { recursive: true });
