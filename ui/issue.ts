/**
 * The issue as the UI sees it: one work-store item, with its stage from its jobs, as a row of the Issues page or a
 * card of the Status page. Every route that shows an issue builds it here, so the link, the stage and the Ask card
 * read the same on every page.
 */
import { issueHref } from "../lib/naming.ts";
import type { Ask } from "../jobs/lib/asks/ask.ts";
import type { Stage } from "../jobs/lib/records/stage.ts";
import { afterOf, areasOf, priorityOf, sourceOf } from "../issues/lib/store.ts";
import * as todos from "../issues/lib/todo.ts";
import type { NewIssue } from "./state.ts";

/** The stage the UI shows: parked when parked, else the stage its jobs give, else its status. */
export const stageOf = (item: todos.Issue, st?: Pick<Stage, "stage">): string =>
  todos.status(item) === "parked" ? "parked" : st?.stage ?? todos.status(item);

export interface Row {
  id: number; ref: string; repo: string; title: string; href: string; kind: string; status: string; priority: string | null; labels: string[];
  after: string[]; created: string | null; createdTime: string | null; closed: string | null; closedTime: string | null; source: string | null; updated: string | null; updatedTime: string | null; notes: number;
  /** The parent's ref: `"5"` for a child of `<repo>-5`; null for a top-level issue. */
  parent: string | null;
  stage: string; why: string;
}

/** The Issues page row of `item` in `repo`, with the stage `st` its jobs give. */
export function row(repo: string, item: todos.Issue, st?: Pick<Stage, "stage" | "why">): Row {
  const createdTime = todos.created(item) ?? null, closedTime = todos.closed(item) ?? null, updatedTime = todos.updated(item) ?? null;
  const day = (t: string | null) => (t ? todos.today(new Date(t)) : null);
  const parked = todos.status(item) === "parked";
  return {
    id: item.id, ref: todos.refOf(item), repo, title: item.title, href: issueHref(`${repo}-${todos.refOf(item)}`), kind: todos.kindOf(item), status: todos.status(item), priority: priorityOf(item), labels: areasOf(item),
    after: afterOf(item), created: day(createdTime), createdTime, closed: day(closedTime), closedTime, source: sourceOf(item), updated: day(updatedTime), updatedTime, notes: item.notes.length, parent: todos.parentRef(item) ?? null,
    stage: stageOf(item, st), why: parked ? "" : st?.why ?? "",
  };
}

/** The Status page card of an open `item` in `repo` at `stage`; with `ask`, the Ask it waits on and the question it puts. */
export function card(repo: string, item: todos.Issue, stage: string, ask?: Ask): NewIssue {
  const id = `${repo}-${todos.refOf(item)}`;
  const c: NewIssue = { id, title: item.title, priority: priorityOf(item), status: "open", href: issueHref(id), labels: areasOf(item), notes: item.notes.length, created: todos.created(item) ?? "", updated: todos.updated(item) ?? "", stage };
  if (!ask) return c;
  const last = item.notes.at(-1);
  const q = ask.question || (last && todos.noteOf(last).text.trim());
  if (q) c.question = q;
  if (ask.options.length) c.decision = ask;
  return { ...c, ask, reason: ask.reason, askKind: ask.kind };
}
