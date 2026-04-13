import { spawn, type ChildProcess } from 'child_process';
import { resolve } from 'path';

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
    // Ensure child workers are killed when parent exits (HMR, SIGTERM, etc.)
    const cleanup = () => { this.stopSync(); process.exit(); };
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    process.on('exit', () => this.stopSync());
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

    proc.stdout?.on('data', (d: Buffer) => process.stdout.write(`[worker-${w.id}] ${d}`));
    proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[worker-${w.id}] ${d}`));

    proc.on('exit', (code, signal) => {
      w.status = 'stopped';
      w.process = null;
      w.pid = null;

      if (this.stopping) return;

      const uptime = Date.now() - (w.startedAt ?? Date.now());
      console.log(`[supervisor] worker ${w.id} exited (code=${code}, signal=${signal}, uptime=${Math.round(uptime / 1000)}s)`);

      // Don't restart on clean exit or our own SIGTERM
      if (code === 0 || signal === 'SIGTERM') return;

      w.restarts++;
      if (w.restarts > this.maxRestarts_) {
        console.error(`[supervisor] worker ${w.id} exceeded ${this.maxRestarts_} restarts — giving up`);
        return;
      }

      const backoff = Math.min(this.baseBackoffMs_ * 2 ** (w.restarts - 1), MAX_BACKOFF_MS);
      console.log(`[supervisor] worker ${w.id} restarting in ${backoff}ms (restart #${w.restarts})`);
      this.spawn(w, backoff);
    });

    console.log(`[supervisor] worker ${w.id} started (pid=${proc.pid})`);
  }

  async stop() {
    this.stopping = true;
    // Cancel pending backoff timers
    for (const w of this.workers) {
      if (w.backoffTimer) clearTimeout(w.backoffTimer);
    }
    console.log('[supervisor] stopping all workers...');
    await Promise.all(this.workers.map(w => this.stopWorker(w)));
    console.log('[supervisor] all workers stopped');
  }

  private stopWorker(w: ManagedWorker): Promise<void> {
    return new Promise(resolve => {
      if (!w.process || w.status === 'stopped') return resolve();

      w.status = 'stopping';

      const forceKill = setTimeout(() => {
        if (w.process && !w.process.killed) {
          console.warn(`[supervisor] worker ${w.id} did not stop after ${this.gracePeriodMs / 1000}s — force killing`);
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
