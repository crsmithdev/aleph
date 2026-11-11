/**
 * Hooks are separate processes. A Pre* event leaves a small file that the
 * matching Post* event picks up, so a span can carry its real start time and
 * its parent. Files live in ~/.aleph/spool (ALEPH_SPOOL overrides, for tests).
 * Each kind of record has its own typed slot below; the key prefix is the kind.
 */
import { readJsonOr } from "../../lib/json.ts";
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { alephPath } from "../../lib/paths.ts";
import type { Snapshot } from "./snapshot.ts";

export function spoolDir(): string {
  return alephPath("ALEPH_SPOOL", "spool");
}

function pathFor(key: string): string {
  return join(spoolDir(), `${key.replace(/[^A-Za-z0-9_.:-]/g, "_")}.json`);
}

function slot<T>(key: string) {
  const get = (): T | null => {
    return readJsonOr<T | null>(pathFor(key), null);
  };
  return {
    get,
    set(value: T): void {
      mkdirSync(spoolDir(), { recursive: true });
      writeFileSync(pathFor(key), JSON.stringify(value));
    },
    take(): T | null {
      const value = get();
      if (value !== null) { try { unlinkSync(pathFor(key)); } catch { /* already gone */ } }
      return value;
    },
  };
}

/** Left by SessionStart: the name, tags and cwd every turn trace repeats, and the last turn's trace for a rating. */
export interface Session { start: number; name?: string; tags?: string[]; cwd?: string; lastTraceId?: string }
export const session = (id: string) => slot<Session>(`session:${id}`);

/** The turn's start, root span and prompt, from UserPromptSubmit to Stop. */
export const turn = (promptId: string) => slot<{ start: number; spanId?: string; input: string }>(`turn:${promptId}`);

/** A tool call's start and input, from PreToolUse to PostToolUse. */
export const tool = (toolUseId: string) => slot<{ start: number; input: unknown }>(`tool:${toolUseId}`);

/** A subagent's span and trace, from SubagentStart to SubagentStop. */
export const agent = (agentId: string) => slot<{ start: number; spanId: string; parentSpanId?: string; traceId: string }>(`agent:${agentId}`);

/** The repo's snapshot at the prompt, for the verify gate at Stop. */
export const snap = (promptId: string) => slot<Snapshot>(`snap:${promptId}`);

/** The verify gate's denials of this turn. */
export function denials(promptId: string) {
  const s = slot<number>(`denials:${promptId}`);
  return {
    count: (): number => s.get() ?? 0,
    add: (): void => s.set((s.get() ?? 0) + 1),
    clear: (): void => void s.take(),
  };
}

/** A mark for something that happens once per key, such as a block once per session. */
export function once(key: string) {
  const s = slot<number>(key);
  return { seen: (): boolean => s.get() !== null, mark: (): void => s.set(Date.now()) };
}

const MAX_AGE_MS = 86_400_000;

/** A Pre event whose Post never came leaves a file behind; drop anything older than a day. */
export function prune(): void {
  let names: string[];
  try { names = readdirSync(spoolDir()); } catch { return; }
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const name of names) {
    const path = join(spoolDir(), name);
    try { if (statSync(path).mtimeMs < cutoff) unlinkSync(path); } catch { /* raced with another hook */ }
  }
}
