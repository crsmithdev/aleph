/** `GET /api/jobs`, `/api/jobs/:name`, `/api/jobs/:name/diff`: the Jobs and Job views' data. */
import { keyOf, next as nextStep, read as readRecord, type JobEvent, type Step as NextStep } from "../../jobs/lib/records/record.ts";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../jobs/lib/infra/git.ts";
import { OPUS_MODEL } from "../../jobs/lib/roles/agent-call.ts";
import { jobDiff, NO_DIFF } from "../../jobs/lib/records/jobdiff.ts";
import { isAgentRun, isBuild, loadRegistry, type Entry } from "../../jobs/lib/records/ledger.ts";
import { allJobs, checkedBy, lookMinutes, hasFile, latestFile, latestJob, lastReal, readFile, view } from "../../jobs/lib/records/job.ts";
import { changedLinesOf, readHolds, type HoldRecord } from "../../jobs/lib/gates/factory-status.ts";
import { jobProjector, type Job, type Wait } from "../state.ts";
import type { Routes } from "../server.ts";
import { annotate, currentFit, share, type Fit, type Wk } from "../usage.ts";
import { word } from "../../lib/naming.ts";
import { parentOf, partsOf, readList } from "../../issues/lib/store.ts";
import * as todos from "../../issues/lib/todo.ts";

export interface RunInfo { id: string; kind: "worker" | "land" | "review" | "plain" | "intake" | "triage" | "plan" | "facts" | "firefighter" | "director" | "explain" | "monitor"; condition: string; started: string; ended?: string; cost?: number; model?: string; reason?: string; wk?: Wk; logs?: LogFile[] }
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
        t.output = Array.isArray(b.content) ? b.content.map((p: any) => p?.text ?? "").join("") : String(b.content ?? "");
        if (b.is_error === true) t.error = true;
      }
    }
  }
  return steps;
}
export interface JobDetail extends Job {
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
  /** From its job record: the next step, the fix rounds, and what happened to it, oldest first. */
  next?: NextStep; rounds?: number; events?: JobEvent[];
  /** For a part: its issue, its place among the issue's parts, and the part after it. */
  parent?: { id: string; href: string; n: number; of: number; next?: { id: string; href: string } };
}

const issueHref = (repo: string, ref: string) => `#/issues/${encodeURIComponent(repo)}/${ref}`;
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
  out.parent = { id: `${repo}-${todos.refOf(up)}`, href: issueHref(repo, todos.refOf(up)), n: n + 1, of: parts.length, ...(next ? { next: { id: `${repo}-${next}`, href: `#/jobs/${encodeURIComponent(`${repo}-${next}`)}` } } : {}) };
  return out;
}

const DAY = 24 * 3600_000;
const KIND = { agent: "worker", build: "worker", recheck: "worker", land: "land", plain: "plain", intake: "intake", triage: "triage", plan: "plan", facts: "facts", firefighter: "firefighter", director: "director", explain: "explain", monitor: "monitor" } as const;
/** The actor a run belongs to, by its kind. */
const RUN_ACTOR: Partial<Record<RunInfo["kind"], string>> = {
  worker: "worker", review: "reviewer", intake: "intake", triage: "intake", plan: "intake", facts: "intake",
  director: "director", explain: "director", monitor: "monitor", firefighter: "firefighter",
};
function runInfos(runs: Entry[], fit: Fit | null = null): RunInfo[] {
  const out: RunInfo[] = [];
  runs.forEach((e) => {
    const r = e.run;
    const condition = r.condition;
    const info: RunInfo = { id: e.id, kind: KIND[r.kind] ?? "worker", condition, started: r.started };
    if (r.ended) info.ended = r.ended;
    if (r.cost !== undefined) info.cost = r.cost;
    if (r.model) info.model = r.model;
    const wk = share(fit, r.cost, r.model);
    if (wk) info.wk = wk;
    if (r.reason) info.reason = r.reason;
    const logs = logsOf(e.folder);
    if (logs.length) info.logs = logs;
    out.push(info);
    // The reviewer runs inside the worker's run folder and leaves review.md there.
    if (isAgentRun(r.kind) && hasFile(e, "review.md")) {
      out.push({ id: `${e.id}-review`, kind: "review", condition, started: r.ended ?? r.started, ...(r.ended ? { ended: r.ended } : {}), model: OPUS_MODEL });
    }
  });
  return out;
}

/** The Langfuse session page of the job's run, when Langfuse is configured and knows the session. */
async function traceUrl(runs: Entry[]): Promise<string | undefined> {
  const session = runs.findLast((e) => e.run.session)?.run.session;
  const pub = process.env.LANGFUSE_PUBLIC_KEY, sec = process.env.LANGFUSE_SECRET_KEY;
  if (!session || !pub || !sec) return undefined;
  const base = (process.env.LANGFUSE_BASE_URL ?? "http://127.0.0.1:3010").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/api/public/sessions/${encodeURIComponent(session)}`, {
      headers: { authorization: `Basic ${btoa(`${pub}:${sec}`)}` }, signal: AbortSignal.timeout(1500),
    });
    return res.ok ? `${base}/sessions/${encodeURIComponent(session)}` : undefined;
  } catch { return undefined; }
}

const find = (name: string, project: string | null): Entry[] | undefined => latestJob(name, project);

export const routes: Routes = {
  "GET /api/jobs": async (_req, _p, url) => {
    const q = url.searchParams;
    const project = q.get("project"), repo = q.get("repo"), state = q.get("condition"), role = q.get("role");
    const dq = q.get("days");
    const days = dq === null || dq === "" ? 7 : Number(dq);
    if (!(days >= 0)) return Response.json({ error: "days must be a number" }, { status: 400 });
    const since = Date.now() - days * DAY;
    const actor = role && word("actor", role);
    const hit: { at: number; job: Job }[] = [];
    const { toJob } = jobProjector();
    for (const runs of allJobs()) {
      const last = lastReal(runs).run;
      if ((project && last.repo !== project) || (repo && last.repo !== repo) || (state && last.condition !== state)) continue;
      if (actor && !runInfos(runs).some((r) => RUN_ACTOR[r.kind] === actor)) continue;
      const times = runs.flatMap((e) => [e.run.started, e.run.ended]).map((t) => Date.parse(t ?? "")).filter((t) => !Number.isNaN(t));
      const at = Math.max(...times);
      if (!(at >= since)) continue;
      hit.push({ at, job: toJob(runs) });
    }
    const jobs = hit.sort((a, b) => b.at - a.at).map((h) => h.job);
    annotate(jobs, await currentFit().catch(() => null));
    return Response.json(jobs);
  },

  "GET /api/jobs/:name": async (_req, params, url) => {
    const runs = find(params.name, url.searchParams.get("project"));
    if (!runs) return Response.json({ error: "no such job" }, { status: 404 });
    const v = view(runs);
    const fit = await currentFit().catch(() => null);
    const projector = jobProjector();
    const detail: JobDetail = { ...projector.toJob(runs, v), runs: runInfos(runs, fit), holds: readHolds([projector.toJob(runs, v).name]) };
    const blockers = detail.item ? projector.blockers(detail.repo, detail.item.id) : [];
    if (blockers.length) detail.blockers = blockers;
    const rec = readRecord(keyOf(runs.at(-1)!.run));
    if (rec) Object.assign(detail, { next: nextStep(rec), rounds: rec.rounds, events: rec.events });
    annotate([detail], fit);
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
    return Response.json(detail);
  },

  "GET /api/jobs/:name/diff": (_req, params, url) => {
    const runs = find(params.name, url.searchParams.get("project"));
    if (!runs) return Response.json({ error: "no such job" }, { status: 404 });
    const d = jobDiff(runs);
    if (!d) return Response.json({ error: NO_DIFF }, { status: 404 });
    return new Response(d.diff, { headers: { "content-type": "text/plain; charset=utf-8" } });
  },

  // A log file of one run of the job: whole as text, or with `?as=transcript` as the steps of a stream-json log. Only known names.
  "GET /api/jobs/:name/runs/:run/logs/:file": (_req, params, url) => {
    const runs = find(params.name, url.searchParams.get("project"));
    const entry = runs?.find((e) => e.id === params.run);
    if (!entry || !(LOGS as readonly string[]).includes(params.file)) return Response.json({ error: "no such log" }, { status: 404 });
    const path = join(entry.folder, params.file);
    if (!existsSync(path)) return Response.json({ error: "no such log" }, { status: 404 });
    if (url.searchParams.get("as") === "transcript") {
      if (params.file !== "output.log" && params.file !== "review.log") return Response.json({ error: "not a transcript" }, { status: 404 });
      return Response.json(transcript(readFileSync(path, "utf8")));
    }
    return new Response(Bun.file(path), { headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
