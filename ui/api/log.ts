/**
 * `GET /api/log`: the event log of the Status page, one event a row, newest first, `{ rows, total }`.
 * `?window=` and `?project=` scope it as every route does; `?kind=` keeps one kind of `KINDS`, `?q=` keeps the rows
 * whose issue, job or title holds the text, and `?page=` (from 1) picks 25 of the rest.
 */
import { readEvents } from "../../lib/layout.ts";
import { projectsOnMain } from "../../lib/store.ts";
import { issueHref, jobHref, parseKey, runWord, shownId, targetOf, whoOf, wordOf, type EventRow } from "../../lib/naming.ts";
import { reader } from "../../lib/store.ts";
import { mineOf, titlesOf } from "../state.ts";
import type { Routes } from "../server.ts";
import { scopeOf, withProjects } from "./scope.ts";

const PAGE = 25;
/** The kind of each action the filter names; any other action is in All only. */
export const KINDS: Record<string, string> = { failed: "problem", returned: "problem", dropped: "problem", landed: "landed", question: "ask", answered: "ask", escalated: "ask", held: "hold" };

/** An event the log leaves out: a hold on the issue's own job, and the rule's start of an issue, which its run's start repeats. */
const quiet = (e: EventRow) => (e.action === "held" && wordOf(e) === "job") || (e.action === "started" && e.subject === "rule");

/** An event as a log row: a run's start reads as started, and an ended run gives its time in seconds. */
function rowOf(e: EventRow, titles: Record<string, string>, projectOf: (n: number) => string | undefined) {
  const tgt = targetOf(e), job = parseKey(e.object)?.kind === "job" ? e.object : null, issue = parseKey(tgt)?.kind === "issue" ? tgt : null;
  const took = e.action !== "running" && e.started && e.ended ? (Date.parse(e.ended) - Date.parse(e.started)) / 1000 : null;
  return {
    seq: e.seq, at: e.time, action: e.action === "running" ? "started" : e.action,
    // A factory-wide run (a director's) has no project of its own: its issue's link takes the issue's.
    issue: issue ? ((p) => ({ id: shownId(issue, p), to: issueHref(issue, p) }))(e.project ?? projectOf(parseKey(issue)!.n)) : null, job: job ? { id: shownId(job), to: jobHref(shownId(job)) } : null,
    title: (issue && titles[issue]) ?? "", by: e.object_role ? runWord(e.object_role) : whoOf(e.subject, e.subject_role), took,
  };
}

export const routes: Routes = {
  "GET /api/log": (_req, _params, url) => {
    const sc = scopeOf(url);
    if (sc instanceof Response) return sc;
    const kind = url.searchParams.get("kind") ?? "", q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const events = mineOf(withProjects(readEvents(Date.now() - sc.ms)), sc.project).filter((e) => !quiet(e) && (!kind || KINDS[e.action] === kind));
    // One read of the issues' projects, and only when a row needs it.
    let projects: Map<number, string> | undefined;
    const titles = titlesOf(events, reader()), projectOf = (n: number) => (projects ??= projectsOnMain()).get(n);
    const rows = events.reverse().map((e) => rowOf(e, titles, projectOf)).filter((r) => !q || [r.issue?.id, r.job?.id, r.title].some((t) => t?.toLowerCase().includes(q)));
    return Response.json({ rows: rows.slice((page - 1) * PAGE, page * PAGE), total: rows.length });
  },
};
