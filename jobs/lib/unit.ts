/**
 * `aleph unit <run-folder>`: the body of one run, inside its systemd unit.
 * An agent run is setup, the worker, then the state rule; a plain run is one
 * command. Both end with state.json, then `exit`, then the news.
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import * as todos from "../../todo/lib/todo.ts";
import { TODO_PATH, writeList } from "../../todo/lib/store.ts";
import { followMain, git, show, treeWith } from "./git.ts";
import { allJobs, loadRegistry, lock, newsLine, readEnvFile, readRun, tell, updateRun, type Repo, type Run } from "./ledger.ts";

export { git };

let child: ReturnType<typeof Bun.spawn> | null = null;


interface Exec { code: number; timedOut: boolean }

/**
 * Run a command with its output appended to `out`. With a limit, it runs under
 * `timeout`, which puts the command in its own process group and signals the
 * group. Whether it timed out comes from this clock, not from the exit code,
 * which the command can return by itself. The clock is performance.now(), which
 * only moves forward: Date.now() follows the wall clock, which WSL can set back.
 */
async function exec(argv: string[], o: { cwd: string; env: Record<string, string | undefined>; out: string; limit?: number; stdin?: string }): Promise<Exec> {
  const cmd = o.limit ? ["timeout", "--kill-after=30", String(o.limit), ...argv] : argv;
  const fd = openSync(o.out, "a");
  const start = performance.now();
  child = Bun.spawn(cmd, { cwd: o.cwd, env: o.env, stdin: o.stdin === undefined ? "ignore" : new Blob([o.stdin]), stdout: fd, stderr: fd });
  const code = await child.exited;
  child = null;
  closeSync(fd);
  return { code, timedOut: o.limit !== undefined && performance.now() - start >= o.limit * 1000 };
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
 * Where a job's work is on origin/<main>, or null. First a `Job:` trailer: the
 * squash carries one, and so does each worker commit. Then, while the branch
 * exists and has a net change, a merge of it into main that leaves main's tree
 * as it is: the work is already there, however it got there.
 */
export function onMain(repo: Repo, run: Run): { commit: string; how: string } | null {
  const main = `origin/${repo.main}`;
  const trailer = git(repo.path, "log", main, "-1", "--format=%H", "-E", `--grep=^Job: ${run.job}$`).out;
  if (trailer) return { commit: trailer, how: "Job trailer" };
  if (!run.branch) return null;
  const tip = git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${run.branch}`);
  if (!tip.ok) return null;
  const fork = git(repo.path, "merge-base", tip.out, main).out;
  const treeOf = (rev: string) => git(repo.path, "rev-parse", `${rev}^{tree}`).out;
  if (!fork || treeOf(tip.out) === treeOf(fork)) return null;
  const merged = git(repo.path, "merge-tree", "--write-tree", main, tip.out);
  if (merged.ok && merged.out.split("\n")[0] === treeOf(main)) return { commit: git(repo.path, "rev-parse", main).out, how: "content" };
  return null;
}

/**
 * The tree to push: the checked tree, with the list from `onto`, the job's
 * item marked done, and a new item for an open manual check. When the branch
 * changed the list itself, its copy is the one used.
 */
function squashTree(wt: string, run: Run, onto: string, ownList: boolean): { tree: string; todo?: string; checkItem?: number } {
  const head = git(wt, "rev-parse", "HEAD^{tree}").out;
  const shown = show(wt, ownList ? "HEAD" : onto, TODO_PATH);
  const open = run.check === "open";
  if (shown === null && !open) return { tree: head, todo: run.todo === undefined ? undefined : `no ${TODO_PATH}` };
  const text = shown ?? todos.render(todos.blank(run.repo ?? ""));
  // With nothing to change, the list goes in byte for byte.
  if (run.todo === undefined && !open) return { tree: text === show(wt, "HEAD", TODO_PATH) ? head : treeWith(wt, head, TODO_PATH, text) };
  const doc = todos.parse(text);
  let todo: string | undefined;
  if (run.todo !== undefined) {
    const item = todos.find(doc, run.todo);
    if (item) {
      todos.setStatus(item, "done");
      todos.note(item, `job ${run.name} landed`);
    }
    todo = item ? "done" : `no item ${run.todo}`;
  }
  const checkItem = open ? todos.add(doc, `Check ${run.name}: ${run.say}`, { labels: ["check"] }).id : undefined;
  return { tree: treeWith(wt, head, TODO_PATH, todos.render(doc)), todo, checkItem };
}

const PUSHES = 5;
const MOVED = "main moved during the land; land again";

/**
 * Land a job: rebase onto origin/<main>, run the checks, push one squash
 * commit as a fast-forward. The job's to-do item closes in that commit. When
 * main moved by a to-do commit alone, the checked tree still holds, so the
 * squash goes onto the new main without a new check. Every failure leaves the
 * remote as it was.
 */
async function land(folder: string, run: Run, repo: Repo, env: Record<string, string | undefined>): Promise<{ verdict: Verdict; code: number }> {
  const wt = run.worktree!;
  const main = repo.main;
  const logFile = join(folder, "land.log");
  const log = (step: string, out = "") => appendFileSync(logFile, `## ${step}\n${out ? out + "\n" : ""}\n`);
  const step = (name: string, ...args: string[]) => { const r = git(wt, ...args); log(`${name}: ${r.ok ? "ok" : "failed"}`, r.out); return r; };
  const phase = (p: string) => updateRun(folder, { phase: p });
  const fail = (reason: string, extra: Partial<Verdict> = {}) => { log(`failed: ${reason}`); return { verdict: { state: "failed" as const, reason, ...extra }, code: 1 }; };

  const release = await lock(`job-${repo.key}-${run.name}`, 60_000);
  if (!release) return fail("job lock busy");
  let releaseRepo: (() => void) | null = null;
  try {
    phase("land");
    if (!existsSync(wt)) {
      // The work may have reached main another way before its worktree went.
      git(repo.path, "fetch", "-q", "origin");
      const found = onMain(repo, run);
      if (!found) return fail(`worktree gone: ${wt}`);
      log(`already on main as ${found.commit} (${found.how})`);
      return { verdict: { state: "landed", commit: found.commit, reason: `found on main (${found.how})` }, code: 0 };
    }
    if (existsSync(join(git(wt, "rev-parse", "--absolute-git-dir").out, "rebase-merge"))) step("abort rebase in progress", "rebase", "--abort");
    // One land at a time per repo, from the fetch to the push. The checks run inside it.
    releaseRepo = await lock(`land-${repo.key}`, Infinity);
    if (!step("fetch", "fetch", "-q", "origin").ok) return fail("fetch failed");
    // origin/<main> is shared by every worktree, and another land's push moves it.
    // Everything after the fetch uses this commit, so a move makes the push non-fast-forward.
    const base = git(wt, "rev-parse", `origin/${main}`).out;
    const fork = git(wt, "merge-base", base, "HEAD").out;
    const subjects = git(wt, "log", "--reverse", "--format=%s", `${fork}..HEAD`).out.split("\n").filter(Boolean);
    if (!step("rebase", "rebase", base).ok) {
      // Read before the abort, which clears them.
      const conflicts = git(wt, "diff", "--name-only", "--diff-filter=U").out.split("\n").filter(Boolean);
      log("conflicts", conflicts.join("\n"));
      step("abort rebase", "rebase", "--abort");
      return fail("rebase conflict", { conflicts });
    }
    if (git(wt, "rev-parse", "HEAD^{tree}").out === git(wt, "rev-parse", `${base}^{tree}`).out) {
      log("no net change");
      removeWorktree(repo, run);
      return { verdict: { state: "done", reason: "no net change" }, code: 0 };
    }
    const changed = git(wt, "diff", "--name-only", base, "HEAD").out.split("\n").filter(Boolean);
    const failed = await runChecks(folder, wt, repo, env, changed, phase);
    if (failed) return fail(failed);
    phase("land");
    const message = [subjects[0] ?? run.name, "", ...(subjects.length > 1 ? subjects.map((s) => `- ${s}`) : []), `Job: ${run.job}`].join("\n");
    const ownList = changed.includes(TODO_PATH);
    let onto = base;
    let commit = "";
    let todo: string | undefined;
    let checkItem: number | undefined;
    for (let attempt = 1; ; attempt++) {
      const squash = squashTree(wt, run, onto, ownList);
      todo = squash.todo;
      checkItem = squash.checkItem;
      const c = step("commit-tree", "commit-tree", squash.tree, "-p", onto, "-m", message);
      if (!c.ok) return fail("commit-tree failed");
      if (step("push", "push", "-q", "origin", `${c.out}:refs/heads/${main}`).ok) { commit = c.out; break; }
      if (!step("fetch", "fetch", "-q", "origin").ok) return fail("fetch failed");
      const moved = git(wt, "rev-parse", `origin/${main}`).out;
      if (moved === onto) return fail("push refused");
      const between = git(wt, "diff", "--name-only", onto, moved).out.split("\n").filter(Boolean);
      if (ownList || attempt === PUSHES || between.some((f) => f !== TODO_PATH)) return fail(MOVED);
      log(`main moved by a to-do commit; the squash goes onto ${moved}`);
      onto = moved;
    }
    if (todo) log(todo === "done" ? `todo ${run.todo} done` : `todo ${run.todo} not closed: ${todo}`);
    if (checkItem !== undefined) log(`todo ${checkItem} holds the manual check`);

    const reason = followMain(repo.path, main) ?? undefined;
    log(reason ?? "main checkout updated");
    removeWorktree(repo, run);
    return { verdict: { state: "landed", commit, reason, checkItem }, code: 0 };
  } finally {
    releaseRepo?.();
    release();
  }
}

/**
 * `aleph todo done` (with `done`) or `aleph todo note` for a job's item, as a
 * commit on origin/<main>. Returns why it could not, for the caller to report.
 */
export function updateTodo(repo: Repo, id: number, text: string, done: boolean): string | null {
  try {
    let found = false;
    writeList(repo, `todo: item ${id}: ${text}`, (doc) => {
      const item = todos.find(doc, id);
      if (!item) return null;
      found = true;
      if (done) todos.setStatus(item, "done");
      return todos.note(item, text);
    });
    return found ? null : `no item ${id}`;
  } catch (e: any) {
    return e?.message ?? String(e);
  }
}

/**
 * Give each of the worker's commits a `Job:` trailer, so work that reaches
 * main by hand is still found (onMain). A branch with a merge keeps its
 * commits as they are, because the rebase would flatten it.
 */
function stampJob(wt: string, base: string, job: string): void {
  const bare = git(wt, "log", "--format=%H", "--invert-grep", "-E", `--grep=^Job: ${job}$`, `${base}..HEAD`).out;
  if (!bare || git(wt, "rev-list", "--merges", `${base}..HEAD`).out) return;
  const amend = `git -c core.hooksPath=/dev/null commit -q --amend --no-edit --no-verify --trailer 'Job: ${job}'`;
  if (!git(wt, "-c", "core.hooksPath=/dev/null", "rebase", "-q", "--exec", amend, base).ok) git(wt, "rebase", "--abort");
}

export function removeWorktree(repo: Repo, run: Run): void {
  git(repo.path, "worktree", "remove", "--force", run.worktree!);
  git(repo.path, "worktree", "prune");
  git(repo.path, "branch", "-D", run.branch!);
}

type Verdict = Pick<Run, "state" | "needs" | "reason" | "question" | "say" | "commit" | "conflicts" | "checkItem">;

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

  // The job variables are for the worker: a check that runs aleph's own tests must not see them.
  const checkEnv = { ...env, ALEPH_JOB_ID: undefined, ALEPH_JOB_RUN: undefined };

  let verdict: Verdict;
  let code = 0;
  try {
    if (run.kind === "plain") {
      const r = await exec(["bash", "-c", readFileSync(join(folder, "command.txt"), "utf8")], { cwd: process.cwd(), env, out: join(folder, "output.log") });
      code = r.code;
      verdict = code === 0 ? { state: "done" } : { state: "failed", reason: `exited ${code}` };
    } else if (run.kind === "land") {
      ({ verdict, code } = await land(folder, run, repo!, checkEnv));
    } else {
      ({ verdict, code } = await agent(id, folder, run, repo!, env, checkEnv));
    }
  } catch (e: any) {
    verdict = { state: "failed", reason: `error: ${e?.message ?? e}` };
    code = 1;
  }

  let ended = updateRun(folder, { ...verdict, phase: undefined, ended: new Date().toISOString() });
  const next = nextStep(ended, repo);
  if (next) ended = updateRun(folder, { next });
  writeFileSync(join(folder, "exit"), String(code));
  if (await tell(newsLine(ended, repo?.note))) updateRun(folder, { told: true });
  if (next) await start(folder, ended, next);
}

const BOUNCES = 2;
const RELANDS = 3;

/**
 * What the unit starts after a run ends. A land that conflicts goes back to
 * the worker, at most BOUNCES times a job; a land that lost a race lands
 * again, at most RELANDS times; an agent run lands when it passes, when it was
 * started with --land or its repo lands by itself.
 */
function nextStep(run: Run, repo: Repo | undefined): Run["next"] {
  if (run.kind === "agent") return run.state === "passed" && (run.land || repo?.autoland) ? "land" : undefined;
  if (run.kind !== "land" || run.state !== "failed") return undefined;
  const lands = (allJobs().find((j) => j[0].id === run.job) ?? []).filter((e) => e.run.kind === "land").map((e) => e.run);
  if (run.conflicts?.length) return lands.filter((r) => r.conflicts?.length).length <= BOUNCES ? "worker" : undefined;
  if (run.reason === MOVED) return lands.filter((r) => r.reason === MOVED).length <= RELANDS ? "land" : undefined;
  return undefined;
}

/** Start the next run through the CLI, as Chris would. Its refusal goes to next.log. */
async function start(folder: string, run: Run, next: NonNullable<Run["next"]>): Promise<void> {
  const cli = join(import.meta.dir, "..", "cli.ts");
  const argv = next === "land" ? ["land", run.name] : ["job", run.repo!, run.name, "--spec", "-", "--land"];
  const note = `The land conflicted with origin/main in: ${(run.conflicts ?? []).join(", ")}. Rebase onto origin/main, resolve each conflict so that the change on main and this job's change both survive, run the tests, and commit.`;
  const log = openSync(join(folder, "next.log"), "a");
  const p = Bun.spawn([process.execPath, cli, ...argv], { env: process.env, stdin: next === "worker" ? new Blob([note]) : "ignore", stdout: log, stderr: log });
  const code = await p.exited;
  closeSync(log);
  if (code !== 0) updateRun(folder, { next: undefined });
}

async function agent(id: string, folder: string, run: Run, repo: Repo, env: Record<string, string | undefined>, checkEnv: Record<string, string | undefined>): Promise<{ verdict: Verdict; code: number }> {
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
      const r = await exec(["bash", "-c", cmd], { cwd: wt, env: checkEnv, out: join(folder, "setup.log"), limit: limit("ALEPH_CHECK_TIMEOUT", 1200) });
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
  stampJob(wt, base, run.job);
  const changed = git(wt, "diff", "--name-only", base, "HEAD").out.split("\n").filter(Boolean);
  const failed = await runChecks(folder, wt, repo, checkEnv, changed, phase);
  if (failed) return fail(failed);
  const matches = (globs: string[]) => changed.some((f) => globs.some((g) => new Bun.Glob(g).match(f)));
  // A manual check does not hold the run: it lands with the check open (see land).
  const manual = repo.manual.find((m) => matches(m.when));
  return { verdict: { state: "passed", ...(manual ? { say: manual.say } : {}) }, code: 0 };
}
