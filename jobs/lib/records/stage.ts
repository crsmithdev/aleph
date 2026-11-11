/**
 * stage(): the one place that says where an issue or a part stands (docs/workflow.md). The CLI,
 * Incoming, the lanes and `aleph status` read it.
 *
 * It takes plain data from the store and the ledger: `subjectOf` and
 * `runViewOf` read the store's and the ledger's accessors, which give an old-shape
 * item or run and a new-shape one alike.
 */
import { askOf, waitOf } from "../asks/ask.ts";
import { isWaiting, type Run, type State } from "./ledger.ts";
import type { Job } from "./job.ts";
import { isOpen } from "./job.ts";
import { counting, jobIdOf } from "./record.ts";
import * as store from "../../../issues/lib/store.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { contentText, parseId, sayText, tail } from "../../../lib/naming.ts";

/** The stages of docs/naming.md. */
type StageName = "new" | "queued" | "held" | "working" | "waiting" | "failed" | "landing" | "done" | "dropped" | "parked";

/** Why an item stands where it does: the event fields of docs/naming.md. A field the naming sets have no word for is left out. */
interface Reason {
  /** One word from ACTIONS. */
  action?: string;
  /** One word from SUBS. */
  sub?: string;
  /** What the reason is on: a blocker, a child issue, a job or a commit sha. */
  on?: string[];
  /** `<n> / <m>`: the children done. */
  count?: string;
  /** Who decides next: a reason that waits for Chris. */
  to?: "human" | "director";
}
export interface Stage extends Reason { id: string; stage: StageName; why: string; of?: { n: number; m: number } }

/** What stage() needs of an Ask. */
interface AskFact { kind: "input" | "approval"; reason: string }

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

/** What stage() needs of one job of an item: its ID and its last real run. */
export interface RunView { id: string; kind: Run["kind"]; condition: State; open: boolean; ask?: AskFact }

export interface Ctx {
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
  const a = askOf(`${key}-${issues.refOf(item)}`);
  return {
    id: `${key}-${issues.refOf(item)}`, status: issues.status(item),
    after: store.afterOf(item), parts: store.partsOf(doc, item).map((p) => `${key}-${issues.refOf(p)}`),
    ...(a ? { ask: { kind: a.kind, reason: a.reason } } : {}),
    spec: !!item.spec.trim(), plan: store.planSet(item), tracker: store.isTracker(item), ...(issues.sinceOf(item) ? { since: issues.sinceOf(item) } : {}),
  };
}

export function runViewOf(job: Job): RunView {
  const last = counting(job), run = last.run;
    return { id: jobIdOf(last), kind: run.kind, condition: run.condition, open: isOpen(job), ...(isWaiting(run.condition) ? { ask: waitOf(run.ask) } : {}) };
}

/** The ref's part after `<repo>-`, as `landedIndex` and `reverted` key it: `"910"` for an issue, `"910.1"` for a part. */
const partOf = (ref: string): string | undefined => { const p = parseId(ref); return p ? tail(p) : undefined; };
const SORTING: Run["kind"][] = ["intake"];

/** The item is done: the store says so, or a not-reverted trailer commit on main names it. Returns the reason. */
function doneWhy(item: Subject, ctx: Ctx): Reason | null {
  const part = partOf(item.id);
  const hit = part === undefined ? undefined : ctx.landed.get(part)?.[0];
  if (hit) return { action: "landed", on: [hit.slice(0, 7)] };
  // The store's done stands, unless a revert undid the item's only trailer commits.
  if (item.status === "done" && !(part !== undefined && ctx.reverted.has(part))) return { action: "done" };
  return null;
}

export function stage(item: Subject, ctx: Ctx, seen: ReadonlySet<string> = new Set()): Stage {
  const id = item.id;
  /** The stage with its reason: `why` is the reason's sentence, as the Herald says it; a reason with no action is its fields as text. */
  const out = (s: StageName, r: Reason = {}, of?: Stage["of"]): Stage =>
    ({ id, stage: s, ...r, why: r.action ? sayText({ subject: id, ...r }) : [r.sub, contentText(r)].filter(Boolean).join(" "), ...(of ? { of } : {}) });
  if (item.status === "dropped") return out("dropped", { action: "dropped" });
  // An open item that asks is waiting, even when a trailer commit on main names it (a reopened issue can have one).
  if (item.status === "open" && item.ask) return out("waiting", { action: "waiting", to: "human" });
  const done = doneWhy(item, ctx);
  if (done) return out("done", done);
  if (item.status === "parked") return out("parked", { action: "parked" });
  const live = ctx.runs(id).filter((r) => r.open);
  const work = live.filter((r) => !SORTING.includes(r.kind));
  const parts = item.parts.map((ref) => ctx.item(ref)).filter((p): p is Subject => p !== undefined && !seen.has(p.id)).map((p) => stage(p, ctx, new Set([...seen, id])));
  if (item.ask) return out("waiting", { action: "waiting", to: "human" });
  const mine = live.at(-1);
  if (mine && isWaiting(mine.condition)) return out("waiting", { action: "waiting", on: [mine.id], to: "human" });
  const waiting = parts.find((p) => p.stage === "waiting");
  if (waiting) return out("waiting", { action: "waiting", on: [waiting.id] });
  // A failed job that the director or Chris has carries an Ask, so it is `waiting` above.
  if (mine && (mine.condition === "returned" || mine.condition === "failed")) return out("failed", { action: mine.condition, on: [mine.id] });
  const failed = parts.find((p) => p.stage === "failed");
  if (failed) return out("failed", { action: "failed", on: [failed.id] });
  if (item.parts.length) {
    if (item.plan) return out("working", { action: "starting", sub: "intake" });
    const n = parts.filter((p) => p.stage === "done").length;
    return out("working", { count: `${n} / ${item.parts.length}` }, { n, m: item.parts.length });
  }
  const last = work.at(-1);
  if (last?.kind === "land") return out("landing", { action: last.condition, on: [last.id] });
  if (last) return out("working", { action: last.condition, on: [last.id] });
  const blockers = item.after.filter((ref) => {
    const s = ctx.item(ref);
    return s !== undefined && (s.status === "dropped" || (s.status === "open" && !doneWhy(s, ctx)));
  });
  if (blockers.length) return out("held", { action: "after", on: blockers });
  if (item.plan) return out("working", { action: "starting", sub: "intake" });
  if (item.tracker) return out("new");
  if (item.spec) return out("queued", { action: "starting" });
  const intake = live.findLast((r) => r.kind === "intake");
  if (intake) return out("new", { action: "running", on: [intake.id] });
  return out("new", ctx.sandbox ? { sub: "intake" } : {});
}
