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

/**
 * HEAD and the dirty paths of one tree from a single `git status`: a record `# branch.oid <sha>`, then `1`, `2`, `u` (changed
 * against HEAD or the index) and `?` (untracked, not ignored) records. A rename record is followed by its old path, which is skipped.
 * With no commit yet, only untracked files count, as `git diff HEAD` fails there.
 */
function treeState(tree: string): { head: string; dirty: string[] } {
  const records = (git(tree, "status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z") ?? "").split("\0");
  const oid = records.find((r) => r.startsWith("# branch.oid "))?.slice("# branch.oid ".length) ?? "";
  const head = oid === "(initial)" ? "" : oid;
  const dirty: string[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const kind = r[0];
    if (kind === "?") dirty.push(r.slice(2));
    else if (!head) continue;
    else if (kind === "1") dirty.push(r.split(" ").slice(8).join(" "));
    else if (kind === "2") { dirty.push(r.split(" ").slice(9).join(" ")); i++; }
    else if (kind === "u") dirty.push(r.split(" ").slice(10).join(" "));
  }
  return { head, dirty };
}

/** null when cwd is not inside a git repo. */
export function snapshot(cwd: string): Snapshot | null {
  const trees = worktreesOf(cwd);
  if (trees.length === 0) return null;
  const snap: Snapshot = {};
  for (const tree of trees) {
    const { head, dirty } = treeState(tree);
    snap[`${tree}\0HEAD`] = head;
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

/** A doc or a mock is not code: changing only docs or mocks does not wake the gate. */
export const isCode = (path: string) => !/\.mdx?$/i.test(path) && !/\/docs\/mocks\//.test(path);
