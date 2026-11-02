/**
 * The land of a job: the queue of a repo's lands, the batch, the merge chain,
 * the split of a batch whose checks fail, the push and its retry, and what comes
 * after a land that failed. Also the one rule for which runs may land.
 * The repo's checks and the start of more land runs reach this module through
 * `LandPorts`, so tests land in-process with real git and a fake check.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeAndFile } from "../../todo/lib/store.ts";
import { fetchOrigin, followMain, git, jobCommit } from "./git.ts";
import { needsOf } from "./ask.ts";
import { askOf, allRuns, isAwaiting, isBuild, isLive, loadRegistry, lock, onOf, updateRun, type Entry, type Repo, type Run } from "./ledger.ts";
import { coversAll, stopFields, type ChecksStop } from "./checks.ts";
import { causeOf, LOCK_BUSY, type Cause } from "./outcome.ts";
import { allJobs, hasFile, isOpen, jobById, lastReal } from "./job.ts";
import { itemOnMain } from "./status.ts";
import { serverGraph } from "./ui-graph.ts";
import { landBatch } from "./settings.ts";
import { baselineFile, baselines, factoryDir } from "./factory-status.ts";

/** What the repo's checks said about one commit. `why` is null when they pass; `log` is their part of checks.log. */
export interface CheckReport { why: ChecksStop | null; checks?: Run["checks"]; log?: string }

export interface LandPorts {
  /** The repo's checks on `commit`, which holds the work of `runs`. `changed` is what the commit changes. */
  check(commit: string, runs: Run[], changed: string[]): Promise<CheckReport>;
  /** Start land runs for up to `room` runs waiting to land, and return when they are in the queue. */
  pull(room: number): Promise<void>;
}

/** What a land says about a run. */
export type Verdict = Pick<Run, "condition" | "reason" | "cause" | "checkName" | "commit" | "conflicts" | "checkItem">;
export type Landing = { outcome: Verdict; code: number };

/** The run a land of this job takes its terms from: the last agent or recheck run. */
export const agentOf = (runs: Entry[]): Entry | undefined => runs.filter((e) => isBuild(e.run.kind) || e.run.kind === "recheck").at(-1);

/**
 * The one rule for which runs may land, and on what terms. A passed agent run may land, and it opens a check
 * when it says one. A run that needs Chris only for a manual check, a held path or the reviewer may land when he says so (`asked`).
 * Every other run gives null.
 */
export function landTerms(agent: Run): { manual: boolean; held: boolean; asked: boolean } | null {
  if (!isBuild(agent.kind) && agent.kind !== "recheck") return null;
  if (agent.condition === "passed") return { manual: agent.say !== undefined, held: false, asked: false };
  const needs = isAwaiting(agent.condition) ? needsOf(askOf(agent)) : undefined;
  if (needs === "manual") return { manual: true, held: false, asked: true };
  if (needs === "held" || needs === "review") return { manual: false, held: true, asked: true };
  return null;
}

/** Passed agent runs waiting to land by themselves (`--land` or an autoland repo), oldest first. */
export function waitingToLand(jobs = allJobs()): string[] {
  const repos = loadRegistry();
  return jobs.filter((j) => {
    const last = lastReal(j);
    const r = last.run;
    return isOpen(j) && landTerms(r)?.asked === false && !isLive(last.folder) && (r.land || (r.repo && repos[r.repo]?.autoland));
  }).sort((a, b) => Date.parse(a[0].run.started) - Date.parse(b[0].run.started)).map((j) => j.at(-1)!.run.name);
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

/** The job's worktree, when it has one, and its branch. */
export function removeBranch(repo: Repo, run: Run): void {
  if (run.worktree) {
    git(repo.path, "worktree", "remove", "--force", run.worktree);
    git(repo.path, "worktree", "prune");
  }
  if (run.branch) git(repo.path, "branch", "-D", run.branch);
}

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
  const on = onOf(run);
  const trailers = [
    ...(on === undefined ? [] : [`Issue: ${repo.key}-${on}`]),
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
interface Pending { m: Member; commit: string }


/** The land runs queued behind this one in the repo, oldest first, that `aleph land` would still accept. */
function queuedLands(repo: Repo, id: string, run: Run, cap: number): Member[] {
  const seen = new Set([run.job]);
  const out: Member[] = [];
  const queued = allRuns().filter((e) => e.run.kind === "land" && e.run.repo === repo.key && e.id !== id && e.run.condition === "running" && isLive(e.folder) && !hasFile(e, "batch.json"))
    .sort((a, b) => (a.run.made ?? 0) - (b.run.made ?? 0) || (a.id < b.id ? -1 : 1));
  for (const e of queued) {
    if (out.length >= cap || seen.has(e.run.job)) continue;
    const runs = jobById(e.run.job);
    const agent = runs && agentOf(runs);
    if (!runs || !isOpen(runs) || !agent || !landTerms(agent.run)) continue;
    seen.add(e.run.job);
    out.push({ id: e.id, folder: e.folder, run: e.run, log: (step, o = "") => appendFileSync(join(e.folder, "land.log"), `## ${step}\n${o ? o + "\n" : ""}\n`) });
  }
  return out;
}

/**
 * The commits of `fork..tip` replayed one by one onto `onto`, in memory, as a land's mechanical rebase:
 * the commit it ends on, or null when one conflicts or the range holds a merge, whose resolution a replay would lose.
 */
function rebased(repo: Repo, onto: string, fork: string, tip: string): string | null {
  if (git(repo.path, "rev-list", "--merges", "--count", `${fork}..${tip}`).out !== "0") return null;
  let cur = onto;
  for (const c of git(repo.path, "rev-list", "--reverse", `${fork}..${tip}`).out.split("\n").filter(Boolean)) {
    const merged = git(repo.path, "merge-tree", "--write-tree", `--merge-base=${c}^`, cur, c);
    if (!merged.ok) return null;
    const made = git(repo.path, "commit-tree", merged.out, "-p", cur, "-m", git(repo.path, "log", "-1", "--format=%s", c).out);
    if (!made.ok) return null;
    cur = made.out;
  }
  return cur;
}

/** A member's verdict, and the step to run once the land is over. */
type Outcome = Landing & { after?: () => void };

/** What one attempt of a land shares: the leader, the commit main was at, each member's branch tip and checks, and the land's log and ports. */
interface Attempt {
  repo: Repo;
  leader: Member;
  base0: string;
  tips: Map<Member, string>;
  checksOf: Map<Member, Run["checks"]>;
  finish: (m: Member, o: Outcome) => void;
  log: (step: string, out?: string) => void;
  ports: LandPorts;
  /** Commits whose tree passed every check of the repo. */
  covered: Set<string>;
}

/** A land that did not land: its verdict, with what it conflicted in. */
function failed(cause: Cause, reason: string, extra: Partial<Verdict> = {}): Landing {
  return { outcome: { condition: "failed", cause, reason, ...extra }, code: 1 };
}

/** Merge each run onto the one before it. A conflict, a run with no net change and a run that edits the list leave the chain. */
function build(ctx: Attempt, list: Member[], from: string): Pending[] {
  const { repo, tips, finish } = ctx;
  const items: Pending[] = [];
  let cur = from;
  for (const m of list) {
    let tip = tips.get(m)!;
    let merged = git(repo.path, "merge-tree", "--write-tree", "--name-only", cur, tip);
    if (!merged.ok) {
      const replayed = rebased(repo, cur, git(repo.path, "merge-base", cur, tip).out, tip);
      m.log(`mechanical rebase: ${replayed ? "ok" : "conflicts"}`);
      if (replayed) {
        tip = replayed;
        tips.set(m, tip);
        merged = git(repo.path, "merge-tree", "--write-tree", "--name-only", cur, tip);
      }
    }
    if (!merged.ok) {
      const lines = merged.out.split("\n");
      const conflicts = lines.slice(1, lines.indexOf("") < 0 ? undefined : lines.indexOf("")).filter(Boolean);
      m.log("conflicts", conflicts.join("\n"));
      finish(m, failed("conflict", "merge conflict", { conflicts }));
      continue;
    }
    const tree = merged.out.split("\n")[0];
    if (tree === git(repo.path, "rev-parse", `${cur}^{tree}`).out) {
      m.log("no net change");
      finish(m, { outcome: { condition: "done", reason: "no net change" }, code: 0, after: () => removeBranch(repo, m.run) });
      continue;
    }
    // Only aleph issue writes the list. A worker can go past git-guard with a script, so the land refuses it.
    if (git(repo.path, "diff", "--name-only", cur, tree).out.split("\n").includes(TODO_PATH)) { finish(m, failed("own-list", OWN_LIST, { conflicts: [TODO_PATH] })); continue; }
    const fork = git(repo.path, "merge-base", cur, tip).out;
    const subjects = git(repo.path, "log", "--reverse", "--no-merges", "--format=%s", `${fork}..${tip}`).out.split("\n").filter(Boolean);
    const c = git(repo.path, "commit-tree", tree, "-p", cur, "-m", landMessage(subjects, m.run, repo));
    m.log(`commit-tree: ${c.ok ? "ok" : "failed"}`, c.out);
    if (!c.ok) { finish(m, failed("other", "commit-tree failed")); continue; }
    items.push({ m, commit: c.out });
    cur = c.out;
  }
  return items;
}

/** The checks on the chain's last commit, or none when the run's own checks passed on this very origin/<main>. */
async function check(ctx: Attempt, items: Pending[], base: string): Promise<ChecksStop | null> {
  const { repo, leader, base0, tips, checksOf, log, ports } = ctx;
  const first = items[0].m.run;
  const changed = git(repo.path, "diff", "--name-only", base, items.at(-1)!.commit).out.split("\n").filter(Boolean);
  const cover = (tip: string) => { if (coversAll(repo, changed)) ctx.covered.add(tip); };
  if (items.length === 1 && base === base0 && first.checkedBase === base0 && first.checkedTip === tips.get(items[0].m)) {
    log(`checks skipped: main unchanged since ${base0}`);
    // The run's own checks passed on this base; a failed call that covered it earlier does not decide its verdict.
    checksOf.set(items[0].m, first.checks);
    cover(items[0].commit);
    return null;
  }
  const tip = items.at(-1)!.commit;
  log(`checks on ${items.length} run${items.length > 1 ? "s" : ""}`, items.map((i) => i.m.run.name).join("\n"));
  const report = await ports.check(tip, items.map((i) => i.m.run), changed);
  for (const i of items) checksOf.set(i.m, report.checks);
  if (report.why && items.length === 1 && items[0].m !== leader && report.log !== undefined) items[0].m.log("checks.log", report.log);
  if (!report.why) cover(tip);
  return report.why;
}

/**
 * Write `commit` to baseline.json as green, the way the factory's baseline does, so the next dispatch does not run
 * the checks on it again. Never replaces the entry of a commit that is not an ancestor of `commit`.
 */
async function recordGreen(repo: Repo, commit: string, log: (step: string, out?: string) => void): Promise<void> {
  try {
    const release = await lock(`baseline-${repo.key}`, 60_000);
    if (!release) { log("baseline not recorded: lock busy"); return; }
    try {
      const old = baselines()[repo.key];
      if (old && old.commit !== commit && git(repo.path, "cat-file", "-e", `${old.commit}^{commit}`).ok
        && !git(repo.path, "merge-base", "--is-ancestor", old.commit, commit).ok) { log("baseline not recorded: newer entry"); return; }
      mkdirSync(factoryDir(), { recursive: true });
      writeFileSync(baselineFile(), JSON.stringify({ ...baselines(), [repo.key]: { repo: repo.key, commit, ok: true } }, null, 2) + "\n");
      log(`baseline green: ${commit}`);
    } finally {
      release();
    }
  } catch (e) {
    log(`baseline not recorded: ${e instanceof Error ? e.message : e}`);
  }
}

/** The commits of `items` that pass, in order, and the commit they end on. `known` is why the whole chain is already known to fail. */
async function settle(ctx: Attempt, items: Pending[], base: string, known: ChecksStop | null): Promise<{ ok: Pending[]; tip: string }> {
  if (!items.length) return { ok: [], tip: base };
  const why = known ?? await check(ctx, items, base);
  if (!why) return { ok: items, tip: items.at(-1)!.commit };
  if (items.length === 1) { ctx.finish(items[0].m, { outcome: { condition: "failed", ...stopFields(why) }, code: 1 }); return { ok: [], tip: base }; }
  ctx.log(`split ${items.length} runs: ${why.reason}`);
  const h = Math.floor(items.length / 2);
  const a = await settle(ctx, items.slice(0, h), base, null);
  const rest = items.slice(h);
  // The first half passed whole, so the second half on top of it is the tree that just failed.
  const intact = a.ok.length === h;
  const b = await settle(ctx, intact ? rest : build(ctx, rest.map((i) => i.m), a.tip), a.tip, intact ? why : null);
  return { ok: [...a.ok, ...b.ok], tip: b.ok.length ? b.tip : a.tip };
}

/**
 * Land a job, and the land runs queued behind it. Each run's branch merges onto
 * origin/<main> in memory, in order, as one squash commit with its own trailers.
 * A merge that conflicts tries a mechanical rebase first, so the worker wakes only when that conflicts too.
 * The checks run once on the last commit; when they fail the batch splits in
 * half, until the run that fails is found. That run fails, the others land, and
 * one plain push takes all their commits. A conflict takes only its run out. A
 * run whose own checks passed on the current origin/<main> pushes with no check.
 * A refused push merges again, at most RELANDS times. Each run's issue closes
 * in the work store after the push, and the main checkout follows origin/<main>
 * if it is clean. Every failure leaves the remote as it was.
 */
export async function land({ id, folder, run }: Entry, repo: Repo, ports: LandPorts): Promise<Landing> {
  const main = repo.main;
  const logFile = join(folder, "land.log");
  const log = (step: string, out = "") => appendFileSync(logFile, `## ${step}\n${out ? out + "\n" : ""}\n`);
  const logged = (name: string, r: { ok: boolean; out: string }) => { log(`${name}: ${r.ok ? "ok" : "failed"}`, r.out); return r; };
  const step = (name: string, ...args: string[]) => logged(name, git(repo.path, ...args));
  const phase = (p: string) => updateRun(folder, { phase: p });
  const fail =(cause: Cause, reason: string, extra: Partial<Verdict> = {}) => { log(`failed: ${reason}`); return failed(cause, reason, extra); };

  const release = await lock(`job-${repo.key}-${run.name}`, 60_000);
  if (!release) return fail("lock-busy", LOCK_BUSY);
  let releaseRepo: (() => void) | null = null;
  try {
    phase("queued");
    releaseRepo = await landTurn(repo, id, run.made ?? 0);
    // A land run an earlier land took into its batch has its verdict in its folder.
    const given = join(folder, "batch.json");
    if (existsSync(given)) {
      const b = JSON.parse(readFileSync(given, "utf8"));
      if (b.checks) updateRun(folder, { checks: b.checks });
      return { outcome: b.verdict, code: b.code };
    }
    phase("land");
    const cap = landBatch();
    const room = cap - 1 - queuedLands(repo, id, run, cap).length;
    if (room > 0) await ports.pull(room);
    const leader: Member = { id, folder, run, log };
    const members = [leader, ...queuedLands(repo, id, run, cap - 1)];
    for (const m of members.slice(1)) m.log(`taken into the batch of ${run.name}'s land ${id}`);
    if (members.length > 1) log(`batch of ${members.length}`, members.map((m) => m.run.name).join("\n"));

    // Members that failed in an earlier attempt keep their verdict and are not tried again.
    const failedBefore = new Map<Member, Landing & { after?: () => void }>();
    for (let attempt = 0; ; attempt++) {
      { const f = logged("fetch", fetchOrigin(repo.path)); if (!f.ok) return fail("infra", `fetch failed: ${f.out}`); }
      const base0 = git(repo.path, "rev-parse", `origin/${main}`).out;
      const done = new Map<Member, Landing & { after?: () => void }>(failedBefore);
      const finish = (m: Member, o: Landing & { after?: () => void }) => { done.set(m, o); if (o.outcome.condition === "failed") m.log(`failed: ${o.outcome.reason}`); };
      const tips = new Map<Member, string>();
      // The checks of the last check call that covered each member; that call decided its verdict.
      const checksOf = new Map<Member, Run["checks"]>();

      // Runs that need no merge: already on main, their item on main, or no branch.
      const open: Member[] = [];
      for (const m of members) {
        // A land that pushed and then died finds its own commit here and does not merge again.
        const pushed = jobCommit(repo.path, main, m.run.job);
        if (pushed) {
          m.log(`already on main as ${pushed}`);
          finish(m, { outcome: { condition: "landed", commit: pushed }, code: 0, after: () => {
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
          finish(m, { outcome: { condition: "done", reason: `item landed as ${there}` }, code: 0, after: () => { closeItems(repo, { ...m.run, check: undefined }); removeBranch(repo, m.run); } });
          continue;
        }
        const tip = git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${m.run.branch}`);
        if (!tip.ok) { finish(m, failed("other", `branch gone: ${m.run.branch}`)); continue; }
        tips.set(m, tip.out);
        open.push(m);
      }

      const covered = new Set<string>();
      const ctx: Attempt = { repo, leader, base0, tips, checksOf, finish, log, ports, covered };
      const chain = build(ctx, open, base0);
      const result = await settle(ctx, chain, base0, null);
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
            finish(m, { outcome: { condition: "landed", commit, checkItem }, code: 0 });
          }
          followCheckout(repo, log);
          if (covered.has(result.tip)) await recordGreen(repo, result.tip, log);
          return conclude(leader, done, checksOf);
        }
        { const f = logged("fetch", fetchOrigin(repo.path)); if (!f.ok) return fail("infra", `fetch failed: ${f.out}`); }
        const refused = git(repo.path, "rev-parse", `origin/${main}`).out === base0;
        if (refused || attempt >= RELANDS) {
          for (const { m } of ok) done.set(m, refused ? failed("other", "push refused") : failed("moved", MOVED));
          for (const { m } of ok) m.log(`failed: ${refused ? "push refused" : MOVED}`);
          return conclude(leader, done, checksOf);
        }
        log("main moved; merging again");
        for (const [m, o] of done) {
          if (o.outcome.condition !== "failed" || ok.some((i) => i.m === m)) continue;
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
function conclude(leader: Member, done: Map<Member, Landing & { after?: () => void }>, checksOf: Map<Member, Run["checks"]>): Landing {
  for (const [m, o] of done) {
    o.after?.();
    if (m === leader) continue;
    const checks = checksOf.get(m);
    writeFileSync(join(m.folder, "batch.json"), JSON.stringify({ verdict: o.outcome, code: o.code, ...(checks ? { checks } : {}) }));
  }
  const own = checksOf.get(leader);
  if (own) updateRun(leader.folder, { checks: own });
  return done.get(leader) ?? { outcome: { condition: "failed", cause: "other", reason: "not landed" }, code: 1 };
}

/**
 * After the land is on origin/<main>: fast-forward the repo's main checkout,
 * and, for the aleph repo, restart aleph-ui when a path between the checkout's
 * old and new HEAD is in serverGraph (the files the server imports, at the new
 * HEAD), wherever it lives. Neither fails the land; the log says what
 * happened. A checkout
 * that did not move still holds the old code, so no restart.
 */
function followCheckout(repo: Repo, log: (step: string, out?: string) => void): void {
  const old = git(repo.path, "rev-parse", "HEAD").out;
  const why = followMain(repo.path, repo.main);
  if (why) { log(why); return; }
  log("main checkout updated");
  if (repo.key !== "aleph") return;
  const moved = git(repo.path, "diff", "--name-only", old, "HEAD").out.split("\n").filter(Boolean);
  const graph = serverGraph(repo.path);
  if (!moved.some((f) => graph.has(f))) return;
  try {
    const r = Bun.spawnSync(["systemctl", "--user", "try-restart", "--no-block", "aleph-ui.service"], { stdout: "pipe", stderr: "pipe" });
    log(r.exitCode === 0 ? "aleph-ui restarted" : `aleph-ui not restarted: ${(r.stderr.toString() || r.stdout.toString() || `exit ${r.exitCode}`).trim()}`);
  } catch (e) {
    log(`aleph-ui not restarted: ${e instanceof Error ? e.message : e}`);
  }
}

const BOUNCES = 2;
const RELANDS = 3;

/**
 * What the unit starts after a failed land. A land that conflicts, or that
 * refuses a branch that changes the list, goes back to the worker, at most
 * BOUNCES times a job; a land that lost a race lands again, at most RELANDS times.
 */
export function afterLand(run: Run): Run["next"] {
  if (run.condition !== "failed") return undefined;
  const lands = (jobById(run.job) ?? []).filter((e) => e.run.kind === "land").map((e) => e.run);
  if (run.conflicts?.length) return lands.filter((r) => r.conflicts?.length).length <= BOUNCES ? "worker" : undefined;
  if (causeOf(run) === "moved") return lands.filter((r) => causeOf(r) === "moved").length <= RELANDS ? "land" : undefined;
  return undefined;
}

/** What the worker reads when a land sent the job back. */
export function bounceNote(run: Run): string {
  return causeOf(run) === "own-list"
    ? `The land refused this branch because it changes ${TODO_PATH}. Only aleph issue writes the list. The lists live in the work store now. Remove ${TODO_PATH} from the branch, commit, and make each change to the list with aleph issue.`
    : `The land conflicted with origin/main in: ${(run.conflicts ?? []).join(", ")}. Merge origin/main into this branch, resolve each conflict so that the change on main and this job's change both survive, run the tests, and commit.`;
}

/** The model of a merge run: the cheapest tier the factory routes a worker to. */
export const MERGE_MODEL = "haiku";
/** The time limit of a merge run, in seconds. */
export const MERGE_SECONDS = 600;

/** Whether the next run is a merge run: a conflict bounce, not an `own-list` one. */
export const isMergeBounce = (land: Run): boolean => causeOf(land) !== "own-list" && !!land.conflicts?.length;

/**
 * The whole prompt of a merge run: the conflicted paths, the last commit on main that touched each,
 * and the goal's title when the store has one. No spec text, no notes.
 */
export function mergePrompt(land: Run, repo: Repo, title?: string): string {
  const main = `origin/${repo.main}`;
  const paths = (land.conflicts ?? []).map((p) => {
    const last = git(repo.path, "log", "-1", "--format=%h %s", main, "--", p).out.trim();
    return `- ${p}${last ? ` (last commit on ${main}: ${last})` : ""}`;
  });
  return [
    `# Merge ${main} into this branch`,
    ...(title ? [`Goal: ${title}`] : []),
    `A land of this branch conflicted with ${main}. This run does one task and nothing else: merge ${main} into the branch, resolve the conflicts so that the change on main and this job's change both survive, and commit. Do not start other work.`,
    `Conflicted paths:\n${paths.join("\n")}`,
  ].join("\n\n") + "\n";
}
