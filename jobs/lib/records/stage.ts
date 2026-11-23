/**
 * stage(): the one place that says where an issue or a part stands (docs/workflow.md). The CLI,
 * Incoming, the lanes and `aleph status` read it.
 *
 * It takes plain data from the store and the ledger: `subjectOf` and
 * `runViewOf` read the store's and the ledger's accessors, which give an old-shape
 * item or run and a new-shape one alike.
 */
import { askOfItem, waitOf } from "../asks/ask.ts";
import { isWaiting, type Run, type State, isOpen } from "./ledger.ts";
import type { Job } from "./job.ts";
import { counting } from "./record.ts";
import { eventsOf } from "../../../lib/layout.ts";
import * as issues from "../../../lib/issue-file.ts";
import { issueKey, parseKey, say, sayText, type StageName } from "../../../lib/naming.ts";


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
  /** Who decides next: a reason that waits for the user. */
  to?: "human" | "director";
}
export interface Stage extends Reason { id: string; stage: StageName; why: string; of?: { n: number; m: number } }

/** What stage() needs of an Ask. */
interface AskFact { reason: string }

/** What stage() needs of an item. */
export interface Subject {
  id: string; status: string; parts: string[]; ask?: AskFact;
  /** The Herald sentence of the issue's latest `held` event, its IDs as keys, when no `started` event came after it. */
  held?: string;
  /** It has a spec. */
  spec: boolean;
  /** `plan` is set. */
  plan: boolean;
  tracker: boolean;
}

/** What stage() needs of one job of an item: its ID and its last real run. */
export interface RunView { id: string; kind: Run["role"]; state: State; open: boolean; ask?: AskFact }

export interface Ctx {
  /** The repo is a factory repo (`sandbox: true`): intake reads it, so an issue with no spec gets sorted. */
  sandbox: boolean;
  /** Intake's switch is off (routing/models.ts): an issue that waits on intake says so. */
  intakeOff: boolean;
  /** The repo's other items, by ref (`<repo>-<n>`). */
  item(ref: string): Subject | undefined;
  /** The jobs of an item, oldest first. */
  runs(ref: string): RunView[];
}

export function subjectOf(item: issues.Issue, key: string, doc: issues.Doc): Subject {
  const a = askOfItem(item);
  const hold = issues.status(item) === "open" ? eventsOf(issueKey(item.id), "held", "started").at(-1) : undefined;
  return {
    id: `${key}-${item.id}`, status: issues.status(item),
    ...(hold?.action === "held" ? { held: say(hold).map((p) => (typeof p === "string" ? p : p.id)).join("") } : {}),
    parts: issues.partsOf(doc, item).map((p) => `${key}-${p.id}`),
    ...(a ? { ask: { reason: a.reason } } : {}),
    spec: !!item.spec.trim(), plan: issues.planSet(item), tracker: issues.isTracker(item),
  };
}

export function runViewOf(job: Job): RunView {
  const last = counting(job), run = last.run;
    return { id: last.id, kind: run.role, state: run.state, open: isOpen(job), ...(isWaiting(run.state) ? { ask: waitOf(run.ask) } : {}) };
}

const SORTING: Run["role"][] = ["intake"];

/** The item is done: the store says so. Returns the reason. */
function doneWhy(item: Subject): Reason | null {
  return item.status === "done" ? { action: "done" } : null;
}

export function stage(item: Subject, ctx: Ctx, seen: ReadonlySet<string> = new Set()): Stage {
  const id = item.id;
  /** Intake's reason: it starts the item, or the item waits while intake is off. */
  const toIntake = (r: Reason): Reason => (ctx.intakeOff ? { action: "off", sub: "intake" } : r);
  /** The stage with its reason: `why` is the reason's sentence, as the Herald says it; a reason with no action is its fields as text. */
  const out = (s: StageName, r: Reason = {}, of?: Stage["of"]): Stage =>
    ({ id, stage: s, ...r, why: r.action ? r.action === "held" ? item.held! : sayText({ subject: "rule", action: r.action, object: r.on?.find((x) => parseKey(x)?.kind === "job") ?? id }) : [r.sub, r.count].filter(Boolean).join(" "), ...(of ? { of } : {}) });
  if (item.status === "dropped") return out("dropped", { action: "dropped" });
  // An open item that asks is waiting, even when a trailer commit on main names it (a reopened issue can have one).
  if (item.status === "open" && item.ask) return out("waiting", { action: "waiting", to: "human" });
  const done = doneWhy(item);
  if (done) return out("done", done);
  if (item.status === "parked") return out("parked", { action: "parked" });
  const live = ctx.runs(id).filter((r) => r.open);
  const work = live.filter((r) => !SORTING.includes(r.kind));
  const parts = item.parts.map((ref) => ctx.item(ref)).filter((p): p is Subject => p !== undefined && !seen.has(p.id)).map((p) => stage(p, ctx, new Set([...seen, id])));
  if (item.ask) return out("waiting", { action: "waiting", to: "human" });
  const mine = live.at(-1);
  if (mine && isWaiting(mine.state)) return out("waiting", { action: "waiting", on: [mine.id], to: "human" });
  const waiting = parts.find((p) => p.stage === "waiting");
  if (waiting) return out("waiting", { action: "waiting", on: [waiting.id] });
  // A failed job that the director or the user has carries an Ask, so it is `waiting` above.
  if (mine && (mine.state === "returned" || mine.state === "failed")) return out("failed", { action: mine.state, on: [mine.id] });
  const failed = parts.find((p) => p.stage === "failed");
  if (failed) return out("failed", { action: "failed", on: [failed.id] });
  if (item.parts.length) {
    if (item.plan) return out("working", toIntake({ action: "starting", sub: "intake" }));
    const n = parts.filter((p) => p.stage === "done").length;
    return out("working", { count: `${n} / ${item.parts.length}` }, { n, m: item.parts.length });
  }
  const last = work.at(-1);
  if (last?.kind === "land") return out("landing", { action: last.state, on: [last.id] });
  if (last) return out("working", { action: last.state, on: [last.id] });
  if (item.held) return out("held", { action: "held" });
  if (item.plan) return out("working", toIntake({ action: "starting", sub: "intake" }));
  if (item.tracker) return out("new");
  if (item.spec) return out("queued", { action: "starting" });
  const intake = live.findLast((r) => r.kind === "intake");
  if (intake) return out("new", { action: "running", on: [intake.id] });
  return out("new", ctx.sandbox ? toIntake({ sub: "intake" }) : {});
}
