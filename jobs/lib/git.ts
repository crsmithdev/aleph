/**
 * git for aleph: plain calls, a tree with one file replaced, and the main
 * checkout following origin. Every write to main goes through a push that
 * git refuses when main moved, so the push is the compare-and-swap.
 */
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A worker's env carries GIT_CONFIG_* to send its pushes nowhere. aleph's own
// writes (an issue commit from a worker) are not the worker's push.
const baseEnv = (): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_CONFIG_")) delete env[k];
  return env;
};

/** `Bun.spawnSync` for git. A spawn that throws is rethrown with the original as `cause` and a one-line message that says where and with which PATH it ran. */
export function spawnGit(cmd: string[], opts: { cwd?: string; env?: Record<string, string | undefined>; stdin?: "ignore" | Blob; stdout: "pipe"; stderr: "pipe" | "ignore" }): { exitCode: number | null; stdout: Buffer; stderr: Buffer } {
  try {
    return Bun.spawnSync(cmd, opts) as { exitCode: number | null; stdout: Buffer; stderr: Buffer };
  } catch (e) {
    const cwd = opts.cwd;
    let here: string;
    try { here = process.cwd(); } catch (err) { here = `unreadable (${(err as Error).message})`; }
    const PATH = (opts.env ?? process.env).PATH;
    const found = Bun.which("git", { PATH: PATH ?? "" });
    const text = (e as Error).message.replace(/\s+/g, " ");
    throw new Error(
      `git could not start (${text}). The cwd passed is ${cwd === undefined ? "none" : JSON.stringify(cwd)}` +
      `${cwd === undefined ? "" : ` and ${existsSync(cwd) ? "exists" : "does not exist"} (existsSync ${existsSync(cwd)})`}. ` +
      `process.cwd() is ${here}. The PATH passed is ${JSON.stringify(PATH)}. Bun.which finds git at ${JSON.stringify(found)}. ` +
      `TMPDIR is ${JSON.stringify(process.env.TMPDIR)} and tmpdir() ${existsSync(tmpdir()) ? "exists" : "does not exist"} (existsSync ${existsSync(tmpdir())}).`,
      { cause: e },
    );
  }
}

export function git(cwd: string, ...args: string[]): { ok: boolean; out: string } {
  return gitWith({}, cwd, ...args);
}

export function gitWith(o: { env?: Record<string, string>; stdin?: string }, cwd: string, ...args: string[]): { ok: boolean; out: string } {
  const p = spawnGit(["git", ...args], {
    cwd, env: { ...baseEnv(), ...o.env }, stdin: o.stdin === undefined ? "ignore" : new Blob([o.stdin]), stdout: "pipe", stderr: "pipe",
  });
  return { ok: p.exitCode === 0, out: (p.stdout.toString() + (p.exitCode === 0 ? "" : p.stderr.toString())).trimEnd() };
}

/** `git fetch -q origin <refs>`, tried again (up to 5 times) when another process holds the ref lock. Returns the last result. */
export function fetchOrigin(cwd: string, ...refs: string[]): { ok: boolean; out: string } {
  let r = git(cwd, "fetch", "-q", "origin", ...refs);
  for (let i = 1; i < 5 && !r.ok && r.out.includes("cannot lock ref"); i++) {
    Bun.sleepSync(100 + Math.random() * 200);
    r = git(cwd, "fetch", "-q", "origin", ...refs);
  }
  return r;
}

/**
 * Clears what an ended job of that name left, then `git worktree add -q -b <branch> <wt> <base>`. Both write `.git/config`,
 * so when another process holds its lock the whole step is tried again (up to 5 times, the cleanup included). Returns the last result.
 */
export function addWorktree(repo: string, wt: string, branch: string, base: string): { ok: boolean; out: string } {
  const locked = (r: { ok: boolean; out: string }) => !r.ok && r.out.includes("could not lock config file");
  let r = { ok: false, out: "" };
  for (let i = 0; i < 5; i++) {
    if (i) Bun.sleepSync(100 + Math.random() * 200);
    git(repo, "worktree", "remove", "--force", wt);
    git(repo, "worktree", "prune");
    const del = git(repo, "branch", "-D", branch);
    r = locked(del) ? del : git(repo, "worktree", "add", "-q", "-b", branch, wt, base);
    if (!locked(r)) break;
  }
  return r;
}

/** The file at `path` in `rev`, or null when `rev` has no such file. */
export function show(cwd: string, rev: string, path: string): string | null {
  const r = git(cwd, "show", `${rev}:${path}`);
  return r.ok ? r.out + "\n" : null;
}

/** `tree` with `path` set to `content`, built in a temporary index: no working tree changes. */
export function treeWith(cwd: string, tree: string, path: string, content: string): string {
  return treeWithFiles(cwd, tree, { [path]: content });
}

/** `tree` with each path in `files` set to its content, or removed when it is null. */
export function treeWithFiles(cwd: string, tree: string, files: Record<string, string | null>): string {
  const index = join(tmpdir(), `aleph-index-${process.pid}-${crypto.randomUUID()}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    const steps = [["read-tree", tree]];
    for (const [path, content] of Object.entries(files)) {
      if (content === null) { steps.push(["update-index", "--force-remove", path]); continue; }
      const blob = gitWith({ stdin: content }, cwd, "hash-object", "-w", "--stdin");
      if (!blob.ok) throw new Error(`hash-object: ${blob.out}`);
      steps.push(["update-index", "--add", "--cacheinfo", `100644,${blob.out},${path}`]);
    }
    for (const args of steps) {
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
