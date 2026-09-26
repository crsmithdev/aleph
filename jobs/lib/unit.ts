/**
 * `aleph unit <run-folder>`: the body of one run, inside its systemd unit.
 * An agent run is setup, the worker, then the state rule; a plain run is one
 * command. Both end with state.json, then `exit`, then the news.
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { allJobs, loadRegistry, lock, newsLine, readEnvFile, readRun, tell, updateRun, type Repo, type Run } from "./ledger.ts";

let child: ReturnType<typeof Bun.spawn> | null = null;


export function git(cwd: string, ...args: string[]): { ok: boolean; out: string } {
  const p = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { ok: p.exitCode === 0, out: (p.stdout.toString() + (p.exitCode === 0 ? "" : p.stderr.toString())).trimEnd() };
}

interface Exec { code: number; timedOut: boolean }

/**
 * Run a command with its output appended to `out`. With a limit, it runs under
 * `timeout`, which puts the command in its own process group and signals the
 * group. Whether it timed out comes from this clock, not from the exit code.
 */
async function exec(argv: string[], o: { cwd: string; env: Record<string, string | undefined>; out: string; limit?: number; stdin?: string }): Promise<Exec> {
  const cmd = o.limit ? ["timeout", "--kill-after=30", String(o.limit), ...argv] : argv;
  const fd = openSync(o.out, "a");
  const start = Date.now();
  child = Bun.spawn(cmd, { cwd: o.cwd, env: o.env, stdin: o.stdin === undefined ? "ignore" : new Blob([o.stdin]), stdout: fd, stderr: fd });
  const code = await child.exited;
  child = null;
  closeSync(fd);
  return { code, timedOut: o.limit !== undefined && Date.now() - start >= o.limit * 1000 };
}

const limit = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

function tail(file: string, n: number): string {
  if (!existsSync(file)) return "";
  return readFileSync(file, "utf8").trimEnd().split("\n").slice(-n).join("\n");
}

/** The `result` of the last result event; else the last assistant text; else empty. */
export function resultText(log: string): string {
  let result: string | undefined;
  let text = "";
  for (const line of log.split("\n")) {
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.type === "result" && typeof ev.result === "string") result = ev.result;
    if (ev?.type === "assistant") {
      for (const block of ev.message?.content ?? []) if (block?.type === "text" && block.text) text = block.text;
    }
  }
  return result ?? text;
}

const FIXED = (run: Run, main: string) => `You are a worker on job \`${run.name}\` in \`${run.worktree}\`, branch \`${run.branch}\`. Work
only there. Commit every change on the branch; the run fails if anything is
left uncommitted or untracked. Never merge, never push, never touch another
branch. If the previous run was a failed land, rebase onto \`origin/${main}\`,
resolve the conflicts, and commit. If you need a decision from Chris, stop
and make your last line \`QUESTION: <one question>\`. End with a short summary
of what you did and what you ran.`;

/** The fixed text, the spec, every note in order, and the previous run's files. */
export function prompt(id: string, folder: string, run: Run, repo: Repo): string {
  const first = join(folder, "..", run.job);
  const parts = [FIXED(run, repo.main), `## Spec\n\n${readFileSync(join(first, "spec.md"), "utf8").trim()}`];
  const notesDir = join(first, "notes");
  if (existsSync(notesDir)) {
    for (const n of readdirSync(notesDir).sort()) parts.push(`## Note ${basename(n, ".md")}\n\n${readFileSync(join(notesDir, n), "utf8").trim()}`);
  }
  const runs = allJobs().find((j) => j[0].id === run.job) ?? [];
  const prev = runs[runs.findIndex((e) => e.id === id) - 1];
  if (prev) {
    const p = prev.run;
    parts.push(`## Previous run: ${p.kind}, ${p.state}${p.needs ? ` (${p.needs})` : ""}${p.reason ? `: ${p.reason}` : ""}`);
    for (const f of ["result.md", "checks.log", "land.log"]) {
      const file = join(prev.folder, f);
      if (existsSync(file)) parts.push(`### ${f}\n\n${readFileSync(file, "utf8").trim()}`);
    }
  }
  return parts.join("\n\n") + "\n";
}

/** Run every check with no `when`, and every check whose globs match a changed file. Returns why one failed. */
async function runChecks(folder: string, wt: string, repo: Repo, env: Record<string, string | undefined>, changed: string[], phase: (p: string) => void): Promise<string | null> {
  const matches = (globs: string[]) => changed.some((f) => globs.some((g) => new Bun.Glob(g).match(f)));
  for (const check of repo.checks) {
    if (check.when && !matches(check.when)) continue;
    phase(`check ${check.name}`);
    const out = join(folder, "check.out");
    writeFileSync(out, "");
    const r = await exec(["bash", "-c", check.run], { cwd: wt, env, out, limit: limit("ALEPH_CHECK_TIMEOUT", 1200) });
    appendFileSync(join(folder, "checks.log"), `## ${check.name}: exit ${r.code}${r.timedOut ? " (timed out)" : ""}\n${tail(out, 100)}\n\n`);
    if (r.timedOut) return `timed out: check ${check.name}`;
    if (r.code !== 0) return `${check.name} failed`;
  }
  return null;
}

/**
 * Land a job: rebase onto origin/<main>, run the checks, push one squash
 * commit as a fast-forward. Every failure leaves the remote as it was.
 */
async function land(folder: string, run: Run, repo: Repo, env: Record<string, string | undefined>): Promise<{ verdict: Verdict; code: number }> {
  const wt = run.worktree!;
  const main = repo.main;
  const logFile = join(folder, "land.log");
  const log = (step: string, out = "") => appendFileSync(logFile, `## ${step}\n${out ? out + "\n" : ""}\n`);
  const step = (name: string, ...args: string[]) => { const r = git(wt, ...args); log(`${name}: ${r.ok ? "ok" : "failed"}`, r.out); return r; };
  const phase = (p: string) => updateRun(folder, { phase: p });
  const fail = (reason: string) => { log(`failed: ${reason}`); return { verdict: { state: "failed" as const, reason }, code: 1 }; };

  const release = await lock(`job-${repo.key}-${run.name}`, 60_000);
  if (!release) return fail("job lock busy");
  try {
    phase("land");
    if (existsSync(join(git(wt, "rev-parse", "--absolute-git-dir").out, "rebase-merge"))) step("abort rebase in progress", "rebase", "--abort");
    if (!step("fetch", "fetch", "-q", "origin").ok) return fail("fetch failed");
    const base = git(wt, "merge-base", `origin/${main}`, "HEAD").out;
    const subjects = git(wt, "log", "--reverse", "--format=%s", `${base}..HEAD`).out.split("\n").filter(Boolean);
    if (!step("rebase", "rebase", `origin/${main}`).ok) {
      step("abort rebase", "rebase", "--abort");
      return fail("rebase conflict");
    }
    if (git(wt, "rev-parse", "HEAD^{tree}").out === git(wt, "rev-parse", `origin/${main}^{tree}`).out) {
      log("no net change");
      removeWorktree(repo, run);
      return { verdict: { state: "done", reason: "no net change" }, code: 0 };
    }
    const changed = git(wt, "diff", "--name-only", `origin/${main}`, "HEAD").out.split("\n").filter(Boolean);
    const failed = await runChecks(folder, wt, repo, env, changed, phase);
    if (failed) return fail(failed);
    phase("land");
    const message = [subjects[0] ?? run.name, "", ...(subjects.length > 1 ? subjects.map((s) => `- ${s}`) : []), `Job: ${run.job}`].join("\n");
    const commit = step("commit-tree", "commit-tree", "HEAD^{tree}", "-p", `origin/${main}`, "-m", message);
    if (!commit.ok) return fail("commit-tree failed");
    if (!step("push", "push", "-q", "origin", `${commit.out}:refs/heads/${main}`).ok) return fail("push refused");

    // The main checkout follows only when it is on <main> with no tracked changes.
    let reason: string | undefined;
    const head = git(repo.path, "symbolic-ref", "--short", "HEAD").out;
    const dirty = git(repo.path, "status", "--porcelain", "--untracked-files=no").out;
    if (head !== main || dirty || !git(repo.path, "merge", "--ff-only", "-q", commit.out).ok) reason = "main checkout not updated";
    log(reason ?? "main checkout updated");
    removeWorktree(repo, run);
    return { verdict: { state: "landed", commit: commit.out, reason }, code: 0 };
  } finally {
    release();
  }
}

function removeWorktree(repo: Repo, run: Run): void {
  git(repo.path, "worktree", "remove", "--force", run.worktree!);
  git(repo.path, "worktree", "prune");
  git(repo.path, "branch", "-D", run.branch!);
}

type Verdict = Pick<Run, "state" | "needs" | "reason" | "question" | "say" | "commit">;

export async function unit(folder: string): Promise<void> {
  // drop sends SIGTERM when no systemd unit is there to stop the cgroup.
  process.on("SIGTERM", () => {
    if (child) {
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
      try { child.kill("SIGKILL"); } catch {}
    }
    process.exit(143);
  });
  writeFileSync(join(folder, "pid"), String(process.pid));
  const id = basename(folder);
  const run = readRun(folder)!;
  const repo = run.repo ? loadRegistry()[run.repo] : undefined;
  const dispatcherPath = process.env.PATH;
  const env: Record<string, string | undefined> = {
    ...process.env, ...readEnvFile(repo?.env ?? process.env.ALEPH_RUN_ENV),
    PATH: dispatcherPath, HOME: homedir(), ALEPH_JOB_ID: run.job, ALEPH_JOB_RUN: id,
  };
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDECODE;
  delete env.ALEPH_RUN_ENV;

  let verdict: Verdict;
  let code = 0;
  try {
    if (run.kind === "plain") {
      const r = await exec(["bash", "-c", readFileSync(join(folder, "command.txt"), "utf8")], { cwd: process.cwd(), env, out: join(folder, "output.log") });
      code = r.code;
      verdict = code === 0 ? { state: "done" } : { state: "failed", reason: `exited ${code}` };
    } else if (run.kind === "land") {
      ({ verdict, code } = await land(folder, run, repo!, env));
    } else {
      ({ verdict, code } = await agent(id, folder, run, repo!, env));
    }
  } catch (e: any) {
    verdict = { state: "failed", reason: `error: ${e?.message ?? e}` };
    code = 1;
  }

  const ended = updateRun(folder, { ...verdict, phase: undefined, ended: new Date().toISOString() });
  writeFileSync(join(folder, "exit"), String(code));
  if (await tell(newsLine(ended, repo?.note))) updateRun(folder, { told: true });
}

async function agent(id: string, folder: string, run: Run, repo: Repo, env: Record<string, string | undefined>): Promise<{ verdict: Verdict; code: number }> {
  const wt = run.worktree!;
  const branch = run.branch!;
  const phase = (p: string) => updateRun(folder, { phase: p });
  const fail = (reason: string) => ({ verdict: { state: "failed" as const, reason }, code: 1 });

  // A new job starts from origin/<main>, after it clears what an ended job of that name left.
  if (run.job === id || !existsSync(wt)) {
    phase("setup");
    if (!git(repo.path, "fetch", "-q", "origin").ok) return fail("fetch failed");
    git(repo.path, "worktree", "remove", "--force", wt);
    git(repo.path, "worktree", "prune");
    git(repo.path, "branch", "-D", branch);
    const add = git(repo.path, "worktree", "add", "-q", "-b", branch, wt, `origin/${repo.main}`);
    if (!add.ok) return fail(`worktree add failed: ${add.out}`);
  }

  const marker = join(git(wt, "rev-parse", "--absolute-git-dir").out, "aleph-setup");
  if (!existsSync(marker)) {
    phase("setup");
    for (const cmd of repo.setup) {
      appendFileSync(join(folder, "setup.log"), `## ${cmd}\n`);
      const r = await exec(["bash", "-c", cmd], { cwd: wt, env, out: join(folder, "setup.log"), limit: limit("ALEPH_CHECK_TIMEOUT", 1200) });
      if (r.timedOut) return fail(`timed out: setup ${cmd}`);
      if (r.code !== 0) return fail(`setup failed: ${cmd}`);
    }
    writeFileSync(marker, "");
  }

  // The worker cannot push to github or reach gh; see "No push, no gh" in the spec.
  const ghDir = join(folder, "gh");
  mkdirSync(ghDir, { recursive: true });
  const workerEnv = {
    ...env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "url.aleph-no-push:.pushInsteadOf", GIT_CONFIG_VALUE_0: "git@github.com:",
    GH_CONFIG_DIR: ghDir, GH_TOKEN: undefined, GITHUB_TOKEN: undefined,
  };
  const argv = [process.env.ALEPH_WORKER_CMD ?? "claude", "-p", "--tools", "Read", "Write", "Edit", "Bash", "Grep", "Glob", "Skill",
    "--session-id", run.session!, "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions",
    ...(run.model ? ["--model", run.model] : [])];
  const text = prompt(id, folder, run, repo);
  writeFileSync(join(folder, "prompt.md"), text);
  phase("worker");
  const w = await exec(argv, { cwd: wt, env: workerEnv, out: join(folder, "output.log"), limit: limit("ALEPH_JOB_TIMEOUT", 2400), stdin: text });
  const result = resultText(readFileSync(join(folder, "output.log"), "utf8"));
  writeFileSync(join(folder, "result.md"), result);

  // The state rule: the first match wins.
  if (w.timedOut) return fail("timed out: worker");
  if (w.code !== 0) return { verdict: { state: "failed", reason: `worker exited ${w.code}` }, code: w.code };
  const question = result.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("QUESTION:")).at(-1);
  if (question) return { verdict: { state: "needs-you", needs: "question", question: question.slice("QUESTION:".length).trim() }, code: 0 };
  const dirty = git(wt, "status", "--porcelain").out;
  if (dirty) return fail(`uncommitted: ${dirty.split("\n")[0].slice(3)}`);
  if (!git(wt, "fetch", "-q", "origin").ok) return fail("fetch failed");
  const base = git(wt, "merge-base", `origin/${repo.main}`, "HEAD").out;
  if (git(wt, "rev-list", "--count", `${base}..HEAD`).out === "0") {
    removeWorktree(repo, run);
    return { verdict: { state: "done", reason: "no commits" }, code: 0 };
  }
  const changed = git(wt, "diff", "--name-only", base, "HEAD").out.split("\n").filter(Boolean);
  const failed = await runChecks(folder, wt, repo, env, changed, phase);
  if (failed) return fail(failed);
  const matches = (globs: string[]) => changed.some((f) => globs.some((g) => new Bun.Glob(g).match(f)));
  const manual = repo.manual.find((m) => matches(m.when));
  if (manual) return { verdict: { state: "needs-you", needs: "manual", say: manual.say }, code: 0 };
  return { verdict: { state: "passed" }, code: 0 };
}
