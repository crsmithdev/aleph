/**
 * One-off: build every job record (jobs/lib/record.ts) from the stores it replaces. Run it once, with the factory
 * paused, then delete this file. It writes the records folder, and refuses when that folder has a record already.
 * With `--strip-store` it then takes the Ask fields out of the issues' front matter, one store commit per repo.
 * See docs/specs/2026-11-04-job-record.md, "Store survey".
 *
 *   bun jobs/migrate-records.ts [--strip-store]
 *
 * It reads: each run folder's state.json, `asked`, `asked-spec` and `rescued`; the factory's holds.jsonl,
 * director.jsonl, spec-checks.jsonl, streak/, cap/ and rerun/; and the Ask fields of each issue's front matter.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { layout } from "./lib/layout.ts";
import { decodeOption, type Ask } from "./lib/ask.ts";
import { loadRegistry, type Run } from "./lib/ledger.ts";
import * as record from "./lib/record.ts";
import { readList, writeList } from "../todo/lib/store.ts";
import * as issues from "../todo/lib/todo.ts";

/** The front-matter fields of an issue's Ask before the record held it. */
const ASK_FIELDS = ["ask", "reason", "question", "options", "recommended", "why", "headline", "situation", "details", "effects", "recommend"];

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const lines = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const pair = (s: string) => { const at = s.indexOf("::"); return at < 0 ? { a: s.trim(), b: "" } : { a: s.slice(0, at).trim(), b: s.slice(at + 2).trim() }; };

/** The Ask in an issue's front matter, as ask.ts read it before the record. */
function frontMatterAsk(fm: Record<string, unknown>): Ask | null {
  const kind = fm.ask;
  if (kind !== "input" && kind !== "approval") return null;
  const why = fm.why;
  const effects = lines(fm.effects).map(pair);
  const recommend = text(fm.recommend) ? pair(text(fm.recommend)) : null;
  return {
    kind, reason: text(fm.reason) || "question", question: text(fm.question), options: lines(fm.options).map(decodeOption),
    ...(text(fm.recommended) ? { recommended: text(fm.recommended) } : {}),
    why: typeof why === "string" ? why.split(",").map((s) => s.trim()).filter(Boolean) : lines(why),
    ...(text(fm.headline) ? { headline: text(fm.headline) } : {}),
    ...(text(fm.situation) ? { situation: text(fm.situation) } : {}),
    ...(text(fm.details) ? { details: text(fm.details) } : {}),
    ...(effects.length ? { effects: effects.map((e) => ({ action: e.a, text: e.b })) } : {}),
    ...(recommend ? { recommend: { action: recommend.a, why: recommend.b } } : {}),
  };
}

/** Fields in old state.json files that no type names. */
const DEAD = ["facts", "kept", "rejected", "todo", "review2", "needs"];

/** The hold kinds that never stopped a start: `started`, and the kinds from before the 7 gates. */
const NOT_HELD = new Set(["started", "open", "start", "done"]);

const readText = (f: string): string | undefined => { try { return readFileSync(f, "utf8"); } catch { return undefined; } };
const jsonl = (f: string): any[] => (readText(f) ?? "").split("\n").filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });

export function migrate(): { records: number; runs: number; events: number; runAsks: number; issueAsks: number; clashes: string[] } {
  const dir = record.recordsDir();
  if (existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".json"))) throw new Error(`${dir} has records already`);
  const { ledger, factory } = layout();
  const recs = new Map<string, record.JobRecord>();
  const of = (key: string) => recs.get(key) ?? recs.set(key, record.empty(key)).get(key)!;
  let runs = 0;

  for (const id of existsSync(ledger) ? readdirSync(ledger).sort() : []) {
    const folder = join(ledger, id);
    const raw = readText(join(folder, "state.json"));
    if (raw === undefined) continue;
    const run: Run & Record<string, unknown> = JSON.parse(raw);
    for (const k of DEAD) delete run[k];
    const r = of(record.keyOf(run));
    r.runs.push({ ...run, id });
    runs++;
    const asked = readText(join(folder, "asked"));
    if (asked !== undefined) {
      const spec = readText(join(folder, "asked-spec"))?.trim();
      r.events.push({ at: run.ended ?? run.started, kind: "asked", run: id, what: asked.trim(), ...(spec ? { data: { spec } } : {}) });
    }
    const rescued = readText(join(folder, "rescued"));
    if (rescued !== undefined) r.events.push({ at: run.ended ?? run.started, kind: "rescued", run: id, what: rescued.trim() });
  }

  for (const h of jsonl(join(factory, "holds.jsonl"))) {
    of(h.name).events.push({ at: h.at, kind: h.kind === "started" ? "started" : "hold", what: h.text, ...(h.kind !== "started" ? { data: { gate: h.kind } } : {}) });
  }
  for (const d of jsonl(join(factory, "director.jsonl"))) {
    of(d.on || d.ref).events.push({ at: d.at, kind: "director", what: `${d.reason}: ${d.outcome}`, data: d });
  }
  for (const c of jsonl(join(factory, "spec-checks.jsonl"))) {
    of(c.name).events.push({ at: c.at, kind: "spec-check", what: `spec check cost ${c.cost.toFixed(2)} dollars`, data: { cost: c.cost } });
  }
  for (const [sub, kind] of [["streak", "streak"], ["cap", "cap"], ["rerun", "rerun"]] as const) {
    const folder = join(factory, sub);
    for (const f of existsSync(folder) ? readdirSync(folder) : []) {
      const key = f.replace(/\.(txt|md)$/, "");
      const body = readText(join(folder, f))!.trim();
      const at = kind === "rerun" ? new Date(Bun.file(join(folder, f)).lastModified).toISOString() : body;
      of(key).events.push({ at, kind, what: kind === "rerun" ? body : kind });
    }
  }

  // The Ask: a run's while it is the newest run and awaits Chris, else the open issue's from its front matter.
  let runAsks = 0, issueAsks = 0;
  const clashes: string[] = [];
  for (const r of recs.values()) {
    const last = r.runs.findLast((x) => x.kind !== "facts");
    if (last?.condition === "awaiting" && last.ask) { r.ask = last.ask; r.askRun = last.id; runAsks++; }
    for (const x of r.runs) delete x.ask;
  }
  for (const repo of Object.values(loadRegistry())) {
    let doc: issues.Doc | null = null;
    try { doc = readList(repo); } catch { continue; }
    for (const item of doc?.items ?? []) {
      const ask = frontMatterAsk(item.fm as Record<string, unknown>);
      if (!ask || issues.status(item) !== "open") continue;
      const r = of(`${repo.key}-${issues.refOf(item)}`);
      if (r.askRun) { clashes.push(r.issue); continue; }
      r.ask = ask;
      issueAsks++;
    }
  }

  let events = 0;
  for (const r of recs.values()) {
    r.events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    events += r.events.length;
    // The goal waits while its newest hold event is a gate that stopped a start and no start followed it.
    const last = r.events.findLast((e) => e.kind === "hold" || e.kind === "started");
    const gate = (last?.data as { gate?: string } | undefined)?.gate;
    const held = last?.kind === "hold" && gate && !NOT_HELD.has(gate) && !(gate === "not-ready" && /^(its job is |the item is already done$)/.test(last.what));
    r.wait = held ? { kind: gate!, reason: last!.what, since: last!.at } : null;
    record.update(r.issue, () => r);
  }
  return { records: recs.size, runs, events, runAsks, issueAsks, clashes };
}

/** Take the Ask fields out of every issue's front matter: one store commit per repo that has any. Returns the repos and counts. */
export function stripStore(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const repo of Object.values(loadRegistry())) {
    let n = 0;
    try {
      writeList(repo, "migrate: the Ask moves to the job record", (doc) => {
        n = 0;
        for (const item of doc.items) {
          if (item.fm.ask === undefined) continue;
          for (const k of ASK_FIELDS) delete item.fm[k];
          n++;
        }
        return n ? true : null;
      });
    } catch { continue; }
    if (n) out[repo.key] = n;
  }
  return out;
}

if (import.meta.main) {
  console.log(JSON.stringify(migrate()));
  if (process.argv.includes("--strip-store")) console.log(JSON.stringify({ stripped: stripStore() }));
}
