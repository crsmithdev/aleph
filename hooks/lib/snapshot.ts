/**
 * A fingerprint of a repo and every worktree it lists, except subagent
 * worktrees under .claude/worktrees: HEAD, and a hash of each dirty file
 * (changed against HEAD, or untracked and not ignored). Two fingerprints
 * give the files the turn changed.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { probe } from "../../lib/git.ts";

/** Key `<tree>\0HEAD` holds the HEAD sha; key `<tree>\0<path>` holds a hash of that dirty file. */
export type Snapshot = Record<string, string>;

function git(cwd: string, ...args: string[]): string | null {
  const r = probe(cwd, ...args);
  return r.ok ? r.out : null;
}

function worktreesOf(cwd: string): string[] {
  const top = git(cwd, "rev-parse", "--show-toplevel")?.trim();
  if (!top) return [];
  const listed = git(top, "worktree", "list", "--porcelain") ?? "";
  const paths = listed.split("\n").filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length));
  // A subagent's worktree under .claude/worktrees holds another agent's edits, not this turn's, unless cwd is in it.
  const own = paths.filter((p) => p === top || !p.includes("/.claude/worktrees/"));
  return own.length ? own : [top];
}

/** A file that vanishes or cannot be read hashes as "missing". */
function fileHash(path: string): string {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return "missing";
  }
}

const names = (out: string | null) => (out ?? "").split("\0").filter(Boolean);

/** null when cwd is not inside a git repo. */
export function snapshot(cwd: string): Snapshot | null {
  const trees = worktreesOf(cwd);
  if (trees.length === 0) return null;
  const snap: Snapshot = {};
  for (const tree of trees) {
    snap[`${tree}\0HEAD`] = git(tree, "rev-parse", "HEAD")?.trim() ?? "";
    const dirty = [...names(git(tree, "diff", "HEAD", "--name-only", "-z")), ...names(git(tree, "ls-files", "--others", "--exclude-standard", "-z"))];
    for (const name of dirty) snap[`${tree}\0${name}`] = fileHash(join(tree, name));
  }
  return snap;
}

/**
 * The files, as absolute paths, that differ between two snapshots: dirty files that changed, and files in
 * the commits a HEAD gained that no HEAD in `before` reaches. That covers a worktree the turn created.
 */
export function changedFiles(before: Snapshot, after: Snapshot): string[] {
  const out = new Set<string>();
  const heads = Object.entries(before).filter(([k, v]) => k.endsWith("\0HEAD") && v).map(([, v]) => v);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] === after[key]) continue;
    const [tree, name] = key.split("\0");
    if (name !== "HEAD") { out.add(join(tree, name)); continue; }
    const to = after[key];
    if (!to) continue;
    const log = git(tree, "-c", "core.quotepath=off", "log", "--name-only", "--format=", to, "--not", ...heads) ?? "";
    for (const f of log.split("\n").filter(Boolean)) out.add(join(tree, f));
  }
  return [...out];
}

/** A doc is not code: changing only docs does not wake the gate. */
export const isCode = (path: string) => !/\.mdx?$/i.test(path);
