/**
 * stage(): the one place that says where an issue or a goal stands, from the
 * work-model spec (docs/specs/2026-10-31-work-model.md). The CLI,
 * Incoming, the lanes and `aleph status` read it.
 *
 * It takes plain data from the store and the ledger: `subjectOf` and
 * `runViewOf` read the store's and the ledger's accessors, which give an old-shape
 * item or run and a new-shape one alike.
 */
import { askOf, waitOf } from "./ask.ts";
import { askOf as runAsk, isAwaiting, type Run, type State } from "./ledger.ts";
import type { Job } from "./job.ts";
import { isOpen, lastReal } from "./job.ts";
import * as store from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";

export type StageName = "dropped" | "done" | "awaiting" | "stuck" | "landing" | "working" | "blocked" | "planning" | "queued" | "new";
export interface Stage { id: string; stage: StageName; why: string; of?: { n: number; m: number } }

/** What stage() needs of an Ask. */
export interface AskFact { kind: "input" | "approval"; reason: string }

/** What stage() needs of an item. */
export interface Subject {
  id: string; status: string; after: string[]; parts: string[]; ask?: AskFact;
  /** It has a spec. */
  spec: boolean;
  /** `plan` is set. */
  plan: boolean;
  tracker: boolean;
  /** Only trailers after this commit count: `landedIndex` applies it. */
  since?: string;
}

/** What stage() needs of one job of an item: its last real run. */
export interface RunView { kind: Run["kind"]; condition: State; open: boolean; ask?: AskFact }

export interface Ctx {
  /** The ref's name on the page, for `why`. */
  main: string;
  /** The repo is a factory repo (`sandbox: true`): intake reads it, so an issue with no spec gets sorted. */
  sandbox: boolean;
  /** The not-reverted `Issue:` trailer commits on origin/<main>, by item number: `landedIndex`. */
  landed: Map<string, string[]>;
  /** Items whose trailer commits are all reverted. */
  reverted: Set<string>;
  /** The repo's other items, by ref (`<repo>-<n>`). */
  item(ref: string): Subject | undefined;
  /** The jobs of an item, oldest first. */
  runs(ref: string): RunView[];
}

export function subjectOf(item: issues.Issue, key: string, doc: issues.Doc): Subject {
  const a = askOf(item);
  return {
    id: `${key}-${issues.refOf(item)}`, status: issues.status(item),
    after: store.afterOf(item), parts: store.partsOf(doc, item).map((p) => `${key}-${issues.refOf(p)}`),
    ...(a ? { ask: { kind: a.kind, reason: a.reason } } : {}),
    spec: !!item.spec.trim(), plan: store.planSet(item), tracker: store.isTracker(item), ...(item.fm.since ? { since: String(item.fm.since) } : {}),
  };
}

export function runViewOf(job: Job): RunView {
  const run = lastReal(job).run;
    return { kind: run.kind, condition: run.condition, open: isOpen(job), ...(isAwaiting(run.condition) ? { ask: waitOf(runAsk(run)) } : {}) };
}

/** The ref's part after `<repo>-`, as `landedIndex` and `reverted` key it: `"910"` for an issue, `"910.1"` for a part. */
const partOf = (ref: string): string | undefined => /-(\d+(?:\.\d+)?)$/.exec(ref)?.[1];
const SORTING: Run["kind"][] = ["intake", "triage", "plan", "facts"];

/** The item is done: the store says so, or a not-reverted trailer commit on main names it. Returns the reason. */
function doneWhy(item: Subject, ctx: Ctx): string | null {
  const part = partOf(item.id);
  const hit = part === undefined ? undefined : ctx.landed.get(part)?.[0];
  if (hit) return `commit ${hit.slice(0, 7)} on ${ctx.main.replace(/^refs\/remotes\//, "")}`;
  // The store's done stands, unless a revert undid the item's only trailer commits.
  if (item.status === "done" && !(part !== undefined && ctx.reverted.has(part))) return "the store says done";
  return null;
}

const asks = (a: AskFact) => `asks for your ${a.kind}: ${a.reason}`;

export function stage(item: Subject, ctx: Ctx, seen: ReadonlySet<string> = new Set()): Stage {
  const id = item.id;
  const out = (s: StageName, why: string, of?: Stage["of"]): Stage => ({ id, stage: s, why, ...(of ? { of } : {}) });
  if (item.status === "dropped") return out("dropped", "the store says dropped");
  // An open item that asks is awaiting, even when a trailer commit on main names it (a reopened issue can have one).
  if (item.status === "open" && item.ask) return out("awaiting", asks(item.ask));
  const done = doneWhy(item, ctx);
  if (done) return out("done", done);
  const live = ctx.runs(id).filter((r) => r.open && r.kind !== "facts");
  const work = live.filter((r) => !SORTING.includes(r.kind));
  const parts = item.parts.map((ref) => ctx.item(ref)).filter((p): p is Subject => p !== undefined && !seen.has(p.id)).map((p) => stage(p, ctx, new Set([...seen, id])));
  if (item.ask) return out("awaiting", asks(item.ask));
  const mine = live.at(-1);
  if (mine && isAwaiting(mine.condition)) return out("awaiting", asks(mine.ask!));
  const waiting = parts.find((p) => p.stage === "awaiting");
  if (waiting) return out("awaiting", `${waiting.id} ${waiting.why}`);
  if (mine && (mine.condition === "stuck" || mine.condition === "failed")) return out("stuck", `its job is ${mine.condition}`);
  const stuck = parts.find((p) => p.stage === "stuck");
  if (stuck) return out("stuck", `${stuck.id}: ${stuck.why}`);
  if (item.parts.length) {
    if (item.plan) return out("planning", "intake plans the rest");
    const n = parts.filter((p) => p.stage === "done").length;
    return out("working", `${n} of ${item.parts.length} parts done`, { n, m: item.parts.length });
  }
  const last = work.at(-1);
  if (last?.kind === "land") return out("landing", `its job is ${last.condition}`);
  if (last) return out("working", `its job is ${last.condition}`);
  const blockers = item.after.filter((ref) => {
    const s = ctx.item(ref);
    return s !== undefined && (s.status === "dropped" || (s.status === "open" && !doneWhy(s, ctx)));
  });
  if (blockers.length) return out("blocked", `after ${blockers.join(", ")}`);
  if (item.plan) return out("planning", "intake splits it");
  if (item.tracker) return out("new", "the flake tracker: a note log");
  if (item.spec) return out("queued", "no job has started it");
  if (live.some((r) => r.kind === "intake")) return out("new", "an intake run is open");
  return out("new", ctx.sandbox ? "intake has not taken it in" : "the factory does not run for this repo, so nothing sorts it");
}
