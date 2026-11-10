/**
 * The land of a job: the queue of a repo's lands, the batch, the merge chain,
 * the split of a batch whose checks fail, the push and its retry, and what comes
 * after a land that failed. Also the one rule for which runs may land.
 * The repo's checks and the start of more land runs reach this module through
 * `LandPorts`, so tests land in-process with real git and a fake check.
 */
import { basename } from "node:path";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { closeAndFile, note } from "../../../issues/lib/store.ts";
import { filing } from "../transitions/filing.ts";
import { fetchOrigin, followMain, git } from "../infra/git.ts";
import { needsOf } from "../asks/ask.ts";
import { allRuns, isWaiting, isAgentRun, onOf, trailerOf, type Check, type Entry, type Repo, type Run } from "../records/ledger.ts";
import { lock } from "../infra/locks.ts";
import { isLive } from "../infra/process.ts";
import { buildChecks } from "../gates/related.ts";
import { stopFields, type ChecksStop } from "../gates/checks.ts";
import { LOCK_BUSY, type Cause } from "../records/outcome.ts";
import { allJobs, hasFile, isOpen, jobById } from "../records/job.ts";
import { onMain } from "../records/status.ts";
import { RELANDS, TODO_PATH } from "../transitions/continuation.ts";
import { landBatch } from "../infra/settings.ts";
import { runFile } from "../records/run-files.ts";
import { writeTitle } from "../roles/title.ts";
import * as record from "../records/record.ts";

/** What the repo's checks said about one commit. `why` is null when they pass; `log` is their part of checks.log. */
export interface CheckReport { why: ChecksStop | null; checks?: Run["checks"]; log?: string }

export interface LandPorts {
  /** The `picked` checks on `commit`, which holds the work of `runs`. `changed` is what the commit changes; `picked.tests` holds the test files of each narrowed check. */
  check(commit: string, runs: Run[], changed: string[], picked: { checks: Check[]; tests: Map<string, string[]> }): Promise<CheckReport>;
  /** Start land runs for up to `room` runs waiting to land, and return when they are in the queue. */
  pull(room: number): Promise<void>;
}

/** What a land says about a run. */
export type Verdict = Pick<Run, "condition" | "reason" | "cause" | "checkName" | "commit" | "conflicts" | "checkItem">;
export type Landing = { outcome: Verdict; code: number };

/** The run a land of this job takes its terms from: the last agent or recheck run. */
export const agentOf = (runs: Entry[]): Entry | undefined => runs.filter((e) => isAgentRun(e.run.kind)).at(-1);

/**
 * The one rule for which runs may land, and on what terms. A passed agent run may land, and it opens a check
 * when it says one. A run that needs Chris only for a held path or the reviewer may land when he says so (`asked`).
 * Every other run gives null.
 */
export function landTerms(agent: Run): { manual: boolean; held: boolean; asked: boolean } | null {
  if (!isAgentRun(agent.kind)) return null;
  if (agent.condition === "passed") return { manual: agent.say !== undefined, held: false, asked: false };
  const needs = isWaiting(agent.condition) ? needsOf(agent.ask) : undefined;
  if (needs === "protected" || needs === "review") return { manual: false, held: true, asked: true };
  return null;
}

/**
 * Passed agent runs waiting to land by themselves, oldest first: the job's next step is a land (nextStep set `next`
 * for `--land` or an autoland repo). A land that lands again is the unit's own step, so it is not here.
 */
export function waitingToLand(jobs = allJobs()): string[] {
  return jobs.filter((j) => {
    const last = record.counting(j);
    return isOpen(j) && isAgentRun(last.run.kind) && !isLive(last.folder) && record.stepOf(j).step === "land";
  }).sort((a, b) => (a[0].id < b[0].id ? -1 : 1)).map((j) => j.at(-1)!.run.name);
}

/**
 * After the push: the job's issue done in the work store, and a new `check` issue for
 * an open manual check, titled `title`. Returns what happened to each, for the land log.
 * An issue a red CI started (`ci` in its job record) stays open: its record keeps `commit`, the land, and the
 * firefighter closes it when a CI run at or after the land is green (`settleCi`).
 */
function closeItems(repo: Repo, run: Run, title = "", commit?: string): { todo?: string; checkItem?: number } {
  const open = run.check === "open";
  const on = onOf(run);
  if (on === undefined && !open) return {};
  const ci = on !== undefined && run.on && commit ? record.read(run.on)?.ci : undefined;
  if (ci) record.update(run.on!, (r) => { r.ci = { ...ci, landed: commit }; });
  const w = closeAndFile(repo, `todo: job ${run.name} landed`, ci ? undefined : on, `job ${run.name} landed`, open ? [{ title, kind: "check", request: `The manual check of run ${run.name}: ${run.say}` }] : [], "rule", filing);
  if (ci) return { todo: note(repo, on!, `job ${run.name} landed as ${commit!.slice(0, 7)}; the issue is done when GitHub CI on main is green at or after it`) ?? "open until GitHub CI on main is green at or after the land", checkItem: w.ids[0] };
  return { todo: w.todo, checkItem: w.ids[0] };
}

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
    `Job: ${trailerOf(run.job)}`,
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
    out.push({ id: e.id, folder: e.folder, run: e.run, log: (step, o = "") => appendFileSync(runFile(e.folder, "land.log"), `## ${step}\n${o ? o + "\n" : ""}\n`) });
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
    if (git(repo.path, "diff", "--name-only", cur, tree).out.split("\n").includes(TODO_PATH)) { finish(m, failed("other", OWN_LIST, { conflicts: [TODO_PATH] })); continue; }
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

const names = (repo: Repo, from: string, to: string) => git(repo.path, "diff", "--name-only", from, to).out.split("\n").filter(Boolean);

/**
 * The checks on the chain's last commit: the tests its change reaches, the repo's critical tests and the checks that
 * are not tests (buildChecks). The full suite runs on its own timer (`aleph suite`), so no land covers a tip. When
 * the run's own checks passed on this very origin/<main> and tip, they ran the tests its change reaches: only the
 * critical tests run, and none when the repo has none.
 */
async function check(ctx: Attempt, items: Pending[], base: string): Promise<ChecksStop | null> {
  const { repo, leader, base0, tips, checksOf, log, ports } = ctx;
  const first = items[0].m.run;
  const tip = items.at(-1)!.commit;
  const changed = names(repo, base, tip);
  const same = items.length === 1 && base === base0 && first.checkedBase === base0 && first.checkedTip === tips.get(items[0].m);
  const picked = buildChecks(repo, tip, same ? [] : changed, repo.critical);
  const checks = same ? picked.checks.filter((c) => picked.tests.has(c.name)) : picked.checks;
  if (same && !checks.length) {
    log(`checks skipped: main unchanged since ${base0}`);
    // The run's own checks passed on this base; a failed call that covered it earlier does not decide its verdict.
    checksOf.set(items[0].m, first.checks);
    return null;
  }
  const files = [...picked.tests].filter(([name]) => checks.some((c) => c.name === name)).map(([name, f]) => `${name}: ${f.length} test file${f.length === 1 ? "" : "s"}\n${f.join("\n")}`);
  log(`checks on ${items.length} run${items.length > 1 ? "s" : ""}${same ? `, critical tests only: main unchanged since ${base0}` : ""}`, [...items.map((i) => i.m.run.name), ...files].join("\n"));
  const report = await ports.check(tip, items.map((i) => i.m.run), changed, { checks, tests: picked.tests });
  for (const i of items) checksOf.set(i.m, report.checks);
  if (report.why && items.length === 1 && items[0].m !== leader && report.log !== undefined) items[0].m.log("checks.log", report.log);
  return report.why;
}

/** The commits of `items` that pass, in order, and the commit they end on. `known` is why the whole chain is already known to fail. */
async function settle(ctx: Attempt, items: Pending[], base: string, known: ChecksStop | null): Promise<{ ok: Pending[]; tip: string }> {
  if (!items.length) return { ok: [], tip: base };
  const why = known ?? await check(ctx, items, base);
  if (!why) return { ok: items, tip: items.at(-1)!.commit };
  // No verdict blames no run: the batch does not split, and each run lands again (the rescue's infra case).
  if (why.cause === "infra") { for (const i of items) ctx.finish(i.m, { outcome: { condition: "failed", ...stopFields(why) }, code: 1 }); return { ok: [], tip: base }; }
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
  const logFile = runFile(folder, "land.log");
  const log = (step: string, out = "") => appendFileSync(logFile, `## ${step}\n${out ? out + "\n" : ""}\n`);
  const logged = (name: string, r: { ok: boolean; out: string }) => { log(`${name}: ${r.ok ? "ok" : "failed"}`, r.out); return r; };
  const step = (name: string, ...args: string[]) => logged(name, git(repo.path, ...args));
  const phase = (p: string) => record.patchRun(basename(folder), { phase: p });
  const fail =(cause: Cause, reason: string, extra: Partial<Verdict> = {}) => { log(`failed: ${reason}`); return failed(cause, reason, extra); };

  const release = await lock(`job-${repo.key}-${run.name}`, 60_000);
  if (!release) return fail("locked", LOCK_BUSY);
  let releaseRepo: (() => void) | null = null;
  try {
    phase("queued");
    releaseRepo = await landTurn(repo, id, run.made ?? 0);
    // A land run an earlier land took into its batch has its verdict in its folder.
    const given = runFile(folder, "batch.json");
    if (existsSync(given)) {
      const b = JSON.parse(readFileSync(given, "utf8"));
      if (b.checks) record.patchRun(basename(folder), { checks: b.checks });
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
    // The title of each open manual check's issue, written before the land: closeItems runs after the push.
    const checkTitles = new Map(await Promise.all(members.filter((m) => m.run.check === "open").map(async (m) => [m, await writeTitle(m.run.say ?? m.run.name)] as const)));

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
        const hit = onMain(repo, { job: m.run.job, item: onOf(m.run), fetch: false });
        const pushed = hit?.how === "Job trailer" ? hit.commit : "";
        if (pushed) {
          m.log(`already on main as ${pushed}`);
          finish(m, { outcome: { condition: "landed", commit: pushed }, code: 0, after: () => {
            // The land that pushed may have died before it closed the item.
            const { todo, checkItem } = closeItems(repo, m.run, checkTitles.get(m), pushed);
            if (todo) m.log(todo === "done" ? `todo ${onOf(m.run)} done` : `todo ${onOf(m.run)} not closed: ${todo}`);
            if (checkItem !== undefined) m.log(`todo ${checkItem} holds the manual check`);
            removeBranch(repo, m.run);
            followCheckout(repo, log);
          } });
          continue;
        }
        // A commit by hand, or by another job, that names the item: this land must not add a second one.
        const there = hit?.commit;
        if (there) {
          m.log(`item landed as ${there}`);
          finish(m, { outcome: { condition: "done", reason: `item landed as ${there}` }, code: 0, after: () => { closeItems(repo, { ...m.run, check: undefined }, "", there); removeBranch(repo, m.run); } });
          continue;
        }
        const tip = git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${m.run.branch}`);
        if (!tip.ok) { finish(m, failed("other", `branch gone: ${m.run.branch}`)); continue; }
        tips.set(m, tip.out);
        open.push(m);
      }

      const ctx: Attempt = { repo, leader, base0, tips, checksOf, finish, log, ports };
      const chain = build(ctx, open, base0);
      const result = await settle(ctx, chain, base0, null);
      const ok = result.ok;
      if (ok.length) {
        phase("land");
        if (step("push", "push", "-q", "--no-verify", "origin", `${result.tip}:refs/heads/${main}`).ok) {
          for (const { m, commit } of ok) {
            const { todo, checkItem } = closeItems(repo, m.run, checkTitles.get(m), commit);
            if (todo) m.log(todo === "done" ? `todo ${onOf(m.run)} done` : `todo ${onOf(m.run)} not closed: ${todo}`);
            if (checkItem !== undefined) m.log(`todo ${checkItem} holds the manual check`);
            removeBranch(repo, m.run);
            if (m !== leader) m.log(`landed as ${commit} with ${run.name}; the checks ran in ${id}`);
            finish(m, { outcome: { condition: "landed", commit, checkItem }, code: 0 });
          }
          followCheckout(repo, log);
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
    writeFileSync(runFile(m.folder, "batch.json"), JSON.stringify({ verdict: o.outcome, code: o.code, ...(checks ? { checks } : {}) }));
  }
  const own = checksOf.get(leader);
  if (own) record.patchRun(leader.id, { checks: own });
  return done.get(leader) ?? { outcome: { condition: "failed", cause: "other", reason: "not landed" }, code: 1 };
}

/** After the land is on origin/<main>: fast-forward the repo's main checkout. It does not fail the land; the log says what happened. aleph-ui runs under `bun --watch`, so it restarts by itself. */
function followCheckout(repo: Repo, log: (step: string, out?: string) => void): void {
  const why = followMain(repo.path, repo.main);
  log(why ?? "main checkout updated");
}
