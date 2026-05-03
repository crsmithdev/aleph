#!/usr/bin/env bun
/**
 * UI route smoke test: every route loads and renders without errors.
 *
 * This is the final gate before claiming a UI change "done". Catches what
 * `bun test.ts` and `bun run build` cannot: runtime render errors, API
 * contract mismatches that manifest in the browser, and empty renders from
 * silently-caught component exceptions.
 *
 * Requires the web bundle in src/ui/web/dist/ — the harness invokes
 * `bun run build` if it's missing.
 */

import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

const tmpDir = mkdtempSync(join(tmpdir(), 'construct-ui-smoke-'));
const dbPath = join(tmpDir, 'test.db');
process.env.CONSTRUCT_DB_PATH = dbPath;
process.env.NODE_ENV = 'production';

const webDir = resolve(import.meta.dirname, '../web');
const distDir = resolve(webDir, 'dist');

if (!existsSync(distDir) || process.env.REBUILD === '1') {
  console.log('[smoke] Building UI bundle...');
  const r = spawnSync('bun', ['run', 'build'], { cwd: webDir, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('[smoke] FATAL: ui build failed');
    process.exit(1);
  }
}

const { chromium } = await import('playwright');
const { createApp } = await import('../api/src/app.js');

// All routes from App.tsx. Dynamic segments use safe placeholders.
// Keep in sync with src/ui/web/src/App.tsx.
const ROUTES: Array<{ path: string; needsData?: boolean }> = [
  { path: '/summary' },
  { path: '/goals' },
  { path: '/todos' },
  { path: '/habits' },
  { path: '/research' },
  { path: '/research/history' },
  { path: '/research/queries' }, // legacy → redirects to /research/history
  { path: '/research/workers' },
  { path: '/research/config' },
  { path: '/observability' },
  { path: '/observability/tools' },
  { path: '/observability/hooks' },
  { path: '/observability/skills' },
  { path: '/observability/tokens' },
  { path: '/observability/subagents' },
  { path: '/observability/sessions' },
  { path: '/observability/evals' },
  { path: '/observability/compaction' },
  { path: '/observability/events' },
  { path: '/observability/memory' },
  { path: '/observability/signals' },
  { path: '/observability/db' },
  { path: '/settings' },
];

// Patterns in console.error we ignore — third-party noise we can't fix.
const IGNORED_CONSOLE_PATTERNS = [
  /\[vite\]/i,
  /\[HMR\]/,
  /Download the React DevTools/i,
  /Warning: ReactDOM\.render/, // React 18+ noise from libs
  /Failed to load resource.*favicon/i,
];

let server: Awaited<ReturnType<typeof createApp>> | null = null;
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

async function setup() {
  server = await createApp({ dbUrl: dbPath, workerCount: 0 });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const port = (server.server.address() as any).port;
  console.log(`[smoke] server on :${port}`);
  browser = await chromium.launch({ headless: true });
  return port;
}

async function teardown() {
  if (browser) await browser.close();
  if (server) await server.close();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
}

type Failure = { path: string; reasons: string[] };

async function smokeRoute(port: number, path: string): Promise<Failure | null> {
  const page = await browser!.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failed5xx: string[] = [];

  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE_PATTERNS.some(re => re.test(text))) return;
    consoleErrors.push(text);
  });
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('response', resp => {
    if (resp.status() >= 500 && resp.url().includes('/api/')) {
      failed5xx.push(`${resp.status()} ${resp.url()}`);
    }
  });

  const reasons: string[] = [];
  try {
    await page.goto(`http://127.0.0.1:${port}${path}`, { timeout: 30_000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main', { timeout: 15_000 });
    // Give React one cycle to render or throw.
    await page.waitForFunction(
      () => {
        const main = document.querySelector('main');
        if (!main) return false;
        // Main has rendered children beyond the route wrapper.
        return main.textContent !== null && main.textContent.trim().length > 0;
      },
      { timeout: 10_000 },
    ).catch(() => { reasons.push('main element is empty after 10s (likely a render error)'); });
  } catch (err: any) {
    reasons.push(`navigation: ${err.message ?? err}`);
  }

  if (pageErrors.length) reasons.push(`${pageErrors.length} uncaught error(s): ${pageErrors.slice(0, 3).join('; ')}`);
  if (consoleErrors.length) reasons.push(`${consoleErrors.length} console.error: ${consoleErrors.slice(0, 3).join('; ')}`);
  if (failed5xx.length) reasons.push(`api 5xx: ${failed5xx.slice(0, 3).join('; ')}`);

  await page.close();
  return reasons.length ? { path, reasons } : null;
}

console.log('[smoke] UI route smoke test\n');

let exitCode = 0;
try {
  const port = await setup();
  const failures: Failure[] = [];
  let passed = 0;
  for (const r of ROUTES) {
    const f = await smokeRoute(port, r.path);
    if (f) {
      failures.push(f);
      console.log(`  \u2717 ${r.path}`);
      for (const reason of f.reasons) console.log(`      ${reason}`);
    } else {
      console.log(`  \u2713 ${r.path}`);
      passed++;
    }
  }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  exitCode = failures.length > 0 ? 1 : 0;
} catch (err) {
  console.error('[smoke] FATAL:', err);
  exitCode = 1;
}

await teardown();
process.exit(exitCode);
