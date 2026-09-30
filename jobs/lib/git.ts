/**
 * git for aleph: plain calls, a tree with one file replaced, and the main
 * checkout following origin. Every write to main goes through a push that
 * git refuses when main moved, so the push is the compare-and-swap.
 */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A worker's env carries GIT_CONFIG_* to send its pushes nowhere. aleph's own
// writes (a to-do commit from a worker) are not the worker's push.
const baseEnv = (): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_CONFIG_")) delete env[k];
  return env;
};

export function git(cwd: string, ...args: string[]): { ok: boolean; out: string } {
  return gitWith({}, cwd, ...args);
}

export function gitWith(o: { env?: Record<string, string>; stdin?: string }, cwd: string, ...args: string[]): { ok: boolean; out: string } {
  const p = Bun.spawnSync(["git", ...args], {
    cwd, env: { ...baseEnv(), ...o.env }, stdin: o.stdin === undefined ? "ignore" : new Blob([o.stdin]), stdout: "pipe", stderr: "pipe",
  });
  return { ok: p.exitCode === 0, out: (p.stdout.toString() + (p.exitCode === 0 ? "" : p.stderr.toString())).trimEnd() };
}

/** The file at `path` in `rev`, or null when `rev` has no such file. */
export function show(cwd: string, rev: string, path: string): string | null {
  const r = git(cwd, "show", `${rev}:${path}`);
  return r.ok ? r.out + "\n" : null;
}

/** `tree` with `path` set to `content`, built in a temporary index: no working tree changes. */
export function treeWith(cwd: string, tree: string, path: string, content: string): string {
  const blob = gitWith({ stdin: content }, cwd, "hash-object", "-w", "--stdin");
  if (!blob.ok) throw new Error(`hash-object: ${blob.out}`);
  const index = join(tmpdir(), `aleph-index-${process.pid}-${crypto.randomUUID()}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    for (const args of [["read-tree", tree], ["update-index", "--add", "--cacheinfo", `100644,${blob.out},${path}`]]) {
      const r = gitWith({ env }, cwd, ...args);
      if (!r.ok) throw new Error(`${args[0]}: ${r.out}`);
    }
    const w = gitWith({ env }, cwd, "write-tree");
    if (!w.ok) throw new Error(`write-tree: ${w.out}`);
    return w.out;
  } finally {
    rmSync(index, { force: true });
  }
}

/**
 * Fast-forward the main checkout to origin/<main>. Returns why it could not,
 * or null. It never moves a checkout that is on another branch or has tracked changes.
 */
export function followMain(path: string, main: string): string | null {
  const head = git(path, "symbolic-ref", "--short", "HEAD").out;
  if (head !== main) return `main checkout not updated: it is on ${head || "a detached HEAD"}`;
  const dirty = git(path, "status", "--porcelain", "--untracked-files=no").out.split("\n").filter(Boolean).map((l) => l.slice(3));
  if (dirty.length) return `main checkout not updated: it has changes in ${dirty.join(", ")}`;
  const ff = git(path, "merge", "--ff-only", "-q", `origin/${main}`);
  return ff.ok ? null : `main checkout not updated: ${ff.out.split("\n")[0]}`;
}
