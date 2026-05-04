#!/usr/bin/env bun
/**
 * Server-boot smoke: spawns `src/ui/api/src/server.ts` as a real child
 * process on an isolated port and verifies it serves a working response.
 *
 * Catches what the in-process route smoke cannot: top-level import errors
 * in the entrypoint, missing env, broken systemd/dev startup paths, and
 * any failure that only manifests when the server is launched as its own
 * process. Production mode (NODE_ENV=production) — requires src/ui/web/dist
 * to exist (build it first; route smoke does this implicitly).
 *
 * Asserts:
 *   - server binds on the chosen port within 20s
 *   - GET / returns 200 with an `id="root"` mount point and a <title>
 *   - stderr contains no error/fatal/exception lines during the boot window
 */

import { spawn } from 'child_process';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '../../..');
const SERVER_ENTRY = resolve(ROOT, 'src/ui/api/src/server.ts');
const DIST = resolve(ROOT, 'src/ui/web/dist');

if (!existsSync(DIST)) {
  console.error('[boot] FATAL: src/ui/web/dist missing — run `bun run --cwd src/ui/web build` first');
  process.exit(1);
}

const tmpDirPath = mkdtempSync(join(tmpdir(), 'construct-boot-smoke-'));
const dbPath = join(tmpDirPath, 'test.db');

function findFreePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as any).port;
      srv.close(() => res(port));
    });
  });
}

const port = await findFreePort();
console.log(`[boot] picked port ${port}`);

const child = spawn('bun', [SERVER_ENTRY], {
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    NODE_ENV: 'production',
    CONSTRUCT_DB_PATH: dbPath,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const stderrChunks: string[] = [];
let exitedEarly = false;
child.stdout.on('data', () => {});
child.stderr.on('data', d => stderrChunks.push(d.toString()));
child.on('exit', code => {
  if (!shutdown) {
    exitedEarly = true;
    console.error(`[boot] child exited unexpectedly with code ${code}`);
  }
});

let shutdown = false;
function cleanup() {
  shutdown = true;
  if (!child.killed) child.kill('SIGTERM');
  try { rmSync(tmpDirPath, { recursive: true }); } catch {}
}

function fail(reason: string): never {
  console.error(`[boot] ✗ ${reason}`);
  cleanup();
  process.exit(1);
}

const DEADLINE_MS = 20_000;
const t0 = Date.now();
let response: Response | null = null;
while (Date.now() - t0 < DEADLINE_MS) {
  if (exitedEarly) fail(`server crashed during boot — stderr:\n${stderrChunks.join('')}`);
  try {
    response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1_000) });
    if (response.status === 200) break;
  } catch {
    // not ready yet
  }
  await new Promise(r => setTimeout(r, 200));
}

if (!response || response.status !== 200) {
  fail(`server did not respond 200 on :${port} within ${DEADLINE_MS}ms — stderr:\n${stderrChunks.join('')}`);
}

const html = await response.text();
if (!html.includes('id="root"')) fail(`response missing id="root":\n${html.slice(0, 300)}`);
if (!/<title>[^<]+<\/title>/i.test(html)) fail('response missing or empty <title>');

const stderr = stderrChunks.join('');
const stderrErrors = stderr
  .split('\n')
  .filter(line => /\b(error|fatal|exception|uncaught|throw)\b/i.test(line));
if (stderrErrors.length) fail(`stderr error lines during boot:\n${stderrErrors.slice(0, 5).join('\n')}`);

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`[boot] ✓ server booted on :${port}, served / with #root + <title> (${elapsed}s)`);
cleanup();
process.exit(0);
