/** `GET /api/jobs`, `/api/jobs/:id`, its diff and logs, and `/api/issues/:id/jobs`: the Jobs and Job views' data. `:id` is a job ID, `a1430#2`. */
import { counting, jobIdOf, keyOf, next as nextStep, read as readRecord, type JobEvent, type Step as NextStep } from "../../jobs/lib/records/record.ts";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../jobs/lib/infra/git.ts";
import { OPUS_MODEL, readModels } from "../../jobs/lib/routing/models.ts";
import { jobDiff, NO_DIFF } from "../../jobs/lib/records/jobdiff.ts";
import { allRuns, isAgentRun, isBuild, issueKeyOf, loadRegistry, onOf, runOfJob, runsByIssue, type Entry } from "../../jobs/lib/records/ledger.ts";
import { allJobs, checkedBy, lookMinutes, hasFile, latestFile, readFile, view } from "../../jobs/lib/records/job.ts";
import { changedLinesOf, readHolds, type HoldRecord } from "../../jobs/lib/gates/factory-status.ts";
import { jobProjector, type Job, type Wait } from "../state.ts";
import type { Routes } from "../server.ts";
import { currentFit, runShare, type Fit, type Wk } from "../usage.ts";
import { langfuse } from "../../lib/langfuse.ts";
import { resultContent } from "../../lib/toolresult.ts";
import { contentText, issueHref, parseId, subjectOf, tail } from "../../lib/naming.ts";
import { unusable } from "../../jobs/lib/learning/monitor-table.ts";
import { projectOf, repoIn, scopeOf } from "./scope.ts";
import { parentOf, partsOf, readList } from "../../issues/lib/store.ts";
import * as todos from "../../issues/lib/todo.ts";

/** `id` is the run folder's name, the key of its logs; `job` is the job ID that the page shows, `a1375#6`. */
interface RunInfo { id: string; job?: string; kind: "worker" | "land" | "review" | "plain" | "intake" | "director" | "monitor" | "chat" | "lens" | "housekeeper" | "maintainer"; condition: string; started: string; ended?: string; cost?: number; model?: string; reason?: string; wk?: Wk; logs?: LogFile[] }
/** A log file of a run, with its size in bytes. */
export interface LogFile { name: string; size: number }
/** The log files the Job page serves, and no others. */
export const LOGS = ["output.log", "review.log", "checks.log", "stderr.log", "land.log", "setup.log"] as const;
/** The known log files a run folder has. */
function logsOf(folder: string): LogFile[] {
  const out: LogFile[] = [];
  for (const name of LOGS) {
    try { const st = statSync(join(folder, name)); if (st.isFile()) out.push({ name, size: st.size }); } catch {}
  }
  return out;
}
/** One step of a transcript: assistant text, or a tool call with its input and result. */
export type Step = { kind: "text"; text: string } | { kind: "tool"; name: string; input: unknown; output?: string; error?: boolean };
/** A stream-json transcript as steps, in order. */
export function transcript(stream: string): Step[] {
  const steps: Step[] = [];
  const calls = new Map<string, Extract<Step, { kind: "tool" }>>();
  for (const line of stream.split("\n")) {
    if (!line.startsWith("{")) continue;
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    const content = ev?.message?.content;
    if (ev?.type === "assistant" && Array.isArray(content)) {
      for (const b of content) {
        if (b?.type === "text" && b.text) steps.push({ kind: "text", text: String(b.text) });
        if (b?.type === "tool_use") { const t: Extract<Step, { kind: "tool" }> = { kind: "tool", name: String(b.name), input: b.input }; steps.push(t); calls.set(b.id, t); }
      }
    } else if (ev?.type === "user" && Array.isArray(content)) {
      for (const b of content) {
        const t = b?.type === "tool_result" ? calls.get(b.tool_use_id) : undefined;
        if (!t) continue;
        t.output = resultContent(b.content);
        if (b.is_error === true) t.error = true;
      }
    }
  }
  return steps;
}
interface JobDetail extends Job {
  blockers?: Wait[];
  runs: RunInfo[]; result?: string; review?: string; stat?: string;
  /** The reviewer's verdict, from the review.json beside review.md. */
  verdict?: "pass" | "hold";
  trace?: string;
  /** What checked the job; a delivery's minutes to spot-check it, an estimate. */
  checkedBy?: string[]; look?: number;
  /** The item's spec, from the store. */
  spec?: string;
  /** Why the job waited: its hold records, oldest first. */
  holds: HoldRecord[];
  /** From its job record: the next step, its line of event words, the fix rounds, and what happened to it, oldest first. */
  next?: NextStep & { text: string }; rounds?: number; events?: JobEvent[];
  /** For a part: its issue, its place among the issue's parts, and the part after it. */
  parent?: { id: string; href: string; n: number; of: number; next?: { id: string; href: string } };
}

/** The item's spec and, for a part, its issue and its place among the parts. Nothing when the store cannot be read. */
function fromStore(repo: string, id: number | string): Pick<JobDetail, "spec" | "parent"> {
  const place = loadRegistry()[repo];
  let doc: todos.Doc | null = null;
  try { doc = place ? readList(place) : null; } catch { return {}; }
  const item = doc && todos.find(doc, id);
  if (!doc || !item) return {};
  const out: Pick<JobDetail, "spec" | "parent"> = {};
  if (item.spec) out.spec = item.spec;
  const up = parentOf(doc, item);
  if (!up) return out;
  const parts = partsOf(doc, up).map(todos.refOf);
  const n = parts.indexOf(todos.refOf(item)), next = parts[n + 1];
  out.parent = { id: `${repo}-${todos.refOf(up)}`, href: issueHref(`${repo}-${todos.refOf(up)}`), n: n + 1, of: parts.length, ...(next ? { next: { id: `${repo}-${next}`, href: issueHref(`${repo}-${next}`) } } : {}) };
  return out;
}

const KIND = { build: "worker", recheck: "worker", land: "land", plain: "plain", intake: "intake", director: "director", monitor: "monitor", chat: "chat", lens: "lens", housekeeper: "housekeeper", maintainer: "maintainer" } as const;
/** The actor a run belongs to, by its kind. */
const RUN_ACTOR: Partial<Record<RunInfo["kind"], string>> = {
  worker: "worker", review: "reviewer", intake: "intake", director: "director", monitor: "monitor",
};
/** The runs of a job as the page shows them, each with its job ID. */
function runInfos(runs: Entry[], fit: Fit | null): RunInfo[] {
  const out: RunInfo[] = [];
  runs.forEach((e) => {
    const r = e.run;
    const condition = r.condition;
    const info: RunInfo = { id: e.id, job: jobIdOf(e), kind: KIND[r.kind] ?? "worker", condition, started: r.started };
    if (r.ended) info.ended = r.ended;
    if (r.cost !== undefined) info.cost = r.cost;
    if (r.model) info.model = r.model;
    const wk = runShare(fit, r);
    if (wk) info.wk = wk;
    if (r.reason) info.reason = r.reason;
    const logs = logsOf(e.folder);
    if (logs.length) info.logs = logs;
    out.push(info);
    // The reviewer runs inside the worker's run folder and leaves review.md there.
    if (isAgentRun(r.kind) && hasFile(e, "review.md")) {
      out.push({ id: `${e.id}-review`, kind: "review", condition, started: r.ended ?? r.started, ...(r.ended ? { ended: r.ended } : {}), model: r.review?.model ?? readModels().reviewer?.model ?? OPUS_MODEL });
    }
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
    const ended = r.ended ?? null, kind = KIND[r.kind as keyof typeof KIND] ?? "worker";
    return {
      id: jobIdOf(e), subject: subjectOf(r), name: r.name, repo: r.repo ?? "", kind: r.kind, actor: RUN_ACTOR[kind] ?? null, state: r.condition,
      title: (issue && lists.item(r.repo!, onOf(r)!)?.title) || r.name, issue, started: r.started, ended,
      seconds: ended ? Math.round((Date.parse(ended) - Date.parse(r.started)) / 1000) : null, cost: r.cost ?? null, model: r.model ?? null,
    };
  });
}

/** The run of job `id` and the runs grouped with it (`allJobs`), in `project` when given; null for none. */
function located(id: string, project: string | null): { e: Entry; runs: Entry[] } | null {
  loadRegistry();
  const e = runOfJob(id);
  if (!e || !repoIn(e.run.repo, project)) return null;
  return { e, runs: allJobs().find((g) => g.some((x) => x.id === e.id))! };
}

/** The Job page's data: the job's runs, its record and its files, with `id`, the job asked for. */
async function detailOf(id: string, runs: Entry[]): Promise<JobDetail> {
  const v = view(runs);
  const fit = await currentFit().catch(() => null);
  const projector = jobProjector();
  const job = projector.toJob(runs, v);
  const detail: JobDetail = { ...job, id, runs: runInfos(runs, fit), holds: readHolds([job.name]) };
  const blockers = detail.item ? projector.blockers(detail.repo, detail.item.id) : [];
  if (blockers.length) detail.blockers = blockers;
  const rec = readRecord(keyOf(counting(runs).run));
  if (rec) {
    const step = nextStep(rec);
    Object.assign(detail, { next: { ...step, text: [step.action, step.sub, contentText(step)].filter(Boolean).join(" ") }, rounds: rec.rounds, events: rec.events });
  }
  // The job's share is its runs' shares: a run's reviewer is on another model than the job's.
  const wks = detail.runs.flatMap((r) => (r.wk ? [r.wk] : []));
  if (wks.length) detail.wk = { pct: wks.reduce((a, w) => a + w.pct, 0), pooled: wks[0].pooled };
  const result = latestFile(runs, "result.md", (e) => isBuild(e.run.kind))?.text;
  const review = latestFile(runs, "review.md");
  if (result !== undefined) detail.result = result;
  if (review) detail.review = review.text;
  const rv = review && readFile(review.entry, "review.json");
  if (rv) detail.verdict = JSON.parse(rv).verdict;
  const by = checkedBy(runs);
  if (by.length) detail.checkedBy = by;
  const landedIn = v.condition === "landed" && v.commit && v.repo ? loadRegistry()[v.repo] : undefined;
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
  // One row per job, newest first: `?project=`, `?window=` (default week), `?state=`, `?unusable=1` (the runs the monitor counts as failed), and the page `?limit=`, `?before=` (an ISO start).
  "GET /api/jobs": (_req, _p, url) => {
    const q = url.searchParams, sc = scopeOf(url);
    if (sc instanceof Response) return sc;
    const state = q.get("state"), before = q.get("before");
    const limit = q.has("limit") ? Number(q.get("limit")) : LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX) return Response.json({ error: `limit must be a whole number from 1 to ${MAX}` }, { status: 400 });
    if (before !== null && Number.isNaN(Date.parse(before))) return Response.json({ error: "before must be an ISO time" }, { status: 400 });
    loadRegistry();
    const since = Date.now() - sc.ms, all = allRuns();
    const hit = all.filter((e) => { const r = e.run; return repoIn(r.repo, sc.project) && (!state || r.condition === state) && (q.get("unusable") !== "1" || unusable(e)) && Date.parse(r.ended ?? r.started) >= since && (!before || Date.parse(r.started) < Date.parse(before)); })
      .sort((a, b) => Date.parse(b.run.started) - Date.parse(a.run.started));
    const page = hit.slice(0, limit);
    return Response.json({ jobs: rowsOf(page), next: hit.length > limit ? page.at(-1)!.run.started : null });
  },

  // The jobs of one issue and its sub-issues, newest first.
  "GET /api/issues/:id/jobs": (_req, params, url) => {
    loadRegistry();
    const p = parseId(params.id);
    if (!p || !repoIn(p.repo, projectOf(url))) return Response.json({ error: "no such issue" }, { status: 404 });
    const all = allRuns();
    const mine = [...(runsByIssue(all, { rollUp: true }).get(`${p.repo}-${tail(p)}`) ?? [])].reverse();
    return Response.json({ jobs: rowsOf(mine) });
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
    const path = join(at.e.folder, params.file);
    if (!existsSync(path)) return Response.json({ error: "no such log" }, { status: 404 });
    if (url.searchParams.get("as") === "transcript") {
      if (params.file !== "output.log" && params.file !== "review.log") return Response.json({ error: "not a transcript" }, { status: 404 });
      return Response.json(transcript(readFileSync(path, "utf8")));
    }
    return new Response(Bun.file(path), { headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
