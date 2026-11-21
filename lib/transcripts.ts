/** Claude Code's transcripts: the file of a session, and each tool call with its result. */
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Entry } from "./jsonl.ts";
import { claudeProjects } from "./paths.ts";

/** A tool call's `tool_use` block and the `tool_result` block that answers it; either is absent when the transcript has only the other. */
export interface Pair { use?: Entry; result?: Entry }

/** The transcript of session `id`: one lookup in each project folder, not a scan of every transcript. */
export function find(id: string): string | undefined {
  const root = claudeProjects();
  if (!existsSync(root)) return undefined;
  for (const p of readdirSync(root)) { const f = join(root, p, `${id}.jsonl`); if (existsSync(f)) return f; }
}

/** Every transcript: its session id, its project folder, its path and its mtime in ms. */
export function list(): { id: string; project: string; path: string; at: number }[] {
  const root = claudeProjects();
  if (!existsSync(root)) return [];
  return [...new Bun.Glob("*/*.jsonl").scanSync({ cwd: root })].map((f) => {
    const path = join(root, f);
    return { id: basename(f, ".jsonl"), project: dirname(f), path, at: statSync(path).mtimeMs };
  });
}

/** Each tool call of `entries` with its result, by tool_use id, in the order the calls were made. */
export function pairs(entries: Iterable<Entry>): Map<string, Pair> {
  const out = new Map<string, Pair>();
  for (const e of entries) for (const b of [e.message?.content].flat()) {
    if (b?.type === "tool_use") out.set(b.id, { ...out.get(b.id), use: b });
    if (b?.type === "tool_result") out.set(b.tool_use_id, { ...out.get(b.tool_use_id), result: b });
  }
  return out;
}
