/** `GET /api/jobs`, `/api/jobs/:name`, `/api/jobs/:name/diff`: the Jobs and Job views' data. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../jobs/lib/git.ts";
import { allJobs, loadRegistry, type Entry } from "../../jobs/lib/ledger.ts";
import { readList } from "../../todo/lib/store.ts";
import type { Doc } from "../../todo/lib/todo.ts";
import type { Job } from "../state.ts";
import type { Routes } from "../server.ts";

export interface RunInfo { id: string; kind: "worker" | "land" | "review" | "plain" | "triage"; state: string; started: string; ended?: string; cost?: number; model?: string; reason?: string }
export interface JobDetail extends Job {
  runs: RunInfo[]; result?: string; review?: string; stat?: string;
  checksLog?: string; stderr?: string; trace?: string;
}

const DAY = 24 * 3600_000;
const text = (folder: string, f: string): string | undefined => {
  const p = join(folder, f);
  return existsSync(p) ? readFileSync(p, "utf8") : undefined;
};
/** The last `n` lines of `s`. */
export const lastLines = (s: string | undefined, n = 80): string | undefined => {
  if (s === undefined) return undefined;
  const lines = s.replace(/\n+$/, "").split("\n");
  return lines.slice(-n).join("\n");
};
const tagged = (s: string, tag: string): string[] =>
  s.split("\n").map((l) => l.trim()).filter((l) => l.startsWith(`${tag}:`)).map((l) => l.slice(tag.length + 1).trim());

const lists = new Map<string, Doc | null>();
function itemOf(repo: string, id: number): { id: number; title: string } {
  if (!lists.has(repo)) {
    let doc: Doc | null = null;
    try { doc = readList({ key: repo }); } catch {}
    lists.set(repo, doc);
  }
  return { id, title: lists.get(repo)?.items.find((i) => i.id === id)?.title ?? "" };
}

function toJob(runs: Entry[]): Job {
  const last = runs.at(-1)!.run;
  const todo = runs.findLast((e) => e.run.todo !== undefined)?.run.todo;
  const withResult = runs.findLast((e) => e.run.kind === "agent" && existsSync(join(e.folder, "result.md")));
  const commit = last.commit ?? runs.findLast((e) => e.run.commit)?.run.commit;
  const model = last.model ?? runs.findLast((e) => e.run.model)?.run.model;
  const stat = last.stat ?? runs.findLast((e) => e.run.stat)?.run.stat;
  const checks = (runs.findLast((e) => (e.run as any).checks) as any)?.run.checks;
  const job: Job = {
    name: last.name, repo: last.repo ?? "", item: todo !== undefined && last.repo ? itemOf(last.repo, todo) : null,
    state: last.state, started: runs[0].run.started, run: { kind: last.kind, started: last.started },
    defaults: runs.findLast((e) => e.run.defaults !== undefined)?.run.defaults ?? [],
    followups: withResult ? tagged(text(withResult.folder, "result.md") ?? "", "FOLLOWUP") : [],
  };
  if (last.needs) job.needs = last.needs;
  if (last.phase) job.phase = last.phase;
  if (last.reason) job.reason = last.reason;
  if (last.question) job.question = last.question;
  if (last.ended) job.ended = last.ended;
  if (runs.some((e) => e.run.cost !== undefined)) job.cost = runs.reduce((a, e) => a + (e.run.cost ?? 0), 0);
  if (model) job.model = model;
  if (commit) job.commit = commit;
  if (stat) job.stat = stat;
  if (Array.isArray(checks)) job.checks = checks;
  return job;
}

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
    if ((r.kind === "agent" || r.kind === "recheck") && existsSync(join(e.folder, "review.md"))) {
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

const find = (name: string, project: string | null): Entry[] | undefined =>
  allJobs().find((runs) => runs.at(-1)!.run.name === name && (!project || runs.at(-1)!.run.repo === project));

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
    for (const runs of allJobs()) {
      const last = runs.at(-1)!.run;
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
    const withResult = runs.findLast((e) => e.run.kind === "agent" && existsSync(join(e.folder, "result.md")));
    const withReview = runs.findLast((e) => existsSync(join(e.folder, "review.md")));
    const withChecks = runs.findLast((e) => existsSync(join(e.folder, "checks.log")));
    const withErr = runs.findLast((e) => existsSync(join(e.folder, "stderr.log")));
    const detail: JobDetail = { ...toJob(runs), runs: runInfos(runs) };
    if (withResult) detail.result = text(withResult.folder, "result.md");
    if (withReview) detail.review = text(withReview.folder, "review.md");
    if (withChecks) detail.checksLog = lastLines(text(withChecks.folder, "checks.log"));
    if (withErr) detail.stderr = lastLines(text(withErr.folder, "stderr.log"));
    const range = branchRange(runs);
    if (range) {
      const s = git(range.path, "diff", "--stat", range.base, range.ref);
      if (s.ok && s.out) detail.stat = s.out;
    }
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
