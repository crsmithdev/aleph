/**
 * git for aleph: the one runner (a spawn that says where it failed, aleph's env, and a wait on another
 * process's index.lock), a fetch, a tree with files replaced, and the main checkout following origin.
 * Every write to main goes through a push that git refuses when main moved, so the push is the compare-and-swap.
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

export function gitWith(o: { env?: Record<string, string>; stdin?: string | Uint8Array }, cwd: string, ...args: string[]): { ok: boolean; out: string } {
  // Several facts gates write the vault in the same second; a git call that
  // meets another's index.lock waits and tries again (6 facts lost to it, 1 to 3 Nov).
  for (let i = 0; ; i++) {
    const p = spawnGit(["git", ...args], {
      cwd, env: { ...baseEnv(), ...o.env }, stdin: o.stdin === undefined ? "ignore" : new Blob([o.stdin as BlobPart]), stdout: "pipe", stderr: "pipe",
    });
    const r = { ok: p.exitCode === 0, out: (p.stdout.toString() + (p.exitCode === 0 ? "" : p.stderr.toString())).trimEnd() };
    if (r.ok || !r.out.includes("index.lock") || i === 10) return r;
    Bun.sleepSync(200 * (i + 1));
  }
}

/** The pause between two tries of a step that met a held git lock: `sleep` waits, Bun.sleepSync unless the caller passes Bun.sleep and awaits it. A test replaces it to free the lock. */
export const lockRetry = { pause: (sleep: (ms: number) => unknown = Bun.sleepSync): unknown => sleep(100 + Math.random() * 200) };

type Run = { ok: boolean; out: string };

/** The tries of a fetch: it yields the number of each try and takes its result. A try after the first waits out the ref lock that another process holds (up to 5 tries). */
function* fetchTries(): Generator<number, Run, Run> {
  let r = yield 0;
  for (let i = 1; i < 5 && !r.ok && r.out.includes("cannot lock ref"); i++) r = yield i;
  return r;
}

/** `git fetch -q origin <refs>`, tried again (up to 5 times) when another process holds the ref lock. Returns the last result. */
export function fetchOrigin(cwd: string, ...refs: string[]): Run {
  const tries = fetchTries();
  for (let t = tries.next(); ; ) {
    if (t.done) return t.value;
    if (t.value) lockRetry.pause();
    t = tries.next(git(cwd, "fetch", "-q", "origin", ...refs));
  }
}

/** fetchOrigin that does not block: each try is an async spawn and each pause an async sleep. */
export async function fetchOriginAsync(cwd: string, ...refs: string[]): Promise<Run> {
  const tries = fetchTries();
  for (let t = tries.next(); ; ) {
    if (t.done) return t.value;
    if (t.value) await lockRetry.pause(Bun.sleep);
    const p = Bun.spawn(["git", "fetch", "-q", "origin", ...refs], { cwd, env: baseEnv(), stdin: "ignore", stdout: "ignore", stderr: "pipe" });
    const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
    t = tries.next({ ok: code === 0, out: code === 0 ? "" : err.trimEnd() || `git fetch exited ${code}` });
  }
}

/** `tree` with each path in `files` set to its content, or removed when it is null. */
export function treeWithFiles(cwd: string, tree: string, files: Record<string, string | Uint8Array | null>): string {
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
