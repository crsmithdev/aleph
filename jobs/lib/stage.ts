/**
 * stage(): the one place that says where an issue or a goal stands, from the
 * work-model spec (docs/specs/2026-10-30-work-model.md, "stage()"). The CLI,
 * Incoming, the lanes and `aleph status` read it.
 *
 * It takes plain data, so the same call runs from the store and the ledger in
 * Chris's session and from the facts snapshot in a sandbox: `subjectOf` and
 * `runViewOf` read the store's and the ledger's accessors, which give an old-shape
 * item or run and a new-shape one alike.
 */
import { askOf as runAsk, isAwaiting, type Run, type State } from "./ledger.ts";
import type { Job } from "./job.ts";
import { isOpen, lastReal } from "./job.ts";
import * as store from "../../todo/lib/store.ts";
import * as todos from "../../todo/lib/todo.ts";

export type GoalStage = "dropped" | "done" | "awaiting" | "stuck" | "landing" | "building" | "planning" | "blocked" | "queued";
export type IssueStage = "dropped" | "done" | "awaiting" | "stuck" | "building" | "planning" | "triaged" | "new";
export interface Stage { id: string; stage: GoalStage | IssueStage; why: string; of?: { n: number; m: number } }

/** What stage() needs of an Ask. */
export interface AskFact { kind: "input" | "approval"; reason: string }

/** What stage() needs of an item. */
export interface Subject {
  id: string; status: string; kind: "goal" | "issue"; after: string[]; goals: string[]; ask?: AskFact;
  /** Triage has routed it: a `triaged`, `live-check` or `proposal` label. */
  sorted: boolean;
}

/** What stage() needs of one job of an item: its last real run. */
export interface RunView { kind: Run["kind"]; state: State; open: boolean; ask?: AskFact }

export interface Ctx {
  /** The ref's name on the page, for `why`. */
  main: string;
  /** The not-reverted `Item:` trailer commits on origin/<main>, by item number: `landedIndex`. */
  landed: Map<number, string[]>;
  /** Items whose trailer commits are all reverted. */
  reverted: Set<number>;
  /** The repo's other items, by ref (`<repo>-<n>`). */
  item(ref: string): Subject | undefined;
  /** The jobs of an item, oldest first. */
  runs(ref: string): RunView[];
}

export function subjectOf(item: todos.Item, key: string): Subject {
  const a = store.askOf(item);
  return {
    id: `${key}-${item.id}`, status: todos.status(item), kind: store.kindOf(item),
    after: store.afterOf(item), goals: store.goalsOf(item),
    ...(a ? { ask: { kind: a.kind, reason: a.reason } } : {}), sorted: store.isSorted(item),
  };
}

export function runViewOf(job: Job): RunView {
  const run = lastReal(job).run;
  const a = isAwaiting(run.state) ? runAsk(run) : undefined;
  return { kind: run.kind, state: run.state, open: isOpen(job), ...(isAwaiting(run.state) ? { ask: a ? { kind: a.kind, reason: a.reason } : { kind: "input", reason: "question" } } : {}) };
}

const numberOf = (ref: string): number | undefined => { const m = /-(\d+)$/.exec(ref); return m ? Number(m[1]) : undefined; };
const SORTING: Run["kind"][] = ["triage", "plan", "facts"];

/** The item is done: the store says so, or a not-reverted trailer commit on main names it. Returns the reason. */
function doneWhy(item: Subject, ctx: Ctx): string | null {
  const n = numberOf(item.id);
  const hit = n === undefined ? undefined : ctx.landed.get(n)?.[0];
  if (hit) return `commit ${hit.slice(0, 7)} on ${ctx.main.replace(/^refs\/remotes\//, "")}`;
  // The store's done stands, unless a revert undid the item's only trailer commits.
  if (item.status === "done" && !(n !== undefined && ctx.reverted.has(n))) return "the store says done";
  return null;
}

const asks = (a: AskFact) => `asks for your ${a.kind}: ${a.reason}`;

export function stage(item: Subject, ctx: Ctx, seen: ReadonlySet<string> = new Set()): Stage {
  const id = item.id;
  const out = (s: Stage["stage"], why: string, of?: Stage["of"]): Stage => ({ id, stage: s, why, ...(of ? { of } : {}) });
  if (item.status === "dropped") return out("dropped", "the store says dropped");
  const done = doneWhy(item, ctx);
  if (done) return out("done", done);
  const live = ctx.runs(id).filter((r) => r.open && r.kind !== "facts");
  const work = live.filter((r) => !SORTING.includes(r.kind));
  return item.kind === "goal" ? goalStage(item, ctx, out, live, work) : issueStage(item, ctx, out, live, work, new Set([...seen, id]));
}

type Out = (s: Stage["stage"], why: string, of?: Stage["of"]) => Stage;

function goalStage(item: Subject, ctx: Ctx, out: Out, live: RunView[], work: RunView[]): Stage {
  const last = work.at(-1);
  if (item.ask) return out("awaiting", asks(item.ask));
  if (last && isAwaiting(last.state)) return out("awaiting", asks(last.ask!));
  if (last && (last.state === "stuck" || last.state === "failed")) return out("stuck", `its job is ${last.state}`);
  if (last?.kind === "land") return out("landing", `its job is ${last.state}`);
  if (last) return out("building", `its job is ${last.state}`);
  // A job that landed leaves the goal landing until the store or main says done; a revert of its commit undoes that.
  const n = numberOf(item.id);
  const lastJob = ctx.runs(item.id).at(-1);
  if (lastJob?.state === "landed" && !(n !== undefined && ctx.reverted.has(n))) return out("landing", "its job landed and the goal is not closed");
  if (live.some((r) => r.kind === "plan")) return out("planning", "a plan run is open");
  const blockers = item.after.filter((ref) => {
    const s = ctx.item(ref);
    return s !== undefined && s.status === "open" && !doneWhy(s, ctx);
  });
  if (blockers.length) return out("blocked", `after ${blockers.join(", ")}`);
  return out("queued", "no job has started it");
}

function issueStage(item: Subject, ctx: Ctx, out: Out, live: RunView[], work: RunView[], seen: Set<string>): Stage {
  const goals = item.goals.map((ref) => ctx.item(ref)).filter((g): g is Subject => g !== undefined && !seen.has(g.id)).map((g) => stage(g, ctx, seen));
  if (item.ask) return out("awaiting", asks(item.ask));
  const mine = live.at(-1);
  if (mine && isAwaiting(mine.state)) return out("awaiting", asks(mine.ask!));
  const waiting = goals.find((g) => g.stage === "awaiting");
  if (waiting) return out("awaiting", `${waiting.id} ${waiting.why}`);
  if (mine && (mine.state === "stuck" || mine.state === "failed")) return out("stuck", `its job is ${mine.state}`);
  const stuck = goals.find((g) => g.stage === "stuck");
  if (stuck) return out("stuck", `${stuck.id}: ${stuck.why}`);
  if (item.goals.length) {
    const n = goals.filter((g) => g.stage === "done").length;
    return out("building", `${n} of ${item.goals.length} goals done`, { n, m: item.goals.length });
  }
  if (work.length) return out("building", `its job is ${work.at(-1)!.state}`);
  if (live.some((r) => r.kind === "plan")) return out("planning", "a plan run is open");
  if (item.sorted) return out("triaged", "triage sorted it and no goal is filed");
  return out("new", "no commit on main names it");
}
