/** `GET /api/jobs`, `/api/jobs/:id`, and its diff and logs: the Jobs and Job views' data. `:id` is a job key, `job.6802`. */
import { roundsOf, stepOf, type Step as NextStep, allRuns, jobOfRun } from "../../jobs/lib/records/record.ts";
import { statSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../lib/git.ts";
import { jobDiff, NO_DIFF } from "../../jobs/lib/records/jobdiff.ts";
import { isBuild, isOpen, issueKeyOf, loadRegistry, onOf, type Entry } from "../../jobs/lib/records/ledger.ts";
import { duration } from "../../jobs/lib/infra/process.ts";
import { checkedBy, lookMinutes, latestFile, readFile, view } from "../../jobs/lib/records/job.ts";
import { changedLinesOf } from "../../jobs/lib/gates/factory-status.ts";
import { readHolds, type HoldRecord } from "../../jobs/lib/gates/holds.ts";
import { jobProjector, type Job, type Wait } from "../state.ts";
import type { Routes } from "../server.ts";
import { currentFit, runShare, type Fit, type Wk } from "../usage.ts";
import { langfuse } from "../../lib/langfuse.ts";
import { resultContent } from "../../lib/toolresult.ts";
import { jsonLines } from "../../lib/jsonl.ts";
import { pairs } from "../../lib/transcripts.ts";
import { issueHref, shownId } from "../../lib/naming.ts";
import { isSection, readSections } from "../../jobs/lib/records/run-files.ts";
import { unusable } from "../../jobs/lib/learning/monitor-table.ts";
import { projectOf, repoIn, scopeOf } from "./scope.ts";
import { runNowOf } from "./issues.ts";
import { readList } from "../../lib/store.ts";
import { parentOf, partsOf } from "../../lib/todo.ts";
import * as todos from "../../lib/todo.ts";

/** `id` is the job key, the key of its logs; `job` is the key the page shows. */
interface RunInfo { id: string; job?: string; kind: "worker" | "land" | "review" | "plain" | "intake" | "director" | "monitor" | "housekeeper" | "maintainer"; state: string; started: string; ended?: string; cost?: number; model?: string; reason?: string; wk?: Wk; logs?: LogFile[] }
/** A log file of a run, with its size in bytes. */
interface LogFile { name: string; size: number }
/**
 * The log files the Job page serves, and no others: the names the page asks for, each a file of the job folder or a section of its `log.txt`.
 * A reviewer's transcript is the `output.log` of its own job.
 */
const LOG_SOURCE = { "output.log": { file: "transcript.jsonl" }, "stderr.log": { section: "stderr" }, "setup.log": { section: "setup" }, "checks.log": { section: "checks" }, "land.log": { section: "land" } } as const;
const LOGS = Object.keys(LOG_SOURCE) as (keyof typeof LOG_SOURCE)[];
/** The text of the log `name` of the run `e`, or undefined when it has none. */
function logText(e: Entry, name: keyof typeof LOG_SOURCE): string | undefined {
  const src: { file: "transcript.jsonl" } | { section: string } = LOG_SOURCE[name];
  if ("section" in src) return isSection(src.section) ? readFile(e, src.section) : undefined;
  return readFile(e, src.file);
}
/** The known logs a job folder has. */
function logsOf(folder: string): LogFile[] {
  const out: LogFile[] = [], sections = readSections(folder);
  for (const name of LOGS) {
    const src: { file: string } | { section: string } = LOG_SOURCE[name];
    let size: number | undefined;
    if ("section" in src) { const text = isSection(src.section) ? sections.get(src.section) : undefined; if (text !== undefined) size = Buffer.byteLength(text); }
    else try { size = statSync(join(folder, src.file)).size; } catch {}
    if (size !== undefined) out.push({ name, size });
  }
  return out;
}
/** One step of a transcript: assistant text, or a tool call with its input and result. */
export type Step = { kind: "text"; text: string } | { kind: "tool"; name: string; input: unknown; output?: string; error?: boolean };
/** A stream-json transcript as steps, in order. */
export function transcript(stream: string): Step[] {
  const entries = jsonLines(stream), calls = pairs(entries), steps: Step[] = [];
  for (const ev of entries) {
    if (ev.type !== "assistant" || !Array.isArray(ev.message?.content)) continue;
    for (const b of ev.message.content) {
      if (b?.type === "text" && b.text) steps.push({ kind: "text", text: String(b.text) });
      if (b?.type !== "tool_use") continue;
      const t: Extract<Step, { kind: "tool" }> = { kind: "tool", name: String(b.name), input: b.input }, r = calls.get(b.id)?.result;
      if (r) { t.output = resultContent(r.content); if (r.is_error === true) t.error = true; }
      steps.push(t);
    }
  }
  return steps;
}
interface JobDetail extends Job {
  blockers?: Wait[];
  runs: RunInfo[]; result?: string; review?: string; stat?: string;
  /** The reviewer's verdict, from the review.json beside its result.md. */
  verdict?: "pass" | "hold";
  trace?: string;
  /** What checked the job; a delivery's minutes to spot-check it, an estimate. */
  checkedBy?: string[]; look?: number;
  /** The item's spec, from the store. */
  spec?: string;
  /** Why the job waited: its hold records, oldest first. */
  holds: HoldRecord[];
  /** The next step of the work and its fix rounds. */
  next?: NextStep & { text: string }; rounds?: number;
  /** For a part: its issue, its place among the issue's parts, and the part after it. */
  parent?: { id: string; href: string; n: number; of: number; next?: { id: string; href: string } };
  /** The job is open: it can be landed, parked or cancelled. */
  open: boolean;
  /** The job's issue is parked. */
  parked?: boolean;
  /** Run now for the job's issue (see `runNowOf`): null when it starts the issue, else why not. Absent when the issue is closed. */
  runNow?: string | null;
}

/** The item's spec and, for a part, its issue and its place among the parts. Nothing when the store cannot be read. */
function fromStore(repo: string, id: number | string): Pick<JobDetail, "spec" | "parent" | "parked" | "runNow"> {
  const place = loadRegistry()[repo];
  let doc: todos.Doc | null = null;
  try { doc = place ? readList(place) : null; } catch { return {}; }
  const item = doc && todos.find(doc, id);
  if (!doc || !item) return {};
  const out: Pick<JobDetail, "spec" | "parent" | "parked" | "runNow"> = {};
  if (item.spec) out.spec = item.spec;
  if (todos.status(item) === "parked") out.parked = true;
  if (place) Object.assign(out, runNowOf(place, doc, item));
  const up = parentOf(doc, item);
  if (!up) return out;
  const parts = partsOf(doc, up).map((p) => String(p.id));
  const n = parts.indexOf(String(item.id)), next = parts[n + 1];
  out.parent = { id: `${repo}-${up.id}`, href: issueHref(`${repo}-${up.id}`), n: n + 1, of: parts.length, ...(next ? { next: { id: `${repo}-${next}`, href: issueHref(`${repo}-${next}`) } } : {}) };
  return out;
}

const KIND = { build: "worker", recheck: "worker", land: "land", review: "review", plain: "plain", intake: "intake", director: "director", monitor: "monitor", housekeeper: "housekeeper", maintainer: "maintainer", judge: "worker" } as const;
/** The actor a run belongs to, by its kind. */
const RUN_ACTOR: Partial<Record<RunInfo["kind"], string>> = {
  worker: "worker", review: "reviewer", intake: "intake", director: "director", monitor: "monitor",
};
/** The runs of a job as the page shows them, each with its job ID. */
function runInfos(runs: Entry[], fit: Fit | null): RunInfo[] {
  const out: RunInfo[] = [];
  runs.forEach((e) => {
    const r = e.run;
    const state = r.state;
    const info: RunInfo = { id: e.id, job: e.id, kind: KIND[r.role] ?? "worker", state, started: r.started };
    if (r.ended) info.ended = r.ended;
    if (r.cost !== undefined) info.cost = r.cost;
    if (r.model) info.model = r.model;
    const wk = runShare(fit, r);
    if (wk) info.wk = wk;
    if (r.reason) info.reason = r.reason;
    const logs = logsOf(e.folder);
    if (logs.length) info.logs = logs;
    out.push(info);
  });
  return out;
}

/** The Langfuse session page of the job's run, when Langfuse is configured and knows the session. */
async function traceUrl(runs: Entry[]): Promise<string | undefined> {
  const session = runs.findLast((e) => e.run.session)?.run.session;
  const lf = langfuse();
  if (!session || !lf) return undefined;
  return (await lf.session(session)) ? `${lf.base}/sessions/${encodeURIComponent(session)}` : undefined;
}

/** `?limit=`: the rows of one page by default, and the most a page holds. */
const LIMIT = 100, MAX = 2000;

/** One row of `GET /api/jobs`: one job, the run whose ID it is. Times are ISO; `seconds` is null while it runs. */
export interface Row {
  id: string; subject: string; name: string; repo: string; kind: string; actor: string | null; state: string;
  title: string; issue: string | null; started: string; ended: string | null; seconds: number | null; cost: number | null; model: string | null;
}

/** Each run as a row, with its job ID and its issue's title. */
function rowsOf(runs: Entry[]): Row[] {
  const lists = jobProjector().lists;
  return runs.map((e) => {
    const r = e.run, issue = issueKeyOf(r) ?? null;
    const ended = r.ended ?? null, kind = KIND[r.role] ?? "worker", took = duration(e);
    return {
      id: e.id, subject: r.name, name: r.name, repo: r.repo ?? "", kind: r.role, actor: RUN_ACTOR[kind] ?? null, state: r.state,
      title: (issue && lists.item(r.repo!, onOf(r)!)?.title) || r.name, issue, started: r.started, ended,
      seconds: took === null ? null : Math.round(took), cost: r.cost ?? null, model: r.model ?? null,
    };
  });
}

/** The run of job `id` and the runs grouped with it (as `allJobs` groups them), in `project` when given; null for none. */
function located(id: string, project: string | null): { e: Entry; runs: Entry[] } | null {
  loadRegistry();
  const runs = jobOfRun(id), e = runs.find((x) => x.id === id);
  if (!e || !repoIn(e.run.repo, project)) return null;
  return { e, runs };
}

/** The Job page's data: the job's runs, its record and its files, with `id`, the job asked for. */
async function detailOf(id: string, runs: Entry[]): Promise<JobDetail> {
  const v = view(runs);
  const fit = await currentFit();
  const projector = jobProjector();
  const job = projector.toJob(runs, v);
  const detail: JobDetail = { ...job, id, runs: runInfos(runs, fit), holds: readHolds([job.name]), open: isOpen(runs) };
  const blockers = detail.item ? projector.blockers(detail.repo, detail.item.id) : [];
  if (blockers.length) detail.blockers = blockers;
  const step = stepOf(runs);
  Object.assign(detail, { next: { ...step, text: [step.action, step.sub, step.on?.map((x) => shownId(x)).join(" "), step.count, step.to && `→ ${step.to}`].filter(Boolean).join(" ") }, rounds: roundsOf(runs[0].run.target ?? runs[0].id) });
  // The job's share is its runs' shares: a run's reviewer is on another model than the job's.
  const wks = detail.runs.flatMap((r) => (r.wk ? [r.wk] : []));
  if (wks.length) detail.wk = { pct: wks.reduce((a, w) => a + w.pct, 0), pooled: wks[0].pooled };
  const result = latestFile(runs, "result.md", (e) => isBuild(e.run.role))?.text;
  const review = latestFile(runs, "result.md", (e) => e.run.role === "review");
  if (result !== undefined) detail.result = result;
  if (review) detail.review = review.text;
  const rv = review && readFile(review.entry, "review.json");
  if (rv) detail.verdict = JSON.parse(rv).verdict;
  const by = checkedBy(runs);
  if (by.length) detail.checkedBy = by;
  const landedIn = v.state === "landed" && v.commit && v.repo ? loadRegistry()[v.repo] : undefined;
  const shortstat = landedIn ? git(landedIn.path, "show", "--shortstat", "--format=", v.commit!).out : "";
  if (shortstat) detail.look = lookMinutes(changedLinesOf(shortstat));
  // The job's diff stat (branch, landed commit, or the kept file), else the stat the run kept.
  const jd = jobDiff(runs);
  if (jd?.stat) detail.stat = jd.stat;
  else if (v.stat) detail.stat = v.stat;
  const trace = await traceUrl(runs);
  if (trace) detail.trace = trace;
  if (detail.item) Object.assign(detail, fromStore(detail.repo, detail.item.id));
  return detail;
}

const none = () => Response.json({ error: "no such job" }, { status: 404 });

export const routes: Routes = {
  // One row per job, newest first, without the judge calls: `?project=`, `?window=` (default week), `?state=`, `?unusable=1` (the runs the monitor counts as failed), and the page `?limit=`, `?before=` (an ISO start).
  "GET /api/jobs": (_req, _p, url) => {
    const q = url.searchParams, sc = scopeOf(url);
    if (sc instanceof Response) return sc;
    const state = q.get("state"), before = q.get("before");
    const limit = q.has("limit") ? Number(q.get("limit")) : LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX) return Response.json({ error: `limit must be a whole number from 1 to ${MAX}` }, { status: 400 });
    if (before !== null && Number.isNaN(Date.parse(before))) return Response.json({ error: "before must be an ISO time" }, { status: 400 });
    loadRegistry();
    const since = Date.now() - sc.ms, all = allRuns();
    const hit = all.filter((e) => { const r = e.run; return r.role !== "judge" && repoIn(r.repo, sc.project) && (!state || r.state === state) && (q.get("unusable") !== "1" || unusable(e)) && Date.parse(r.ended ?? r.started) >= since && (!before || Date.parse(r.started) < Date.parse(before)); })
      .sort((a, b) => Date.parse(b.run.started) - Date.parse(a.run.started));
    const page = hit.slice(0, limit);
    return Response.json({ jobs: rowsOf(page), next: hit.length > limit ? page.at(-1)!.run.started : null });
  },

  "GET /api/jobs/:id": async (_req, params, url) => {
    const at = located(params.id, projectOf(url));
    return at ? Response.json(await detailOf(params.id, at.runs)) : none();
  },

  "GET /api/jobs/:id/diff": (_req, params, url) => {
    const at = located(params.id, projectOf(url));
    if (!at) return none();
    const d = jobDiff(at.runs);
    if (!d) return Response.json({ error: NO_DIFF }, { status: 404 });
    return new Response(d.diff, { headers: { "content-type": "text/plain; charset=utf-8" } });
  },

  // A log file of the job's run: whole as text, or with `?as=transcript` as the steps of a stream-json log. Only known names.
  "GET /api/jobs/:id/logs/:file": (_req, params, url) => {
    const at = located(params.id, projectOf(url));
    if (!at || !(LOGS as readonly string[]).includes(params.file)) return Response.json({ error: "no such log" }, { status: 404 });
    const text = logText(at.e, params.file as keyof typeof LOG_SOURCE);
    if (text === undefined) return Response.json({ error: "no such log" }, { status: 404 });
    if (url.searchParams.get("as") === "transcript") {
      if (params.file !== "output.log") return Response.json({ error: "not a transcript" }, { status: 404 });
      return Response.json(transcript(text));
    }
    return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
