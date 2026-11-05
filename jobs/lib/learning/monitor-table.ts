/**
 * The monitor's table: what the factory did on one day, against the trailing 7 days, from the data that exists
 * (the ledger, the holds and spec-check files, the flake list, the work store's items and git history, and the
 * usage file). It reads and never writes. monitor.ts runs the reader agent on it and keeps the report; aleph-ui
 * loads this module for the Status panel, so it imports no transition and no agent call.
 *
 * Each value is measured over local days. A count in the trailing column is the mean per day; a ratio, a rate and
 * a median are pooled over the 7 days.
 */
import * as record from "../records/record.ts";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { allRuns, expand, loadRegistry, type Entry } from "../records/ledger.ts";
import { allHolds, flakeNames, flakes, stopsStart, type Flake, type HoldRecord } from "../gates/factory-status.ts";
import { layout } from "../infra/layout.ts";
import { git } from "../infra/git.ts";
import { causeOf } from "../records/outcome.ts";
import { usageFileSetting } from "../infra/settings.ts";
import { flakeTracker, reader, storeDir, type Reader } from "../../../issues/lib/store.ts";
import * as issues from "../../../issues/lib/todo.ts";

const DAY = 24 * 3600_000;

/**
 * One change of one item file in one store commit. Only the lines the table reads are kept: the `reason:` and
 * `closed_as:` front matter.
 */
export interface StoreChange { at: string; item: string; added: string[]; removed: string[] }

/** Everything the table reads. readSources fills it from disk; a test gives its own. */
export interface Sources {
  runs: Entry[];
  holds: HoldRecord[];
  specChecks: { at: string; name: string; cost: number }[];
  /** The items of the factory repos, each with its `<repo>-<ref>` name. */
  items: { name: string; item: issues.Issue }[];
  storeLog: StoreChange[];
  flakes: Flake[];
  /** Each factory repo's open flake tracker. */
  trackers: { ref: string; notes: string[] }[];
  usage: { at: string; seven_day?: number }[];
}

export interface StageRow {
  stage: string;
  runs: number;
  /** Distinct items the runs were on. */
  items: number;
  /** Runs that ended with no usable result; null when the data does not say. */
  unusable: number | null;
  /** Dollars at the API price; null when no run of the stage records a cost. */
  cost: number | null;
  /** The median minutes from start to end; null when no run records both. */
  minutes: number | null;
}

export interface HoldRow { kind: string; records: number; goals: number; hours: number }

export interface Window {
  from: string; to: string;
  stages: StageRow[];
  asks: Record<string, number>;
  holds: HoldRow[];
  /** Goals with a hold record of a kind that stops a start, of all goals with a record. */
  held: { goals: number; seen: number };
  reopens: number;
  /** The seven-day usage, in percent, at the end of the window. */
  quota: number | null;
}

export interface FlakeSection {
  /** `<repo> <test|check> <name>` and its reruns in 7 days, two or more, most first, at most 5. */
  reruns: { key: string; n: number }[];
  /** Each tracker with notes in 7 days. */
  trackers: { ref: string; notes: number; files: number }[];
}

export interface Table {
  day: string;
  made: string;
  today: Window;
  trailing: Window;
  flakes: FlakeSection;
}

/** The metrics the design names that no recorded data gives; the table says so. */
export const LEFT_OUT = [
  "cost of the reviewer: a build run records only its worker's cost",
  "spec checks (before intake) with no usable result, and their time: the job record keeps only the cost",
  "time in each state of an item after its start (awaiting, answered): no record keeps those changes with their times",
  "usage per agent: usage.jsonl is the account's quota, not per run",
];

/** The table's stage order; a stage with no run is left out. */
const STAGES = ["intake", "triage", "plan", "spec-check", "build", "review", "recheck", "land", "facts", "explain", "firefighter", "director", "monitor"];

/** Local midnight of `day` (YYYY-MM-DD), in ms. */
export const dayStart = (day: string): number => new Date(`${day}T00:00:00`).getTime();

/** The local date `n` days after `day`. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return issues.today(d);
}


const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), k = Math.floor(s.length / 2);
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};

const inside = (iso: string | undefined, from: number, to: number): boolean => {
  const t = Date.parse(iso ?? "");
  return t >= from && t < to;
};

/** A run that ended with nothing the line can use: it failed, got stuck or was dropped, or it states a cause. */
function unusable(e: Entry): boolean {
  const r = e.run;
  return r.condition === "failed" || r.condition === "stuck" || r.condition === "dropped" || causeOf(r) !== undefined;
}

function stageRows(src: Sources, from: number, to: number): StageRow[] {
  const by = new Map<string, { runs: number; items: Set<string>; unusable: number | null; cost: number | null; minutes: number[] }>();
  const row = (stage: string, known: boolean) => {
    if (!by.has(stage)) by.set(stage, { runs: 0, items: new Set(), unusable: known ? 0 : null, cost: null, minutes: [] });
    return by.get(stage)!;
  };
  for (const e of src.runs) {
    const r = e.run;
    if (r.kind === "plain" || r.kind === "agent" || r.condition === "running" || !inside(r.started, from, to)) continue;
    const s = row(r.kind, true);
    s.runs++;
    // A run on no item (a firefighter sweep) is its own item.
    s.items.add(r.on ?? r.job);
    if (unusable(e)) s.unusable!++;
    if (typeof r.cost === "number") s.cost = (s.cost ?? 0) + r.cost;
    const took = Date.parse(r.ended ?? "") - Date.parse(r.started);
    if (took >= 0) s.minutes.push(took / 60_000);
    // The reviewer of a build: its call is on the build's state. `error` means it ended with no verdict.
    if (r.kind === "build" && r.review && r.review.call !== "pending") {
      const v = row("review", true);
      v.runs++;
      v.items.add(r.on ?? r.name);
      if (r.review.call === "error") v.unusable!++;
    }
  }
  for (const c of src.specChecks) {
    if (!inside(c.at, from, to)) continue;
    const s = row("spec-check", false);
    s.runs++;
    s.items.add(c.name);
    s.cost = (s.cost ?? 0) + c.cost;
  }
  return STAGES.filter((k) => by.has(k)).map((stage) => {
    const s = by.get(stage)!;
    return { stage, runs: s.runs, items: s.items.size, unusable: s.unusable, cost: s.cost, minutes: median(s.minutes) };
  });
}

function holdRows(holds: HoldRecord[], from: number, to: number): { rows: HoldRow[]; held: Window["held"] } {
  const byName = new Map<string, HoldRecord[]>();
  for (const h of holds) byName.set(h.name, [...(byName.get(h.name) ?? []), h]);
  const rows = new Map<string, { records: number; goals: Set<string>; ms: number }>();
  const seen = new Set<string>(), held = new Set<string>();
  const row = (k: string) => { if (!rows.has(k)) rows.set(k, { records: 0, goals: new Set(), ms: 0 }); return rows.get(k)!; };
  for (const [name, list] of byName) {
    list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    list.forEach((h, i) => {
      const at = Date.parse(h.at);
      if (at >= from && at < to) {
        const r = row(h.kind);
        r.records++;
        r.goals.add(name);
        seen.add(name);
        if (stopsStart(h)) held.add(name);
      }
      // A state lasts until the goal's next record; the last record of a goal has no known end and counts no time.
      const next = list[i + 1];
      if (!next) return;
      const ms = Math.min(Date.parse(next.at), to) - Math.max(at, from);
      if (ms > 0) row(h.kind).ms += ms;
    });
  }
  return {
    rows: [...rows].filter(([, r]) => r.records || r.ms).sort((a, b) => b[1].records - a[1].records)
      .map(([kind, r]) => ({ kind, records: r.records, goals: r.goals.size, hours: r.ms / 3600_000 })),
    held: { goals: held.size, seen: seen.size },
  };
}

function asksOf(src: Sources, from: number, to: number): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (k: string) => { out[k] = (out[k] ?? 0) + 1; };
  for (const c of src.storeLog) {
    if (!inside(c.at, from, to)) continue;
    for (const l of c.added) { const m = /^reason: (.+)$/.exec(l); if (m) add(m[1].trim()); }
  }
  for (const { run } of src.runs) if (run.ask && inside(run.ended ?? run.started, from, to)) add(run.ask.reason);
  return out;
}

function reopensOf(src: Sources, from: number, to: number): number {
  return src.storeLog.filter((c) => inside(c.at, from, to)
    && c.removed.some((l) => l.startsWith("closed_as:")) && !c.added.some((l) => l.startsWith("closed_as:"))).length;
}

function quotaAt(usage: Sources["usage"], to: number): number | null {
  let best: { at: number; v: number } | null = null;
  for (const u of usage) {
    const at = Date.parse(u.at);
    if (typeof u.seven_day !== "number" || !(at < to) || to - at > DAY) continue;
    if (!best || at > best.at) best = { at, v: u.seven_day };
  }
  return best?.v ?? null;
}

export function windowOf(src: Sources, from: number, to: number): Window {
  const h = holdRows(src.holds, from, to);
  return {
    from: new Date(from).toISOString(), to: new Date(to).toISOString(),
    stages: stageRows(src, from, to),
    asks: asksOf(src, from, to),
    holds: h.rows, held: h.held,
    reopens: reopensOf(src, from, to),
    quota: quotaAt(src.usage, to),
  };
}

/** The flake counts of the 7 days before `now`: the reruns on flaky.json and each tracker's notes. */
export function flakeSection(rows: Flake[], trackers: Sources["trackers"], now: number): FlakeSection {
  const counts = new Map<string, number>();
  for (const f of rows) {
    if (!(now - Date.parse(f.at) < 7 * DAY)) continue;
    for (const { kind, name } of flakeNames(f)) {
      const k = `${f.repo} ${kind} ${name}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const reruns = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key, n]) => ({ key, n }));
  const out: FlakeSection = { reruns, trackers: [] };
  for (const t of trackers) {
    const files = new Set<string>();
    let k = 0;
    for (const line of t.notes) {
      const m = /^- (\d{4}-\d\d-\d\d) (\d\d:\d\d): (.*)$/.exec(line);
      if (!m) continue;
      const at = Date.parse(`${m[1]}T${m[2]}`);
      if (!(now - at < 7 * DAY)) continue;
      k++;
      const cut = m[3].indexOf(" > ");
      // The caller's prefix ("job x: ", "firefighter: ") is not part of the file name.
      if (cut >= 0) files.add(m[3].slice(0, cut).split(": ").at(-1)!.trim());
    }
    if (k) out.trackers.push({ ref: t.ref, notes: k, files: files.size });
  }
  return out;
}

/** The health lines of a flake section, as `aleph report` prints them. */
export function flakeHealth(f: FlakeSection): string[] {
  return [
    ...f.reruns.map((r) => `health: ${r.key} passed on rerun ${r.n} times in 7 days`),
    ...f.trackers.map((t) => `health: ${t.ref} holds ${t.notes} flake notes in 7 days, ${t.files} test files`),
  ];
}

const factoryKeys = (): string[] => Object.values(loadRegistry()).filter((r) => r.sandbox).map((r) => r.key);

/** Each factory repo's open flake tracker, read from `lists`. */
export function trackersOf(lists: Reader, keys = factoryKeys()): Sources["trackers"] {
  return keys.flatMap((key) => {
    const doc = lists.list(key);
    const t = doc && flakeTracker(doc);
    return t ? [{ ref: `${key}-${t.id}`, notes: t.notes }] : [];
  });
}

/** The flake lines of `aleph report`, read now. */
export const flakeLines = (now = Date.now(), lists: Reader = reader()): string[] => flakeHealth(flakeSection(flakes(), trackersOf(lists), now));

/** The changes of the store's item files, from its git history. */
export function storeLog(dir = storeDir()): StoreChange[] {
  if (!existsSync(dir)) return [];
  const rev = git(dir, "rev-parse", "--verify", "-q", "origin/main").ok ? "origin/main" : "HEAD";
  const r = git(dir, "log", rev, "--format=%x01%cI", "-p", "--unified=0", "--no-color", "--no-renames", "--", "*.md");
  if (!r.ok) return [];
  const out: StoreChange[] = [];
  let at = "", cur: StoreChange | null = null;
  for (const line of r.out.split("\n")) {
    if (line.startsWith("\x01")) { at = new Date(line.slice(1)).toISOString(); cur = null; continue; }
    const f = /^diff --git a\/\S+ b\/(\S+)$/.exec(line);
    if (f) { cur = { at, item: f[1].split("/").at(-1)!.replace(/\.md$/, ""), added: [], removed: [] }; out.push(cur); continue; }
    if (!cur || line.startsWith("+++") || line.startsWith("---")) continue;
    const m = /^([+-])((?:reason|closed_as): .*)$/.exec(line);
    if (m) (m[1] === "+" ? cur.added : cur.removed).push(m[2]);
  }
  return out.filter((c) => c.added.length || c.removed.length);
}

function readJsonl<T>(file: string): T[] {
  let raw: string;
  try { raw = readFileSync(file, "utf8"); } catch { return []; }
  return raw.split("\n").flatMap((l) => { if (!l.trim()) return []; try { return [JSON.parse(l) as T]; } catch { return []; } });
}

/** The sources from disk. It fetches nothing and writes nothing. */
export function readSources(): Sources {
  const keys = factoryKeys(), set = new Set(keys);
  const lists = reader({ fetch: false });
  const items = keys.flatMap((key) => (lists.list(key)?.items ?? []).map((item) => ({ name: `${key}-${issues.refOf(item)}`, item })));
  const records = record.all();
  return {
    // Runs of other repos are not the factory's; a run with no repo (explain, firefighter, director, monitor) is.
    runs: allRuns().filter((e) => !e.run.repo || set.has(e.run.repo)),
    holds: allHolds(),
    // Spec checks ran before intake; their cost is a `spec-check` event in the job record.
    specChecks: records.flatMap((r) => r.events.filter((e) => e.kind === "spec-check").map((e) => ({ at: e.at, name: r.issue, cost: (e.data as { cost: number }).cost }))),
    items,
    storeLog: storeLog(),
    flakes: flakes(),
    trackers: trackersOf(lists, keys),
    usage: readJsonl(expand(usageFileSetting())),
  };
}

/** The table of local day `day` and the 7 days before it. `now` bounds the flake counts: the end of the day, or now when the day is today. */
export function measure(src: Sources, day: string, now = Date.now()): Table {
  const from = dayStart(day), to = dayStart(addDays(day, 1)), back = dayStart(addDays(day, -7));
  return {
    day, made: new Date(now).toISOString(),
    today: windowOf(src, from, to),
    trailing: windowOf(src, back, from),
    flakes: flakeSection(src.flakes, src.trackers, Math.min(now, to)),
  };
}

// ---------------------------------------------------------------- the text

const pct = (n: number, of: number): string => (of ? `${Math.round((100 * n) / of)}%` : "-");
const num = (n: number | null, digits = 1): string => (n === null ? "-" : Number.isInteger(n) ? String(n) : n.toFixed(digits));
const money = (n: number | null): string => (n === null ? "-" : `$${n.toFixed(2)}`);
/** A cell: the day's value, then the trailing value in brackets. */
const cell = (a: string, b: string) => `${a} (${b})`;

/** The table as Markdown: what the reader reads, the vault note holds and the Status panel shows. */
export function renderTable(t: Table): string {
  const d = t.today, w = t.trailing, per = (n: number) => num(n / 7);
  const out: string[] = [`# Factory monitor ${t.day}`, "", `Each cell: the day (the trailing 7 days: a count is the mean per day; a ratio, rate or median is pooled).`, ""];
  out.push("## Stages", "", "| stage | runs | runs per item | no usable result | cost | cost per item | median minutes |", "|---|---|---|---|---|---|---|");
  for (const stage of STAGES) {
    const a = d.stages.find((s) => s.stage === stage), b = w.stages.find((s) => s.stage === stage);
    if (!a && !b) continue;
    const z: StageRow = { stage, runs: 0, items: 0, unusable: null, cost: null, minutes: null };
    const x = a ?? z, y = b ?? z;
    const rate = (s: StageRow) => (s.unusable === null ? "-" : pct(s.unusable, s.runs));
    out.push(`| ${stage} | ${cell(String(x.runs), per(y.runs))} | ${cell(x.items ? num(x.runs / x.items) : "-", y.items ? num(y.runs / y.items) : "-")} | ${x.unusable === null ? "-" : `${x.unusable}, ${cell(rate(x), rate(y))}`} | ${cell(money(x.cost), y.cost === null ? "-" : money(y.cost / 7))} | ${cell(x.cost !== null && x.items ? money(x.cost / x.items) : "-", y.cost !== null && y.items ? money(y.cost / y.items) : "-")} | ${cell(num(x.minutes), num(y.minutes))} |`);
  }
  out.push("", "## Asks by reason", "", "| reason | Asks |", "|---|---|");
  const reasons = [...new Set([...Object.keys(d.asks), ...Object.keys(w.asks)])].sort((a, b) => (d.asks[b] ?? 0) - (d.asks[a] ?? 0) || (w.asks[b] ?? 0) - (w.asks[a] ?? 0));
  for (const r of reasons) out.push(`| ${r} | ${cell(String(d.asks[r] ?? 0), per(w.asks[r] ?? 0))} |`);
  if (!reasons.length) out.push("| none | 0 (0) |");
  out.push("", "## Holds", "");
  out.push(`- Goals held at least once: ${cell(`${d.held.goals} of ${d.held.seen} (${pct(d.held.goals, d.held.seen)})`, `${pct(w.held.goals, w.held.seen)}`)}`);
  out.push(`- Reopens: ${cell(String(d.reopens), per(w.reopens))}`);
  out.push(`- Seven-day quota used at the end of the day: ${d.quota === null ? "-" : `${d.quota}%`} (${w.quota === null ? "-" : `${w.quota}% a week before`})`);
  out.push("", "| hold record kind | records | goals | hours in the state |", "|---|---|---|---|");
  const kinds = [...new Set([...d.holds.map((h) => h.kind), ...w.holds.map((h) => h.kind)])];
  for (const k of kinds) {
    const a = d.holds.find((h) => h.kind === k) ?? { records: 0, goals: 0, hours: 0 }, b = w.holds.find((h) => h.kind === k) ?? { records: 0, goals: 0, hours: 0 };
    out.push(`| ${k} | ${cell(String(a.records), per(b.records))} | ${cell(String(a.goals), per(b.goals))} | ${cell(num(a.hours), per(b.hours))} |`);
  }
  out.push("", "## Flakes in the 7 days to the end of the day", "");
  const f = flakeHealth(t.flakes).map((l) => `- ${l.replace(/^health: /, "")}`);
  out.push(...(f.length ? f : ["- none"]));
  out.push("", "## Not measured", "", ...LEFT_OUT.map((l) => `- ${l}`));
  return out.join("\n") + "\n";
}

// ---------------------------------------------------------------- the report on disk

export const monitorDir = () => join(layout().factory, "monitor");

/** One day's report: the table, and the reader's ranked findings or why there are none. */
export interface Report {
  day: string;
  table: Table;
  /** The reader's reply, trimmed. */
  text?: string;
  /** The numbered lines of the reply, in rank order, without their numbers. */
  findings: string[];
  error?: string;
  /** The reader's run folder. */
  run?: string;
  /** The vault note's title, or why it was not written. */
  note?: string;
  noteError?: string;
}

export const reportFile = (day: string) => join(monitorDir(), `${day}.json`);

/** The newest report on disk, or null. */
export function latestReport(): Report | null {
  let names: string[];
  try { names = readdirSync(monitorDir()).filter((n) => /^\d{4}-\d\d-\d\d\.json$/.test(n)).sort(); } catch { return null; }
  for (const n of names.reverse()) {
    try { return JSON.parse(readFileSync(join(monitorDir(), n), "utf8")) as Report; } catch {}
  }
  return null;
}

/** A value of the day and the same value over the trailing 7 days; null when the data does not say. */
export interface Pair { day: number | null; trailing: number | null }

/** What the Status panel shows of the newest report. Rates are fractions; a count in the trailing value is the mean per day. */
export function monitorPanel(): {
  day: string; findings: string[]; error?: string;
  stages: { stage: string; costPerItem: Pair; runsPerItem: Pair; unusable: Pair }[];
  holds: { kind: string; goals: Pair; hours: Pair }[];
} | null {
  const r = latestReport();
  if (!r) return null;
  const d = r.table.today, w = r.table.trailing;
  const ratio = (a: number | null, b: number) => (a !== null && b ? a / b : null);
  const stage = (s: StageRow | undefined) => ({
    costPerItem: ratio(s?.cost ?? null, s?.items ?? 0), runsPerItem: ratio(s?.runs ?? 0, s?.items ?? 0), unusable: ratio(s?.unusable ?? null, s?.runs ?? 0),
  });
  const stages = STAGES.flatMap((name) => {
    const a = d.stages.find((s) => s.stage === name), b = w.stages.find((s) => s.stage === name);
    if (!a && !b) return [];
    const x = stage(a), y = stage(b);
    return [{ stage: name, costPerItem: { day: x.costPerItem, trailing: y.costPerItem }, runsPerItem: { day: x.runsPerItem, trailing: y.runsPerItem }, unusable: { day: x.unusable, trailing: y.unusable } }];
  });
  const kinds = [...new Set([...d.holds.map((h) => h.kind), ...w.holds.map((h) => h.kind)])];
  const holds = kinds.map((kind) => {
    const a = d.holds.find((h) => h.kind === kind), b = w.holds.find((h) => h.kind === kind);
    return { kind, goals: { day: a?.goals ?? 0, trailing: (b?.goals ?? 0) / 7 }, hours: { day: a?.hours ?? 0, trailing: (b?.hours ?? 0) / 7 } };
  });
  return { day: r.day, findings: r.findings, ...(r.error ? { error: r.error } : {}), stages, holds };
}

/** The report's line in `aleph report`: the newest report of the last 2 days and its first finding. */
export function reportLine(now = Date.now()): string | null {
  const r = latestReport();
  if (!r || now - dayStart(r.day) > 3 * DAY) return null;
  if (r.error) return `health: the monitor of ${r.day} has no reading: ${r.error}`;
  if (!r.findings.length) return null;
  return `health: the monitor of ${r.day} names ${r.findings.length} ${r.findings.length > 1 ? "things that look" : "thing that looks"} off; first: ${r.findings[0]}`;
}
