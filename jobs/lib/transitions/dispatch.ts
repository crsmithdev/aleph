/**
 * The dispatch: `aleph dispatch` starts every ready issue up to the live cap, or one issue now. See docs/factory.md.
 */
import { issueKey } from "../../../lib/naming.ts";
import * as issues from "../../../lib/todo.ts";
import { buildableIssue, buildableIssues, reader } from "../../../lib/store.ts";
import { askChris, plainAsk } from "../asks/ask.ts";
import { logEvent } from "../../../lib/layout.ts";
import { allJobs, type Repo } from "../records/ledger.ts";
import { lock } from "../../../lib/locks.ts";
import { rescueStuck, type Rescue } from "../land/rescue.ts";
import { issueBrief } from "./continuation.ts";
import type { Fate } from "../records/outcome.ts";
import { openJob } from "../records/job.ts";
import { waitingToLand } from "../land/landing.ts";
import { drop, land, recheck, refusal, startIssue, type Refused } from "./transitions.ts";
import { startKept } from "./kept.ts";
import { route, type Size } from "../routing/route.ts";
import { gates } from "../gates/factory-status.ts";
import { holdIssue, recordHold } from "../gates/holds.ts";
import { paused } from "../gates/pause.ts";
import { sandboxRepos, logCap } from "../gates/gpu.ts";
import { baselines } from "../gates/tables.ts";
import { heldEvent, NO_COMMIT_LIMIT, type Gate, type Hold, type IssueDecision } from "../gates/issue-decision.ts";
import type { StartDecision } from "../gates/start-decision.ts";
import { decider } from "../gates/decider.ts";
import { issueLockWaitMs, rescueOn } from "../infra/settings.ts";
import { directIfNew, intakeQueued, starts, type Starts } from "./factory.ts";
import { mainState } from "./baseline.ts";
import { sweepRepo } from "./sweep.ts";

/** The facts of a hold's event: its detail after the hold word (`full: 5 / 5 jobs` gives `5 / 5 jobs`). */
const facts = (ev?: Hold): string | undefined => ev?.detail?.replace(/^\w+: /, "");

/** Dispatch is off when `ALEPH_DISPATCH=off`: a run's end and `aleph issue` then start nothing; the tick's sweep still does. */

/** `size` is the router's rating when the dispatch has it already; undefined lets the start rate the spec itself. */
type Start = (repo: Repo, name: string, id: number | string, spec: string, size?: Size | null, now?: boolean) => Promise<Refused | null>;
type Land = (name: string) => Promise<string | null>;
/**
 * Start every ready issue, in order, until the live cap. It runs when a run ends, when an issue is added or edited,
 * and from the tick's sweep when the sweep finds work it missed. While the factory is paused it does nothing. Else its steps run first: the next
 * steps a pause kept (`startKept`), the rescue of returned, failed, killed and lost runs, the lands and the close of parents whose parts are done.
 * It runs no checks: main's state is what the last `aleph suite` recorded (`mainState`). Then each issue meets the gates of issueDecision in
 * order; the first that binds skips it, and its `held` event names the hold word and its facts. Between the busy file and the loop guard an issue whose last build run ended with the
 * API credit error (`API Error: 402`) less than 10 minutes ago (`waitMs` of `POLICY`) waits out its credit wait with a `credit` hold. The loop guard sets an Ask in place of a start,
 * and its `question` event is its only event. The run a gate reads is the issue's newest build run (`nextRun`),
 * whose model names the backend the issue runs on. An issue no gate holds starts. Each start
 * holds a lock on its issue and re-reads the jobs under it, so two dispatches at once start an issue once. `start`
 * dispatches the run; it is `aleph job`, in-process (transitions.ts). It starts issues
 * only: an issue is closed as done once its parts are all done (`sweepRepo`). Intake (intake.ts) took each issue in
 * before: an issue to plan (`plan` set) goes to an intake run too, but `intakeQueued` starts it, once for each pass.
 * `now` is the key of one issue to Run now (`runNow`): the pause, the live cap, the order and the steps above do not apply, only that issue is read,
 * and `refused` is the text of what held it.
 */
export async function dispatchIssues(start: Start, land?: Land, rescue?: Rescue, now?: string): Promise<{ started: string[]; skipped: string[]; paused?: true; landed?: string[]; refused?: string }> {
  if (!now && paused()) return { started: [], skipped: [], paused: true };
  const kept = now ? [] : await startKept();
  for (const name of kept) logEvent({ subject: "rule", action: "started", object: name, detail: "the pause kept this step" });
  if (rescue) await rescueStuck(rescue, land, async (repo) => mainState(repo));
  const landed: string[] = [];
  if (land) {
    // All at once: the lands queue on the repo's lock, and the first takes the rest into one batch.
    const names = waitingToLand();
    const whys = await Promise.all(names.map((name) => land(name)));
    names.forEach((name, i) => { if (!whys[i]) landed.push(name); });
  }
  const started: string[] = [];
  const skipped: string[] = [];
  const at = decider({ fresh: true });
  // A parent whose parts all landed closes without a green main, after the sweep closes the parts.
  const lists = reader();
  for (const repo of now ? [] : sandboxRepos()) skipped.push(...await sweepRepo(repo, lists, at.done));
  const ready = buildableIssues(sandboxRepos()).filter(({ item }) => !now || issueKey(item.id) === now);
  /** The text that stopped a Run now. */
  let refused: string | undefined;
  /** The full bound's `N / M jobs`, when a decision skipped an issue for the cap. */
  let capText: string | undefined;
  /** Records the hold and the skip line of an issue no start reached. The pause, the backend and the live cap each log their own change, so a skip for one records no hold. */
  const skip = (name: string, kind: Gate, why: string, ev: Hold) => {
    if (kind === "waiting") holdIssue(name);
    if (kind !== "paused" && kind !== "waiting" && kind !== "full" && kind !== "done") recordHold(name, kind, ev);
    skipped.push(`${name}: ${why}`);
    refused = why;
  };
  /** Skips an issue the store no longer has open, with its status; true when it did, so the caller stops. */
  const closed = (name: string, repo: Repo, ref: number | string): boolean => {
    const latest = reader().item(repo.key, ref);
    const status = latest ? issues.status(latest) : "dropped";
    if (status === "open") return false;
    skip(name, status === "parked" ? "parked" : "done", `the item is ${latest ? status : "gone"}`, { action: status });
    return true;
  };
  /** Skips an issue that a gate holds; a red main's event names its commit, and the note its failed checks. */
  const held = (name: string, repo: Repo, d: IssueDecision) => {
    const b = d.kind === "red" ? baselines()[repo.key] : undefined;
    if (d.kind === "full") capText = facts(d.ev);
    skip(name, d.kind as Gate, now ? d.text : d.why, b ? heldEvent("red", `at ${b.commit.slice(0, 7)}: ${b.failed}`) : d.ev!);
  };
  for (const { repo, item: listed } of ready) {
    const ref = listed.id;
    const name = issueKey(ref);
    if (at.done(`${repo.key}-${ref}`)) continue;
    // The cheap facts first: the pause was asked above.
    const first = at.decide(repo, listed, { cheap: true });
    if (first.kind !== "ready") { held(name, repo, first); continue; }
    // Wait for a dispatch that holds the issue: it may skip it (an open job a drop is closing right now), and a
    // dispatch that skipped here too would leave the issue until the next tick. Under the lock all is read again.
    const release = await lock(`issue-${name}`, issueLockWaitMs());
    if (!release) { skip(name, "starting", "another dispatch is starting it", { action: "starting" }); continue; }
    try {
      const jobs = allJobs();
      const open = openJob(name, null, jobs);
      // Read after the jobs: a note added before the last run's drop is in the rerun's spec. It may also have gained an after.
      const item = open ? listed : buildableIssue(repo, ref);
      // An item closed, dropped or parked since the pass listed it is skipped with that status; one still open is a plain issue.
      if (!item) { if (closed(name, repo, ref)) continue; skip(name, "parent", "not an issue", { action: "parent" }); continue; }
      // A pass that began before a pause must not start a run after it.
      // Run now asks the issue's gates only; the start holds the backend and the GPU slot of a local model.
      const parents = reader();
      const d: StartDecision = now ? at.decide(repo, item, { jobs, lists: parents }) : await at.decide(repo, item, { jobs, lists: parents, route: () => route(issueBrief(item, name, jobs).spec, name) });
      if (d.kind !== "ready" && d.kind !== "ask") { held(name, repo, d); continue; }
      // Read again just before the start or the Ask: an item done, dropped or parked since it was read gets neither, whatever the trigger.
      if (closed(name, repo, ref)) continue;
      if (d.kind === "ask") {
        // The Ask goes to the director, as every Ask does; its `question` event is the only event of the guard.
        skipped.push(`${name}: ${d.why}`);
        if (now) refused = d.text;
        if (d.ask === "no-commit") {
          const text = `the last ${NO_COMMIT_LIMIT} runs of this issue ended with no commit, so the factory stopped starting it; rewrite the issue or close the item.`;
          const bad = askChris(repo, ref, { ...plainAsk("no-commit", text), facts: d.facts }, text);
          if (bad) logEvent({ subject: "rule", action: "failed", object: name, detail: `no issue note: ${bad}` });
        } else {
          const text = `the factory started this issue ${d.starts} times in the last hour; it stops starting it until Chris reruns it.`;
          const bad = askChris(repo, ref, { ...plainAsk("run-cap", text), facts: d.facts }, text);
          if (bad) logEvent({ subject: "rule", action: "failed", object: name, detail: `no issue note: ${bad}` });
        }
        continue;
      }
      const { spec } = issueBrief(item, name, jobs);
      const no = await start(repo, name, ref, spec, d.size, now !== undefined);
      // A refused start: the item landed or its job runs (another dispatch got there first), or the last live slot filled.
      if (no) skip(name, no.gate, no.why, no.ev);
      else { recordHold(name, "started"); started.push(name); }
    } finally {
      release();
    }
  }
  if (now) return { started, skipped, ...(started.length ? {} : { refused: refused ?? `${now} is not a queued issue` }) };
  logCap(capText ?? facts(gates({ only: ["full"] })?.ev) ?? null);
  return { started, skipped, ...(landed.length ? { landed } : {}) };
}

/** The factory's ports onto the transitions, each in-process; each returns the refusal, or null. */
const landPart = (name: string) => refusal(async () => { await (await land(name, {}, { output: "ignore" })).child?.exited; });
/** A safe default drop: quiet, as the factory writes the issue note and the news. */
const dropIssue = (name: string, reason: string, fate?: Fate) => refusal(() => drop(name, { reason, quiet: true, fate }));
const recheckIssue = (name: string) => refusal(async () => { await (await recheck(name, { output: "ignore" })).child?.exited; });

/** `aleph dispatch <key>`: start that one issue now, whatever the pause, the live cap and the order; the other gates of issueDecision still bind. */
export const runNow = (key: string, start: Start = startIssue) => dispatchIssues(start, undefined, undefined, key);

/**
 * `aleph dispatch`: one dispatch of the ready issues, then the intake queue and the director for an Ask that the
 * dispatch or the run before it set. A run's end calls it, so an intake the live cap held starts when a slot frees.
 */
export async function runDispatch(p: Starts = starts): Promise<Awaited<ReturnType<typeof dispatchIssues>> & { intaking?: string[] }> {
  // `ALEPH_RESCUE=off` leaves a returned or failed run as it is: its open job keeps its issue not ready.
  const d = await dispatchIssues(startIssue, landPart, !rescueOn() ? undefined : { drop: dropIssue, recheck: recheckIssue });
  if (d.paused) return d;
  const intaking = intakeQueued(p.intake);
  directIfNew(p.director);
  return { ...d, ...(intaking.length ? { intaking } : {}) };
}
