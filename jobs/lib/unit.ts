/**
 * `aleph unit <run-folder>`: the body of one run, inside its systemd unit.
 * An agent run is setup, the worker, then the state rule; a plain run is one
 * command. Both end with state.json, then `exit`, then the news.
 */
import { appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { closeAndFile, file as fileIssues, issueOf, noteFlake, readHidden, reader } from "../../todo/lib/store.ts";
import { addWorktree, fetchOrigin, followMain, git } from "./git.ts";
import { ALREADY_MET, heldRule, testFindings, outcome, tagged, verdict as reviewVerdict } from "./gate.ts";
import { askOf, checkSlot, isAwaiting, isBuild, needsOf, onOf, readCall, testParallel, allRuns, isLive, LOCK_BUSY, loadRegistry, lock, newsLine, readEnvFile, readRun, tell, updateRun, type Ask, type CheckResult, type Repo, type Run } from "./ledger.ts";
import { allJobs, hasFile, isOpen, jobById, notes, openJob, readFile } from "./job.ts";
import { bridge, sandboxNetnsPid } from "./netns.ts";
import { serveShots } from "./shot.ts";
import { makeRunFolder, removeRunFolder, runPath, sandboxed, workerToken } from "./sandbox.ts";
import { dispatchOn, gates, recordFlake, waitingToLand } from "./factory.ts";
import { startReview } from "./review.ts";
import { postTrace } from "./trace.ts";
import { runLogged, startUnit } from "./launch.ts";
import { land as startLand, startJob } from "./transitions.ts";
import { FACTS_REF, itemOnMain, writeFacts } from "./status.ts";

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

// A worker that backgrounds a command and ends its turn is never woken again in a headless run.
const FOREGROUND = "Run every command in the foreground and wait for it: nothing wakes you after your turn ends.";

const FIXED = (run: Run, main: string) => `You are a worker on job \`${run.name}\` in \`${run.worktree}\`, branch \`${run.branch}\`. Work
only there. Commit every change on the branch; the run fails if anything is
left uncommitted or untracked. Never merge, never push, never touch another
branch. \`aleph issue\` is not your push: it writes the list of issues on main by
itself, so use it for every change to the list. If the previous run was a
failed land, merge \`origin/${main}\` into the branch, resolve the conflicts,
and commit. If you need a decision from Chris, stop
and make your last line \`QUESTION: <one question>\`. ${FOREGROUND} End with a
short summary of what you did and what you ran.`;

const FACTORY = (run: Run, main: string) => `You are a worker on job \`${run.name}\`, in a git repo on branch \`${run.branch}\`, inside
a sandbox. You see this repo and nothing else of the machine, and the network
reaches only the Anthropic API and npm. Do the goal below. Commit every change
on the branch: only commits leave the sandbox. Never switch to another branch
and never push. If the previous run's land conflicted, merge \`origin/${main}\`
into the branch and resolve the conflicts so that both changes survive. Nobody
answers questions during the run: when you must choose, take the answer you
would recommend and print a line \`DEFAULT: <question> -> <answer>\`. For work
you find but do not do, print a line \`FOLLOWUP: <title>\`. A test that fails or times out and is not the goal's own, and passes again alone or on a rerun, is a flake: print one line \`FLAKE: <test file> > <test name>: <what you saw>\` and no \`FOLLOWUP:\` for it. End the result with zero or more lines
\`FACT: <one sentence> [source: <file:line | commit sha | https URL>]\`, for durable
facts about the repo or its tools that you learned and checked. If the goal already
holds on your branch and no edit is needed, make no commit, run the repo's tests,
and print exactly one line \`${ALREADY_MET}: <evidence>\`, the evidence being the
files, the lines and the commit on \`${main}\` that show it. Run the repo's
tests before you end. Chrome cannot start in the sandbox. For a screenshot of a page
served by your own server on 127.0.0.1, run \`aleph-shot <url> <out.png> [--width 1440] [--height 900] [--scheme light|dark] [--click <css selector>] [--wait <ms>]\`:
the factory takes the shot outside the sandbox and writes the PNG at the path, which must be inside the repo, and you commit it.
Only \`http://127.0.0.1:<port>\` URLs of your own server are loaded. ${FOREGROUND} End with a short summary of what you did and what you ran.`;

/** The fixed text, the spec, every note in order, and the previous run's files. */
export function prompt(id: string, folder: string, run: Run, repo: Repo): string {
  const first = join(folder, "..", run.job);
  const parts = [(repo.sandbox ? FACTORY : FIXED)(run, repo.main), `## Spec\n\n${readFileSync(join(first, "spec.md"), "utf8").trim()}`];
  const runs = jobById(run.job) ?? [];
  if (runs.length) for (const n of notes(runs)) parts.push(`## Note ${n.name}\n\n${n.text.trim()}`);
  const prev = runs[runs.findIndex((e) => e.id === id) - 1];
  if (prev) {
    const p = prev.run;
    parts.push(`## Previous run: ${p.kind}, ${p.state}${needsOf(askOf(p)) ? ` (${needsOf(askOf(p))})` : ""}${p.reason ? `: ${p.reason}` : ""}`);
    for (const f of ["result.md", "checks.log", "land.log"] as const) {
      const text = readFile(prev, f);
      if (text !== undefined) parts.push(`### ${f}\n\n${text.trim()}`);
    }
  }
  return parts.join("\n\n") + "\n";
}

/** A recorder that starts the run's `checks` over and adds each check that ran. */
function recorder(folder: string): (c: CheckResult) => void {
  let all: CheckResult[] = [];
  updateRun(folder, { checks: all });
  return (c) => { all = [...all, c]; updateRun(folder, { checks: all }); };
}

/** Run `fn` holding a check slot: the slot is freed when `fn` settles, also when it throws. */
export async function withSlot<T>(fn: () => T | Promise<T>): Promise<T> {
  const free = await checkSlot();
  try {
    return await fn();
  } finally {
    free();
  }
}

/** Run every check with no `when`, and every check whose globs match a changed file. Returns why one failed. */
async function runChecks(folder: string, wt: string, repo: Repo, env: Record<string, string | undefined>, changed: string[], phase: (p: string) => void, record: (c: CheckResult) => void): Promise<string | null> {
  const matches = (globs: string[]) => changed.some((f) => globs.some((g) => new Bun.Glob(g).match(f)));
  for (const check of repo.checks) {
    if (check.when && !matches(check.when)) continue;
    phase(`check ${check.name}`);
    const out = join(folder, "check.out");
    writeFileSync(out, "");
    // The wait for a slot is outside the time limit and outside the check's seconds.
    const { r, again, seconds } = await withSlot(async () => {
      const t0 = Date.now();
      let r = await exec(["bash", "-c", check.run], { cwd: wt, env, out, limit: limit("ALEPH_CHECK_TIMEOUT", 1200) });
      let again = false;
      if (r.code !== 0 && !r.timedOut) {
        // One more run on the same tree: a pass the second time is a flake, recorded and counted as passed.
        appendFileSync(join(folder, "checks.log"), `## ${check.name}: exit ${r.code}, run again\n${tail(out, 100)}\n\n`);
        again = true;
        r = await exec(["bash", "-c", check.run], { cwd: wt, env, out, limit: limit("ALEPH_CHECK_TIMEOUT", 1200) });
        if (r.code === 0 && !r.timedOut) recordFlake(repo.key, check.name, basename(folder));
      }
      return { r, again, seconds: Math.round((Date.now() - t0) / 1000) };
    });
    const rerun = again && r.code === 0 && !r.timedOut;
    record({ name: check.name, ok: r.code === 0 && !r.timedOut, seconds, ...(rerun ? { rerun: true } : {}) });
    appendFileSync(join(folder, "checks.log"), `## ${check.name}: exit ${r.code}${r.timedOut ? " (timed out)" : ""}${again ? " (second run)" : ""}\n${tail(out, 100)}\n\n`);
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
  const on = onOf(run);
  if (on === undefined && !open) return {};
  const w = closeAndFile(repo, `todo: job ${run.name} landed`, on, `job ${run.name} landed`, open ? [{ title: `Check ${run.name}: ${run.say}`, areas: ["check"] }] : []);
  return { todo: w.todo, checkItem: w.ids[0] };
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

/** The issue a goal belongs to, from the store, or undefined when the store does not say. */
function readItemIssue(repo: Repo, on: number | string): string | undefined {
  try {
    const item = reader().item(repo.key, on);
    return (item && issueOf(item)) || undefined;
  } catch { return undefined; }
}

/** The squash commit's message: the worker's subjects, then the trailer block. */
function landMessage(subjects: string[], run: Run, repo: Repo): string {
  const on = onOf(run);
  const ref = on === undefined ? undefined : `${repo.key}-${on}`;
  // A goal's issue is the store's; a run on an issue with no goal names only the issue.
  const goal = typeof on === "string" ? ref : undefined;
  const issue = goal ? readItemIssue(repo, on!) : ref;
  const trailers = [
    ...(issue ? [`Issue: ${issue}`] : []),
    ...(goal ? [`Goal: ${goal}`] : []),
    `Job: ${run.job}`,
    ...(run.held ? [`Held-by: ${run.lander ?? "Chris"}`] : []),
  ];
  // A subject is never on a line of its own after the title, so none can read as a trailer.
  const body = subjects.length > 1 ? ["", ...subjects.map((s) => `- ${s}`)] : [];
  return [subjects[0] ?? run.name, ...body, "", ...trailers].join("\n");
}

/** One run in a land: the leader's own, or a land run queued behind it. */
interface Member { id: string; folder: string; run: Run; log: (step: string, out?: string) => void }
/** A member's squash commit, on top of the commit before it in the chain. */
interface Item { m: Member; commit: string }
type Outcome = { verdict: Verdict; code: number };

const landBatch = () => Math.max(1, Math.floor(Number(process.env.ALEPH_LAND_BATCH ?? 8)) || 1);

/** A run `aleph land` accepts: passed, or needing Chris only for a manual check, a held path or the reviewer. */
function landable(agent: Run | undefined): boolean {
  return !!agent && (agent.state === "passed" || (isAwaiting(agent.state) && ["manual", "held", "review"].includes(needsOf(askOf(agent)) ?? "")));
}

/** The land runs queued behind this one in the repo, oldest first, that `aleph land` would still accept. */
function queuedLands(repo: Repo, id: string, run: Run, cap: number): Member[] {
  const seen = new Set([run.job]);
  const out: Member[] = [];
  const queued = allRuns().filter((e) => e.run.kind === "land" && e.run.repo === repo.key && e.id !== id && e.run.state === "running" && isLive(e.folder) && !hasFile(e, "batch.json"))
    .sort((a, b) => (a.run.made ?? 0) - (b.run.made ?? 0) || (a.id < b.id ? -1 : 1));
  for (const e of queued) {
    if (out.length >= cap || seen.has(e.run.job)) continue;
    const runs = jobById(e.run.job);
    if (!runs || !isOpen(runs) || !landable(runs.filter((x) => isBuild(x.run.kind) || x.run.kind === "recheck").at(-1)?.run)) continue;
    seen.add(e.run.job);
    out.push({ id: e.id, folder: e.folder, run: e.run, log: (step, o = "") => appendFileSync(join(e.folder, "land.log"), `## ${step}\n${o ? o + "\n" : ""}\n`) });
  }
  return out;
}

/**
 * Passed runs of the repo waiting to land that have no land run yet: start
 * `aleph land` for them, so they queue on the lock and join this batch. Not
 * while the factory is paused or held, as the dispatch would not land them.
 */
async function pullWaiting(repo: Repo, run: Run, room: number): Promise<void> {
  if (room <= 0 || gates({ only: ["pause", "hold"], except: run.job })) return;
  const jobs = allJobs();
  const names = waitingToLand(jobs).filter((n) => {
    const last = openJob(n, null, jobs)?.at(-1)!.run;
    return last && last.repo === repo.key && !last.next && last.job !== run.job;
  }).slice(0, room);
  const jobsOf = names.map((n) => openJob(n, null, jobs)![0].run.job);
  // Their own units: a child of this land's unit would die with its cgroup when the leader exits.
  for (const n of names) {
    const unit = `aleph-pull-${repo.key}-${n}-${Date.now()}`.replace(/[^A-Za-z0-9:_.-]/g, "-");
    try { startUnit(["land", n], { unit, cwd: repo.path }); } catch {}
  }
  const deadline = Date.now() + 10_000;
  const queued = (job: string) => allRuns().some((e) => e.run.kind === "land" && e.run.job === job && e.run.state === "running");
  while (Date.now() < deadline && !jobsOf.every(queued)) await Bun.sleep(100);
}

/**
 * Land a job, and the land runs queued behind it. Each run's branch merges onto
 * origin/<main> in memory, in order, as one squash commit with its own trailers.
 * The checks run once on the last commit; when they fail the batch splits in
 * half, until the run that fails is found. That run fails, the others land, and
 * one plain push takes all their commits. A conflict takes only its run out. A
 * run whose own checks passed on the current origin/<main> pushes with no check.
 * A refused push merges again, at most RELANDS times. Each run's issue closes
 * in the work store after the push, and the main checkout follows origin/<main>
 * if it is clean. Every failure leaves the remote as it was.
 */
async function land(id: string, folder: string, run: Run, repo: Repo, env: Record<string, string | undefined>): Promise<{ verdict: Verdict; code: number }> {
  const main = repo.main;
  const logFile = join(folder, "land.log");
  const log = (step: string, out = "") => appendFileSync(logFile, `## ${step}\n${out ? out + "\n" : ""}\n`);
  const logged = (name: string, r: { ok: boolean; out: string }) => { log(`${name}: ${r.ok ? "ok" : "failed"}`, r.out); return r; };
  const step = (name: string, ...args: string[]) => logged(name, git(repo.path, ...args));
  const phase = (p: string) => updateRun(folder, { phase: p });
  const failed = (reason: string, extra: Partial<Verdict> = {}): Outcome => ({ verdict: { state: "failed", reason, ...extra }, code: 1 });
  const fail = (reason: string, extra: Partial<Verdict> = {}) => { log(`failed: ${reason}`); return failed(reason, extra); };

  const release = await lock(`job-${repo.key}-${run.name}`, 60_000);
  if (!release) return fail(LOCK_BUSY);
  let releaseRepo: (() => void) | null = null;
  try {
    phase("queued");
    releaseRepo = await landTurn(repo, id, run.made ?? 0);
    // A land run an earlier land took into its batch has its verdict in its folder.
    const given = join(folder, "batch.json");
    if (existsSync(given)) {
      const b = JSON.parse(readFileSync(given, "utf8"));
      if (b.checks) updateRun(folder, { checks: b.checks });
      return { verdict: b.verdict, code: b.code };
    }
    phase("land");
    const cap = landBatch();
    await pullWaiting(repo, run, cap - 1 - queuedLands(repo, id, run, cap).length);
    const leader: Member = { id, folder, run, log };
    const members = [leader, ...queuedLands(repo, id, run, cap - 1)];
    for (const m of members.slice(1)) m.log(`taken into the batch of ${run.name}'s land ${id}`);
    if (members.length > 1) log(`batch of ${members.length}`, members.map((m) => m.run.name).join("\n"));

    // Members that failed in an earlier attempt keep their verdict and are not tried again.
    const failedBefore = new Map<Member, Outcome & { after?: () => void }>();
    for (let attempt = 0; ; attempt++) {
      { const f = logged("fetch", fetchOrigin(repo.path)); if (!f.ok) return fail(`fetch failed: ${f.out}`); }
      const base0 = git(repo.path, "rev-parse", `origin/${main}`).out;
      const done = new Map<Member, Outcome & { after?: () => void }>(failedBefore);
      const finish = (m: Member, o: Outcome & { after?: () => void }) => { done.set(m, o); if (o.verdict.state === "failed") m.log(`failed: ${o.verdict.reason}`); };
      const tips = new Map<Member, string>();
      // The checks of the last check call that covered each member; that call decided its verdict.
      const checksOf = new Map<Member, Run["checks"]>();

      // Runs that need no merge: already on main, their item on main, or no branch.
      const open: Member[] = [];
      for (const m of members) {
        // A land that pushed and then died finds its own commit here and does not merge again.
        const pushed = git(repo.path, "log", `origin/${main}`, "-1", "--format=%H", "-E", `--grep=^Job: ${m.run.job}$`).out;
        if (pushed) {
          m.log(`already on main as ${pushed}`);
          finish(m, { verdict: { state: "landed", commit: pushed }, code: 0, after: () => {
            // The land that pushed may have died before it closed the item.
            const { todo, checkItem } = closeItems(repo, m.run);
            if (todo) m.log(todo === "done" ? `todo ${onOf(m.run)} done` : `todo ${onOf(m.run)} not closed: ${todo}`);
            if (checkItem !== undefined) m.log(`todo ${checkItem} holds the manual check`);
            removeBranch(repo, m.run);
            followCheckout(repo, log);
          } });
          continue;
        }
        // A commit by hand, or by another job, that names the item: this land must not add a second one.
        const there = itemOnMain(repo, onOf(m.run));
        if (there) {
          m.log(`item landed as ${there}`);
          finish(m, { verdict: { state: "done", reason: `item landed as ${there}` }, code: 0, after: () => { closeItems(repo, { ...m.run, check: undefined }); removeBranch(repo, m.run); } });
          continue;
        }
        const tip = git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${m.run.branch}`);
        if (!tip.ok) { finish(m, failed(`branch gone: ${m.run.branch}`)); continue; }
        tips.set(m, tip.out);
        open.push(m);
      }

      // Merge each run onto the one before it. A conflict, a run with no net change and a run that edits the list leave the chain.
      const build = (list: Member[], from: string): Item[] => {
        const items: Item[] = [];
        let cur = from;
        for (const m of list) {
          const tip = tips.get(m)!;
          const merged = git(repo.path, "merge-tree", "--write-tree", "--name-only", cur, tip);
          if (!merged.ok) {
            const lines = merged.out.split("\n");
            const conflicts = lines.slice(1, lines.indexOf("") < 0 ? undefined : lines.indexOf("")).filter(Boolean);
            m.log("conflicts", conflicts.join("\n"));
            finish(m, failed("merge conflict", { conflicts }));
            continue;
          }
          const tree = merged.out.split("\n")[0];
          if (tree === git(repo.path, "rev-parse", `${cur}^{tree}`).out) {
            m.log("no net change");
            finish(m, { verdict: { state: "done", reason: "no net change" }, code: 0, after: () => removeBranch(repo, m.run) });
            continue;
          }
          // Only aleph issue writes the list. A worker can go past git-guard with a script, so the land refuses it.
          if (git(repo.path, "diff", "--name-only", cur, tree).out.split("\n").includes(TODO_PATH)) { finish(m, failed(OWN_LIST, { conflicts: [TODO_PATH] })); continue; }
          const fork = git(repo.path, "merge-base", cur, tip).out;
          const subjects = git(repo.path, "log", "--reverse", "--no-merges", "--format=%s", `${fork}..${tip}`).out.split("\n").filter(Boolean);
          const c = git(repo.path, "commit-tree", tree, "-p", cur, "-m", landMessage(subjects, m.run, repo));
          m.log(`commit-tree: ${c.ok ? "ok" : "failed"}`, c.out);
          if (!c.ok) { finish(m, failed("commit-tree failed")); continue; }
          items.push({ m, commit: c.out });
          cur = c.out;
        }
        return items;
      };

      // The checks on the chain's last commit, or none when the run's own checks passed on this very origin/<main>.
      const check = async (items: Item[], base: string): Promise<string | null> => {
        const first = items[0].m.run;
        if (items.length === 1 && base === base0 && first.checkedBase === base0 && first.checkedTip === tips.get(items[0].m)) {
          log(`checks skipped: main unchanged since ${base0}`);
          // The run's own checks passed on this base; a failed call that covered it earlier does not decide its verdict.
          checksOf.set(items[0].m, first.checks);
          return null;
        }
        const tip = items.at(-1)!.commit;
        const changed = git(repo.path, "diff", "--name-only", base, tip).out.split("\n").filter(Boolean);
        const before = existsSync(join(folder, "checks.log")) ? readFileSync(join(folder, "checks.log"), "utf8").length : 0;
        log(`checks on ${items.length} run${items.length > 1 ? "s" : ""}`, items.map((i) => i.m.run.name).join("\n"));
        let why: string | null;
        if (repo.sandbox) {
          const hidden: Record<string, string> = {};
          for (const i of items) for (const [name, text] of Object.entries(hiddenOf(repo, i.m.run))) hidden[name in hidden ? `${i.m.run.on ?? onOf(i.m.run)}-${name}` : name] = text;
          why = await sandboxChecks(id, folder, repo, tip, changed, phase, hidden);
        } else {
          const owner = items.map((i) => i.m.run).find((r) => r.worktree && existsSync(r.worktree)) ?? first;
          why = await worktreeChecks(folder, owner, repo, env, tip, changed, phase);
        }
        const list = readRun(folder)?.checks;
        for (const i of items) checksOf.set(i.m, list);
        if (why && items.length === 1 && items[0].m !== leader && existsSync(join(folder, "checks.log"))) items[0].m.log("checks.log", readFileSync(join(folder, "checks.log"), "utf8").slice(before));
        return why;
      };

      // The commits of `items` that pass, in order, and the commit they end on. `known` is why the whole chain is already known to fail.
      const settle = async (items: Item[], base: string, known: string | null): Promise<{ ok: Item[]; tip: string }> => {
        if (!items.length) return { ok: [], tip: base };
        const why = known ?? await check(items, base);
        if (!why) return { ok: items, tip: items.at(-1)!.commit };
        if (items.length === 1) { finish(items[0].m, failed(why)); return { ok: [], tip: base }; }
        log(`split ${items.length} runs: ${why}`);
        const h = Math.floor(items.length / 2);
        const a = await settle(items.slice(0, h), base, null);
        const rest = items.slice(h);
        // The first half passed whole, so the second half on top of it is the tree that just failed.
        const intact = a.ok.length === h;
        const b = await settle(intact ? rest : build(rest.map((i) => i.m), a.tip), a.tip, intact ? why : null);
        return { ok: [...a.ok, ...b.ok], tip: b.ok.length ? b.tip : a.tip };
      };

      const chain = build(open, base0);
      const result = await settle(chain, base0, null);
      const ok = result.ok;
      if (ok.length) {
        phase("land");
        if (step("push", "push", "-q", "origin", `${result.tip}:refs/heads/${main}`).ok) {
          for (const { m, commit } of ok) {
            const { todo, checkItem } = closeItems(repo, m.run);
            if (todo) m.log(todo === "done" ? `todo ${onOf(m.run)} done` : `todo ${onOf(m.run)} not closed: ${todo}`);
            if (checkItem !== undefined) m.log(`todo ${checkItem} holds the manual check`);
            removeBranch(repo, m.run);
            if (m !== leader) m.log(`landed as ${commit} with ${run.name}; the checks ran in ${id}`);
            finish(m, { verdict: { state: "landed", commit, checkItem }, code: 0 });
          }
          followCheckout(repo, log);
          return conclude(leader, done, checksOf);
        }
        { const f = logged("fetch", fetchOrigin(repo.path)); if (!f.ok) return fail(`fetch failed: ${f.out}`); }
        const refused = git(repo.path, "rev-parse", `origin/${main}`).out === base0;
        if (refused || attempt >= RELANDS) {
          for (const { m } of ok) done.set(m, failed(refused ? "push refused" : MOVED));
          for (const { m } of ok) m.log(`failed: ${refused ? "push refused" : MOVED}`);
          return conclude(leader, done, checksOf);
        }
        log("main moved; merging again");
        for (const [m, o] of done) {
          if (o.verdict.state !== "failed" || ok.some((i) => i.m === m)) continue;
          if (failedBefore.has(m)) continue;
          failedBefore.set(m, o);
          members.splice(members.indexOf(m), 1);
        }
        continue;
      }
      return conclude(leader, done, checksOf);
    }
  } finally {
    releaseRepo?.();
    release();
  }
}

/** Run the deferred steps of the runs that ended without a push, give the queued runs their verdicts, and return the leader's. */
function conclude(leader: Member, done: Map<Member, Outcome & { after?: () => void }>, checksOf: Map<Member, Run["checks"]>): Outcome {
  for (const [m, o] of done) {
    o.after?.();
    if (m === leader) continue;
    const checks = checksOf.get(m);
    writeFileSync(join(m.folder, "batch.json"), JSON.stringify({ verdict: o.verdict, code: o.code, ...(checks ? { checks } : {}) }));
  }
  const own = checksOf.get(leader);
  if (own) updateRun(leader.folder, { checks: own });
  return done.get(leader) ?? { verdict: { state: "failed", reason: "not landed" }, code: 1 };
}

/**
 * After the land is on origin/<main>: fast-forward the repo's main checkout,
 * and restart aleph-ui when the paths between the checkout's old and new HEAD
 * include ui/. Neither fails the land; the log says what happened. A checkout
 * that did not move still holds the old code, so no restart.
 */
function followCheckout(repo: Repo, log: (step: string, out?: string) => void): void {
  const old = git(repo.path, "rev-parse", "HEAD").out;
  const why = followMain(repo.path, repo.main);
  if (why) { log(why); return; }
  log("main checkout updated");
  if (repo.key !== "aleph") return;
  const moved = git(repo.path, "diff", "--name-only", old, "HEAD").out.split("\n").filter(Boolean);
  if (!moved.some((f) => f.startsWith("ui/"))) return;
  try {
    const r = Bun.spawnSync(["systemctl", "--user", "try-restart", "--no-block", "aleph-ui.service"], { stdout: "pipe", stderr: "pipe" });
    log(r.exitCode === 0 ? "aleph-ui restarted" : `aleph-ui not restarted: ${(r.stderr.toString() || r.stdout.toString() || `exit ${r.exitCode}`).trim()}`);
  } catch (e) {
    log(`aleph-ui not restarted: ${e instanceof Error ? e.message : e}`);
  }
}

/** The checks on `commit`, in the job's worktree, which is back on its branch after. */
async function worktreeChecks(folder: string, run: Run, repo: Repo, env: Record<string, string | undefined>, commit: string, changed: string[], phase: (p: string) => void): Promise<string | null> {
  const wt = run.worktree!;
  if (!existsSync(wt)) return `worktree gone: ${wt}`;
  if (!git(wt, "checkout", "-q", "--detach", commit).ok) return "checkout failed";
  try {
    return await runChecks(folder, wt, repo, env, changed, phase, recorder(folder));
  } finally {
    git(wt, "checkout", "-q", "-f", run.branch!);
  }
}

/**
 * The repo's setup and checks on `ref` of `bundle`, under srt, in a fresh
 * clone in check/: nothing a worker left in work/ runs. Each check's output
 * and exit code go to checklog/, which only this step can write.
 */
async function checksInSandbox(folder: string, dir: string, bundle: string, ref: string, repo: Repo, changed: string[], phase: (p: string) => void, record?: (c: CheckResult) => void, hiddenFiles: Record<string, string> = {}): Promise<string | null> {
  const matches = (globs: string[]) => changed.some((f) => globs.some((g) => new Bun.Glob(g).match(f)));
  const hasHidden = Object.keys(hiddenFiles).length > 0;
  // The hidden check runs last, on files copied in after the repo's own checks have passed.
  const checks = [...repo.checks.filter((c) => !c.when || matches(c.when)), ...(hasHidden ? [{ name: "hidden", run: repo.hiddenRun }] : [])];
  const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
  const lim = limit("ALEPH_CHECK_TIMEOUT", 1200);
  if (hasHidden) {
    mkdirSync(join(dir, "hidden"), { recursive: true });
    for (const [name, text] of Object.entries(hiddenFiles)) writeFileSync(join(dir, "hidden", name), text);
  }
  const script = [
    "set -e", "git init -q .",
    `git fetch -q ../${bundle} ${q(`+${ref}:refs/heads/check`)}`, "git switch -q check", "set +e",
    `{ ${repo.setup.map((c) => `${c} && `).join("")}true; } > ../checklog/setup.log 2>&1; echo $? > ../checklog/setup.code`,
    `[ "$(cat ../checklog/setup.code)" = 0 ] || exit 0`,
    ...checks.map((c, i) => {
      const hid = c.name === "hidden" && hasHidden && i === checks.length - 1;
      const L = `../checklog/${i}`;
      const once = `timeout -k 30 ${lim} bash -c ${q(c.run)} > ${L}.log 2>&1; echo $? > ${L}.code`;
      // A failed check, not the hidden one and not a timeout, runs once more on the same tree; the first run's exit and log are kept.
      const again = hid ? "" : `c=$(cat ${L}.code); if [ "$c" != 0 ] && [ "$c" != 124 ]; then echo $c > ${L}.first; cp ${L}.log ${L}.first.log; ${once}; fi; `;
      return `${hid ? "cp -r ../hidden .hidden; " : ""}t=$(date +%s%N); ${once}; ${again}echo $(( ($(date +%s%N) - t) / 1000000 )) > ${L}.ms; [ "$(cat ${L}.code)" = 0 ] || exit 0`;
    }),
  ].join("\n");
  phase(checks.length ? `check ${checks.map((c) => c.name).join(", ")}` : "check");
  const r = await withSlot(() => sandboxed(dir, script, { read: [bundle, ...(hasHidden ? ["hidden"] : [])], write: ["check", "checklog", "home", "tmp"], cwd: "check", stdout: join(folder, "check.out"), stderr: join(folder, "check.out") }));
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
    const seconds = Math.round(Number(read(`${i}.ms`) ?? 0) / 1000);
    if (check.name === "hidden") {
      // The hidden log can show the tests' source, so it goes to its own file and never into checks.log.
      if (code === undefined) continue;
      const log = read(`${i}.log`) ?? "";
      const pass = Number(log.match(/^\s*(\d+) pass\s*$/m)?.[1] ?? 0);
      const fail = Number(log.match(/^\s*(\d+) fail\s*$/m)?.[1] ?? 0);
      record?.({ name: "hidden", ok: code === "0", seconds, ...(pass + fail ? { passed: pass, total: pass + fail } : {}) });
      writeFileSync(join(folder, "hidden.log"), log + "\n");
      appendFileSync(join(folder, "checks.log"), `## hidden: exit ${code}${timedOut ? " (timed out)" : ""}\n\n`);
      if (timedOut) return "timed out: check hidden";
      if (code !== "0") return fail ? `hidden check failed: ${fail} of ${pass + fail} tests` : "hidden check failed";
      continue;
    }
    const first = read(`${i}.first`);
    if (first !== undefined) appendFileSync(join(folder, "checks.log"), `## ${check.name}: exit ${first}, run again\n${tail(join(dir, "checklog", `${i}.first.log`), 100)}\n\n`);
    const rerun = first !== undefined && code === "0";
    if (rerun) recordFlake(repo.key, check.name, basename(folder));
    if (code !== undefined) record?.({ name: check.name, ok: code === "0", seconds, ...(rerun ? { rerun: true } : {}) });
    appendFileSync(join(folder, "checks.log"), `## ${check.name}: exit ${code ?? "none"}${timedOut ? " (timed out)" : ""}${first !== undefined ? " (second run)" : ""}\n${tail(join(dir, "checklog", `${i}.log`), 100)}\n\n`);
    if (timedOut) return `timed out: check ${check.name}`;
    if (code !== "0") return `${check.name} failed`;
  }
  return null;
}

/** The hidden files of the run's item, or none: a read of the work store that fails gives none, as a repo without an item has none. */
function hiddenOf(repo: Repo, run: Run): Record<string, string> {
  const id = onOf(run);
  if (id === undefined) return {};
  try { return readHidden(repo, id); } catch { return {}; }
}

/** The checks on a land's squash commit: the commit goes in as a bundle. */
async function sandboxChecks(id: string, folder: string, repo: Repo, commit: string, changed: string[], phase: (p: string) => void, hidden: Record<string, string>): Promise<string | null> {
  const dir = makeRunFolder(id);
  const ref = `refs/aleph/land/${id}`;
  try {
    git(repo.path, "update-ref", ref, commit);
    const b = git(repo.path, "bundle", "create", join(dir, "out", "land.bundle"), ref);
    if (!b.ok) return `bundle failed: ${b.out}`;
    return await checksInSandbox(folder, dir, "out/land.bundle", ref, repo, changed, phase, recorder(folder), hidden);
  } finally {
    git(repo.path, "update-ref", "-d", ref);
    removeRunFolder(dir);
  }
}

/** The repo's checks, all of them, on `commit` of origin/<main>: null when they pass, else why not. For the factory's baseline. */
export async function baselineChecks(repo: Repo, commit: string, logs: string): Promise<string | null> {
  // The fixed name is safe: baseline() in factory.ts holds lock(`baseline-${repo.key}`) around this.
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

type Verdict = Pick<Run, "state" | "ask" | "reason" | "question" | "say" | "commit" | "conflicts" | "checkItem" | "failed" | "round" | "cost" | "defaults" | "stat" | "checkedBase" | "checkedTip">;

/** A verdict that waits for Chris: the state `awaiting` and the Ask. */
const awaiting = (kind: Ask["kind"], reason: string, question: string, why: string[] = []): Pick<Verdict, "state" | "ask"> =>
  ({ state: "awaiting", ask: { kind, reason, question, options: [], why: why.filter(Boolean) } });

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
  const dispatcherPath = runPath();
  const env: Record<string, string | undefined> = {
    ...process.env, ...readEnvFile(repo?.env ?? process.env.ALEPH_RUN_ENV),
    PATH: dispatcherPath, HOME: homedir(), ALEPH_JOB_ID: run.job, ALEPH_JOB_RUN: id, ALEPH_TEST_PARALLEL: String(testParallel()),
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
    } else if (run.kind === "recheck") {
      ({ verdict, code } = await recheck(id, folder, run, repo!));
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
  process.exitCode = code;
  if (isBuild(run.kind) || run.kind === "recheck") startReview(folder);
  if ((isBuild(run.kind) || run.kind === "recheck") && repo?.sandbox) await postTrace(folder, id, ended, run.repo!);
  if (await tell(newsLine(ended, repo?.note))) updateRun(folder, { told: true });
  if (next) await start(folder, ended, next);
  if (run.kind !== "plain" && dispatchOn()) await dispatchFree(folder);
}

/** A run ended, so a slot may be free: `aleph dispatch` starts the ready goals. Its output goes to dispatch.log. */
async function dispatchFree(folder: string): Promise<void> {
  await runLogged(["dispatch"], join(folder, "dispatch.log"));
}

const BOUNCES = 2;
const fixRounds = () => Number(process.env.ALEPH_FIX_ROUNDS ?? 2);
const RELANDS = 3;

/**
 * What the unit starts after a run ends. A land that conflicts, or that
 * refuses a branch that changes the list, goes back to the worker, at most
 * BOUNCES times a job; a land that lost a race lands again, at most RELANDS
 * times; an agent run lands when it passes, when it was started with --land
 * or its repo lands by itself.
 */
function nextStep(run: Run, repo: Repo | undefined): Run["next"] {
  if (isBuild(run.kind) && run.failed) return "worker";
  if (isBuild(run.kind) || run.kind === "recheck") return run.state === "passed" && (run.land || repo?.autoland) ? "land" : undefined;
  if (run.kind !== "land" || run.state !== "failed") return undefined;
  const lands = (jobById(run.job) ?? []).filter((e) => e.run.kind === "land").map((e) => e.run);
  if (run.conflicts?.length) return lands.filter((r) => r.conflicts?.length).length <= BOUNCES ? "worker" : undefined;
  if (run.reason === MOVED) return lands.filter((r) => r.reason === MOVED).length <= RELANDS ? "land" : undefined;
  return undefined;
}

/** The last 80 lines of the named check's section of the run's checks.log. */
function checkLog(folder: string, name: string): string {
  const file = join(folder, "checks.log");
  if (!existsSync(file)) return "";
  const section = readFileSync(file, "utf8").split(/^## /m).findLast((x) => x.startsWith(`${name}: exit`)) ?? "";
  return section.split("\n").slice(1).join("\n").trimEnd().split("\n").slice(-80).join("\n");
}

/**
 * The fix-round note for a failed hidden check: the reason and the names of
 * the failing tests, read from hidden.log. Never the log, never the source.
 */
function hiddenNote(folder: string, run: Run): string {
  const file = join(folder, "hidden.log");
  const log = existsSync(file) ? readFileSync(file, "utf8") : "";
  const names = [...new Set([...log.matchAll(/^\(fail\) (.*?)(?: \[[\d.]+m?s\])?$/gm)].map((m) => m[1]))];
  return `${run.reason}\n${names.length ? `\nThe failing tests:\n${names.map((n) => `- ${n}`).join("\n")}\n` : ""}\nThe tests are hidden: their source and log are not available. Fix the cause, run the tests, and commit.`;
}

/** Start the next run as `aleph land` or `aleph job` would, in-process. What it prints and its refusal go to next.log. */
async function start(folder: string, run: Run, next: NonNullable<Run["next"]>): Promise<void> {
  if (gates({ only: ["pause"] })) {
    appendFileSync(join(folder, "next.log"), `paused: no ${next} started\n`);
    updateRun(folder, { next: undefined });
    return;
  }
  const dropped = (jobById(run.job) ?? []).some((e) => e.run.state === "dropped");
  const repo = run.repo ? loadRegistry()[run.repo] : undefined;
  if (repo && !dropped && onOf(run) !== undefined) fetchOrigin(repo.path);
  const there = dropped ? null : itemOnMain(repo, onOf(run));
  if (dropped || there) {
    appendFileSync(join(folder, "next.log"), dropped ? `dropped: no ${next} started\n` : `item landed as ${there}: no ${next} started\n`);
    updateRun(folder, { next: undefined });
    return;
  }
  const h = next === "land" ? gates({ only: ["hold"], except: run.job }) : null;
  if (h) {
    appendFileSync(join(folder, "next.log"), `held: ${h.why}\n`);
    updateRun(folder, { next: undefined });
    return;
  }
  const note = run.failed === "hidden"
    ? hiddenNote(folder, run)
    : run.failed === "review"
    ? `The reviewer sent this branch back: ${run.reason}\n\nFix what it names, run the tests, and commit.`
    : run.failed
    ? `The check \`${run.failed}\` failed on this branch. The last 80 lines of its log:\n\n${checkLog(folder, run.failed)}\n\nFix the cause, run the tests, and commit.`
    : run.reason === OWN_LIST
    ? `The land refused this branch because it changes ${TODO_PATH}. Only aleph issue writes the list. The lists live in the work store now. Remove ${TODO_PATH} from the branch, commit, and make each change to the list with aleph issue.`
    : `The land conflicted with origin/main in: ${(run.conflicts ?? []).join(", ")}. Merge origin/main into this branch, resolve each conflict so that the change on main and this job's change both survive, run the tests, and commit.`;
  const log = join(folder, "next.log");
  try {
    const s = next === "land"
      ? await startLand(run.name, {}, { output: { file: log } })
      : await startJob({ repo: run.repo!, name: run.name, spec: note, land: true }, { output: { file: log } });
    appendFileSync(log, JSON.stringify(s.started, null, 2) + "\n");
    await s.child?.exited;
  } catch (e: any) {
    appendFileSync(log, `${String(e?.message ?? e)}\n`);
    updateRun(folder, { next: undefined });
  }
}

async function agent(id: string, folder: string, run: Run, repo: Repo, env: Record<string, string | undefined>, checkEnv: Record<string, string | undefined>): Promise<{ verdict: Verdict; code: number }> {
  const wt = run.worktree!;
  const branch = run.branch!;
  const phase = (p: string) => updateRun(folder, { phase: p });
  const fail = (reason: string) => ({ verdict: { state: "failed" as const, reason }, code: 1 });

  // A new job starts from origin/<main>, after it clears what an ended job of that name left.
  if (run.job === id || !existsSync(wt)) {
    phase("setup");
    // Units of one repo share its .git: a concurrent worktree add fails on the config lock, prune removes another's
    // half-made worktree entry, and fetch can fail on shared files. One unit at a time runs these git writes.
    const release = await lock(`setup-${repo.key}`, 300_000);
    if (!release) return fail("setup lock busy");
    try {
      const fetched = fetchOrigin(repo.path);
      if (!fetched.ok) {
        appendFileSync(join(folder, "setup.log"), `## fetch: failed\n${fetched.out}\n`);
        return fail(`fetch failed: ${fetched.out}`);
      }
      const add = addWorktree(repo.path, wt, branch, `origin/${repo.main}`);
      if (!add.ok) return fail(`worktree add failed: ${add.out}`);
    } finally {
      release();
    }
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
    GH_CONFIG_DIR: ghDir, GH_TOKEN: undefined, GITHUB_TOKEN: undefined, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
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
  if (question) return { verdict: { ...awaiting("input", "question", question.slice("QUESTION:".length).trim()), question: question.slice("QUESTION:".length).trim() }, code: 0 };
  const dirty = git(wt, "status", "--porcelain").out;
  if (dirty) return fail(`uncommitted: ${dirty.split("\n")[0].slice(3)}`);
  const refetched = fetchOrigin(wt);
  if (!refetched.ok) {
    appendFileSync(join(folder, "setup.log"), `## fetch: failed\n${refetched.out}\n`);
    return fail(`fetch failed: ${refetched.out}`);
  }
  const base = git(wt, "merge-base", `origin/${repo.main}`, "HEAD").out;
  if (git(wt, "rev-list", "--count", `${base}..HEAD`).out === "0") {
    removeBranch(repo, run);
    return { verdict: { state: "done", reason: "no commits" }, code: 0 };
  }
  stampJob(wt, base, run.job);
  const changed = git(wt, "diff", "--name-only", base, "HEAD").out.split("\n").filter(Boolean);
  const failed = await runChecks(folder, wt, repo, checkEnv, changed, phase, recorder(folder));
  if (failed) return fail(failed);
  const matches = (globs: string[]) => changed.some((f) => globs.some((g) => new Bun.Glob(g).match(f)));
  // A manual check does not hold the run: it lands with the check open (see land).
  const manual = repo.manual.find((m) => matches(m.when));
  return { verdict: { state: "passed", checkedBase: base, checkedTip: git(wt, "rev-parse", "HEAD").out, ...(manual ? { say: manual.say } : {}) }, code: 0 };
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
  { const f = fetchOrigin(repo.path); if (!f.ok) return stuck(`fetch failed: ${f.out}`); }
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
    // Chrome stays outside the sandbox: the worker's shot requests are served here, through a bridge into its network namespace.
    const reach = async (url: string) => {
      const pid = child ? sandboxNetnsPid(child.pid) : null;
      if (pid === null) return { url, stop: async () => {} };
      const u = new URL(url);
      const b = await bridge(pid, Number(u.port));
      return { url: new URL(u.pathname + u.search + u.hash, b.url).href, stop: b.stop, stderr: b.stderr };
    };
    const shots = serveShots(dir, { reach });
    let w: Awaited<ReturnType<typeof sandboxed>>;
    try {
      w = await sandboxed(dir, script, {
        read: ["in.bundle"], write: ["home", "work", "tmp"], cwd: "work", stdin: text,
        env: { CLAUDE_CODE_OAUTH_TOKEN: workerToken(), CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" },
        stdout: join(folder, "output.log"), stderr: join(folder, "stderr.log"), limit: limit("ALEPH_JOB_TIMEOUT", 2400),
        stall: limit("ALEPH_STALL_SECONDS", 600),
        onSpawn: (p) => { child = p; },
      });
    } finally { await shots.stop(); }
    child = null;
    const o = outcome(readFileSync(join(folder, "output.log"), "utf8"));
    writeFileSync(join(folder, "result.md"), o.result);
    const facts: Partial<Verdict> = { ...(o.cost !== undefined ? { cost: o.cost } : {}), defaults: tagged(o.result, "DEFAULT") };
    fileFollowups(repo, run, tagged(o.result, "FOLLOWUP"));
    noteFlakes(repo, run, tagged(o.result, "FLAKE"));
    if (w.stalled) {
      const s = limit("ALEPH_STALL_SECONDS", 600);
      return stuck(`stalled: no output for ${s % 60 === 0 ? `${s / 60} minutes` : `${s} seconds`}`, facts);
    }
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

    // Each earlier run of the job that a failed check sent back is a fix round.
    const earlier = (jobById(run.job) ?? []).filter((e) => e.id !== id && isBuild(e.run.kind) && e.run.failed).map((e) => e.run);
    const done = earlier.length;
    if (done) facts.round = done;
    const changed = git(repo.path, "diff", "--name-only", base, `refs/heads/${branch}`).out.split("\n").filter(Boolean);
    const failed = await checksInSandbox(folder, dir, "out/out.bundle", `refs/heads/${branch}`, repo, changed, phase, recorder(folder), hiddenOf(repo, run));
    if (failed) {
      // A check that failed goes back to the worker, at most FIX_ROUNDS times a job.
      const check = readRun(folder)?.checks?.findLast((c) => !c.ok)?.name;
      if (!check || (failed !== `${check} failed` && !(check === "hidden" && failed.startsWith("hidden check failed")))) return stuck(failed, facts);
      const rounds = fixRounds();
      if (done < rounds) return stuck(failed, { ...facts, failed: check, round: done });
      return stuck(rounds > 0 ? `${failed} after ${done} fix rounds` : failed, facts);
    }
    facts.checkedBase = base;
    facts.checkedTip = git(repo.path, "rev-parse", `refs/heads/${branch}`).out;
    return await heldAndReview(id, folder, run, repo, dir, base, branch, facts, earlier);
  } finally {
    removeRunFolder(dir);
  }
}

/** "once", "twice", "3 times". */
const times = (n: number) => n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;

/**
 * After the checks pass: the held rule, then the reviewer. `earlier` is the runs
 * of the job that were sent back (a worker run; a recheck has none): a reviewer
 * finding goes back to the worker like a failed check, while rounds are left.
 */
async function heldAndReview(id: string, folder: string, run: Run, repo: Repo, dir: string, base: string, branch: string, facts: Partial<Verdict>, earlier?: Run[]): Promise<{ verdict: Verdict; code: number }> {
  const phase = (p: string) => updateRun(folder, { phase: p });
  const rule = heldRule(repo.path, repo.held, base, `refs/heads/${branch}`);
  const stat = git(repo.path, "diff", "--stat", base, `refs/heads/${branch}`).out;
  if (rule) return { verdict: { ...awaiting("approval", "held-path", rule, [stat]), reason: rule, stat, ...facts }, code: 0 };
  phase("review");
  const findings = testFindings(repo.path, base, `refs/heads/${branch}`);
  let rv = await review(id, folder, run, repo, dir, base, branch, findings);
  if (rv.cost !== undefined) facts.cost = (facts.cost ?? 0) + rv.cost;
  // A reviewer that gave no verdict runs once more; a second miss is the reviewer's, not the
  // worker's: it goes to Chris whatever fix rounds are left, since a fix round cannot cure it.
  if (rv.none) {
    rv = await review(id, folder, run, repo, dir, base, branch, findings);
    if (rv.cost !== undefined) facts.cost = (facts.cost ?? 0) + rv.cost;
  }
  if (!rv.reason) return { verdict: { state: "passed", ...facts }, code: 0 };
  if (rv.none) return { verdict: { ...awaiting("approval", "review", rv.reason, [stat]), reason: rv.reason, stat, ...facts }, code: 0 };
  if (earlier) {
    if (earlier.length < fixRounds()) return { verdict: { state: "stuck", reason: rv.reason, stat, ...facts, failed: "review", round: earlier.length }, code: 1 };
    const back = earlier.filter((r) => r.failed === "review").length;
    if (back) return { verdict: { ...awaiting("approval", "review", sentBack(back, rv.reason), [stat]), reason: sentBack(back, rv.reason), stat, ...facts }, code: 0 };
  }
  return { verdict: { ...awaiting("approval", "review", rv.reason, [stat]), reason: rv.reason, stat, ...facts }, code: 0 };
}

/** The reason of a run that came back from the reviewer after the last fix round. */
const sentBack = (n: number, reason: string) => `the reviewer sent it back ${times(n)}: ${reason.replace(/^reviewer:\s*/, "")}`;

/**
 * A held run whose review says `back` goes to the worker as a fix round, while
 * rounds are left; after the last round it stays with Chris, its reason saying so.
 * Called by `aleph review` when the review ends.
 */
export async function reviewBack(folder: string): Promise<void> {
  const run = readRun(folder);
  const r2 = readCall(folder);
  if (!run || !isBuild(run.kind) || !isAwaiting(run.state) || r2?.verdict !== "back") return;
  const earlier = (jobById(run.job) ?? []).filter((e) => e.id !== basename(folder) && isBuild(e.run.kind) && e.run.failed).map((e) => e.run);
  const reason = r2.reason ?? "no reason given";
  if (earlier.length < fixRounds()) {
    const ended = updateRun(folder, { state: "stuck", ask: undefined, needs: undefined, reason, failed: "review", round: earlier.length, next: "worker" });
    await start(folder, ended, "worker");
    return;
  }
  const back = earlier.filter((r) => r.failed === "review").length;
  if (back) updateRun(folder, { reason: sentBack(back, reason) });
}

/**
 * A recheck: no worker. The run branch takes origin/<main> by a merge made in
 * memory (a conflict makes the run stuck and names the files), the checks run
 * in the sandbox on the result, then the held rule and the reviewer, as after a worker.
 */
async function recheck(id: string, folder: string, run: Run, repo: Repo): Promise<{ verdict: Verdict; code: number }> {
  const branch = run.branch!;
  const ref = `refs/heads/${branch}`;
  const main = `refs/remotes/origin/${repo.main}`;
  const phase = (p: string) => updateRun(folder, { phase: p });
  const stuck = (reason: string, extra: Partial<Verdict> = {}) => ({ verdict: { state: "stuck" as const, reason, ...extra }, code: 1 });
  phase("setup");
  { const f = fetchOrigin(repo.path); if (!f.ok) return stuck(`fetch failed: ${f.out}`); }
  const tip = git(repo.path, "rev-parse", "--verify", "-q", ref);
  if (!tip.ok) return stuck(`branch gone: ${branch}`);
  const upstream = git(repo.path, "rev-parse", main).out;
  phase("merge");
  if (!git(repo.path, "merge-base", "--is-ancestor", upstream, tip.out).ok) {
    const merged = git(repo.path, "merge-tree", "--write-tree", "--name-only", tip.out, upstream);
    const lines = merged.out.split("\n");
    if (!merged.ok) {
      const conflicts = lines.slice(1, lines.indexOf("") < 0 ? undefined : lines.indexOf("")).filter(Boolean);
      return stuck(`merge conflict: ${conflicts.join(", ")}`, { conflicts });
    }
    const c = git(repo.path, "commit-tree", lines[0], "-p", tip.out, "-p", upstream, "-m", `Merge ${repo.main} into ${branch}`);
    if (!c.ok || !git(repo.path, "update-ref", ref, c.out, tip.out).ok) return stuck(`merge failed: ${c.out}`);
  }
  const dir = makeRunFolder(id);
  try {
    const b = git(repo.path, "bundle", "create", join(dir, "out", "out.bundle"), ref);
    if (!b.ok) return stuck(`bundle failed: ${b.out}`);
    const base = git(repo.path, "merge-base", main, ref).out;
    if (git(repo.path, "rev-list", "--count", `${main}..${ref}`).out === "0") return stuck("no commit");
    const changed = git(repo.path, "diff", "--name-only", base, ref).out.split("\n").filter(Boolean);
    const failed = await checksInSandbox(folder, dir, "out/out.bundle", ref, repo, changed, phase, recorder(folder), hiddenOf(repo, run));
    if (failed) return stuck(failed);
    return await heldAndReview(id, folder, run, repo, dir, base, branch, { checkedBase: base, checkedTip: git(repo.path, "rev-parse", ref).out });
  } finally {
    removeRunFolder(dir);
  }
}

const REVIEW = `You are the reviewer of job \`%NAME%\`. The working directory is a clone of the
branch the worker made for the goal issue below; read the code there as needed.
Judge whether the diff does what the issue asks, whether the tests cover it, and
whether it breaks anything. Do not change files. The factory already ran the repo's checks on this branch and
they passed. Do not run the full test suite or repeat-run loops: you have a time
box, and a long command ends it with no verdict. Run only a few targeted commands
of your own, each ending in well under a minute. ${FOREGROUND} End with one line:
\`VERDICT: pass\` or \`VERDICT: hold <one-sentence reason>\`.`;

const TESTS = `The diff changes tests. Judge each finding below against the goal: hold only
when the goal does not call for the change, or the change weakens a check the
goal keeps. A change the goal calls for passes.`;

/** The reviewer's prompt: the instructions, the test findings if any, the goal and the diff. */
export function reviewPrompt(name: string, spec: string, diff: string, findings: string[]): string {
  const tests = findings.length ? `\n\n## Test changes\n\n${TESTS}\n\n${findings.map((f) => `- The diff ${f}`).join("\n")}` : "";
  return `${REVIEW.replace("%NAME%", name)}${tests}\n\n## Goal issue\n\n${spec}\n\n## Diff from the merge base\n\n${diff}\n`;
}

/**
 * A fresh reviewer reads the passing run: `claude -p` on Opus 5.5 under srt,
 * with the worker's profile, in its own run folder with a clone of the branch.
 * Returns the reason to hold, or null on a pass, and the cost. Fails closed.
 */
async function review(id: string, folder: string, run: Run, repo: Repo, dir: string, base: string, branch: string, findings: string[]): Promise<{ reason: string | null; cost?: number; none?: boolean }> {
  const rdir = makeRunFolder(`${id}-review`);
  try {
    copyFileSync(join(dir, "out", "out.bundle"), join(rdir, "out", "out.bundle"));
    const spec = readFileSync(join(folder, "..", run.job, "spec.md"), "utf8").trim();
    const whole = git(repo.path, "diff", base, `refs/heads/${branch}`).out;
    const max = limit("ALEPH_REVIEW_DIFF_MAX", 200000);
    const diff = whole.length <= max ? whole
      : `${git(repo.path, "diff", "--stat", base, `refs/heads/${branch}`).out}\n\n${whole.slice(0, max)}\n\n(diff cut at ${max} of ${whole.length} characters; read the changed files in the working directory)`;
    const text = reviewPrompt(run.name, spec, diff, findings);
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
      env: { CLAUDE_CODE_OAUTH_TOKEN: workerToken(), CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" },
      stdout: log, stderr: join(folder, "review.err"), limit: limit("ALEPH_REVIEW_TIMEOUT", 600),
      onSpawn: (p) => { child = p; },
    });
    child = null;
    const o = outcome(existsSync(log) ? readFileSync(log, "utf8") : "");
    writeFileSync(join(folder, "review.md"), o.result);
    const cost = o.cost;
    const none = (why: string) => ({ reason: `reviewer: no verdict (${why})`, cost, none: true });
    if (w.timedOut) return none("time box");
    if (!o.ok) return none(o.line || `exit ${w.code}`);
    const v = reviewVerdict(o.result);
    if (!v) return none("no VERDICT line");
    return { reason: v.pass ? null : `reviewer: ${v.reason}`, cost };
  } finally {
    removeRunFolder(rdir);
  }
}

/**
 * A worker's `FOLLOWUP:` lines each become an issue with `source: worker` (the line as the title, the run in a `## Request` line),
 * filed in one store commit. This reverses the aleph-826 choice (a log and no issue), which the spec supersedes.
 */
function fileFollowups(repo: Repo, run: Run, titles: string[]): void {
  if (!titles.length) return;
  fileIssues(repo, `followups from ${run.name}`, titles.map((title) => ({ title, source: "worker" as const, body: `## Request\n\nA follow-up the worker met in run ${run.name}.\n` })));
}

/** A worker's `FLAKE:` lines become notes on the repo's flake tracker; they file no issue and start no triage. */
function noteFlakes(repo: Repo, run: Run, lines: string[]): void {
  for (const line of lines) noteFlake(repo, `job ${run.name}: ${line}`);
}
