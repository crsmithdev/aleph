/**
 * `aleph unit <run-folder>`: the body of one run, inside its systemd unit.
 * An agent run is setup, the worker, then the state rule; a plain run is one
 * command. Both end with state.json, then `exit`, then the news.
 */
import { appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import * as todos from "../../todo/lib/todo.ts";
import { writeList } from "../../todo/lib/store.ts";
import { git } from "./git.ts";
import { heldRule, outcome, tagged, verdict as reviewVerdict } from "./gate.ts";
import { allJobs, allRuns, isLive, loadRegistry, lock, newsLine, readEnvFile, readRun, tell, updateRun, type Repo, type Run } from "./ledger.ts";
import { makeRunFolder, removeRunFolder, sandboxed, workerToken } from "./sandbox.ts";
import { paused } from "./factory.ts";
import { FACTS_REF, writeFacts } from "./status.ts";

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
branch. \`aleph issue\` is not your push: it writes the list of issues on main by
itself, so use it for every change to the list. If the previous run was a
failed land, merge \`origin/${main}\` into the branch, resolve the conflicts,
and commit. If you need a decision from Chris, stop
and make your last line \`QUESTION: <one question>\`. End with a short summary
of what you did and what you ran.`;

const FACTORY = (run: Run, main: string) => `You are a worker on job \`${run.name}\`, in a git repo on branch \`${run.branch}\`, inside
a sandbox. You see this repo and nothing else of the machine, and the network
reaches only the Anthropic API and npm. Do the goal below. Commit every change
on the branch: only commits leave the sandbox. Never switch to another branch
and never push. If the previous run's land conflicted, merge \`origin/${main}\`
into the branch and resolve the conflicts so that both changes survive. Nobody
answers questions during the run: when you must choose, take the answer you
would recommend and print a line \`DEFAULT: <question> -> <answer>\`. For work
you find but do not do, print a line \`FOLLOWUP: <title>\`. Run the repo's
tests before you end. End with a short summary of what you did and what you ran.`;

/** The fixed text, the spec, every note in order, and the previous run's files. */
export function prompt(id: string, folder: string, run: Run, repo: Repo): string {
  const first = join(folder, "..", run.job);
  const parts = [(repo.sandbox ? FACTORY : FIXED)(run, repo.main), `## Spec\n\n${readFileSync(join(first, "spec.md"), "utf8").trim()}`];
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
 * After the push: the job's issue done in the work store, and a new issue for
 * an open manual check. Returns what happened to each, for the land log.
 */
function closeItems(repo: Repo, run: Run): { todo?: string; checkItem?: number } {
  const open = run.check === "open";
  if (run.todo === undefined && !open) return {};
  let todo: string | undefined;
  let checkItem: number | undefined;
  try {
    writeList(repo, `todo: job ${run.name} landed`, (doc) => {
      if (run.todo !== undefined) {
        const item = todos.find(doc, run.todo);
        if (item) {
          todos.setStatus(item, "done");
          todos.note(item, `job ${run.name} landed`);
        }
        todo = item ? "done" : `no issue ${run.todo}`;
      }
      if (open) checkItem = todos.add(doc, `Check ${run.name}: ${run.say}`, { labels: ["check"] }).id;
      return true;
    }, true);
  } catch (e: any) {
    todo = e?.message ?? String(e);
  }
  return { todo, checkItem };
}

// The lists left product repos for the work store. A branch made before that
// still has the old file, and landing it would bring the file back.
const TODO_PATH = "docs/todo.md";

const MOVED = "main moved during the land; land again";
const OWN_LIST = `the branch changes ${TODO_PATH}; change the list with aleph issue`;

/**
 * Wait until no older land of this repo is still live, then hold the repo's
 * land lock. A land run is made when its branch becomes ready, and `made`
 * records when, so the repo's lands go one at a time in that order.
 */
async function landTurn(repo: Repo, id: string, made: number): Promise<() => void> {
  const before = (e: { id: string; run: Run }) => (e.run.made ?? 0) < made || ((e.run.made ?? 0) === made && e.id < id);
  for (;;) {
    const release = (await lock(`land-${repo.key}`, Infinity))!;
    const older = allRuns().some((e) => e.run.kind === "land" && e.run.repo === repo.key && e.id !== id && before(e) && isLive(e.folder));
    if (!older) return release;
    release();
    await Bun.sleep(200);
  }
}

/** The squash commit's message: the worker's subjects, then the trailer block. */
function landMessage(subjects: string[], run: Run, repo: Repo): string {
  const trailers = [
    ...(run.todo !== undefined ? [`Item: ${repo.key}-${run.todo}`] : []),
    `Job: ${run.job}`,
    ...(run.held ? ["Held-by: Chris"] : []),
  ];
  // A subject is never on a line of its own after the title, so none can read as a trailer.
  const body = subjects.length > 1 ? ["", ...subjects.map((s) => `- ${s}`)] : [];
  return [subjects[0] ?? run.name, ...body, "", ...trailers].join("\n");
}

/**
 * Land a job: merge its branch onto origin/<main> in memory, run the checks on
 * that tree, and push one squash commit of exactly that tree with a plain
 * push. A refused push merges again, at most RELANDS times. The job's issue
 * closes in the work store after the push. No checkout of the repo
 * moves, and every failure leaves the remote as it was.
 */
async function land(id: string, folder: string, run: Run, repo: Repo, env: Record<string, string | undefined>): Promise<{ verdict: Verdict; code: number }> {
  const main = repo.main;
  const logFile = join(folder, "land.log");
  const log = (step: string, out = "") => appendFileSync(logFile, `## ${step}\n${out ? out + "\n" : ""}\n`);
  const step = (name: string, ...args: string[]) => { const r = git(repo.path, ...args); log(`${name}: ${r.ok ? "ok" : "failed"}`, r.out); return r; };
  const phase = (p: string) => updateRun(folder, { phase: p });
  const fail = (reason: string, extra: Partial<Verdict> = {}) => { log(`failed: ${reason}`); return { verdict: { state: "failed" as const, reason, ...extra }, code: 1 }; };

  const release = await lock(`job-${repo.key}-${run.name}`, 60_000);
  if (!release) return fail("job lock busy");
  let releaseRepo: (() => void) | null = null;
  try {
    phase("queued");
    releaseRepo = await landTurn(repo, id, run.made ?? 0);
    phase("land");
    for (let attempt = 0; ; attempt++) {
      if (!step("fetch", "fetch", "-q", "origin").ok) return fail("fetch failed");
      // A land that pushed and then died finds its own commit here and does not merge again.
      const pushed = git(repo.path, "log", `origin/${main}`, "-1", "--format=%H", "-E", `--grep=^Job: ${run.job}$`).out;
      if (pushed) {
        log(`already on main as ${pushed}`);
        removeBranch(repo, run);
        return { verdict: { state: "landed", commit: pushed }, code: 0 };
      }
      const tip = git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${run.branch}`);
      if (!tip.ok) return fail(`branch gone: ${run.branch}`);
      // Every step after the fetch uses this commit, so a move of main makes the push non-fast-forward.
      const base = git(repo.path, "rev-parse", `origin/${main}`).out;
      const merged = git(repo.path, "merge-tree", "--write-tree", "--name-only", base, tip.out);
      if (!merged.ok) {
        const lines = merged.out.split("\n");
        const conflicts = lines.slice(1, lines.indexOf("") < 0 ? undefined : lines.indexOf("")).filter(Boolean);
        log("conflicts", conflicts.join("\n"));
        return fail("merge conflict", { conflicts });
      }
      const tree = merged.out.split("\n")[0];
      if (tree === git(repo.path, "rev-parse", `${base}^{tree}`).out) {
        log("no net change");
        removeBranch(repo, run);
        return { verdict: { state: "done", reason: "no net change" }, code: 0 };
      }
      const changed = git(repo.path, "diff", "--name-only", base, tree).out.split("\n").filter(Boolean);
      // Only aleph issue writes the list. A worker can go past git-guard with a script, so the land refuses it.
      if (changed.includes(TODO_PATH)) return fail(OWN_LIST, { conflicts: [TODO_PATH] });
      const fork = git(repo.path, "merge-base", base, tip.out).out;
      const subjects = git(repo.path, "log", "--reverse", "--no-merges", "--format=%s", `${fork}..${tip.out}`).out.split("\n").filter(Boolean);
      const c = step("commit-tree", "commit-tree", tree, "-p", base, "-m", landMessage(subjects, run, repo));
      if (!c.ok) return fail("commit-tree failed");
      const failed = repo.sandbox
        ? await sandboxChecks(id, folder, repo, c.out, changed, phase)
        : await worktreeChecks(folder, run, repo, env, c.out, changed, phase);
      if (failed) return fail(failed);
      phase("land");
      if (step("push", "push", "-q", "origin", `${c.out}:refs/heads/${main}`).ok) {
        const { todo, checkItem } = closeItems(repo, run);
        if (todo) log(todo === "done" ? `todo ${run.todo} done` : `todo ${run.todo} not closed: ${todo}`);
        if (checkItem !== undefined) log(`todo ${checkItem} holds the manual check`);
        removeBranch(repo, run);
        return { verdict: { state: "landed", commit: c.out, checkItem }, code: 0 };
      }
      if (!step("fetch", "fetch", "-q", "origin").ok) return fail("fetch failed");
      if (git(repo.path, "rev-parse", `origin/${main}`).out === base) return fail("push refused");
      if (attempt >= RELANDS) return fail(MOVED);
      log("main moved; merging again");
    }
  } finally {
    releaseRepo?.();
    release();
  }
}

/** The checks on `commit`, in the job's worktree, which is back on its branch after. */
async function worktreeChecks(folder: string, run: Run, repo: Repo, env: Record<string, string | undefined>, commit: string, changed: string[], phase: (p: string) => void): Promise<string | null> {
  const wt = run.worktree!;
  if (!existsSync(wt)) return `worktree gone: ${wt}`;
  if (!git(wt, "checkout", "-q", "--detach", commit).ok) return "checkout failed";
  try {
    return await runChecks(folder, wt, repo, env, changed, phase);
  } finally {
    git(wt, "checkout", "-q", "-f", run.branch!);
  }
}

/**
 * The repo's setup and checks on `ref` of `bundle`, under srt, in a fresh
 * clone in check/: nothing a worker left in work/ runs. Each check's output
 * and exit code go to checklog/, which only this step can write.
 */
async function checksInSandbox(folder: string, dir: string, bundle: string, ref: string, repo: Repo, changed: string[], phase: (p: string) => void): Promise<string | null> {
  const matches = (globs: string[]) => changed.some((f) => globs.some((g) => new Bun.Glob(g).match(f)));
  const checks = repo.checks.filter((c) => !c.when || matches(c.when));
  const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
  const lim = limit("ALEPH_CHECK_TIMEOUT", 1200);
  const script = [
    "set -e", "git init -q .",
    `git fetch -q ../${bundle} ${q(`+${ref}:refs/heads/check`)}`, "git switch -q check", "set +e",
    `{ ${repo.setup.map((c) => `${c} && `).join("")}true; } > ../checklog/setup.log 2>&1; echo $? > ../checklog/setup.code`,
    `[ "$(cat ../checklog/setup.code)" = 0 ] || exit 0`,
    ...checks.map((c, i) => `timeout -k 30 ${lim} bash -c ${q(c.run)} > ../checklog/${i}.log 2>&1; echo $? > ../checklog/${i}.code; [ "$(cat ../checklog/${i}.code)" = 0 ] || exit 0`),
  ].join("\n");
  phase(checks.length ? `check ${checks.map((c) => c.name).join(", ")}` : "check");
  const r = await sandboxed(dir, script, { read: [bundle], write: ["check", "checklog", "home", "tmp"], cwd: "check", stdout: join(folder, "check.out"), stderr: join(folder, "check.out") });
  const read = (f: string) => existsSync(join(dir, "checklog", f)) ? readFileSync(join(dir, "checklog", f), "utf8").trim() : undefined;
  const setup = read("setup.code");
  if (setup === undefined) return `checks did not start (exit ${r.code})`;
  if (setup !== "0") {
    appendFileSync(join(folder, "checks.log"), `## setup: exit ${setup}\n${tail(join(dir, "checklog", "setup.log"), 100)}\n\n`);
    return "setup failed";
  }
  for (const [i, check] of checks.entries()) {
    const code = read(`${i}.code`);
    const timedOut = code === "124";
    appendFileSync(join(folder, "checks.log"), `## ${check.name}: exit ${code ?? "none"}${timedOut ? " (timed out)" : ""}\n${tail(join(dir, "checklog", `${i}.log`), 100)}\n\n`);
    if (timedOut) return `timed out: check ${check.name}`;
    if (code !== "0") return `${check.name} failed`;
  }
  return null;
}

/** The checks on a land's squash commit: the commit goes in as a bundle. */
async function sandboxChecks(id: string, folder: string, repo: Repo, commit: string, changed: string[], phase: (p: string) => void): Promise<string | null> {
  const dir = makeRunFolder(id);
  const ref = `refs/aleph/land/${id}`;
  try {
    git(repo.path, "update-ref", ref, commit);
    const b = git(repo.path, "bundle", "create", join(dir, "out", "land.bundle"), ref);
    if (!b.ok) return `bundle failed: ${b.out}`;
    return await checksInSandbox(folder, dir, "out/land.bundle", ref, repo, changed, phase);
  } finally {
    git(repo.path, "update-ref", "-d", ref);
    removeRunFolder(dir);
  }
}

/** The repo's checks, all of them, on `commit` of origin/<main>: null when they pass, else why not. For the factory's baseline. */
export async function baselineChecks(repo: Repo, commit: string, logs: string): Promise<string | null> {
  const dir = makeRunFolder(`baseline-${repo.key}`);
  const ref = `refs/aleph/baseline/${repo.key}`;
  try {
    rmSync(logs, { recursive: true, force: true });
    mkdirSync(logs, { recursive: true });
    git(repo.path, "update-ref", ref, commit);
    const b = git(repo.path, "bundle", "create", join(dir, "out", "base.bundle"), ref);
    if (!b.ok) return `bundle failed: ${b.out}`;
    const all = git(repo.path, "ls-tree", "-r", "--name-only", commit).out.split("\n").filter(Boolean);
    return await checksInSandbox(logs, dir, "out/base.bundle", ref, repo, all, () => {});
  } catch (e) {
    return `baseline did not run: ${e instanceof Error ? e.message : e}`;
  } finally {
    git(repo.path, "update-ref", "-d", ref);
    removeRunFolder(dir);
  }
}

/**
 * `aleph issue done` (with `done`) or `aleph issue note` for a job's issue, as a
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
    return found ? null : `no issue ${id}`;
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

/** The job's worktree, when it has one, and its branch. */
export function removeBranch(repo: Repo, run: Run): void {
  if (run.worktree) {
    git(repo.path, "worktree", "remove", "--force", run.worktree);
    git(repo.path, "worktree", "prune");
  }
  if (run.branch) git(repo.path, "branch", "-D", run.branch);
}

type Verdict = Pick<Run, "state" | "needs" | "reason" | "question" | "say" | "commit" | "conflicts" | "checkItem" | "cost" | "defaults" | "stat">;

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
      ({ verdict, code } = await land(id, folder, run, repo!, checkEnv));
    } else if (repo!.sandbox) {
      ({ verdict, code } = await factoryAgent(id, folder, run, repo!));
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
 * What the unit starts after a run ends. A land that conflicts, or that
 * refuses a branch that changes the list, goes back to the worker, at most
 * BOUNCES times a job; a land that lost a race lands again, at most RELANDS
 * times; an agent run lands when it passes, when it was started with --land
 * or its repo lands by itself.
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
  if (paused()) {
    appendFileSync(join(folder, "next.log"), `paused: no ${next} started\n`);
    updateRun(folder, { next: undefined });
    return;
  }
  const cli = join(import.meta.dir, "..", "cli.ts");
  const argv = next === "land" ? ["land", run.name] : ["job", run.repo!, run.name, "--spec", "-", "--land"];
  const note = run.reason === OWN_LIST
    ? `The land refused this branch because it changes ${TODO_PATH}. Only aleph issue writes the list. The lists live in the work store now. Remove ${TODO_PATH} from the branch, commit, and make each change to the list with aleph issue.`
    : `The land conflicted with origin/main in: ${(run.conflicts ?? []).join(", ")}. Merge origin/main into this branch, resolve each conflict so that the change on main and this job's change both survive, run the tests, and commit.`;
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
    removeBranch(repo, run);
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

/**
 * A factory run. The worker gets origin/<main>, and the job's branch when a
 * previous run left one, as a bundle; it runs under srt with an empty home
 * and the worker token as its only secret. A second srt call bundles the
 * branch, aleph fetches it, and a third runs the checks on a fresh clone.
 * The run folder goes when the verdict is known. See the seed spec's "Sandbox".
 */
async function factoryAgent(id: string, folder: string, run: Run, repo: Repo): Promise<{ verdict: Verdict; code: number }> {
  const branch = run.branch!;
  const main = `refs/remotes/origin/${repo.main}`;
  const phase = (p: string) => updateRun(folder, { phase: p });
  const stuck = (reason: string, extra: Partial<Verdict> = {}) => ({ verdict: { state: "stuck" as const, reason, ...extra }, code: 1 });
  phase("setup");
  if (!git(repo.path, "fetch", "-q", "origin").ok) return stuck("fetch failed");
  const prev = git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${branch}`).ok;
  const dir = makeRunFolder(id);
  try {
    // The store and ledger facts ride along, so `aleph status` inside answers as it does outside.
    const b = git(repo.path, "bundle", "create", join(dir, "in.bundle"), main, writeFacts(repo), ...(prev ? [`refs/heads/${branch}`] : []));
    if (!b.ok) return stuck(`bundle failed: ${b.out}`);
    const text = prompt(id, folder, run, repo);
    writeFileSync(join(folder, "prompt.md"), text);
    const argv = [process.env.ALEPH_WORKER_CMD ?? "claude", "-p", "--session-id", run.session!, "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions",
      ...(run.model ? ["--model", run.model] : [])];
    const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
    // Setup output goes to stderr, so the worker's own stdout ends the transcript.
    const script = [
      "set -e", "exec 3>&1 1>&2", "git init -q .",
      `git fetch -q ../in.bundle ${q(`+${main}:${main}`)} ${q(`+${FACTS_REF}:${FACTS_REF}`)}${prev ? ` ${q(`+refs/heads/${branch}:refs/heads/${branch}`)}` : ""}`,
      prev ? `git switch -q ${q(branch)}` : `git switch -q -c ${q(branch)} ${q(`origin/${repo.main}`)}`,
      ...repo.setup, "exec 1>&3 3>&-", `exec ${argv.map(q).join(" ")}`,
    ].join("\n");
    phase("worker");
    const w = await sandboxed(dir, script, {
      read: ["in.bundle"], write: ["home", "work", "tmp"], cwd: "work", stdin: text,
      env: { CLAUDE_CODE_OAUTH_TOKEN: workerToken() },
      stdout: join(folder, "output.log"), stderr: join(folder, "stderr.log"), limit: limit("ALEPH_JOB_TIMEOUT", 2400),
      onSpawn: (p) => { child = p; },
    });
    child = null;
    const o = outcome(readFileSync(join(folder, "output.log"), "utf8"));
    writeFileSync(join(folder, "result.md"), o.result);
    const facts: Partial<Verdict> = { ...(o.cost !== undefined ? { cost: o.cost } : {}), defaults: tagged(o.result, "DEFAULT") };
    fileFollowups(repo, run, tagged(o.result, "FOLLOWUP"));
    if (w.timedOut) return stuck("time box", facts);
    if (!o.ok) return stuck(o.line, facts);

    // The worker's processes are gone with its sandbox. Only this step reads work/.
    phase("bundle");
    const out = await sandboxed(dir, `git bundle create -q ../out/out.bundle ${q(`refs/heads/${branch}`)}`, {
      read: ["work"], write: ["out"], cwd: "work", stdout: join(folder, "stderr.log"), stderr: join(folder, "stderr.log"),
    });
    if (out.code !== 0) return stuck(`no branch ${branch} to hand back`, facts);
    // The one operation on the worker's data: a fetch of its branch from the bundle.
    const f = git(repo.path, "fetch", "-q", join(dir, "out", "out.bundle"), `+refs/heads/${branch}:refs/heads/${branch}`);
    if (!f.ok) return stuck(`fetch of the bundle failed: ${f.out}`, facts);
    const base = git(repo.path, "merge-base", main, `refs/heads/${branch}`).out;
    if (git(repo.path, "rev-list", "--count", `${main}..refs/heads/${branch}`).out === "0") return stuck("no commit", facts);

    const changed = git(repo.path, "diff", "--name-only", base, `refs/heads/${branch}`).out.split("\n").filter(Boolean);
    const failed = await checksInSandbox(folder, dir, "out/out.bundle", `refs/heads/${branch}`, repo, changed, phase);
    if (failed) return stuck(failed, facts);
    const rule = heldRule(repo.path, repo.held, base, `refs/heads/${branch}`);
    if (rule) return { verdict: { state: "needs-you", needs: "held", reason: rule, stat: git(repo.path, "diff", "--stat", base, `refs/heads/${branch}`).out, ...facts }, code: 0 };
    const stat = git(repo.path, "diff", "--stat", base, `refs/heads/${branch}`).out;
    phase("review");
    const rv = await review(id, folder, run, repo, dir, base, branch);
    if (rv.cost !== undefined) facts.cost = (facts.cost ?? 0) + rv.cost;
    if (rv.reason) return { verdict: { state: "needs-you", needs: "review", reason: rv.reason, stat, ...facts }, code: 0 };
    return { verdict: { state: "passed", ...facts }, code: 0 };
  } finally {
    removeRunFolder(dir);
  }
}

const REVIEW = `You are the reviewer of job \`%NAME%\`. The working directory is a clone of the
branch the worker made for the goal issue below; read the code there as needed.
Judge whether the diff does what the issue asks, whether the tests cover it, and
whether it breaks anything. Do not change files. End with one line:
\`VERDICT: pass\` or \`VERDICT: hold <one-sentence reason>\`.`;

/**
 * A fresh reviewer reads the passing run: `claude -p` on Opus 5.5 under srt,
 * with the worker's profile, in its own run folder with a clone of the branch.
 * Returns the reason to hold, or null on a pass, and the cost. Fails closed.
 */
async function review(id: string, folder: string, run: Run, repo: Repo, dir: string, base: string, branch: string): Promise<{ reason: string | null; cost?: number }> {
  const rdir = makeRunFolder(`${id}-review`);
  try {
    copyFileSync(join(dir, "out", "out.bundle"), join(rdir, "out", "out.bundle"));
    const spec = readFileSync(join(folder, "..", run.job, "spec.md"), "utf8").trim();
    const diff = git(repo.path, "diff", base, `refs/heads/${branch}`).out;
    const text = `${REVIEW.replace("%NAME%", run.name)}\n\n## Goal issue\n\n${spec}\n\n## Diff from the merge base\n\n${diff}\n`;
    writeFileSync(join(folder, "review-prompt.md"), text);
    const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
    const argv = [process.env.ALEPH_REVIEWER_CMD ?? process.env.ALEPH_WORKER_CMD ?? "claude", "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions",
      "--tools", "Read", "Grep", "Glob", "Bash", "--model", "claude-opus-5-5"];
    const script = [
      "set -e", "exec 3>&1 1>&2", "git init -q .",
      `git fetch -q ../out/out.bundle ${q(`+refs/heads/${branch}:refs/heads/${branch}`)}`, `git switch -q ${q(branch)}`,
      "exec 1>&3 3>&-", `exec ${argv.map(q).join(" ")}`,
    ].join("\n");
    const log = join(folder, "review.log");
    const w = await sandboxed(rdir, script, {
      read: ["out/out.bundle"], write: ["home", "work", "tmp"], cwd: "work", stdin: text,
      env: { CLAUDE_CODE_OAUTH_TOKEN: workerToken() },
      stdout: log, stderr: join(folder, "review.err"), limit: limit("ALEPH_REVIEW_TIMEOUT", 600),
      onSpawn: (p) => { child = p; },
    });
    child = null;
    const o = outcome(existsSync(log) ? readFileSync(log, "utf8") : "");
    writeFileSync(join(folder, "review.md"), o.result);
    const cost = o.cost;
    const none = (why: string) => ({ reason: `reviewer: no verdict (${why})`, cost });
    if (w.timedOut) return none("time box");
    if (!o.ok) return none(o.line || `exit ${w.code}`);
    const v = reviewVerdict(o.result);
    if (!v) return none("no VERDICT line");
    return { reason: v.pass ? null : `reviewer: ${v.reason}`, cost };
  } finally {
    removeRunFolder(rdir);
  }
}

/** A worker's `FOLLOWUP:` lines become issues in the repo's list, filed by aleph. */
function fileFollowups(repo: Repo, run: Run, titles: string[]): void {
  if (!titles.length) return;
  try {
    writeList(repo, `todo: follow-ups from job ${run.name}`, (doc) => {
      for (const t of titles) todos.add(doc, t, { labels: ["followup"], body: `From job ${run.name}${run.todo !== undefined ? ` on issue ${run.todo}` : ""}.` });
      return true;
    }, true);
  } catch {}
}
