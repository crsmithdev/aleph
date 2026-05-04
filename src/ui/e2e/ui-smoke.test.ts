#!/usr/bin/env bun
/**
 * UI route smoke test: every route loads and renders its page-specific
 * marker without errors.
 *
 * The route list is imported from `src/ui/web/src/routes.tsx` — the same
 * module App.tsx renders from. By construction the smoke list cannot drift
 * from the routes the app actually serves.
 *
 * For each route with `smoke` metadata:
 *   - waits for `<main data-testid="page-X">` (page rendered, not just chrome)
 *   - asserts <h1> matches `heading` regex if specified
 *   - fails on any /api/ 4xx or 5xx received during initial mount
 *   - fails on uncaught errors or console.error (with a small ignore list)
 *
 * Routes without `smoke` (redirects, dynamic detail pages) are listed for
 * source-of-truth purposes but skipped here.
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
const { ROUTE_META } = await import('../web/src/routes-meta.js');

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

type SmokeOpts = {
  testid: string;
  heading?: RegExp;
  allowedApi404?: RegExp[];
  expectErrorState?: boolean;
};

async function smokeRoute(port: number, path: string, opts: SmokeOpts): Promise<Failure | null> {
  const page = await browser!.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const apiFailures: string[] = [];

  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE_PATTERNS.some(re => re.test(text))) return;
    // Browser logs "Failed to load resource ... 404" for every fetch 404 —
    // dedupe those against the allowedApi404 allowlist by URL.
    const url = msg.location().url;
    if (url && /\/api\//.test(url) && opts.allowedApi404?.some(re => re.test(url))) return;
    consoleErrors.push(text);
  });
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('response', resp => {
    const status = resp.status();
    if (status < 400 || !resp.url().includes('/api/')) return;
    if (status === 404 && opts.allowedApi404?.some(re => re.test(resp.url()))) return;
    apiFailures.push(`${status} ${resp.url()}`);
  });

  const reasons: string[] = [];
  try {
    await page.goto(`http://127.0.0.1:${port}${path}`, { timeout: 30_000, waitUntil: 'domcontentloaded' });
    // Page-specific marker — absence means THIS page didn't mount.
    await page.waitForSelector(`main[data-testid="${opts.testid}"]`, { timeout: 15_000 });

    if (opts.expectErrorState) {
      await page.waitForSelector('[data-testid="error-state"]', { timeout: 10_000 })
        .catch(() => { reasons.push('expected ErrorState (data-testid="error-state") not visible'); });
    } else if (opts.heading) {
      const h1Text = await page.locator('main h1').first().textContent({ timeout: 5_000 }).catch(() => null);
      if (!h1Text || !opts.heading.test(h1Text.trim())) {
        reasons.push(`h1 ${h1Text === null ? 'not found' : `"${h1Text.trim()}"`} did not match ${opts.heading}`);
      }
    }
  } catch (err: any) {
    reasons.push(`navigation: ${err.message ?? err}`);
  }

  if (pageErrors.length) reasons.push(`${pageErrors.length} uncaught error(s): ${pageErrors.slice(0, 3).join('; ')}`);
  if (consoleErrors.length) reasons.push(`${consoleErrors.length} console.error: ${consoleErrors.slice(0, 3).join('; ')}`);
  if (apiFailures.length) reasons.push(`api 4xx/5xx: ${apiFailures.slice(0, 3).join('; ')}`);

  await page.close();
  return reasons.length ? { path, reasons } : null;
}

console.log('[smoke] UI route smoke test\n');

const smokeable = ROUTE_META.filter(r => r.smoke);
const skipped = ROUTE_META.filter(r => !r.smoke);
console.log(`[smoke] ${smokeable.length} routes to smoke, ${skipped.length} skipped (redirects/dynamic)\n`);

// Routes run in parallel batches. Each Playwright page already has its own
// context, so cookies / storage / console handlers don't bleed between them.
// Batch size keeps memory bounded — 6 chrome tabs in flight is comfortable.
const BATCH_SIZE = parseInt(process.env.SMOKE_CONCURRENCY ?? '6', 10);

let exitCode = 0;
try {
  const port = await setup();
  const failures: Failure[] = [];
  let passed = 0;
  const t0 = Date.now();
  for (let i = 0; i < smokeable.length; i += BATCH_SIZE) {
    const batch = smokeable.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async r => {
      const url = r.smoke!.pathFor ?? r.path;
      return {
        path: url,
        failure: await smokeRoute(port, url, r.smoke!),
      };
    }));
    for (const { path, failure } of results) {
      if (failure) {
        failures.push(failure);
        console.log(`  ✗ ${path}`);
        for (const reason of failure.reasons) console.log(`      ${reason}`);
      } else {
        console.log(`  ✓ ${path}`);
        passed++;
      }
    }
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${passed} passed, ${failures.length} failed (${elapsed}s, batch=${BATCH_SIZE})`);
  exitCode = failures.length > 0 ? 1 : 0;
} catch (err) {
  console.error('[smoke] FATAL:', err);
  exitCode = 1;
}

await teardown();
process.exit(exitCode);
