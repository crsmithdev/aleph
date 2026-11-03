/**
 * The factory around the runs: the timer's tick, the dispatch and the report.
 * What it reads of its state is in factory-status.ts. Its state lives in
 * ~/.aleph/factory, which no sandbox can see. See docs/specs/2026-10-26-seed-factory.md.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { byPriority, afterOf, goal, goals, isSorted, note, partsOf, planSet, readList, readLists, reader, type Reader } from "../../todo/lib/store.ts";
import { fetchOrigin, git } from "./git.ts";
import { startProposals, takeFresh } from "./deps.ts";
import { askChris, askOf, needsOf, plainAsk } from "./ask.ts";
import { factoryLog } from "./layout.ts";
import { itemOnMain, readRecord, repoStages } from "./status.ts";
import { firefight, type Fired, type Ports } from "./firefighter.ts";
import { countsLine, triageIssue, triageOpen, type Counts } from "./triage.ts";
import { allRuns, askOf as runAskOf, isAwaiting, loadRegistry, lock, updateRun, type Entry, type Repo } from "./ledger.ts";
import { isLive, isStarting } from "./process.ts";
import { endKilledFacts, rescueStuck, type Rescue } from "./rescue.ts";
import { clearRerun, goalBrief } from "./continuation.ts";
import { type Fate } from "./outcome.ts";
import { allJobs, checkedBy, lookMinutes, sealed, lastReal, openJob } from "./job.ts";
import { accept, final, reaccept, reopenedByAcceptance, sandboxRunner, sandboxScenarios, unshown, type Runner, type ScenarioCheck } from "./acceptance.ts";
import { mine, proposals, readStore } from "./corrections.ts";
import { endLost } from "./agent-run.ts";
import { factsGate } from "./facts.ts";
import { explainStep } from "./explain.ts";
import { writeEpisodes } from "./episode.ts";
import { vaultDir } from "../../vault/lib/vault.ts";
import { readdirSync } from "node:fs";
import { waitingToLand } from "./landing.ts";
import { baselineChecks, type ChecksStop } from "./checks.ts";
import { drop, land, recheck, refusal, startGoal } from "./transitions.ts";
import { acceptanceDetached, dispatchDetached, planDetached, specCheckDetached } from "./launch.ts";
import { markLaunched, recordedVerdict, specChecking } from "./spec-check.ts";
import { needsPlan, planning, runPlan, type Rate } from "./plan.ts";
import { route, type Tier } from "./route.ts";
import { writeBaseline, clearCap, goalFacts, issueJob, markCap, markStreak, setPaused, writeStalls, baselines, changedLinesOf, factoryDir, factoryRepos as sandboxRepos, gates, lastProbe, liveRuns, paused, readStalls, recordHold, redLine, runsToday, spentToday } from "./factory-status.ts";
export { setPaused };

/** jobs/lib/probe.ts imports the type from here, and a security path stays as it is. */
import { goalDecision, NO_COMMIT_LIMIT, pendingWaits, refDone } from "./goal-decision.ts";
import { DAY_CAP, rescueOn } from "./settings.ts";


/**
 * The facts gate for every landed job of a factory repo that has a commit, no facts marker on its land run and no facts run yet. A land that
 * comes through the unit's own next step is picked up by the dispatch the unit starts when it ends.
 */
async function factsStep(): Promise<void> {
  endKilledFacts();
  await endLost("facts", (run) => run.name, "its verdicts");
  const keys = new Map(sandboxRepos().map((r) => [r.key, r]));
  for (const j of allJobs()) {
    const last = lastReal(j);
    const repo = last.run.repo ? keys.get(last.run.repo) : undefined;
    if (!repo || last.run.condition !== "landed" || !last.run.commit || last.run.facts || j.some((e) => e.run.kind === "facts")) continue;
    const name = last.run.name;
    const release = await lock(`facts-${name}`, 0);
    if (!release) continue;
    try {
      // Read again under the lock: another dispatch may have run the gate meanwhile.
      const now = allJobs().find((x) => x[0].run.job === j[0].run.job);
      if (!now || now.some((e) => e.run.kind === "facts" || e.run.facts)) continue;
      await factsGate(repo, last, last.run.commit, factoryLog);
    } catch (e: any) {
      factoryLog(`${name}: facts gate failed: ${e?.message ?? e}`);
    } finally {
      release();
    }
  }
}

/** The buildable issues of each factory repo. */
export const openGoals = (lists?: Reader): { repo: Repo; item: issues.Issue }[] => goals(sandboxRepos(), lists);

/** Whether `<repo>-<n>` is done, by `refDone`. It fetches each repo once. */
export function doneChecker(): (ref: string) => boolean {
  const reg = loadRegistry();
  const known = new Map<string, { doc: issues.Doc | null; stages: Map<string, string>; read: boolean }>();
  return (ref) => {
    const r = issues.parseGoalRef(ref);
    const repo = r && reg[r.repo];
    if (!r || !repo) return false;
    if (!known.has(r.repo)) {
      const k = { doc: null as issues.Doc | null, stages: new Map<string, string>(), read: false };
      try {
        k.doc = readList(repo);
        for (const s of repoStages(repo, { fetch: true, doc: k.doc })) k.stages.set(s.id, s.stage);
        k.read = !!k.doc;
      } catch {}
      known.set(r.repo, k);
    }
    const { doc, stages, read } = known.get(r.repo)!;
    return refDone(doc ? issues.find(doc, r.id) : undefined, read, stages.get(`${r.repo}-${r.id}`));
  };
}

/** Dispatch is off when `ALEPH_DISPATCH=off`: a run's end and `aleph issue` then start nothing; the tick still does. */

/** `tier` is the router's rating when the dispatch has it already; undefined lets the start rate the spec itself. */
type Start = (repo: Repo, name: string, id: number | string, spec: string, tier?: Tier | null) => Promise<string | null>;
type Checks = (repo: Repo, commit: string, logs: string) => Promise<ChecksStop | null>;
type Land = (name: string) => Promise<string | null>;
/**
 * Start every ready goal, in order, until the live cap: an open goal item with
 * no open job, while the factory is not paused and the other gates allow. It
 * runs when a run ends, when a goal is added or edited, and from the tick as a
 * fallback. Each start holds a lock on its goal and re-reads the jobs under it,
 * so two dispatches at once start a goal once. `start` dispatches the run; it
 * is `aleph job`, in-process (transitions.ts). With `rate`, a large goal's
 * first run is a planner run on its issue instead (plan.ts). It starts goals
 * only: an issue is closed as done once its goals are all done (`closeIssues`).
 * `plan` starts an issue's planner detached; the dispatch does not wait for it.
 * `specCheck` starts a goal's spec check detached (spec-check.ts), for a repo with `author` set: a goal
 * starts only once its spec version has a recorded verdict of pass or error.
 * `acceptance` starts the acceptance run detached (`aleph acceptance`); goal starts do not wait for it.
 */
export async function dispatchIssues(start: Start, checks?: Checks, land?: Land, rescue?: Rescue, rate?: Rate, plan: (repo: Repo, id: number) => void = planDetached, specCheck: (repo: Repo, ref: string) => void = specCheckDetached, acceptance: () => void = acceptanceDetached): Promise<{ started: string[]; skipped: string[]; paused?: true; held?: string; landed?: string[]; planned?: string[] }> {
  if (gates({ only: ["pause"] })) {
    factoryLog("paused");
    return { started: [], skipped: [], paused: true };
  }
  if (rescue) await rescueStuck(rescue, land, checks && ((repo) => baseline(repo, checks)));
  const held = gates({ only: ["hold"] });
  if (held) {
    factoryLog(held.why);
    return { started: [], skipped: [held.why], held: held.why };
  }
  const startedProposals = startProposals(sandboxRepos());
  if (startedProposals.length) factoryLog(`standing: proposal: started ${startedProposals.join(", ")}`);
  const landed: string[] = [];
  if (land) {
    // All at once: the lands queue on the repo's lock, and the first takes the rest into one batch.
    const names = waitingToLand();
    const whys = await Promise.all(names.map((name) => land(name)));
    names.forEach((name, i) => { if (!whys[i]) landed.push(name); });
    if (landed.length) factoryLog(`landed ${landed.join(", ")}`);
  }
  await factsStep();
  if (checks) acceptance();
  const started: string[] = [];
  const skipped: string[] = [];
  const planned: string[] = [];
  const lineOf = (b: Baseline) => (b.state === "green" ? null : b.line);
  const reds = new Map<string, string | null>();
  const done = doneChecker();
  // Baselines run for the repos in the list, then the list is read again, until every repo in it has one. The start loop
  // works from that last list, so a goal written during any baseline is in it: a dispatch that skipped with
  // `main baseline running` has its goal started by the one that held the baseline.
  // A parent whose parts all landed closes without a green main, so the closing comes before the baselines.
  for (const repo of sandboxRepos()) for (const l of await closeIssues(repo, done)) skipped.push(l);
  let goals = openGoals();
  if (checks) {
    for (;;) {
      const missing = goals.filter(({ repo }) => !reds.has(repo.key));
      if (!missing.length) break;
      for (const { repo } of missing) if (!reds.has(repo.key)) reds.set(repo.key, lineOf(await baseline(repo, checks)));
      goals = openGoals();
    }
  }
  const planners: { repo: Repo; item: issues.Issue }[] = [];
  for (const repo of sandboxRepos()) {
    if (reds.get(repo.key)) continue;
    for (const item of reader({ fetch: false }).list(repo.key)?.items ?? []) if (planSet(item)) planners.push({ repo, item });
  }
  for (const { repo, item } of byPriority(planners)) {
    if (issues.status(item) !== "open" || askOf(item) || pendingWaits(afterOf(item), done).length || await planning(repo, item.id)) continue;
    plan(repo, item.id);
    planned.push(issueJob(repo, item.id));
  }
  for (const { repo, item: listed } of goals) {
    const ref = issues.idOf(listed);
    const name = issueJob(repo, ref);
    const red = reds.get(repo.key);
    const first = goalDecision({ name, item: listed, done, red });
    if (first.kind !== "ready") { recordHold(name, first.kind, first.why); skipped.push(`${name}: ${first.why}`); continue; }
    // Wait for a dispatch that holds the goal: it may skip it (an open job a drop is closing right now), and a
    // dispatch that skipped here too would leave the goal until the next tick. Under the lock all is read again.
    const release = await lock(`goal-${name}`);
    if (!release) { recordHold(name, "locked", "another dispatch is starting it"); skipped.push(`${name}: another dispatch is starting it`); continue; }
    try {
      const jobs = allJobs();
      const open = openJob(name, null, jobs);
      // Read after the jobs: a note added before the last run's drop is in the rerun's spec. It may also have gained an after.
      const item = open ? listed : goal(repo, ref);
      if (!item) { recordHold(name, "not-a-goal", "not a goal"); skipped.push(`${name}: not a goal`); continue; }
      const d = goalDecision({
        ...goalFacts(repo, item, jobs), done, red,
        // A plan job runs detached: the goal gets no second planner and no worker while it does.
        planning: !open && await planning(repo, item.id),
        // A pass that began before a pause must not start a run after it.
        gate: gates({ only: ["pause", "live", "day", "awaiting"], jobs }),
      });
      if (d.kind !== "ready" && d.kind !== "no-commit" && d.kind !== "run-cap") { recordHold(name, d.kind, d.why); skipped.push(`${name}: ${d.why}`); continue; }
      // Read again just before the start or the Ask: an item done, dropped or parked since it was read gets neither, whatever the trigger.
      const latest = reader().item(repo.key, ref);
      if (!latest || issues.status(latest) !== "open") {
        const why = `the item is ${latest ? (issues.status(latest) === "parked" ? "parked" : issues.status(latest)) : "gone"}`;
        recordHold(name, "closed", why);
        skipped.push(`${name}: ${why}`);
        continue;
      }
      if (d.kind === "no-commit") {
        recordHold(name, d.kind, d.why);
        markStreak(name);
        const text = `the last ${NO_COMMIT_LIMIT} runs of this goal ended with no commit, so the factory stopped starting it; rewrite the goal or close the item.`;
        const bad = askChris(repo, ref, plainAsk("no-commit", text), text);
        if (bad) factoryLog(`${name}: no issue note: ${bad}`);
        skipped.push(`${name}: ${d.why}`);
        continue;
      }
      if (d.kind === "run-cap") {
        recordHold(name, d.kind, d.why);
        const text = `the factory started this goal ${d.starts} times in the last hour; it stops starting it until Chris reruns it.`;
        const bad = askChris(repo, ref, plainAsk("run-cap", text), text);
        if (bad) factoryLog(`${name}: no issue note: ${bad}`);
        else markCap(name);
        skipped.push(`${name}: ${d.why}`);
        continue;
      }
      // The spec check runs in a process of its own (it clones the repo and may take 900 s); the dispatch reads its verdict.
      // A pass or an error starts the goal. A hold sets the Ask, so the goal leaves the list until Chris answers; a hold with
      // no Ask left is one Chris answered with a rerun and no edit, and it starts, as a checked version is not checked again.
      if (repo.author) {
        const running = await specChecking(name);
        const v = running ? null : recordedVerdict(latest);
        if (!v) {
          if (!running) { markLaunched(name); specCheck(repo, issues.refOf(latest)); }
          recordHold(name, "spec-check", "spec check running");
          skipped.push(`${name}: spec check running`);
          continue;
        }
        if (v.verdict === "hold" && askOf(latest)) { recordHold(name, "spec-check", v.problems); skipped.push(`${name}: spec check held`); continue; }
      }
      const { spec, rerun } = goalBrief(item, name, jobs);
      let tier: Tier | null | undefined;
      if (rate) {
        const p = await needsPlan(repo, item, spec, rate);
        if (paused()) { recordHold(name, "paused", "paused"); skipped.push(`${name}: paused`); continue; }
        if ("plan" in p) { plan(repo, item.id); planned.push(name); continue; }
        tier = p.tier;
      }
      const why = await start(repo, name, ref, spec, tier);
      if (why) { recordHold(name, "start", why); skipped.push(`${name}: ${why}`); }
      else { recordHold(name, "started", "started"); started.push(name); clearCap(name); if (rerun) clearRerun(name); }
    } finally {
      release();
    }
  }
  factoryLog(`started ${started.join(", ") || "none"}${planned.length ? `; planning ${planned.join(", ")}` : ""}${skipped.length ? `; skipped ${skipped.join("; ")}` : ""}`);
  return { started, skipped, ...(landed.length ? { landed } : {}), ...(planned.length ? { planned } : {}) };
}

/** Whether every part is done or dropped, at least one is done, and the parent is neither asking nor to plan: then it closes. */
const finished = (doc: issues.Doc, item: issues.Issue, repo: Repo, done: (ref: string) => boolean): boolean => {
  const parts = partsOf(doc, item);
  if (issues.status(item) !== "open" || !parts.length || askOf(item) || planSet(item)) return false;
  const isDone = (p: issues.Issue) => issues.status(p) !== "dropped" && done(`${repo.key}-${issues.refOf(p)}`);
  return parts.some(isDone) && parts.every((p) => issues.status(p) === "dropped" || isDone(p));
};

/**
 * An open parent whose parts are all done or dropped, with at least one done and no Ask, is closed as done, with a note naming the
 * parts' commits. The write that drops the last open part sets the Ask, so Chris decides first. Returns the lines for the dispatch's skipped list.
 */
async function closeIssues(repo: Repo, done: (ref: string) => boolean): Promise<string[]> {
  const lines: string[] = [];
  const doc = reader({ fetch: false }).list(repo.key);
  for (const listed of doc?.items ?? []) {
    if (!doc || !finished(doc, listed, repo, done)) continue;
    const name = `${repo.key}-${listed.id}`;
    const release = await lock(`issue-${name}`, 0);
    if (!release) { lines.push(`${name}: another dispatch holds it`); continue; }
    try {
      const now = reader().list(repo.key);
      const item = now ? issues.find(now, listed.id) : undefined;
      if (!now || !item || !finished(now, item, repo, done)) continue;
      const commits = partsOf(now, item).filter((p) => issues.status(p) !== "dropped").map((p) => `${repo.key}-${issues.refOf(p)} (${itemOnMain(repo, issues.idOf(p)) ?? "no commit"})`);
      const bad = note(repo, item.id, `its parts are done: ${commits.join(", ")}`, { done: true });
      lines.push(bad ? `${name}: not closed: ${bad}` : `${name}: closed as done`);
    } finally {
      release();
    }
  }
  return lines;
}

/** Done goals older than this many days are not accepted: the step starts with the goals closed lately. */
const ACCEPTANCE_DAYS = 2;

/**
 * The acceptance run: every done goal (one whose land is on origin/<main>, or a `planned` parent
 * closed as done) whose Oracle has not been run since it was done gets it run on origin/<main>,
 * under srt. Pass: a note. A failure reruns the failed tests on that commit once the machine is
 * quiet, and only a repeat in a test the goal touched counts. First repeat: the goal reopens with the
 * output as a note and the dispatch starts it again; second: an Ask (input, acceptance-failed). See acceptance.ts.
 */
export async function acceptanceStep(run: Runner = sandboxRunner, now = issues.clock(), check: ScenarioCheck = sandboxScenarios): Promise<string[]> {
  const lines: string[] = [];
  const since = issues.today(new Date(now.getTime() - ACCEPTANCE_DAYS * 86_400_000));
  const lists = reader();
  for (const repo of sandboxRepos()) {
    const list = lists.list(repo.key)?.items ?? [];
    const due = list.filter((i) => !!i.spec.trim() && issues.status(i) === "done" && (String(i.fm.updated ?? "") >= since || !!readRecord(repo.key, issues.refOf(i))?.retest) && !final(readRecord(repo.key, issues.refOf(i))));
    if (!due.length) continue;
    if (!fetchOrigin(repo.path).ok) { lines.push(`${repo.key}: acceptance not run: fetch failed`); continue; }
    for (const listed of due) {
      const release = await lock(`acceptance-${repo.key}-${issues.refOf(listed)}`, 0);
      if (!release) continue;
      try {
        const item = reader().item(repo.key, issues.refOf(listed));
        if (!item || issues.status(item) !== "done" || final(readRecord(repo.key, issues.refOf(item)))) continue;
        if (!itemOnMain(repo, issues.idOf(item))) continue;
        lines.push(await accept(repo, item, run, now, check));
      } finally {
        release();
      }
    }
  }
  for (const l of lines) factoryLog(l);
  return lines;
}

/** The commit that made an acceptance infra error no result (9fd990c): goals reopened by a fail written before it are candidates. */
const INFRA_FIX = "9fd990c";

/**
 * `aleph accept <repo>`: the open goals whose last note is an `acceptance: fail` written before the infra
 * fix (or before `before`) and after `since`, and whose job landed, get their Oracle run again on origin/<main>.
 * See reaccept in acceptance.ts.
 */
export async function reacceptReopened(repoKey: string, o: { since?: string; before?: string; run?: Runner } = {}): Promise<string[]> {
  const repo = sandboxRepos().find((r) => r.key === repoKey) ?? loadRegistry()[repoKey];
  if (!repo) throw new Error(`no repo ${repoKey} in the registry`);
  if (!fetchOrigin(repo.path).ok) return [`${repo.key}: re-accept not run: fetch failed`];
  const ms = (s: string | undefined, what: string): number | undefined => {
    if (s === undefined) return undefined;
    const t = Date.parse(s);
    if (Number.isNaN(t)) throw new Error(`${what}: not a date: ${s}`);
    return t;
  };
  const fixed = Number(git(repo.path, "log", "-1", "--format=%ct", INFRA_FIX).out) * 1000;
  const before = ms(o.before, "--before") ?? (fixed || Infinity);
  const since = ms(o.since, "--reopened-since") ?? -Infinity;
  const lines: string[] = [];
  const list = reader().list(repo.key)?.items ?? [];
  for (const listed of list.filter((i) => !!i.spec.trim() && reopenedByAcceptance(i, since, before))) {
    const release = await lock(`acceptance-${repo.key}-${issues.refOf(listed)}`, 0);
    if (!release) continue;
    try {
      const item = reader().item(repo.key, issues.refOf(listed));
      if (!item || !reopenedByAcceptance(item, since, before) || !itemOnMain(repo, issues.idOf(item), { anyTime: true })) continue;
      lines.push(await reaccept(repo, item, o.run));
    } finally {
      release();
    }
  }
  for (const l of lines) factoryLog(l);
  return lines;
}


const localDay = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

/** True from 03:00 local, when the store has not been mined on this local date. */
export function correctionsDue(now = Date.now()): boolean {
  if (new Date(now).getHours() < 3) return false;
  const at = readStore().minedAt;
  const t = Date.parse(at);
  return !at || Number.isNaN(t) || localDay(t) !== localDay(now);
}

/** The tick's daily correction mining (corrections.ts), under the pause and probe gates. An error is logged, never thrown. */
export async function correctionsStep(now = Date.now()): Promise<{ signals: number; lessons: number; proposed: number } | null> {
  if (gates({ only: ["pause", "probe"] }) || !correctionsDue(now)) return null;
  try {
    const store = await mine(now);
    const r = {
      signals: store.lessons.reduce((n, l) => n + l.signals.length, 0),
      lessons: store.lessons.length,
      proposed: store.lessons.filter((l) => l.state === "proposed").length,
    };
    factoryLog(`corrections: ${r.signals} signals, ${r.lessons} lessons, ${r.proposed} proposed`);
    return r;
  } catch (e) {
    factoryLog(`corrections: failed: ${(e as Error).message}`);
    return null;
  }
}

/**
 * The tick's triage of open issues that are not goals (triage.ts), and then the explainer (explain.ts), which writes the case
 * text of every Ask with none, those triage just raised among them. Only the tick runs them: a dispatch does not wait on them.
 */
export async function triageStep(): Promise<{ triaged: Counts; skipped: string[] }> {
  if (gates({ only: ["pause", "hold", "probe"] })) return { triaged: {}, skipped: [] };
  const t = await triageOpen(sandboxRepos(), doneChecker());
  factoryLog(`triaged ${countsLine(t.triaged)}${t.skipped.length ? `; skipped ${t.skipped.join("; ")}` : ""}`);
  if (t.triaged.build || t.triaged.plan) dispatchDetached();
  await explainStep(sandboxRepos());
  return t;
}

/**
 * The tick's firefighter (firefighter.ts): a snapshot every tick, and one run only when it holds
 * something new. Under the pause alone: the hold is what it clears. An error is logged, never thrown.
 */
export async function firefighterStep(ports?: Ports): Promise<Fired | null> {
  if (gates({ only: ["pause"] })) return null;
  try {
    const f = await firefight(ports);
    if (f.run) factoryLog(`firefighter ${f.run}: ${f.events.length} new events; ${f.applied.length} applied, ${f.refused.length} refused, ${f.chris.length} to Chris`);
    if (f.applied.length) dispatchDetached();
    return f;
  } catch (e: any) {
    factoryLog(`firefighter: failed: ${e?.message ?? e}`);
    return null;
  }
}

/** The tick's episode pages for goals that finished (episode.ts); never throws. */
export async function episodeStep(): Promise<string[]> {
  try {
    if (gates({ only: ["pause"] })) return [];
    const r = await writeEpisodes(sandboxRepos());
    factoryLog(`episodes ${r.written.join(", ") || "none"}`);
    for (const f of r.failed) factoryLog(`episode failed: ${f}`);
    return r.written;
  } catch (e: any) {
    try { factoryLog(`episodes failed: ${e?.message ?? e}`); } catch {}
    return [];
  }
}

/** Main's baseline as a closed state: `line` is the sentence for logs and skip lines. */
export type Baseline = { state: "green" } | { state: "red" | "unchecked" | "running"; line: string };

/**
 * Whether the repo's checks pass on its current origin/<main>: run once per
 * commit, kept in baseline.json. Returns the closed state with its line.
 * One baseline runs per repo at a time, under a lock; a dispatch that finds it
 * taken starts nothing. Only a failed check is recorded: an error that kept
 * the checks from running is reported but tried again by the next dispatch.
 */
export async function baseline(repo: Repo, checks: (repo: Repo, commit: string, logs: string) => Promise<ChecksStop | null>): Promise<Baseline> {
  const unchecked = (line: string): Baseline => ({ state: "unchecked", line });
  if (!fetchOrigin(repo.path).ok) return unchecked("main is unchecked: fetch failed");
  const commit = git(repo.path, "rev-parse", `origin/${repo.main}`).out;
  if (!commit) return unchecked(`main is unchecked: no origin/${repo.main}`);
  const known = () => { const b = baselines()[repo.key]; return b && b.commit === commit ? b : undefined; };
  let b = known();
  if (!b) {
    const release = await lock(`baseline-${repo.key}`, 0);
    if (!release) return { state: "running", line: "main baseline running" };
    try {
      // Another dispatch may have recorded this commit between the read and the lock.
      b = known();
      if (!b) {
        const why = await checks(repo, commit, join(factoryDir(), "baseline", repo.key));
        if (why && why.cause !== "check") return unchecked(`main is unchecked: ${why.reason}`);
        b = { repo: repo.key, commit, ok: !why, ...(why ? { failed: why.checkName ?? "" } : {}) };
        const entry = b;
        await writeBaseline(repo.key, () => entry);
      }
    } finally {
      release();
    }
  }
  return b.ok ? { state: "green" } : { state: "red", line: redLine(b) };
}

export const probeDue = (now = Date.now()) => { const p = lastProbe(); return !p || now - Date.parse(p.at) > 20 * 3600_000; };

/**
 * What the factory could move now and does not, as `land:<job>`, `goal:<job>` and `ingest:<id>`: a passed run with no
 * land live; a goal that can start with no agent or planner run live; an issue to triage or plan with no triage or
 * planner run live. The gates that stop each step leave its work out, because each gate has its own line.
 */
export function stalled(jobs = allJobs(), lists = reader()): string[] {
  if (gates({ only: ["pause", "hold"], jobs })) return [];
  const runs = jobs.flat();
  const live = (kind: string) => runs.some((e) => e.run.kind === kind && isLive(e.folder));
  const base = baselines(), done = doneChecker();
  // A red baseline counts only while origin/<main> is still its commit, as redOf in ui/state.ts: one rev-parse per repo per call.
  const reds = new Map<string, string | null>();
  const redOf = (repo: Repo): string | null => {
    if (!reds.has(repo.key)) {
      const b = base[repo.key];
      reds.set(repo.key, b && !b.ok && git(repo.path, "rev-parse", `origin/${repo.main}`).out === b.commit ? redLine(b) : null);
    }
    return reds.get(repo.key)!;
  };
  const out = live("land") ? [] : waitingToLand(jobs).map((name) => `land:${name}`);
  if (!liveRuns(runs) && !live("plan") && !gates({ only: ["day", "awaiting"], jobs })) {
    for (const { repo, item } of openGoals(lists)) {
      const facts = goalFacts(repo, item, jobs);
      if (goalDecision({ ...facts, done, red: redOf(repo) }).kind === "ready") out.push(`goal:${facts.name}`);
    }
  }
  if (!live("triage") && !live("plan") && !gates({ only: ["live", "day"], jobs })) {
    for (const repo of sandboxRepos()) {
      const doc = lists.list(repo.key);
      for (const item of doc?.items ?? []) {
        if (issues.status(item) !== "open") continue;
        const toPlan = planSet(item) && !askOf(item) && !pendingWaits(afterOf(item), done).length && !redOf(repo);
        if (toPlan || !isSorted(doc!, item)) out.push(`ingest:${issueJob(repo, issues.idOf(item))}`);
      }
    }
  }
  return out;
}

/** The tick's record of `stalled`: each key with the time a tick first saw it. A key that moved drops out, so its time starts again. */
export function stallStep(now = Date.now()): void {
  const seen = readStalls();
  writeStalls(Object.fromEntries(stalled().map((k) => [k, seen[k] ?? new Date(now).toISOString()])));
}

/** How far a checkout is behind origin/<main>, with the diff a pull would bring. */
export function behind(repo: Repo): string | null {
  const n = Number(git(repo.path, "rev-list", "--count", `HEAD..origin/${repo.main}`).out || 0);
  if (!n) return null;
  return `${repo.path} is ${n} commit${n > 1 ? "s" : ""} behind origin/${repo.main}; git pull brings:\n${git(repo.path, "diff", "--stat", "HEAD", `origin/${repo.main}`).out}`;
}

const money = (n: number) => (n > 0 && n < 0.005 ? "<$0.01" : `$${n.toFixed(2)}`);

/** The first source of the vault note titled `title`, or undefined. */
function noteSource(title: string): string | undefined {
  for (const d of ["gotchas", "concepts"]) {
    try {
      const m = /^sources:\s*\[([^\]]*)\]/m.exec(readFileSync(join(vaultDir(), "wiki", d, `${title}.md`), "utf8"));
      const first = m?.[1].split(",")[0].trim();
      if (first) return first;
    } catch {}
  }
  return undefined;
}

/** The heading a run's report entry goes under. */
const laneOf = (e: Entry): string =>
  e.run.condition === "landed" ? "delivered" : isAwaiting(e.run.condition) ? "needs you" : e.run.condition === "stuck" || e.run.condition === "failed" ? "stuck" : "other";

/** One run as the report gives it. */
function entry(e: Entry): string {
  const r = e.run;
  const needs = isAwaiting(r.condition) ? needsOf(runAskOf(r)) : undefined;
  const lane = laneOf(e);
  const prio = (lane === "delivered" || lane === "needs you") && r.repo && r.on ? reader().item(r.repo, issues.parseGoalRef(r.on)?.id ?? r.on)?.fm.priority : undefined;
  const head = `${r.repo}/${r.name} ${r.condition}${prio === "high" || prio === "critical" ? ` [${prio}]` : ""}${needs ? ` (${needs})` : ""}${r.round && r.condition !== "stuck" ? ` after ${r.round} fix rounds` : ""}`;
  const lines = [r.reason ? `${head}: ${r.reason}` : head];
  if (r.condition === "landed" && r.commit) {
    lines.push(`  commit ${r.commit.slice(0, 7)}`);
    const j = allJobs().find((x) => x[0].run.job === r.job);
    if (j) lines.push(`  checked by: ${checkedBy(j).join(", ") || "nothing recorded"}`);
    const repo = r.repo ? loadRegistry()[r.repo] : undefined;
    const stat = repo ? git(repo.path, "show", "--shortstat", "--format=", r.commit).out : "";
    if (stat) lines.push(`  look: about ${lookMinutes(changedLinesOf(stat), !!j && sealed(j))} min (estimate)`);
  }
  if (needs === "held" || needs === "review") {
    if (r.stat) lines.push(...r.stat.split("\n").map((l) => `  ${l}`));
    lines.push(`  aleph land ${r.name}   (lands it, with Held-by: Chris)`, `  aleph drop ${r.name}   (drops it; the item stays open)`);
  }
  for (const d of r.defaults ?? []) lines.push(`  DEFAULT: ${d}`);
  const hidden = r.checks?.find((c) => c.name === "hidden" && c.total);
  if (hidden) lines.push(`  hidden ${hidden.passed}/${hidden.total}`);
  for (const c of r.checks ?? []) if (c.rerun) lines.push(`  ${c.name} passed on rerun`);
  if (r.kind === "facts") {
    for (const k of r.kept ?? []) {
      const src = noteSource(k);
      lines.push(`  kept: ${k}${src ? ` (${src})` : ""}`);
    }
    for (const x of r.rejected ?? []) lines.push(`  rejected: ${typeof x === "string" ? x : `${x.fact}: ${x.reason}`}`);
  }
  if (r.cost !== undefined) lines.push(`  cost ${money(r.cost)} at the API price`);
  return lines.join("\n");
}

/**
 * The runs the report has not shown, oldest first; each is then marked
 * shown. `told` is Sidetone's flag and the report leaves it alone.
 */
export function report(now = Date.now()): string {
  const lines = runLines(now);
  const due = cameDue();
  if (due.length) lines.unshift(["came due:", ...due.map((d) => `  ${d}`)].join("\n"));
  lines.push(...unshown());
  const eps = newEpisodes();
  if (eps.length) lines.push(["episodes:", ...eps.map((t) => `  ${t}`)].join("\n"));
  const proposed = takeFresh();
  if (proposed.length) lines.push(["proposed updates (relabel one `goal` to start it):", ...proposed.map((d) => `  ${d}`)].join("\n"));
  const lessons = proposals();
  if (lessons.length) lines.push(["proposed lessons (Yes or No on Status):", ...lessons.map((l) => `  ${l.id} ${l.kind}: ${l.sentence} (${l.count} signals)`)].join("\n"));
  return lines.join("\n");
}

const episodesSeenFile = () => join(factoryDir(), "episodes-seen");

/** The episode page titles under the vault's wiki/episodes/ that no report has listed; each is then appended to the seen file. */
function newEpisodes(): string[] {
  let titles: string[] = [];
  try { titles = readdirSync(join(vaultDir(), "wiki", "episodes")).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort(); } catch { return []; }
  const seen = new Set(existsSync(episodesSeenFile()) ? readFileSync(episodesSeenFile(), "utf8").split("\n").filter(Boolean) : []);
  const fresh = titles.filter((t) => !seen.has(t));
  if (fresh.length) {
    mkdirSync(factoryDir(), { recursive: true });
    appendFileSync(episodesSeenFile(), fresh.join("\n") + "\n");
  }
  return fresh;
}

const seenFile = () => join(factoryDir(), "seen");

/**
 * The open items whose waited-on item is done, that no report has listed;
 * each is then written to the seen file.
 */
function cameDue(): string[] {
  const seen = new Set(existsSync(seenFile()) ? readFileSync(seenFile(), "utf8").split("\n").filter(Boolean) : []);
  const done = doneChecker();
  const lines: string[] = [];
  const ids: string[] = [];
  const repos = Object.values(loadRegistry());
  let docs: (issues.Doc | null)[] = [];
  try { docs = readLists(repos); } catch {}
  for (const [n, repo] of docs.map((_, n) => [n, repos[n]] as const)) {
    for (const item of docs[n]?.items ?? []) {
      const id = `${repo.key}-${item.id}`;
      if (issues.status(item) !== "open" || seen.has(id)) continue;
      const waits = afterOf(item);
      if (waits.length > 0 && !pendingWaits(waits, done).length) {
        ids.push(id);
        lines.push(`${id} ${item.title}`);
      }
    }
  }
  if (ids.length) {
    mkdirSync(factoryDir(), { recursive: true });
    appendFileSync(seenFile(), ids.join("\n") + "\n");
  }
  return lines;
}

/** The runs the report has not shown, oldest first; each is then marked shown, and the last line counts the day's runs. */
function runLines(now: number): string[] {
  const fresh = allRuns().filter((e) => e.run.shown === false && e.run.kind !== "plain" && e.run.condition !== "running" && !(isLive(e.folder) || isStarting(e)));
  const lines: string[] = [];
  for (const lane of ["delivered", "needs you", "stuck", "other"]) {
    const here = fresh.filter((e) => laneOf(e) === lane);
    if (here.length) lines.push(`${lane}:`, ...here.map(entry));
  }
  for (const e of fresh) updateRun(e.folder, { shown: true });
  const today = runsToday(now);
  if (lines.length) lines.push(`runs in the last 24 hours: ${today.length} of ${DAY_CAP()}, ${money(spentToday(now))} at the API price${paused() ? "; the factory is paused" : ""}`);
  return lines;
}

/**
 * Triage one issue at once, as `aleph issue add`, a note that answers an Ask, and a
 * worker's follow-ups do. The gates are the dispatch's: paused, the hold, a failed probe, the
 * day cap. A gated issue is left for the tick.
 */
export async function triageNow(repo: Repo, id: number): Promise<{ triaged: Counts; skipped: string[] }> {
  if (gates({ only: ["pause", "hold", "probe"] })) return { triaged: {}, skipped: [] };
  const t = await triageIssue(repo, id, doneChecker());
  factoryLog(`triaged ${repo.key}-${id}: ${countsLine(t.triaged)}${t.skipped.length ? `; skipped ${t.skipped.join("; ")}` : ""}`);
  if (t.triaged.build || t.triaged.plan) dispatchDetached();
  return t;
}

/**
 * Plan one goal at once, as `aleph plan` does, under the dispatch's gates: not paused, no hold,
 * no failed probe, a factory repo. When it ends, the children or the fallback worker start from
 * a dispatch of their own.
 */
export async function planNow(repo: Repo, id: number): Promise<{ planned: string[] } | { why: string }> {
  const gated = gates({ only: ["pause", "hold", "probe"] });
  if (gated) return { why: gated.why };
  if (!repo.sandbox) return { why: `${repo.key} is not a factory repo` };
  const r = await runPlan(repo, id);
  factoryLog(`plan ${repo.key}-${id}: ${"planned" in r ? `into ${r.planned.join(",")}` : r.why}`);
  dispatchDetached();
  return r;
}

/** The factory's ports onto the transitions, each in-process; each returns the refusal, or null. */
const landGoal = (name: string) => refusal(async () => { await (await land(name, {}, { output: "ignore" })).child?.exited; });
/** A safe default drop: quiet, as the factory writes the issue note and the news. */
const dropGoal = (name: string, reason: string, fate?: Fate) => refusal(() => drop(name, { reason, quiet: true, fate }));
const recheckGoal = (name: string) => refusal(async () => { await (await recheck(name, { output: "ignore" })).child?.exited; });

/** `aleph dispatch`: one dispatch of the ready goals. A failed probe starts no run. */
export async function runDispatch() {
  const g = gates({ only: ["pause", "probe"] });
  if (g?.gate === "probe") {
    factoryLog("the last probe failed; no run started");
    return { started: [], skipped: [g.why] };
  }
  // `ALEPH_RESCUE=off` leaves a stuck or failed run to hold the factory, as before the safe default actions; for tests of the hold.
  return dispatchIssues(startGoal, baselineChecks, landGoal, !rescueOn() ? undefined : { drop: dropGoal, recheck: recheckGoal }, route);
}
