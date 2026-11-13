/**
 * `aleph memory maintain`: the mechanical pass of the memory maintainer. No model runs. With `dry` it reports each
 * step and changes nothing. Files outside git are moved to ~/.aleph/backups/maintain/<day>/, never deleted.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useLog } from "../../lib/episode-use.ts";
import { layout } from "../../lib/layout.ts";
import { alephPath, handoffsDir } from "../../lib/paths.ts";
import { addedDate, pushOrigin, trackedFiles } from "./git.ts";
import { Exit, run } from "./ops.ts";
import { compiledDays, fixFrontmatter, lintVault, loadVault, readRun, recordRun, today, wikiNotes, type Finding } from "./vault.ts";

const HANDOFF_DAYS = 30;
const SHOWN_UNOPENED = 8;
const OVERLAP_QUEUE = 10;
type Json = Record<string, any>;
type Commit = (subject: string, paths: string[]) => string | null;

/** An op run in this process: its exit code, its JSON (null when it printed none) and its stderr lines. */
export async function sub(argv: string[]): Promise<{ code: number; json: Json | null; err: string }> {
  const { log, error } = console;
  let text = "", err = "", code = 0;
  console.log = (...a) => { text += a.join(" ") + "\n"; };
  console.error = (...a) => { err += a.join(" ") + "\n"; };
  try { await run(argv); }
  catch (e) { if (!(e instanceof Exit)) throw e; code = e.code; }
  finally { console.log = log; console.error = error; }
  try { return { code, json: JSON.parse(text), err }; } catch { return { code, json: null, err }; }
}

/** `line` with each repeated `[[link]]` removed. */
const dedupe = (line: string): string => { const seen = new Set<string>(); return line.replace(/\s*\[\[[^\]]+\]\]/g, (m) => (seen.has(m.trim()) ? "" : (seen.add(m.trim()), m))); };

const ago = (days: number): string => today(new Date(Date.now() - days * 86400_000));

/** The handoffs of `dir` whose day (from `day`) is before the cutoff and that `keep` allows, moved to `to` unless `dry`. */
function move(dir: string, to: string, dry: boolean, day: (f: string) => string | null, cut: string, keep: (d: string) => boolean = () => true): string[] {
  if (!existsSync(dir)) return [];
  const old = readdirSync(dir).filter((f) => { const d = day(f); return d && d < cut && keep(d); });
  if (!dry && old.length) mkdirSync(to, { recursive: true });
  if (!dry) for (const f of old) renameSync(join(dir, f), join(to, f));
  return old;
}

/** The stale findings, most recalled first, each with its count in the recall log (30 days); ties keep lint order. */
export function decayQueue(root: string, stale: Finding[]): (Finding & { count: number })[] {
  const file = join(root, ".recall-log.jsonl");
  const n = new Map<string, number>();
  for (const l of existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : []) { const t = JSON.parse(l).title; n.set(t, (n.get(t) ?? 0) + 1); }
  return stale.map((f) => ({ ...f, count: n.get(f.note) ?? 0 })).sort((a, b) => b.count - a.count);
}

/** The pass over the vault at `root`. The report, with `ok` false when a step that changes something failed. */
export async function maintain(root: string, dry: boolean, commit: Commit): Promise<Json> {
  const report: Json = { op: "maintain", dry };
  const failed: string[] = [];
  const backup = join(alephPath("ALEPH_BACKUPS_DIR", "backups"), "maintain", today());

  const retry = readRun(root, "vault push")?.result === "failed";
  const pushed = retry && !dry ? pushOrigin(root) : null;
  if (pushed) recordRun(root, "vault push", pushed.pushed ? "ok" : "failed", pushed.detail);
  if (pushed && !pushed.pushed) failed.push("push");
  report.push = { retry, ...(pushed ? { pushed: pushed.pushed, detail: pushed.detail } : {}) };

  const notes = wikiNotes(await loadVault(root));
  const fixes = notes.flatMap((n) => { const r = fixFrontmatter(n, addedDate(root, n.path)); return r ? [{ note: n.title, repairs: r.repairs }] : []; });
  const tracked = new Set(trackedFiles(root, "wiki"));
  const untracked = notes.filter((n) => !tracked.has(n.rel));
  const cores = notes.flatMap((n) => { const was = n.fm.core; return typeof was === "string" && dedupe(was) !== was ? [{ n, was, now: dedupe(was) }] : []; });

  if (dry) report.lint = { fixed: fixes };
  else {
    // Core lines go first: the lint that follows regenerates Home from them.
    for (const c of cores) writeFileSync(c.n.path, c.n.text.replace(/^core:.*$/m, (l) => dedupe(l)));
    const l = await sub(["lint", "--fix"]);
    if (!l.json) failed.push("lint");
    report.lint = { fixed: l.json?.fixed ?? [], commit: l.json?.commit ?? null };
    if (cores.length) report.core = { commit: commit(`maintain core: ${cores.length} notes`, cores.map((c) => c.n.path)) };
  }
  report.adopt = [];
  for (const n of untracked) {
    const r = dry ? null : await sub(["adopt", n.path, "--why", "maintain"]);
    if (r && r.code) failed.push(`adopt ${n.title}`);
    report.adopt.push({ note: n.title, ...(r ? { adopted: !r.code } : {}) });
  }
  report.core = { ...report.core, fixed: cores.map((c) => ({ note: c.n.title, was: c.was, now: c.now })) };

  // A handoff counts as compiled when `aleph memory compile` ran for its day.
  const dated = (f: string) => f.match(/^(\d{4}-\d{2}-\d{2})-\d{6}(-.*)?\.md$/)?.[1] ?? null;
  const compiled = compiledDays(root);
  report.handoffs = move(handoffsDir(), join(backup, "handoffs"), dry, dated, ago(HANDOFF_DAYS), (d) => compiled.includes(d));

  // An episode page shown often and never opened does not help: it moves to the backup, and nothing is deleted.
  const uses = existsSync(useLog()) ? readFileSync(useLog(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const shown = (t: string, event: string) => uses.filter((u) => u.title === t && u.event === event).length;
  const pages = join(layout().factory, "episodes");
  report.episodes = (existsSync(pages) ? readdirSync(pages) : []).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3))
    .filter((t) => shown(t, "shown") >= SHOWN_UNOPENED && !shown(t, "opened"));
  if (!dry && report.episodes.length) mkdirSync(join(backup, "episodes"), { recursive: true });
  if (!dry) for (const t of report.episodes) renameSync(join(pages, `${t}.md`), join(backup, "episodes", `${t}.md`));

  const lint = lintVault(await loadVault(root), { overlap: true, tracked: [...tracked] });
  const queue = (rule: string) => lint.warn.filter((f) => f.rule === rule);
  const misses = await sub(["misses"]);
  report.queues = { decay: decayQueue(root, queue("stale")), overlap: queue("overlap").slice(0, OVERLAP_QUEUE), ...(misses.code ? {} : { misses: misses.json }) };
  const overlaps = queue("overlap").length;
  report.counts = {
    fixed: report.lint.fixed.length, adopt: untracked.length, core: cores.length, handoffs: report.handoffs.length, episodes: report.episodes.length,
    decay: report.queues.decay.length, overlap: overlaps, retry: retry ? 1 : 0,
  };
  report.ok = !failed.length;
  recordRun(root, "maintain", report.ok ? "ok" : "failed", failed.length ? `failed: ${failed.join(", ")}` : `${dry ? "dry: " : ""}${JSON.stringify(report.counts)}`);
  return report;
}
