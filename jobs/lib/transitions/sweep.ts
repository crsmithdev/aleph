/**
 * The dispatch's sweep of a repo's list: an issue whose work is on origin/<main> closes, one whose commits are all
 * reverted reopens, and a parent whose parts are done closes. See docs/factory.md.
 */
import { issueKey } from "../../../lib/naming.ts";
import * as issues from "../../../lib/todo.ts";
import { close, reader, reopenReverted, type Reader } from "../../../lib/store.ts";
import { partsOf, planSet } from "../../../lib/todo.ts";
import { fetchOrigin, git } from "../../../lib/git.ts";
import { askOfItem } from "../asks/ask.ts";
import { logEvent } from "../../../lib/layout.ts";
import { itemOnMain, landedIndex, revertedIn } from "../records/status.ts";
import type { Repo } from "../records/ledger.ts";
import { lock } from "../../../lib/locks.ts";

/** Sweeps the repo's list against origin/<main>, then closes each finished parent; returns the lines for the dispatch's skipped list. */
export async function sweepRepo(repo: Repo, lists: Reader, done: (ref: string) => boolean): Promise<string[]> {
  sweepMain(repo, lists);
  return closeIssues(repo, done);
}

/**
 * The sweep of a repo's list against origin/<main>: an open issue with no Ask whose work is on main closes as done, so no dispatch
 * lists it again, and a done issue whose `Issue:` trailer commits are all reverted reopens. Nothing else reads a trailer for done.
 */
function sweepMain(repo: Repo, lists: Reader): void {
  fetchOrigin(repo.path);
  const doc = lists.list(repo.key);
  if (!doc) return;
  const main = `origin/${repo.main}`;
  const index = landedIndex(repo.path, main, repo.key, (n) => { const i = issues.find(doc, n); return i ? issues.sinceOf(i) : undefined; });
  const reverted = revertedIn(index);
  for (const item of doc.items) {
    const n = String(item.id), status = issues.status(item), hit = index.get(n)?.[0];
    let bad: string | null = null;
    if (status === "open" && hit && !askOfItem(item)) bad = close(repo, item.id, `its work is on origin/${repo.main}: ${hit.slice(0, 7)}`);
    else if (status === "done" && reverted.has(n)) bad = reopenReverted(repo, item.id, `its commits on origin/${repo.main} are all reverted: the goal runs again`, git(repo.path, "rev-parse", main).out);
    if (bad) logEvent({ subject: "rule", action: "failed", object: issueKey(item.id), detail: `not swept: ${bad}` });
  }
}

/** Whether every part is done or dropped, at least one is done, and the parent is neither asking nor to plan: then it closes. */
const finished = (doc: issues.Doc, item: issues.Issue, repo: Repo, done: (ref: string) => boolean): boolean => {
  const parts = partsOf(doc, item);
  if (issues.status(item) !== "open" || !parts.length || askOfItem(item) || planSet(item)) return false;
  const isDone = (p: issues.Issue) => issues.status(p) !== "dropped" && done(`${repo.key}-${p.id}`);
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
    const name = issueKey(listed.id);
    const release = await lock(`issue-${name}`, 0);
    if (!release) { lines.push(`${name}: another dispatch holds it`); logEvent({ subject: "rule", action: "skipped", object: name, detail: "another dispatch holds it" }); continue; }
    try {
      const now = reader().list(repo.key);
      const item = now ? issues.find(now, listed.id) : undefined;
      if (!now || !item || !finished(now, item, repo, done)) continue;
      const commits = partsOf(now, item).filter((p) => issues.status(p) !== "dropped").map((p) => `${repo.key}-${p.id} (${itemOnMain(repo, p.id) ?? "no commit"})`);
      const bad = close(repo, item.id, `its sub-issues are done: ${commits.join(", ")}`);
      lines.push(bad ? `${name}: not closed: ${bad}` : `${name}: closed as done`);
      logEvent(bad ? { subject: "rule", action: "failed", object: name, detail: `not closed: ${bad}` } : { subject: "rule", action: "done", object: name, detail: "its sub-issues are done" });
    } finally {
      release();
    }
  }
  return lines;
}
