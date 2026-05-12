/**
 * Loop supervisor — spawns one child process per loop, pipes its events
 * back into the API's `emitResearchEvent` bus, and respawns on abnormal
 * exit until the loop reaches a terminal status.
 *
 * The child writes one JSON event per line to stdout. We parse and re-emit
 * so research-logger + SSE listeners in the API process see the activity
 * exactly as if the engine were in-process.
 *
 * Respawn policy: on non-zero exit OR signal kill, if the loop is still
 * `pending` / `running` we respawn (capped at MAX_RESPAWNS to avoid loops
 * trapped in unrecoverable crashes). The ledger guarantees the resumed
 * run skips already-completed steps.
 */
import { resolve } from 'path';
import type { Sqlite } from '@construct/data';
import {
  emitResearchEvent, getLoop, updateLoopChildPid, updateLoopStatus,
  type LoopId, type ResearchEvent, type ResearchEventType,
} from '@construct/research';

const RUN_TS_PATH = resolve(import.meta.dirname || '.', '../../../research/src/loop/run.ts');
const MAX_RESPAWNS = 5;

const KNOWN_EVENT_TYPES = new Set<ResearchEventType>([
  'thread', 'job', 'step', 'finding', 'source', 'concept', 'concept_link', 'query',
  'loop', 'cycle', 'cycle_step', 'milestone',
]);

export interface SpawnOptions {
  processor_delay_ms?: number;
  cycles_target?: number;
}

interface ActiveChild {
  proc: ReturnType<typeof Bun.spawn>;
  pid: number;
  respawns: number;
}

const active: Map<LoopId, ActiveChild> = new Map();

/** Spawn (or respawn) the child process driving `loop_id`. */
export function spawnLoopChild(
  sqlite: Sqlite,
  loop_id: LoopId,
  opts: SpawnOptions = {},
  prior?: ActiveChild,
): void {
  const args: string[] = ['bun', RUN_TS_PATH, sqlite.filename, loop_id];
  if (opts.processor_delay_ms !== undefined) args.push(`--processor-delay-ms=${opts.processor_delay_ms}`);
  if (opts.cycles_target !== undefined) args.push(`--cycles-target=${opts.cycles_target}`);

  // Explicit env pass: Bun.spawn snapshots env at runtime startup and does NOT
  // pick up later process.env mutations unless the env object is passed
  // directly. Tests rely on setting OPENROUTER_BASE_URL etc. before the first
  // POST /start, so this spread is load-bearing.
  const proc = Bun.spawn(args, {
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
    env: { ...process.env },
  });

  const respawns = prior ? prior.respawns + 1 : 0;
  const child: ActiveChild = { proc, pid: proc.pid, respawns };
  active.set(loop_id, child);
  updateLoopChildPid(sqlite, loop_id, proc.pid);

  // Read stdout line-by-line and re-emit events into the API process bus.
  void pipeEvents(proc.stdout as ReadableStream<Uint8Array>, loop_id);

  // Mirror stderr to the API log for debugging crashed children.
  void drainStderr(proc.stderr as ReadableStream<Uint8Array>, loop_id);

  // Watch for exit; respawn on abnormal exit if the loop isn't terminal.
  void (async () => {
    await proc.exited;
    active.delete(loop_id);
    updateLoopChildPid(sqlite, loop_id, null);

    const loop = getLoop(sqlite, loop_id);
    if (!loop) return;
    const terminal = loop.status === 'completed' || loop.status === 'failed' || loop.status === 'cancelled';
    if (terminal) return;

    if (respawns >= MAX_RESPAWNS) {
      updateLoopStatus(sqlite, loop_id, 'failed');
      emitResearchEvent(loop_id, 'loop', {
        id: loop_id, status: 'failed', reason: `respawn_limit:${MAX_RESPAWNS}`,
      });
      return;
    }

    // exitCode 0 means clean exit but engine reported non-terminal — odd, but
    // respawn anyway. exitCode != 0 means crash or signal kill — respawn.
    spawnLoopChild(sqlite, loop_id, opts, child);
  })();
}

async function pipeEvents(stream: ReadableStream<Uint8Array>, loop_id: LoopId): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const evt = JSON.parse(line) as ResearchEvent;
          if (!evt.type || !KNOWN_EVENT_TYPES.has(evt.type)) continue;
          // Scope guard: only re-emit events for this loop (defence-in-depth
          // — the child shouldn't emit any others, but it's cheap).
          if (evt.session_id !== loop_id) continue;
          emitResearchEvent(evt.session_id, evt.type, evt.payload);
        } catch { /* malformed line — skip */ }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

async function drainStderr(stream: ReadableStream<Uint8Array>, loop_id: LoopId): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text.trim()) {
        process.stderr.write(`[loop ${loop_id}] ${text}`);
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

/** Test-only: synchronously kill the active child for `loop_id`. */
export function killLoopChild(loop_id: LoopId, signal: NodeJS.Signals = 'SIGKILL'): boolean {
  const c = active.get(loop_id);
  if (!c) return false;
  c.proc.kill(signal);
  return true;
}

/** Test-only: return the pid of the active child (or null). */
export function getActiveChildPid(loop_id: LoopId): number | null {
  return active.get(loop_id)?.pid ?? null;
}

/** Stop all active children — for graceful API shutdown. */
export async function stopAllChildren(): Promise<void> {
  const promises: Promise<unknown>[] = [];
  for (const child of active.values()) {
    child.proc.kill('SIGTERM');
    promises.push(child.proc.exited);
  }
  await Promise.allSettled(promises);
  active.clear();
}
