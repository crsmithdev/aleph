/**
 * Unified dev-server logger — shared across api, supervisor, worker, and any
 * `@aleph/*` peer module that previously used `console.log`.
 *
 * One entry point — `log({source, level, msg, ...fields})`:
 *   - Append NDJSON record to ~/.aleph/logs/dev-YYYY-MM-DD.ndjson
 *   - Write a colorized vite-style line to stdout: `HH:MM:SS [source] msg`
 *
 * Sources used in this codebase: dev, api, vite, fastify, research, ddl,
 * loop, supervisor.
 */

import { Writable } from 'node:stream';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const C = {
  reset: '\x1b[0m',
  dim:   '\x1b[2m',
  bold:  '\x1b[1m',
  red:   '\x1b[31m',
  green: '\x1b[32m',
  yellow:'\x1b[33m',
  blue:  '\x1b[34m',
  magenta:'\x1b[35m',
  cyan:  '\x1b[36m',
  gray:  '\x1b[90m',
};

const SOURCE_COLOR: Record<string, string> = {
  dev:               C.cyan + C.bold,
  api:               C.cyan,
  worker:            C.magenta,
  supervisor:        C.green,
  vite:              C.yellow,
  fastify:           C.gray,
  ddl:               C.gray,
  research:          C.blue,
  research_defaults: C.blue,
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
function paint(c: string, s: string): string { return useColor ? `${c}${s}${C.reset}` : s; }

function compactTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

const logsDir = join(process.env.HOME ?? '/tmp', '.aleph', 'logs');
let dirEnsured = false;
function logFilePath(): string {
  if (!dirEnsured) { try { mkdirSync(logsDir, { recursive: true }); dirEnsured = true; } catch { /* non-fatal */ } }
  const date = new Date().toISOString().slice(0, 10);
  return join(logsDir, `dev-${date}.ndjson`);
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEvent {
  source: string;
  level?: LogLevel;
  msg: string;
  worker_id?: number | string;
  method?: string;
  url?: string;
  status?: number;
  duration_ms?: number;
  pid?: number;
  [extra: string]: unknown;
}

export function log(event: LogEvent): void {
  const ts = new Date();
  const record = { ts: ts.toISOString(), level: event.level ?? 'info', ...event };
  try { appendFileSync(logFilePath(), JSON.stringify(record) + '\n'); } catch { /* non-fatal */ }
  process.stdout.write(formatConsole(record, ts));
}

function formatStatus(s: number): string {
  const str = String(s);
  if (s >= 500) return paint(C.red, str);
  if (s >= 400) return paint(C.yellow, str);
  if (s >= 300) return paint(C.cyan, str);
  return paint(C.green, str);
}

function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null) return '';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatConsole(e: LogEvent & { level: LogLevel }, ts: Date): string {
  const time = paint(C.dim, compactTime(ts));
  const sourceColor = SOURCE_COLOR[e.source] ?? C.cyan;
  const sourceLabel = e.worker_id !== undefined ? `${e.source} @ ${e.worker_id}` : e.source;
  const tag = paint(sourceColor, `[${sourceLabel}]`);

  let body: string;
  if (e.source === 'api' && e.method && e.url && e.status !== undefined) {
    const method = paint(C.dim, e.method);
    const status = formatStatus(e.status);
    const dur = e.duration_ms !== undefined ? paint(C.dim, ` (${formatDuration(e.duration_ms)})`) : '';
    body = `${method} ${e.url} ${paint(C.gray, '→')} ${status}${dur}`;
  } else if (e.level === 'error') {
    body = paint(C.red, e.msg);
  } else if (e.level === 'warn') {
    body = paint(C.yellow, e.msg);
  } else {
    body = e.msg;
  }

  return `${time} ${tag} ${body}\n`;
}

/**
 * Fastify pino stream adapter — reroutes pino's JSON line output through `log()`.
 * Per-request lines come from an explicit onResponse hook in app.ts and bypass
 * this stream entirely; this only catches plugin/internal pino output.
 */
export function createLogStream(): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      try {
        const obj = JSON.parse(chunk.toString());
        const level: LogLevel = obj.level >= 50 ? 'error' : obj.level >= 40 ? 'warn' : 'info';
        const msg = obj.msg ?? '';
        if (msg) log({ source: 'fastify', level, msg });
      } catch {
        process.stdout.write(chunk);
      }
      callback();
    },
  });
}

/**
 * Vite custom logger adapter — wraps Vite's Logger interface so its output
 * flows through `log()`. Pass to `createViteServer({ customLogger })`.
 */
export interface ViteLogger {
  info(msg: string, opts?: unknown): void;
  warn(msg: string, opts?: unknown): void;
  warnOnce(msg: string, opts?: unknown): void;
  error(msg: string, opts?: unknown): void;
  clearScreen(_type: string): void;
  hasErrorLogged(_err: unknown): boolean;
  hasWarned: boolean;
}

export function createViteLogger(): ViteLogger {
  const warnedMessages = new Set<string>();
  const loggedErrors = new WeakSet<object>();

  function strip(msg: string): string {
    return msg.replace(/\x1b\[[0-9;]*m/g, '').replace(/^\s*\d{1,2}:\d{2}:\d{2}\s+(?:PM|AM)?\s*\[?vite\]?\s*/i, '').trim();
  }

  const logger: ViteLogger = {
    hasWarned: false,
    info(msg) { log({ source: 'vite', level: 'info', msg: strip(msg) }); },
    warn(msg) {
      logger.hasWarned = true;
      log({ source: 'vite', level: 'warn', msg: strip(msg) });
    },
    warnOnce(msg) {
      if (warnedMessages.has(msg)) return;
      warnedMessages.add(msg);
      logger.hasWarned = true;
      log({ source: 'vite', level: 'warn', msg: strip(msg) });
    },
    error(msg, opts) {
      const err = (opts as { error?: object } | undefined)?.error;
      if (err && typeof err === 'object') loggedErrors.add(err);
      log({ source: 'vite', level: 'error', msg: strip(msg) });
    },
    clearScreen() { /* no-op — unified log stream shouldn't clear */ },
    hasErrorLogged(err) { return typeof err === 'object' && err !== null && loggedErrors.has(err as object); },
  };
  return logger;
}
