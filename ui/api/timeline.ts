/**
 * `GET /api/timeline?before=<iso>&days=1&project=<key>`: the factory's events as one stream,
 * newest first. A page is the latest `days` local days, each with events, that end before
 * `before` (default now); `next` is the `before` for the page after it, null at the end.
 * The first page (no `before`) also carries `strip`: the items of the last 30 days for the swimlanes,
 * each with kind, start, end (null for a point, or a job still running) and name.
 * Sources: the ledger (job runs), the work store (issues), Langfuse sessions (the sessions
 * route), `git log` of the registry repos (lands) and the vault's daily note lines (notes).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { allRuns, loadRegistry } from "../../jobs/lib/ledger.ts";
import { itemPath, readList, storeDir } from "../../todo/lib/store.ts";
import { status, today } from "../../todo/lib/todo.ts";
import { linkTargets, links, loadVault, vaultDir } from "../../vault/lib/vault.ts";
import type { Routes } from "../server.ts";
import { routes as sessionRoutes } from "./sessions.ts";

export const KINDS = ["job", "land", "issue", "session", "note"] as const;
export type Kind = (typeof KINDS)[number];
const HORIZON_DAYS = 90, STRIP_DAYS = 30;

export interface TimelineEvent {
  at: string;
  kind: Kind;
  /** started, ended, landed, opened, closed, dropped, written. */
  what: string;
  /** A job's state, for its colour. */
  state?: string;
  title: string;
  /** The kind of job (agent, land, ...): the Subtype column. */
  sub?: string;
  /** The job name, issue id or session id: the Id column. */
  id?: string;
  href: string;
  project?: string;
  /** Only the day is known (an issue's created and updated dates). */
  dateOnly?: boolean;
  cost?: number;
  commit?: string;
  /** A bar's end: a job's ended, a session's last turn. */
  end?: string;
  /** The item's own fields as key/value pairs: the Details column. */
  details?: [string, string][];
}
export interface StripItem {
  kind: Kind;
  start: string;
  /** Jobs and sessions are bars; a job with no end runs to now. Others are points (null). */
  end: string | null;
  name: string;
  state?: string;
  href: string;
  /** The local day the item starts on: where a click scrolls the stream. */
  day: string;
}
export interface Timeline {
  days: { day: string; events: TimelineEvent[] }[];
  next: string | null;
  langfuse: "ok" | "off" | "error";
  strip?: StripItem[];
  /** The first page only: every row of the stream table, newest first, one row per job. */
  rows?: TimelineEvent[];
  /** The server's clock, for the duration of running jobs. */
  now?: string;
}

const dayOf = (iso: string): string | null => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : today(d);
};
const startOf = (day: string) => new Date(`${day}T00:00:00`);
const enc = encodeURIComponent;
const pairs = (...kv: [string, unknown][]): [string, string][] =>
  kv.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]);
const took = (a?: string, b?: string) => {
  const ms = Date.parse(b ?? "") - Date.parse(a ?? "");
  if (!(ms >= 0)) return "";
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
};

function jobEvents(project: string | null, since: number, inGit: (sha: string) => boolean): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const { run } of allRuns()) {
    if (project && run.repo !== project) continue;
    const href = `#/jobs/${enc(run.name)}`;
    const base = { href, project: run.repo };
    const isLand = run.kind === "land" && !!run.commit && run.state === "landed";
    if (isLand) {
      // A land that git log already shows is that commit's event.
      if (run.ended && !inGit(run.commit!)) out.push({ ...base, at: run.ended, kind: "land", what: "landed", state: "landed", title: run.name, id: run.name, commit: run.commit, cost: run.cost, details: pairs(["took", took(run.started, run.ended)], ["model", run.model], ["commit", run.commit?.slice(0, 7)]) });
      continue;
    }
    out.push({ ...base, at: run.started, kind: "job", what: "started", state: "running", sub: run.kind, title: run.name, id: run.name, end: run.ended || undefined, details: pairs(["model", run.model]) });
    if (run.ended) out.push({ ...base, at: run.ended, kind: "job", what: "ended", state: run.state, sub: run.kind, title: run.name, id: run.name, cost: run.cost, details: pairs(["took", took(run.started, run.ended)], ["model", run.model]) });
  }
  return out.filter((e) => Date.parse(e.at) >= since);
}

/** Per item file of the repo in the work store: the time of the commit that added it and of the last that changed it, from one `git log`. */
function itemTimes(key: string): Map<string, { added: number; changed: number }> {
  const out = new Map<string, { added: number; changed: number }>();
  const p = Bun.spawnSync(["git", "-C", storeDir(), "log", "origin/main", "--format=%ct", "--name-only", "--", `${key}/backlog/tasks`], { stdout: "pipe", stderr: "ignore" });
  if (p.exitCode !== 0) return out;
  let ct = 0;
  for (const line of p.stdout.toString().split("\n")) {
    if (!line) continue;
    if (/^\d+$/.test(line)) { ct = Number(line) * 1000; continue; }
    const t = out.get(line);
    if (t) t.added = ct; else out.set(line, { added: ct, changed: ct });
  }
  return out;
}

function issueEvents(project: string | null, since: number): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const repo of Object.values(loadRegistry())) {
    if (project && repo.key !== project) continue;
    let doc = null;
    try { doc = readList({ key: repo.key }); } catch {}
    const times = itemTimes(repo.key);
    for (const item of doc?.items ?? []) {
      const git = times.get(itemPath(repo.key, item.id));
      const base = { href: `#/issues/${enc(repo.key)}/${item.id}`, project: repo.key, title: item.title, id: `${repo.key}-${item.id}`, ...(git ? {} : { dateOnly: true }), kind: "issue" as const,
        details: pairs(["labels", (Array.isArray(item.fm.labels) ? item.fm.labels : []).join(",")], ["notes", item.notes.length || ""]) };
      const created = String(item.fm.created ?? ""), updated = String(item.fm.updated ?? "");
      const st = status(item);
      if (git) {
        out.push({ ...base, at: new Date(git.added).toISOString(), what: "opened", state: "open" });
        if (st !== "open") out.push({ ...base, at: new Date(git.changed).toISOString(), what: st === "done" ? "closed" : "dropped", state: st });
        continue;
      }
      if (created) out.push({ ...base, at: `${created.slice(0, 10)}T00:00:00`, what: "opened", state: "open" });
      if (st !== "open" && updated) out.push({ ...base, at: `${updated.slice(0, 10)}T00:00:00`, what: st === "done" ? "closed" : "dropped", state: st });
    }
  }
  return out.filter((e) => !Number.isNaN(Date.parse(e.at)) && new Date(e.at).getTime() >= since);
}

function commitEvents(project: string | null, since: number, landed: Map<string, string>, shas: Set<string>): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const repo of Object.values(loadRegistry())) {
    if ((project && repo.key !== project) || !existsSync(repo.path)) continue;
    const p = Bun.spawnSync(["git", "-C", repo.path, "log", `origin/${repo.main}`, `--since=${new Date(since).toISOString()}`, "--format=%ct%x09%h%x09%H%x09%s"], { stdout: "pipe", stderr: "ignore" });
    if (p.exitCode !== 0) continue;
    for (const line of p.stdout.toString().split("\n")) {
      const [ct, short, full, ...subject] = line.split("\t");
      if (!ct || !short) continue;
      const job = landed.get(full);
      shas.add(full);
      out.push({
        at: new Date(Number(ct) * 1000).toISOString(), kind: "land", what: "landed", state: "landed", title: subject.join("\t"), id: job ?? short,
        href: job ? `#/jobs/${enc(job)}` : `#/projects/${enc(repo.key)}`, project: repo.key, commit: short, details: pairs(["commit", short]),
      });
    }
  }
  return out;
}

async function sessionEvents(project: string | null, days: number): Promise<{ events: TimelineEvent[]; langfuse: Timeline["langfuse"] }> {
  const url = new URL(`http://x/api/sessions?days=${days}${project ? `&project=${enc(project)}` : ""}`);
  let res: Response;
  try { res = await (sessionRoutes["GET /api/sessions"](new Request(url), {}, url) as Promise<Response>); }
  catch { return { events: [], langfuse: "error" }; }
  if (!res.ok) {
    const off = ((await res.json().catch(() => ({}))) as any).error?.includes?.("not configured");
    return { events: [], langfuse: off ? "off" : "error" };
  }
  const body: any = await res.json();
  return {
    langfuse: "ok",
    events: (body.sessions ?? []).map((s: any): TimelineEvent => ({
      at: s.start, end: s.last, kind: "session", what: "started", title: s.firstPrompt || s.id, id: s.id, href: `#/sessions/${enc(s.id)}`, project: s.project, cost: s.cost,
      details: pairs(["turns", s.turns], ["kinds", (s.taskTypes ?? []).join(",")]),
    })),
  };
}

function noteEvents(project: string | null, since: number): TimelineEvent[] {
  const dir = join(vaultDir(), "daily");
  if (!existsSync(dir)) return [];
  const notes = project ? loadVault(vaultDir()) : [];
  const targets = linkTargets(notes);
  const out: TimelineEvent[] = [];
  for (const f of readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))) {
    for (const l of readFileSync(join(dir, f), "utf8").split("\n")) {
      const m = /^- (\d{2}:\d{2}) (.*)$/.exec(l);
      if (!m) continue;
      const at = new Date(`${f.slice(0, 10)}T${m[1]}:00`);
      if (Number.isNaN(at.getTime()) || at.getTime() < since) continue;
      const t = links(m[2])[0];
      if (project) {
        const hit = t ? targets.get(t.toLowerCase()) : undefined;
        if (!hit || String(hit.fm.scope ?? "") !== project) continue;
      }
      out.push({ at: at.toISOString(), kind: "note", what: "written", title: m[2], href: t ? `#/memory/${enc(t)}` : "#/memory" });
    }
  }
  return out;
}

/** Every event of the last 90 days, newest first. */
export async function events(project: string | null, now = new Date()): Promise<{ events: TimelineEvent[]; langfuse: Timeline["langfuse"] }> {
  const since = startOf(today(new Date(now.getFullYear(), now.getMonth(), now.getDate() - HORIZON_DAYS + 1, 12))).getTime();
  const landed = new Map<string, string>();
  for (const { run } of allRuns()) if (run.kind === "land" && run.commit) landed.set(run.commit, run.name);
  const s = await sessionEvents(project, HORIZON_DAYS);
  const shas = new Set<string>();
  const commits = commitEvents(project, since, landed, shas);
  const inGit = (sha: string) => [...shas].some((f) => f.startsWith(sha) || sha.startsWith(f));
  const all = [
    ...jobEvents(project, since, inGit), ...issueEvents(project, since), ...commits,
    ...s.events, ...noteEvents(project, since),
  ].filter((e) => dayOf(e.at) && Date.parse(e.at) >= since && Date.parse(e.at) <= now.getTime() + 60_000);
  all.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return { events: all, langfuse: s.langfuse };
}

/** The stream table's rows: a job is one row at its start, with its end, state and cost once it has ended. */
export function tableRows(all: TimelineEvent[]): TimelineEvent[] {
  const ended = new Map<string, TimelineEvent>();
  for (const e of all) if (e.kind === "job" && e.what === "ended") ended.set(e.title, e);
  return all.filter((e) => !(e.kind === "job" && e.what === "ended")).map((e) => {
    if (e.kind !== "job") return e;
    const x = ended.get(e.title);
    return x ? { ...e, end: x.at, state: x.state, cost: x.cost, details: x.details } : e;
  });
}

export async function timeline(opts: { before?: string | null; days?: number; project?: string | null; now?: Date }): Promise<Timeline> {
  const now = opts.now ?? new Date();
  const project = opts.project ?? null;
  const cut = opts.before ? Date.parse(opts.before) : now.getTime() + 1;
  const take = Math.max(1, Math.min(opts.days ?? 1, 30));
  const { events: all, langfuse } = await events(project, now);
  const older = all.filter((e) => Date.parse(e.at) < cut);
  const byDay = new Map<string, TimelineEvent[]>();
  for (const e of older) {
    const d = dayOf(e.at)!;
    if (byDay.size >= take && !byDay.has(d)) break;
    byDay.set(d, [...(byDay.get(d) ?? []), e]);
  }
  const days = [...byDay].map(([day, evs]) => ({ day, events: evs }));
  const last = days.at(-1);
  const rest = last ? older.some((e) => dayOf(e.at)! < last.day) : false;
  const out: Timeline = { days, next: last && rest ? startOf(last.day).toISOString() : null, langfuse };
  if (!opts.before) {
    out.rows = tableRows(all);
    out.now = now.toISOString();
    const from = startOf(today(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (STRIP_DAYS - 1), 12))).getTime();
    const bar = (e: TimelineEvent) => e.kind === "job" || e.kind === "session";
    out.strip = all.filter((e) => Date.parse(e.at) >= from && !(e.kind === "job" && e.what === "ended")).reverse().map((e) => ({
      kind: e.kind, start: e.at, end: bar(e) ? e.end ?? null : null, name: e.title, state: e.state, href: e.href, day: dayOf(e.at)!,
    }));
  }
  return out;
}

export const routes: Routes = {
  "GET /api/timeline": async (_req, _p, url) => {
    const before = url.searchParams.get("before");
    if (before && Number.isNaN(Date.parse(before))) return Response.json({ error: `bad before: ${before}` }, { status: 400 });
    return Response.json(await timeline({ before, days: Number(url.searchParams.get("days")) || 1, project: url.searchParams.get("project") || null }));
  },
};
