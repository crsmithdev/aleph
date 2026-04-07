import { spawn, type ChildProcess } from 'child_process';
import { resolve } from 'path';

const WORKER_SCRIPT = resolve(import.meta.dirname, '../../../research/src/worker.ts');
const SIGTERM_GRACE_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const MAX_RESTARTS = 20;

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

  constructor(private count: number) {}

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

    const isDev = process.env.NODE_ENV === 'development';
    const args = isDev ? ['--watch', 'run', WORKER_SCRIPT] : ['run', WORKER_SCRIPT];
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
      if (w.restarts > MAX_RESTARTS) {
        console.error(`[supervisor] worker ${w.id} exceeded ${MAX_RESTARTS} restarts — giving up`);
        return;
      }

      const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (w.restarts - 1), MAX_BACKOFF_MS);
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
          console.warn(`[supervisor] worker ${w.id} did not stop after ${SIGTERM_GRACE_MS / 1000}s — force killing`);
          w.process.kill('SIGKILL');
        }
      }, SIGTERM_GRACE_MS);

      w.process.once('exit', () => { clearTimeout(forceKill); resolve(); });
      w.process.kill('SIGTERM');
    });
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
