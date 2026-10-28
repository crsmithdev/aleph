/** `GET /api/jobs`, `/api/jobs/:name`, `/api/jobs/:name/diff`: the Jobs and Job views' data. */
import { git } from "../../jobs/lib/git.ts";
import { loadRegistry, type Entry } from "../../jobs/lib/ledger.ts";
import { allJobs, hasFile, latestFile, latestJob, lastReal, view } from "../../jobs/lib/job.ts";
import { jobProjector, type Job } from "../state.ts";
import type { Routes } from "../server.ts";

export interface RunInfo { id: string; kind: "worker" | "land" | "review" | "plain" | "triage"; state: string; started: string; ended?: string; cost?: number; model?: string; reason?: string }
export interface JobDetail extends Job {
  runs: RunInfo[]; result?: string; review?: string; stat?: string;
  checksLog?: string; stderr?: string; trace?: string;
}

const DAY = 24 * 3600_000;
/** The last `n` lines of `s`. */
export const lastLines = (s: string | undefined, n = 80): string | undefined => {
  if (s === undefined) return undefined;
  const lines = s.replace(/\n+$/, "").split("\n");
  return lines.slice(-n).join("\n");
};
const KIND = { agent: "worker", recheck: "worker", land: "land", plain: "plain", triage: "triage" } as const;
function runInfos(runs: Entry[]): RunInfo[] {
  const out: RunInfo[] = [];
  for (const e of runs) {
    const r = e.run;
    const info: RunInfo = { id: e.id, kind: KIND[r.kind] ?? "worker", state: r.state, started: r.started };
    if (r.ended) info.ended = r.ended;
    if (r.cost !== undefined) info.cost = r.cost;
    if (r.model) info.model = r.model;
    if (r.reason) info.reason = r.reason;
    out.push(info);
    // The reviewer runs inside the worker's run folder and leaves review.md there.
    if ((r.kind === "agent" || r.kind === "recheck") && hasFile(e, "review.md")) {
      out.push({ id: `${e.id}-review`, kind: "review", state: r.state, started: r.ended ?? r.started, ...(r.ended ? { ended: r.ended } : {}), model: "claude-opus-5-5" });
    }
  }
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

/** The branch of a job, if it still exists in the repo, with the repo path and its merge base. */
function branchRange(runs: Entry[]): { path: string; base: string; ref: string } | null {
  const last = runs.at(-1)!.run;
  const repo = last.repo ? loadRegistry()[last.repo] : undefined;
  const branch = runs.findLast((e) => e.run.branch)?.run.branch;
  if (!repo || !branch) return null;
  const ref = `refs/heads/${branch}`;
  if (!git(repo.path, "rev-parse", "--verify", "-q", ref).ok) return null;
  const mb = git(repo.path, "merge-base", `origin/${repo.main}`, ref);
  return mb.ok && mb.out ? { path: repo.path, base: mb.out.trim(), ref } : null;
}

export const routes: Routes = {
  "GET /api/jobs": (_req, _p, url) => {
    const q = url.searchParams;
    const project = q.get("project"), repo = q.get("repo"), state = q.get("state");
    const dq = q.get("days");
    const days = dq === null || dq === "" ? 7 : Number(dq);
    if (!(days >= 0)) return Response.json({ error: "days must be a number" }, { status: 400 });
    const since = Date.now() - days * DAY;
    const hit: { at: number; job: Job }[] = [];
    const { toJob } = jobProjector();
    for (const runs of allJobs()) {
      const last = lastReal(runs).run;
      if ((project && last.repo !== project) || (repo && last.repo !== repo) || (state && last.state !== state)) continue;
      const times = runs.flatMap((e) => [e.run.started, e.run.ended]).map((t) => Date.parse(t ?? "")).filter((t) => !Number.isNaN(t));
      const at = Math.max(...times);
      if (!(at >= since)) continue;
      hit.push({ at, job: toJob(runs) });
    }
    return Response.json(hit.sort((a, b) => b.at - a.at).map((h) => h.job));
  },

  "GET /api/jobs/:name": async (_req, params, url) => {
    const runs = find(params.name, url.searchParams.get("project"));
    if (!runs) return Response.json({ error: "no such job" }, { status: 404 });
    const v = view(runs);
    const detail: JobDetail = { ...jobProjector().toJob(runs, v), runs: runInfos(runs) };
    const result = latestFile(runs, "result.md", (e) => e.run.kind === "agent")?.text;
    const review = latestFile(runs, "review.md")?.text;
    const checksLog = latestFile(runs, "checks.log")?.text;
    const stderr = latestFile(runs, "stderr.log")?.text;
    if (result !== undefined) detail.result = result;
    if (review !== undefined) detail.review = review;
    if (checksLog !== undefined) detail.checksLog = lastLines(checksLog);
    if (stderr !== undefined) detail.stderr = lastLines(stderr);
    // The branch's diff stat while it exists, else the stat the run kept.
    const range = branchRange(runs);
    const s = range && git(range.path, "diff", "--stat", range.base, range.ref);
    if (s && s.ok && s.out) detail.stat = s.out;
    else if (v.stat) detail.stat = v.stat;
    const trace = await traceUrl(runs);
    if (trace) detail.trace = trace;
    return Response.json(detail);
  },

  "GET /api/jobs/:name/diff": (_req, params, url) => {
    const runs = find(params.name, url.searchParams.get("project"));
    const range = runs && branchRange(runs);
    if (!range) return Response.json({ error: "no branch for this job" }, { status: 404 });
    const d = git(range.path, "diff", range.base, range.ref);
    if (!d.ok) return Response.json({ error: d.out }, { status: 500 });
    return new Response(d.out + "\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
