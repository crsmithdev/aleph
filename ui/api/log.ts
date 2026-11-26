/**
 * `GET /api/log`: the event log of the Status page, one event a row, newest first, `{ rows, next, prev, from, total }`.
 * `?window=` and `?project=` scope it as every route does; `?q=` keeps the rows
 * whose issue, job or title holds the text, and `?before=` (a seq; none or 0 is the newest) picks the 25 rows below it.
 * `next` and `prev` are the `before` of the next and previous page, null at an end; `from` is the first row's place, from 1.
 * A row's `run` is the key its run of rows goes by: its issue, else its job.
 */
import { readEvents } from "../../lib/layout.ts";
import { projectsOnMain } from "../../lib/store.ts";
import { factsOf, issueHref, jobHref, parseKey, runWord, shownId, targetOf, whoOf, wordOf, type EventRow } from "../../lib/naming.ts";
import { reader } from "../../lib/store.ts";
import { allRuns } from "../../jobs/lib/records/record.ts";
import { issueKeyOf, type Run } from "../../jobs/lib/records/ledger.ts";
import { mineOf, titlesOf } from "../state.ts";
import type { Routes } from "../server.ts";
import { scopeOf, withProjects } from "./scope.ts";

const PAGE = 25;

/** An event the log leaves out: a hold on the issue's own job, and the rule's start of an issue, which its run's start repeats. */
const quiet = (e: EventRow) => (e.action === "held" && wordOf(e) === "job") || (e.action === "started" && e.subject === "rule");

/** The keys and title of a job with no issue: its name less its role and date, and the head word of its reason (`dry: 5 resolved`) as keys, the rest of the reason as the title. */
function jobTitle(r: Run): { keys: string[]; title: string } {
  const name = r.name.replace(new RegExp(`^${r.role}(-|$)`), "").replace(/-?\d{4}-\d\d-\d\d$/, "");
  const [, head, rest] = r.reason?.match(/^(\w+): (.+)$/s) ?? [null, "", r.reason ?? ""];
  return { keys: [name, head].filter(Boolean), title: rest };
}

/** An event as a log row: a run's start reads as started, and an ended run gives its time in seconds. */
function rowOf(e: EventRow, titles: Record<string, string>, projectOf: (n: number) => string | undefined, runOf: (id: string) => Run | undefined) {
  const tgt = targetOf(e), job = parseKey(e.object)?.kind === "job" ? e.object : null, issue = parseKey(tgt)?.kind === "issue" ? tgt : null;
  const from = parseKey(e.subject)?.kind === "job" ? e.subject : null;
  const run = job && !issue ? runOf(job) : undefined;
  const took = e.action !== "running" && e.started && e.ended ? (Date.parse(e.ended) - Date.parse(e.started)) / 1000 : null;
  return {
    seq: e.seq, at: e.time, action: e.action === "running" ? "started" : e.action,
    // A factory-wide run (a director's) has no project of its own: its issue's link takes the issue's.
    issue: issue ? ((p) => ({ id: shownId(issue, p), to: issueHref(issue, p) }))(e.project ?? projectOf(parseKey(issue)!.n)) : null, job: job ? { id: shownId(job), to: jobHref(shownId(job)) } : null,
    ...(run ? jobTitle(run) : e.object === "settings" ? { keys: [wordOf(e)], title: factsOf(e) } : { keys: [], title: (issue && titles[issue]) ?? "" }), by: e.object_role ? runWord(e.object_role) : whoOf(e.subject, e.subject_role), took,
    // An event a job makes (a housekeeper's change, a review's return) goes with the rows of that job's run.
    run: from ? (issueKeyOf({ target: runOf(from)?.target }) ?? from) : (issue ?? job),
  };
}

export const routes: Routes = {
  "GET /api/log": (_req, _params, url) => {
    const sc = scopeOf(url);
    if (sc instanceof Response) return sc;
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const before = Number(url.searchParams.get("before") ?? 0);
    if (!Number.isInteger(before) || before < 0) return Response.json({ error: "before must be a seq" }, { status: 400 });
    const events = mineOf(withProjects(readEvents(Date.now() - sc.ms)), sc.project).filter((e) => !quiet(e));
    // One read of the issues' projects and of the jobs, and only when a row needs it.
    let projects: Map<number, string> | undefined, runs: Map<string, Run> | undefined;
    const titles = titlesOf(events, reader()), projectOf = (n: number) => (projects ??= projectsOnMain()).get(n);
    const runOf = (id: string) => (runs ??= new Map(allRuns().map((x) => [x.id, x.run]))).get(id);
    const rows = events.reverse().map((e) => rowOf(e, titles, projectOf, runOf)).filter((r) => !q || [r.issue?.id, r.job?.id, r.title, ...r.keys].some((t) => t?.toLowerCase().includes(q)));
    const i = rows.findIndex((r) => r.seq! < before), at = !before ? 0 : i < 0 ? rows.length : i, up = Math.max(0, at - PAGE);
    const page = rows.slice(at, at + PAGE), next = at + PAGE < rows.length ? page.at(-1)!.seq : null;
    return Response.json({ rows: page, next, prev: at ? (up ? rows[up - 1].seq : 0) : null, from: at + 1, total: rows.length });
  },
};
