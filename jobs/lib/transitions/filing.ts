/**
 * The production effects of a filing (store.ts `writeFiling`): a new issue starts a dispatch or intake, detached.
 * Roles and lands that file issues take them from here, not from the orchestrator (factory.ts).
 */
import * as issues from "../../../issues/lib/todo.ts";
import { buildableIssue, readFetched, readList, reader, type Effects, type Place } from "../../../issues/lib/store.ts";
import { repoStages } from "../records/status.ts";
import { loadRegistry, type Repo } from "../records/ledger.ts";
import { mainRed } from "../gates/factory-status.ts";
import { refDone } from "../gates/issue-decision.ts";
import { decideIntake } from "../gates/intake-decision.ts";
import { dispatchDetached, intakeDetached } from "./launch.ts";

/** After a write that leaves an open issue of a factory repo buildable: a dispatch, so the issue starts at once. */
export function dispatchAfterIssue(repo: Repo, item: issues.Issue): void {
  if (!repo.sandbox || !buildableIssue(repo, issues.idOf(item))) return;
  dispatchDetached();
}

/** What a new issue starts, detached: a dispatch when it is buildable, and intake when `decideIntake` says so. It never fails the filing. */
export function afterFiling(place: Place, item: issues.Issue): void {
  const repo = loadRegistry()[place.key];
  if (!repo) return;
  try {
    dispatchAfterIssue(repo, item);
    const doc = reader().list(repo.key);
    if (doc && decideIntake(repo, item, { doc, done: doneChecker(false), red: mainRed()(repo) }).kind !== "none") intakeDetached(repo, item.id);
  } catch {}
}

/** The production effects of a filing (store.ts `writeFiling`). */
export const filing: Effects = { after: afterFiling };

/**
 * Whether `<repo>-<n>` is done, by `refDone`. It fetches each repo once; with `fetch` false it reads what was last fetched.
 * An item that its one read lacks is looked up in `later`, a newer read: an item that read has is not absent.
 */
export function doneChecker(fetch = true, later?: (repo: string, id: number | string) => issues.Issue | undefined): (ref: string) => boolean {
  const reg = loadRegistry();
  const known = new Map<string, { doc: issues.Doc | null; stages: Map<string, string>; read: boolean }>();
  return (ref) => {
    const r = issues.parseIssueRef(ref);
    const repo = r && reg[r.repo];
    if (!r || !repo) return false;
    if (!known.has(r.repo)) {
      const k = { doc: null as issues.Doc | null, stages: new Map<string, string>(), read: false };
      try {
        k.doc = fetch ? readList(repo) : readFetched(repo);
        for (const s of repoStages(repo, { fetch, doc: k.doc })) k.stages.set(s.id, s.stage);
        k.read = !!k.doc;
      } catch {}
      known.set(r.repo, k);
    }
    const { doc, stages, read } = known.get(r.repo)!;
    const item = (doc ? issues.find(doc, r.id) : undefined) ?? (read ? later?.(r.repo, r.id) : undefined);
    return refDone(item, read, stages.get(`${r.repo}-${r.id}`));
  };
}
