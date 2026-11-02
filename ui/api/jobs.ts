/** `GET /api/jobs`, `/api/jobs/:name`, `/api/jobs/:name/diff`: the Jobs and Job views' data. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../jobs/lib/git.ts";
import { jobDiff, NO_DIFF } from "../../jobs/lib/jobdiff.ts";
import { isWorker, loadRegistry, type Entry } from "../../jobs/lib/ledger.ts";
import { allJobs, checkedBy, lookMinutes, sealed, hasFile, latestFile, latestJob, lastReal, view } from "../../jobs/lib/job.ts";
import { changedLinesOf } from "../../jobs/lib/factory-status.ts";
import { jobProjector, type Job, type Wait } from "../state.ts";
import type { Routes } from "../server.ts";
import { annotate, currentFit, share, type Fit, type Wk } from "../usage.ts";
import { partsOf, readList } from "../../todo/lib/store.ts";
import * as todos from "../../todo/lib/todo.ts";

export interface RunInfo { id: string; kind: "worker" | "land" | "review" | "plain" | "triage" | "plan" | "facts" | "firefighter" | "explain"; condition: string; started: string; ended?: string; cost?: number; model?: string; reason?: string; wk?: Wk; logs?: LogFile[] }
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
  checksLog?: string; stderr?: string; trace?: string;
  /** What checked the job; a delivery's minutes to spot-check it, an estimate. */
  checkedBy?: string[]; look?: number;
  /** The item's spec, from the store. */
  spec?: string;
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
  if (item.sub === undefined) return out;
  const parts = partsOf(doc, todos.find(doc, item.id)!).map(todos.refOf);
  const n = parts.indexOf(todos.refOf(item)), next = parts[n + 1];
  out.parent = { id: `${repo}-${item.id}`, href: issueHref(repo, String(item.id)), n: n + 1, of: parts.length, ...(next ? { next: { id: `${repo}-${next}`, href: `#/jobs/${encodeURIComponent(`${repo}-${next}`)}` } } : {}) };
  return out;
}

const DAY = 24 * 3600_000;
/** The last `n` lines of `s`. */
export const lastLines = (s: string | undefined, n = 80): string | undefined => {
  if (s === undefined) return undefined;
  const lines = s.replace(/\n+$/, "").split("\n");
  return lines.slice(-n).join("\n");
};
const KIND = { agent: "worker", build: "worker", recheck: "worker", research: "worker", land: "land", plain: "plain", triage: "triage", plan: "plan", facts: "facts", firefighter: "firefighter", explain: "explain" } as const;
function runInfos(runs: Entry[], fit: Fit | null = null): RunInfo[] {
  const out: RunInfo[] = [];
  runs.forEach((e, i) => {
    const r = e.run;
    // A worker the reviewer sent back stays stored "stuck"; the job carries on with a later worker run, so it reads "sent back".
    const back = isWorker(r.kind) && r.failed === "review" && r.condition === "stuck" && runs.slice(i + 1).some((n) => isWorker(n.run.kind));
    const condition = back ? "sent back" : r.condition;
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
    if ((isWorker(r.kind) || r.kind === "recheck") && hasFile(e, "review.md")) {
      out.push({ id: `${e.id}-review`, kind: "review", condition, started: r.ended ?? r.started, ...(r.ended ? { ended: r.ended } : {}), model: "claude-opus-5-5" });
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
    const project = q.get("project"), repo = q.get("repo"), state = q.get("condition");
    const dq = q.get("days");
    const days = dq === null || dq === "" ? 7 : Number(dq);
    if (!(days >= 0)) return Response.json({ error: "days must be a number" }, { status: 400 });
    const since = Date.now() - days * DAY;
    const hit: { at: number; job: Job }[] = [];
    const { toJob } = jobProjector();
    for (const runs of allJobs()) {
      const last = lastReal(runs).run;
      if ((project && last.repo !== project) || (repo && last.repo !== repo) || (state && last.condition !== state)) continue;
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
    const detail: JobDetail = { ...projector.toJob(runs, v), runs: runInfos(runs, fit) };
    const blockers = detail.item ? projector.blockers(detail.repo, detail.item.id) : [];
    if (blockers.length) detail.blockers = blockers;
    annotate([detail], fit);
    const result = latestFile(runs, "result.md", (e) => isWorker(e.run.kind))?.text;
    const review = latestFile(runs, "review.md")?.text;
    const checksLog = latestFile(runs, "checks.log")?.text;
    const stderr = latestFile(runs, "stderr.log")?.text;
    if (result !== undefined) detail.result = result;
    if (review !== undefined) detail.review = review;
    if (checksLog !== undefined) detail.checksLog = lastLines(checksLog);
    if (stderr !== undefined) detail.stderr = lastLines(stderr);
    const by = checkedBy(runs);
    if (by.length) detail.checkedBy = by;
    const landedIn = v.condition === "landed" && v.commit && v.repo ? loadRegistry()[v.repo] : undefined;
    const shortstat = landedIn ? git(landedIn.path, "show", "--shortstat", "--format=", v.commit!).out : "";
    if (shortstat) detail.look = lookMinutes(changedLinesOf(shortstat), sealed(runs));
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
