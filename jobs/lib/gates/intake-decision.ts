/**
 * The one answer to "does intake run on this issue now": the issue write, the dispatch, the intake queue, the stall
 * check, the retry of an intake with no reply and intake itself all ask it. It reads no store and takes no lock: the
 * caller reads the facts. An issue to plan starts an agent run that splits it, so a red main and its `after` waits hold
 * it, as the dispatch has always held it. An issue to take in waits for neither: no path held it before, and intake on
 * a red main turns a close into an Ask.
 */
import { afterOf, isSorted, planSet } from "../../../issues/lib/store.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { pendingWaits } from "./issue-decision.ts";
import type { Repo } from "../records/ledger.ts";

/** `doc`: the item's list; `red`: the line of the repo's baseline when it is red, else null. */
export interface IntakeFacts { doc: issues.Doc; done: (ref: string) => boolean; red: string | null }

/** `why` names the condition that stops intake, or what intake does. */
export interface IntakeDecision { kind: "plan" | "take-in" | "none"; why: string }

/** The decision for `item` of `repo`. */
export function decideIntake(repo: Repo, item: issues.Issue, f: IntakeFacts): IntakeDecision {
  const none = (why: string): IntakeDecision => ({ kind: "none", why });
  if (issues.status(item) !== "open") return none(`the item is ${issues.status(item)}`);
  // An Ask, a part, the tracker, or, unless it is to plan, parts, taken in or a spec.
  if (isSorted(f.doc, item, repo)) return none("sorted");
  if (!planSet(item)) return { kind: "take-in", why: "not sorted" };
  if (f.red) return none(f.red);
  const ids = pendingWaits(afterOf(item), f.done);
  if (ids.length) return none(`after ${ids.join(",")}`);
  return { kind: "plan", why: "to plan" };
}
