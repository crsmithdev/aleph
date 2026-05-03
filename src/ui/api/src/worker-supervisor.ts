import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { log } from './logger.js';

const DEFAULT_WORKER_SCRIPT = resolve(import.meta.dirname, '../../../research/src/worker.ts');
const SIGTERM_GRACE_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const MAX_RESTARTS = 20;

export interface SupervisorOptions {
  /** Override the worker script path (used in tests to inject tiny scripts). */
  scriptPath?: string;
  /** Override SIGTERM grace period in ms (default 30s — set low in tests). */
  gracePeriodMs?: number;
  /** Override max restart count (default 20). */
  maxRestarts?: number;
  /** Override base backoff in ms (default 1000). */
  baseBackoffMs?: number;
}

export interface WorkerStatus {
  id: number;
  pid: number | null;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'backoff';
  restarts: number;
  uptimeMs: number | null;
}

interface ManagedWorker extends WorkerStatus {
  process: ChildProcess | null;
  startedAt: number | null;
  backoffTimer: ReturnType<typeof setTimeout> | null;
}

export class WorkerSupervisor {
  private workers: ManagedWorker[] = [];
  private stopping = false;
  private scriptPath: string;
  private gracePeriodMs: number;
  private maxRestarts_: number;
  private baseBackoffMs_: number;

  constructor(private count: number, opts: SupervisorOptions = {}) {
    this.scriptPath = opts.scriptPath ?? DEFAULT_WORKER_SCRIPT;
    this.gracePeriodMs = opts.gracePeriodMs ?? SIGTERM_GRACE_MS;
    this.maxRestarts_ = opts.maxRestarts ?? MAX_RESTARTS;
    this.baseBackoffMs_ = opts.baseBackoffMs ?? BASE_BACKOFF_MS;
    // Kill orphaned worker processes from previous server runs
    this.killOrphans();
    // Ensure child workers are killed when parent exits (HMR, SIGTERM, etc.)
    const cleanup = () => { this.stopSync(); process.exit(); };
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    process.on('exit', () => this.stopSync());
  }

  /** Kill orphaned worker processes from previous server runs — any research/src/worker.ts
   *  targeting the same DB as us. Cross-path match is intentional: a stale worker from a
   *  deleted worktree/branch can keep claiming jobs on the same DB for days (PPID=1). */
  private killOrphans() {
    try {
      const ourDb = process.env.CONSTRUCT_DB_PATH ?? '';
      const result = spawnSync('pgrep', ['-f', 'research/src/worker.ts'], { encoding: 'utf-8' });
      const pids = (result.stdout ?? '').trim().split('\n').map(Number).filter(p => p && p !== process.pid);
      for (const pid of pids) {
        // Only kill workers that target the same DB as this supervisor — don't stomp
        // on a concurrently-running prod supervisor when we're the dev one (or vice versa).
        let theirDb = '';
        try {
          const env = readFileSync(`/proc/${pid}/environ`, 'utf-8');
          const m = env.split('\0').find(e => e.startsWith('CONSTRUCT_DB_PATH='));
          theirDb = m ? m.slice('CONSTRUCT_DB_PATH='.length) : '';
        } catch { /* proc gone or permission denied */ }
        if (theirDb === ourDb) {
          try {
            process.kill(pid, 'SIGKILL');
            log({ source: 'supervisor', msg: `killed orphaned worker (pid=${pid}, db=${ourDb || 'default'})`, pid });
          } catch { /* already gone */ }
        }
      }
    } catch { /* pgrep not available */ }
  }

  /** Synchronous best-effort kill for use in exit handlers */
  private stopSync() {
    for (const w of this.workers) {
      if (w.backoffTimer) clearTimeout(w.backoffTimer);
      if (w.process && !w.process.killed) {
        w.process.kill('SIGKILL');
      }
    }
  }

  start() {
    if (this.workers.length > 0) return; // already started
    for (let i = 0; i < this.count; i++) {
      const w: ManagedWorker = {
        id: i, process: null, pid: null, status: 'stopped',
        restarts: 0, startedAt: null, uptimeMs: null, backoffTimer: null,
      };
      this.workers.push(w);
      this.spawn(w);
    }
  }

  private spawn(w: ManagedWorker, backoffMs = 0) {
    if (this.stopping) return;

    if (backoffMs > 0) {
      w.status = 'backoff';
      w.backoffTimer = setTimeout(() => { w.backoffTimer = null; this.doSpawn(w); }, backoffMs);
    } else {
      this.doSpawn(w);
    }
  }

  private doSpawn(w: ManagedWorker) {
    if (this.stopping) return;

    w.status = 'starting';
    w.startedAt = Date.now();

    const args = ['run', '--no-cache', this.scriptPath];
    const proc = spawn(process.execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    w.process = proc;
    w.pid = proc.pid ?? null;
    w.status = 'running';

    const forwardLines = (level: 'info' | 'error') => (d: Buffer) => {
      for (const raw of d.toString().split('\n')) {
        const line = raw.replace(/\r$/, '').trim();
        if (!line) continue;
        // Worker prefixes its own messages with "[worker]" / "[engine]" / etc — strip the
        // bracketed tag so we don't render `[worker @ 0] [worker] ...` double-tagged.
        const stripped = line.replace(/^\[[^\]]+\]\s*/, '');
        log({ source: 'worker', level, worker_id: w.id, msg: stripped });
      }
    };
    proc.stdout?.on('data', forwardLines('info'));
    proc.stderr?.on('data', forwardLines('error'));

    proc.on('exit', (code, signal) => {
      w.status = 'stopped';
      w.process = null;
      w.pid = null;

      if (this.stopping) return;

      const uptime = Date.now() - (w.startedAt ?? Date.now());
      log({ source: 'supervisor', worker_id: w.id, msg: `exited (code=${code}, signal=${signal}, uptime=${Math.round(uptime / 1000)}s)` });

      // Don't restart on clean exit or our own SIGTERM
      if (code === 0 || signal === 'SIGTERM') return;

      w.restarts++;
      if (w.restarts > this.maxRestarts_) {
        log({ source: 'supervisor', level: 'error', worker_id: w.id, msg: `exceeded ${this.maxRestarts_} restarts — giving up` });
        return;
      }

      const backoff = Math.min(this.baseBackoffMs_ * 2 ** (w.restarts - 1), MAX_BACKOFF_MS);
      log({ source: 'supervisor', worker_id: w.id, msg: `restarting in ${backoff}ms (restart #${w.restarts})` });
      this.spawn(w, backoff);
    });

    log({ source: 'supervisor', worker_id: w.id, msg: `started (pid=${proc.pid})`, pid: proc.pid ?? undefined });
  }

  async stop() {
    this.stopping = true;
    // Cancel pending backoff timers
    for (const w of this.workers) {
      if (w.backoffTimer) clearTimeout(w.backoffTimer);
    }
    log({ source: 'supervisor', msg: 'stopping all workers...' });
    await Promise.all(this.workers.map(w => this.stopWorker(w)));
    log({ source: 'supervisor', msg: 'all workers stopped' });
  }

  private stopWorker(w: ManagedWorker): Promise<void> {
    return new Promise(resolve => {
      if (!w.process || w.status === 'stopped') return resolve();

      w.status = 'stopping';

      const forceKill = setTimeout(() => {
        if (w.process && !w.process.killed) {
          log({ source: 'supervisor', level: 'warn', worker_id: w.id, msg: `did not stop after ${this.gracePeriodMs / 1000}s — force killing` });
          w.process.kill('SIGKILL');
        }
      }, this.gracePeriodMs);

      w.process.once('exit', () => { clearTimeout(forceKill); resolve(); });
      w.process.kill('SIGTERM');
    });
  }

  addWorker(): WorkerStatus {
    const id = Math.max(...this.workers.map(w => w.id), -1) + 1;
    const w: ManagedWorker = {
      id, process: null, pid: null, status: 'stopped',
      restarts: 0, startedAt: null, uptimeMs: null, backoffTimer: null,
    };
    this.workers.push(w);
    this.spawn(w);
    return { id: w.id, pid: w.pid, status: w.status, restarts: w.restarts, uptimeMs: null };
  }

  async removeWorker(): Promise<number | null> {
    if (this.workers.length === 0) return null;
    const running = this.workers.filter(w => w.status === 'running');
    const target = running.length > 0 ? running[running.length - 1] : this.workers[this.workers.length - 1];
    const id = target.id;
    await this.stopWorker(target);
    this.workers = this.workers.filter(w => w.id !== id);
    return id;
  }

  async killWorker(id: number): Promise<boolean> {
    const w = this.workers.find(w => w.id === id);
    if (!w) return false;
    await this.stopWorker(w);
    this.workers = this.workers.filter(w => w.id !== id);
    return true;
  }

  status(): WorkerStatus[] {
    return this.workers.map(w => ({
      id: w.id,
      pid: w.pid,
      status: w.status,
      restarts: w.restarts,
      uptimeMs: w.startedAt && w.status === 'running' ? Date.now() - w.startedAt : null,
    }));
  }
}
