/**
 * `GET /api/timeline?before=<iso>&days=1&project=<key>`: the factory's events as one stream,
 * newest first. A page is the latest `days` local days, each with events, that end before
 * `before` (default now); `next` is the `before` for the page after it, null at the end.
 * The first page (no `before`) also carries `strip`: the items of the last 30 days for the swimlanes,
 * each with its kind and local day.
 * One event is one thing that happened at one time, with a verb in `what`. Sources: the ledger
 * (job runs, triage runs left out: the issue's own triaged row records them), the work store (issues
 * and their timestamped notes) and `git log` of the registry repos (lands). Sessions have their own page.
 */
import { existsSync } from "node:fs";
import { allRuns, loadRegistry } from "../../jobs/lib/ledger.ts";
import { itemPath, readList, storeDir } from "../../todo/lib/store.ts";
import { status, today } from "../../todo/lib/todo.ts";
import type { Routes } from "../server.ts";

export const KINDS = ["job", "land", "issue"] as const;
export type Kind = (typeof KINDS)[number];
const HORIZON_DAYS = 90, STRIP_DAYS = 30;

export interface TimelineEvent {
  at: string;
  kind: Kind;
  /** The verb: started, passed, held, landed, dropped, failed, stuck, opened, triaged, decided, closed. */
  what: string;
  /** A job's state, for its colour. */
  state?: string;
  title: string;
  /** A job's run kind (agent, land, plain, recheck); a land's "by hand" (Held-by: Chris) or "direct" (no job made it). */
  sub?: string;
  /** The job name or issue id: the Id column. */
  id?: string;
  href: string;
  project?: string;
  /** Only the day is known (an issue's created and updated dates). */
  dateOnly?: boolean;
  cost?: number;
  commit?: string;
  /** A bar's end: the end of the job a started row belongs to. */
  end?: string;
  /** The item's own fields as key/value pairs, less those the row repeats at top level (state, run, commit, job, message): the view puts them back. */
  details?: [string, string][];
}
export interface StripItem {
  kind: Kind;
  /** The local day the item starts on: where a click scrolls the stream. */
  day: string;
}
export interface Timeline {
  /** Later pages only: the first page leaves it out, the view reads its rows and strip. */
  days?: { day: string; events: TimelineEvent[] }[];
  next: string | null;
  strip?: StripItem[];
  /** The first page only: every row of the stream table, newest first: one row per event. */
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

/** The verb of a job's end row, by its state. */
const OUTCOME: Record<string, string> = { done: "passed", "needs-you": "held" };

/** The title of a repo's issue, or undefined. */
function issueTitle(repo: string | undefined, id: number | undefined, docs: Map<string, Map<number, string>>): string | undefined {
  if (!repo || !id) return undefined;
  if (!docs.has(repo)) {
    const m = new Map<number, string>();
    try { for (const i of readList({ key: repo })?.items ?? []) m.set(i.id, i.title); } catch {}
    docs.set(repo, m);
  }
  return docs.get(repo)!.get(id);
}

/** How a land came about: a held run Chris landed by hand, a commit no job made, or a plain factory run (none). */
const landSub = (job: boolean, held?: boolean) => (!job ? "direct" : held ? "by hand" : undefined);

function jobEvents(project: string | null, since: number, inGit: (sha: string) => boolean): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const docs = new Map<string, Map<number, string>>();
  for (const { run } of allRuns()) {
    if (project && run.repo !== project) continue;
    const href = `#/jobs/${enc(run.name)}`;
    const base = { href, project: run.repo };
    if (run.kind === "triage") continue;
    const isLand = run.kind === "land" && !!run.commit && run.state === "landed";
    if (isLand) {
      // A land that git log already shows is that commit's event.
      if (run.ended && !inGit(run.commit!)) out.push({ ...base, at: run.ended, kind: "land", what: "landed", state: "landed", sub: landSub(true, run.held), title: run.name, id: run.name, commit: run.commit, cost: run.cost, details: pairs(["model", run.model], ["took", took(run.started, run.ended)], ["branch", run.branch], ["folder", run.job]) });
      continue;
    }
    const title = issueTitle(run.repo, run.todo, docs) ?? run.name;
    const state = run.ended ? run.state : "running";
    out.push({ ...base, at: run.started, kind: "job", what: "started", state, sub: run.kind, title, id: run.name, end: run.ended || undefined, details: pairs(["reason", run.reason], ["model", run.model], ["branch", run.branch], ["folder", run.job]) });
    if (run.ended) out.push({ ...base, at: run.ended, kind: "job", what: OUTCOME[run.state] ?? run.state, state: run.state, sub: run.kind, title, id: run.name, cost: run.cost, details: pairs(["reason", run.reason], ["model", run.model], ["took", took(run.started, run.ended)], ["branch", run.branch], ["folder", run.job]) });
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

/** The first line of an issue's last note, without its leading "- ". */
const lastNote = (notes: string[]): string => (notes.at(-1) ?? "").split("\n")[0].replace(/^\s*-\s*/, "").trim();

function issueEvents(project: string | null, since: number): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const repo of Object.values(loadRegistry())) {
    if (project && repo.key !== project) continue;
    let doc = null;
    try { doc = readList({ key: repo.key }); } catch {}
    const times = itemTimes(repo.key);
    for (const item of doc?.items ?? []) {
      const git = times.get(itemPath(repo.key, item.id));
      const labels = Array.isArray(item.fm.labels) ? item.fm.labels.map(String) : [];
      const base = { href: `#/issues/${enc(repo.key)}/${item.id}`, project: repo.key, title: item.title, id: `${repo.key}-${item.id}`, ...(git ? {} : { dateOnly: true }), kind: "issue" as const,
        details: pairs(["status", status(item)], ["labels", labels.join(",")], ["waiting on", item.fm.waiting_on], ["notes", item.notes.length || ""], ["last note", lastNote(item.notes)]) };
      const created = String(item.fm.created ?? ""), updated = String(item.fm.updated ?? "");
      const st = status(item);
      // A 'triage: …' note is a triage, a 'Chris decided: …' or 'Claude decided: …' note a decision, at the note's time.
      for (const line of item.notes) {
        const m = /^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}): (triage:|(?:Chris|Claude) decided:)/.exec(line.trim());
        if (m) out.push({ ...base, at: new Date(`${m[1]}T${m[2]}:00`).toISOString(), what: m[3] === "triage:" ? "triaged" : "decided", state: st, dateOnly: undefined });
      }
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

function commitEvents(project: string | null, since: number, landed: Map<string, string>, held: Set<string>, shas: Set<string>): TimelineEvent[] {
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
        at: new Date(Number(ct) * 1000).toISOString(), kind: "land", what: "landed", state: "landed", sub: landSub(!!job, held.has(full)), title: subject.join("\t"), id: job ?? short,
        href: job ? `#/jobs/${enc(job)}` : `#/projects/${enc(repo.key)}`, project: repo.key, commit: short, details: [],
      });
    }
  }
  return out;
}

/** Every event of the last 90 days, newest first. */
export async function events(project: string | null, now = new Date()): Promise<TimelineEvent[]> {
  const since = startOf(today(new Date(now.getFullYear(), now.getMonth(), now.getDate() - HORIZON_DAYS + 1, 12))).getTime();
  const landed = new Map<string, string>();
  const held = new Set<string>();
  for (const { run } of allRuns()) if (run.kind === "land" && run.commit) { landed.set(run.commit, run.name); if (run.held) held.add(run.commit); }
  const shas = new Set<string>();
  const commits = commitEvents(project, since, landed, held, shas);
  const inGit = (sha: string) => [...shas].some((f) => f.startsWith(sha) || sha.startsWith(f));
  const all = [...jobEvents(project, since, inGit), ...issueEvents(project, since), ...commits].filter((e) => dayOf(e.at) && Date.parse(e.at) >= since && Date.parse(e.at) <= now.getTime() + 60_000);
  all.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return all;
}

export async function timeline(opts: { before?: string | null; days?: number; project?: string | null; now?: Date }): Promise<Timeline> {
  const now = opts.now ?? new Date();
  const project = opts.project ?? null;
  const cut = opts.before ? Date.parse(opts.before) : now.getTime() + 1;
  const take = Math.max(1, Math.min(opts.days ?? 1, 30));
  const all = await events(project, now);
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
  const out: Timeline = { next: last && rest ? startOf(last.day).toISOString() : null };
  if (opts.before) out.days = days;
  else {
    out.rows = all;
    out.now = now.toISOString();
    const from = startOf(today(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (STRIP_DAYS - 1), 12))).getTime();
    out.strip = all.filter((e) => Date.parse(e.at) >= from && (e.kind !== "job" || e.what === "started")).reverse().map((e) => ({ kind: e.kind, day: dayOf(e.at)! }));
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
