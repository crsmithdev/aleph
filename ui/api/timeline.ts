/**
 * `GET /api/timeline?from=<day>&to=<day>&before=<iso>&days=1&project=<key>`: the factory's events as one stream,
 * newest first. Only events on the local days `from` to `to` (default: the last 7 days, today included) are loaded.
 * Events of one issue that end its work in sequence (a job's pass or drop, the land, the issue's close, each
 * less than 10 minutes after the one before) are one row. A page is the latest `days` local days, each with events, that end before
 * `before` (default now); `next` is the `before` for the page after it, null at the end.
 * The first page (no `before`) also carries `strip`: the items of the range for the swimlanes,
 * each with its kind and local day, and `counts`: the rows of the range, in all and per kind.
 * One event is one thing that happened at one time, with a verb in `what`. Sources: the ledger
 * (job runs, triage runs left out: the issue's own triaged row records them), the work store (issues
 * and their timestamped notes) and `git log` of the registry repos (lands). Sessions have their own page.
 */
import { existsSync } from "node:fs";
import { allRuns, loadRegistry } from "../../jobs/lib/ledger.ts";
import { itemTimes, labels, reader } from "../../todo/lib/store.ts";
import { status, today } from "../../todo/lib/todo.ts";
import type { Routes } from "../server.ts";

export const KINDS = ["job", "land", "issue"] as const;
export type Kind = (typeof KINDS)[number];
const DEFAULT_DAYS = 7, MERGE_GAP_MS = 10 * 60_000;

export interface TimelineEvent {
  at: string;
  kind: Kind;
  /** The verb: started, passed, held, landed, dropped, failed, stuck, opened, triaged, decided, closed. */
  what: string;
  /** A job's state, for its colour. */
  state?: string;
  title: string;
  /** A job's run kind (agent, land, plain, recheck); a land's "by hand" (Held-by: Chris) or "by firefighter" or "direct" (no job made it). */
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
  /** The issue the event belongs to (its page address), for grouping. */
  issue?: string;
  /** A merged row only: every kind it holds (the kind filter counts it under each), its steps' verbs in order, and the events themselves, oldest first. */
  kinds?: Kind[];
  trail?: string[];
  steps?: TimelineEvent[];
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
  /** The first page only: the rows of the range, in all and per kind (a merged row counts under each kind it holds). */
  counts?: Record<"all" | Kind, number>;
  /** The first page only: the local days the page shows, `from` to `to`. */
  range?: { from: string; to: string };
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

/** How a land came about: a held run Chris landed by hand, a commit no job made, or a plain factory run (none). */
const landSub = (job: boolean, heldBy?: string) => (!job ? "direct" : heldBy === "firefighter" ? "by firefighter" : heldBy ? "by hand" : undefined);

function jobEvents(project: string | null, since: number, inGit: (sha: string) => boolean): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const lists = reader();
  for (const { run } of allRuns()) {
    if (project && run.repo !== project) continue;
    const href = `#/jobs/${enc(run.name)}`;
    const base = { href, project: run.repo, ...(run.repo && run.todo ? { issue: `#/issues/${enc(run.repo)}/${run.todo}` } : {}) };
    if (run.kind === "triage") continue;
    const isLand = run.kind === "land" && !!run.commit && run.state === "landed";
    if (isLand) {
      // A land that git log already shows is that commit's event.
      if (run.ended && !inGit(run.commit!)) out.push({ ...base, at: run.ended, kind: "land", what: "landed", state: "landed", sub: landSub(true, run.held ? (run.lander ?? "Chris") : undefined), title: run.name, id: run.name, commit: run.commit, cost: run.cost, details: pairs(["model", run.model], ["took", took(run.started, run.ended)], ["branch", run.branch], ["folder", run.job]) });
      continue;
    }
    const title = (run.repo && run.todo ? lists.item(run.repo, run.todo)?.title : undefined) ?? run.name;
    const state = run.ended ? run.state : "running";
    out.push({ ...base, at: run.started, kind: "job", what: "started", state, sub: run.kind, title, id: run.name, end: run.ended || undefined, details: pairs(["reason", run.reason], ["model", run.model], ["branch", run.branch], ["folder", run.job]) });
    if (run.ended) out.push({ ...base, at: run.ended, kind: "job", what: OUTCOME[run.state] ?? run.state, state: run.state, sub: run.kind, title, id: run.name, cost: run.cost, details: pairs(["reason", run.reason], ["model", run.model], ["took", took(run.started, run.ended)], ["branch", run.branch], ["folder", run.job]) });
  }
  return out.filter((e) => Date.parse(e.at) >= since);
}

/** The first line of an issue's last note, without its leading "- ". */
const lastNote = (notes: string[]): string => (notes.at(-1) ?? "").split("\n")[0].replace(/^\s*-\s*/, "").trim();

function issueEvents(project: string | null, since: number): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const times = itemTimes();
  const lists = reader();
  for (const repo of Object.values(loadRegistry())) {
    if (project && repo.key !== project) continue;
    for (const item of lists.list(repo.key)?.items ?? []) {
      const git = times.get(`${repo.key}-${item.id}`);
      const base = { href: `#/issues/${enc(repo.key)}/${item.id}`, issue: `#/issues/${enc(repo.key)}/${item.id}`, project: repo.key, title: item.title, id: `${repo.key}-${item.id}`, ...(git ? {} : { dateOnly: true }), kind: "issue" as const,
        details: pairs(["status", status(item)], ["labels", labels(item).join(",")], ["waiting on", item.fm.waiting_on], ["notes", item.notes.length || ""], ["last note", lastNote(item.notes)]) };
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

function commitEvents(project: string | null, since: number, landed: Map<string, { name: string; issue?: string }>, held: Map<string, string>, shas: Set<string>): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const repo of Object.values(loadRegistry())) {
    if ((project && repo.key !== project) || !existsSync(repo.path)) continue;
    const p = Bun.spawnSync(["git", "-C", repo.path, "log", `origin/${repo.main}`, `--since=${new Date(since).toISOString()}`, "--format=%ct%x09%h%x09%H%x09%s"], { stdout: "pipe", stderr: "ignore" });
    if (p.exitCode !== 0) continue;
    for (const line of p.stdout.toString().split("\n")) {
      const [ct, short, full, ...subject] = line.split("\t");
      if (!ct || !short) continue;
      const run = landed.get(full), job = run?.name;
      shas.add(full);
      out.push({
        at: new Date(Number(ct) * 1000).toISOString(), kind: "land", what: "landed", state: "landed", sub: landSub(!!job, held.get(full)), title: subject.join("\t"), id: job ?? short,
        href: job ? `#/jobs/${enc(job)}` : `#/projects/${enc(repo.key)}`, project: repo.key, commit: short, details: [], ...(run?.issue ? { issue: run.issue } : {}),
      });
    }
  }
  return out;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (day: string, n: number) => today(new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8)) + n, 12));

/** The local days a request asks for: `from` to `to`, by default the last 7 days. Null when a day is not a date or `from` is after `to`. */
export function rangeOf(from: string | null | undefined, to: string | null | undefined, now = new Date()): { from: string; to: string } | null {
  const last = to || today(now), first = from || addDays(last, -(DEFAULT_DAYS - 1));
  const ok = (d: string) => DAY_RE.test(d) && !Number.isNaN(startOf(d).getTime());
  return ok(first) && ok(last) && first <= last ? { from: first, to: last } : null;
}

const isStep = (e: TimelineEvent) => (e.kind === "job" && e.sub === "land") || e.kind === "land" || (e.kind === "issue" && (e.what === "closed" || e.what === "dropped"));
const isEnd = (e: TimelineEvent) => e.kind === "job" && e.sub !== "land" && (e.what === "passed" || e.what === "dropped");

/** One row for a chain of one issue's events: the issue's own row if it has one (the close), at the time of the last event, with the steps as a trail. */
function mergeChain(chain: TimelineEvent[]): TimelineEvent {
  const last = chain.at(-1)!;
  const issue = chain.findLast((e) => e.kind === "issue") ?? last;
  const cost = chain.reduce((n, e) => n + (e.cost ?? 0), 0);
  const commit = chain.findLast((e) => e.commit)?.commit;
  const kinds = KINDS.filter((k) => chain.some((e) => e.kind === k));
  return { ...issue, at: last.at, what: last.what, state: last.state, kinds, trail: chain.map((e) => e.what), commit, ...(cost ? { cost } : {}), dateOnly: undefined, steps: chain };
}

/** Events of one issue less than 10 minutes apart, from a job's pass or drop up to the issue's close, become one row. Starts, triage and opens stay alone. */
export function mergeEvents(all: TimelineEvent[]): TimelineEvent[] {
  const byIssue = new Map<string, TimelineEvent[]>();
  const out: TimelineEvent[] = [];
  for (const e of [...all].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    if (!e.issue) out.push(e); else byIssue.set(e.issue, [...(byIssue.get(e.issue) ?? []), e]);
  }
  for (const evs of byIssue.values()) {
    let chain: TimelineEvent[] = [];
    const flush = () => { if (chain.length > 1) out.push(mergeChain(chain)); else out.push(...chain); chain = []; };
    for (const e of evs) {
      if (chain.length && isStep(e) && Date.parse(e.at) - Date.parse(chain.at(-1)!.at) < MERGE_GAP_MS && !(chain.at(-1)!.kind === "issue")) { chain.push(e); continue; }
      flush();
      if (isEnd(e)) chain = [e]; else out.push(e);
    }
    flush();
  }
  out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return out;
}

/** Every event on the days `range` names (default: the last 7), newest first, one issue's closing sequence as one row. `raw` keeps the events apart, for the strip. */
export async function events(project: string | null, now = new Date(), range = rangeOf(null, null, now)!, raw?: TimelineEvent[]): Promise<TimelineEvent[]> {
  // A day more before the range, so a sequence that starts the evening before still merges.
  const since = startOf(addDays(range.from, -1)).getTime(), lo = startOf(range.from).getTime(), hi = startOf(addDays(range.to, 1)).getTime();
  const landed = new Map<string, { name: string; issue?: string }>();
  const held = new Map<string, string>();
  for (const { run } of allRuns()) if (run.kind === "land" && run.commit) { landed.set(run.commit, { name: run.name, issue: run.repo && run.todo ? `#/issues/${enc(run.repo)}/${run.todo}` : undefined }); if (run.held) held.set(run.commit, run.lander ?? "Chris"); }
  const shas = new Set<string>();
  const commits = commitEvents(project, since, landed, held, shas);
  const inGit = (sha: string) => [...shas].some((f) => f.startsWith(sha) || sha.startsWith(f));
  const all = [...jobEvents(project, since, inGit), ...issueEvents(project, since), ...commits].filter((e) => dayOf(e.at) && Date.parse(e.at) <= now.getTime() + 60_000);
  const within = (e: TimelineEvent) => Date.parse(e.at) >= lo && Date.parse(e.at) < hi;
  raw?.push(...all.filter(within));
  return mergeEvents(all).filter(within);
}

export async function timeline(opts: { before?: string | null; days?: number; project?: string | null; from?: string | null; to?: string | null; now?: Date }): Promise<Timeline> {
  const now = opts.now ?? new Date();
  const project = opts.project ?? null;
  const range = rangeOf(opts.from, opts.to, now) ?? rangeOf(null, null, now)!;
  const cut = opts.before ? Date.parse(opts.before) : now.getTime() + 1;
  const take = Math.max(1, Math.min(opts.days ?? 1, 30));
  const raw: TimelineEvent[] = [];
  const all = await events(project, now, range, raw);
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
    out.range = range;
    out.counts = { all: all.length, ...Object.fromEntries(KINDS.map((k) => [k, all.filter((e) => (e.kinds ?? [e.kind]).includes(k)).length])) } as Timeline["counts"];
    out.strip = raw.filter((e) => e.kind !== "job" || e.what === "started").sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).map((e) => ({ kind: e.kind, day: dayOf(e.at)! }));
  }
  return out;
}

export const routes: Routes = {
  "GET /api/timeline": async (_req, _p, url) => {
    const before = url.searchParams.get("before");
    if (before && Number.isNaN(Date.parse(before))) return Response.json({ error: `bad before: ${before}` }, { status: 400 });
    const from = url.searchParams.get("from"), to = url.searchParams.get("to");
    if ((from || to) && !rangeOf(from, to)) return Response.json({ error: `bad range: ${from ?? ""}..${to ?? ""}` }, { status: 400 });
    return Response.json(await timeline({ before, from, to, days: Number(url.searchParams.get("days")) || 1, project: url.searchParams.get("project") || null }));
  },
};
