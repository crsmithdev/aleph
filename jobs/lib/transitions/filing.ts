/**
 * The production effects of a filing (store.ts `writeFiling`): a new issue starts a dispatch or intake, detached.
 * Roles and lands that file issues take them from here, not from the orchestrator (factory.ts).
 */
import { logEvent } from "../../../lib/layout.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { buildableIssue, reader, type Effects, type Place } from "../../../issues/lib/store.ts";
import { loadRegistry, type Repo } from "../records/ledger.ts";
import { decider } from "../gates/decider.ts";
import { dispatchDetached, intakeDetached } from "./launch.ts";
import { errText } from "../../../lib/errtext.ts";

/** After a write that leaves an open issue of a factory repo buildable: a dispatch, so the issue starts at once. */
export function dispatchAfterIssue(repo: Repo, item: issues.Issue): void {
  if (!repo.sandbox || !buildableIssue(repo, issues.idOf(item))) return;
  dispatchDetached();
}

/** What a new issue starts, detached: a dispatch when it is buildable, and intake when the intake decision says so. It never fails the filing. */
export function afterFiling(place: Place, item: issues.Issue): void {
  const repo = loadRegistry()[place.key];
  if (!repo) return;
  try {
    dispatchAfterIssue(repo, item);
    const doc = reader().list(repo.key);
    if (doc && decider({ fresh: false }).intake(repo, item, doc).kind !== "none") intakeDetached(repo, item.id);
  } catch (e) { logEvent({ subject: "rule", action: "failed", object: "filing", detail: errText(e) }); }
}

/** The production effects of a filing (store.ts `writeFiling`). */
export const filing: Effects = { after: afterFiling };
