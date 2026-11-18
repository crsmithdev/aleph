/**
 * `aleph memory maintain`: the mechanical pass of the memory maintainer. No model runs. With `dry` it reports each
 * step and changes nothing. Files outside git are moved to ~/.aleph/backups/maintain/<day>/, never deleted.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readUses } from "../../lib/episode-use.ts";
import { layout } from "../../lib/layout.ts";
import { alephPath, handoffsDir } from "../../lib/paths.ts";
import { handoffOf } from "../../lib/handoffs.ts";
import { addedDate, pushOrigin, trackedFiles } from "./git.ts";
import { adopt, commitAndPush, lint as lintOp, misses as missesOp, op, requireVault, type Result } from "./ops.ts";
import { daysAgo, today } from "../../lib/day.ts";
import { compiledDays, fixFrontmatter, lintVault, loadVault, loadWiki, readRecallLog, readRun, recordRun, trimRecallLog, type Finding } from "./vault.ts";

const HANDOFF_DAYS = 30;
const SHOWN_UNOPENED = 8;
const OVERLAP_QUEUE = 10;
type Json = Record<string, any>;

/** `line` with each repeated `[[link]]` removed. */
const dedupe = (line: string): string => { const seen = new Set<string>(); return line.replace(/\s*\[\[[^\]]+\]\]/g, (m) => (seen.has(m.trim()) ? "" : (seen.add(m.trim()), m))); };

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
  const n = new Map<string, number>();
  for (const { title } of readRecallLog(root)) n.set(title, (n.get(title) ?? 0) + 1);
  return stale.map((f) => ({ ...f, count: n.get(f.note) ?? 0 })).sort((a, b) => b.count - a.count);
}

/** The pass over the vault at `root`. The report, with `ok` false when a step that changes something failed. */
export const maintain = (root: string, dry: boolean): Promise<Result<Json>> => op(async (w) => {
  requireVault(root);
  const commit = (subject: string, paths: string[]) => commitAndPush(root, w, subject, paths);
  const report: Json = { op: "maintain", dry };
  const failed: string[] = [];
  const backup = join(alephPath("ALEPH_BACKUPS_DIR", "backups"), "maintain", today());

  const retry = readRun(root, "vault push")?.result === "failed";
  const pushed = retry && !dry ? pushOrigin(root) : null;
  if (pushed) recordRun(root, "vault push", pushed.pushed ? "ok" : "failed", pushed.detail);
  if (pushed && !pushed.pushed) failed.push("push");
  report.push = { retry, ...(pushed ? { pushed: pushed.pushed, detail: pushed.detail } : {}) };

  const notes = await loadWiki(root);
  const fixes = notes.flatMap((n) => { const r = fixFrontmatter(n, addedDate(root, n.path)); return r ? [{ note: n.title, repairs: r.repairs }] : []; });
  const tracked = new Set(trackedFiles(root, "wiki"));
  const untracked = notes.filter((n) => !tracked.has(n.rel));
  const cores = notes.flatMap((n) => { const was = n.fm.core; return typeof was === "string" && dedupe(was) !== was ? [{ n, was, now: dedupe(was) }] : []; });

  if (dry) report.lint = { fixed: fixes };
  else {
    // Core lines go first: the lint that follows reads them.
    for (const c of cores) writeFileSync(c.n.path, c.n.text.replace(/^core:.*$/m, (l) => dedupe(l)));
    const l = await lintOp(root, { fix: true });
    if (!l.ok) failed.push("lint");
    report.lint = { fixed: l.ok ? l.value.fixed : [], commit: l.ok ? l.value.commit : null };
    if (cores.length) report.core = { commit: commit(`maintain core: ${cores.length} notes`, cores.map((c) => c.n.path)) };
  }
  report.adopt = [];
  for (const n of untracked) {
    const r = dry ? null : await adopt(root, n.path, "maintain");
    if (r && !r.ok) failed.push(`adopt ${n.title}`);
    report.adopt.push({ note: n.title, ...(r ? { adopted: r.ok } : {}) });
  }
  report.core = { ...report.core, fixed: cores.map((c) => ({ note: c.n.title, was: c.was, now: c.now })) };

  // A handoff counts as compiled when `aleph memory compile` ran for its day.
  const dated = (f: string) => handoffOf(f)?.day || null;
  const compiled = compiledDays(root);
  report.handoffs = move(handoffsDir(), join(backup, "handoffs"), dry, dated, daysAgo(HANDOFF_DAYS), (d) => compiled.includes(d));

  // An episode page shown often and never opened does not help: it moves to the backup, and nothing is deleted.
  const uses = readUses();
  const shown = (t: string, event: string) => uses.filter((u) => u.title === t && u.event === event).length;
  const pages = join(layout().factory, "episodes");
  report.episodes = (existsSync(pages) ? readdirSync(pages) : []).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3))
    .filter((t) => shown(t, "shown") >= SHOWN_UNOPENED && !shown(t, "opened"));
  if (!dry && report.episodes.length) mkdirSync(join(backup, "episodes"), { recursive: true });
  if (!dry) for (const t of report.episodes) renameSync(join(pages, `${t}.md`), join(backup, "episodes", `${t}.md`));

  if (!dry) {
    try { trimRecallLog(root); } catch { failed.push("recall trim"); }
  }

  const lint = lintVault(await loadVault(root), { overlap: true, tracked: [...tracked] });
  const queue = (rule: string) => lint.warn.filter((f) => f.rule === rule);
  const misses = await missesOp();
  report.queues = { decay: decayQueue(root, queue("stale")), overlap: queue("overlap").slice(0, OVERLAP_QUEUE), ...(misses.ok ? { misses: misses.value } : {}) };
  const overlaps = queue("overlap").length;
  report.counts = {
    fixed: report.lint.fixed.length, adopt: untracked.length, core: cores.length, handoffs: report.handoffs.length, episodes: report.episodes.length,
    decay: report.queues.decay.length, overlap: overlaps, retry: retry ? 1 : 0,
  };
  report.ok = !failed.length;
  recordRun(root, "maintain", report.ok ? "ok" : "failed", failed.length ? `failed: ${failed.join(", ")}` : `${dry ? "dry: " : ""}${JSON.stringify(report.counts)}`);
  return report;
});
