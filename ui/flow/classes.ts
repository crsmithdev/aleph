import { isAgentRun, type Run } from "../../jobs/lib/records/ledger.ts";
import { roundsIn } from "../../jobs/lib/records/record.ts";
import { causeOf, type Cause } from "../../jobs/lib/records/outcome.ts";
import { RUN_CAP } from "../../jobs/lib/infra/settings.ts";
import { CLOSED, clip, issueHref, SPEEDS } from "../../lib/naming.ts";
import { runShare, type Fit } from "../usage.ts";
import { issueOf, HOUR, MAX_RUN, passedState, round, splitId } from "./phases.ts";

/** What `classify`'s `statusOf` returns for an issue that is no longer in the store: closed issues left it, so one with no landing was closed without landing. */
export const GONE = "gone";
export const CLASSES = SPEEDS;
type Class = (typeof CLASSES)[number];
/** The classes whose work did not reach main: their hours are the lost time. */
const LOST: Class[] = ["failed", "reran", "dropped"];
const CLASS_TEXT: Record<Class, string> = {
  landed: "The run whose work landed on main.",
  returned: "A run of the landing job before the run that landed: a fix round the issue needed.",
  failed: "A run that started after its issue had landed, or found the work already on main.",
  get reran() { return `A run that a later start replaced: another job of the same issue landed, or the issue started ${RUN_CAP() + 1} or more times inside an hour.`; },
  dropped: "A run of an issue that was then dropped or closed without landing.",
};
/** The breakdown's name of each stated cause that has one. */
const CAUSE_NAME: Partial<Record<Cause, string>> = {
  review: "Reviewer sent back", check: "Checks failed",
  timeout: "Stalled or timed out", stalled: "Stalled or timed out",
  "no-commit": "No commit", conflict: "Passed, not landed",
};

/** What each cause in the breakdown means. */
const CAUSE_TEXT: Record<string, string> = {
  "First run of the job": "The job's first run landed, with no fix round.",
  "After fix rounds": "The job landed on a later run, after one or more fix rounds.",
  "Issue had landed": "The run started after its issue had landed.",
  "Work on main from another issue": "The run found the work already on main, from another issue.",
  get "Restart loop"() { return `The issue started ${RUN_CAP() + 1} or more times inside an hour.`; },
  "Needed the user": "The run waited for the user, or the user restarted or dropped it by hand.",
  "Reviewer sent back": "The reviewer did not pass the run's work.",
  "Checks failed": "The run's checks failed or timed out.",
  "Stalled or timed out": "The run stalled, passed its time box or lost its process.",
  "No commit": "The run ended with no commit.",
  "Passed, not landed": "The run passed its checks, but its work did not land, for example after a land conflict.",
  "Other": "Any other reason, or no reason recorded.",
};

export interface Measure { hours: number; week: number; runs: number }
export interface ClassStat extends Measure {
  /** `lost`: the class's work did not reach main. */
  key: Class; lost: boolean; text: string; issues: number;
  causes: (Omit<Measure, "week"> & { name: string; text: string })[];
  top: (Omit<Measure, "week"> & { issue: string; title?: string; href?: string; reason: string })[];
}

/** Class every agent run of the window by what its work came to; see the parent issue's Classes list. */
export function classify(runs: Run[], statusOf: (ref: string) => string | undefined, since: number, now: number, fit: Fit | null): { classes: ClassStat[]; notCounted: { runs: number; issues: number; hours: number }; lost: { hours: number; share: number }; total: number } {
  const t0 = (r: Run) => Date.parse(r.started);
  const agentsOf = new Map<string, Run[]>(), landsOf = new Map<string, Run[]>(), firstStart = new Map<string, number>();
  for (const r of runs) {
    const t = t0(r);
    if (Number.isFinite(t)) firstStart.set(r.job, Math.min(firstStart.get(r.job) ?? Infinity, t));
    const g = issueOf(r);
    if (g === undefined) continue;
    const m = isAgentRun(r.role) ? agentsOf : r.role === "land" && r.state === "landed" ? landsOf : null;
    if (!m) continue;
    if (!m.has(g)) m.set(g, []);
    m.get(g)!.push(r);
  }
  // The landing runs of each issue, and when its last land ended.
  const landing = new Map<string, Set<Run>>(), lastLand = new Map<string, number>();
  for (const [g, lands] of landsOf) {
    for (const l of lands) {
      const end = Date.parse(l.ended ?? "");
      if (Number.isFinite(end)) lastLand.set(g, Math.max(lastLand.get(g) ?? -Infinity, end));
      // A held run lands from `waiting`, so it counts for the land of its own job.
      const cand = (agentsOf.get(g) ?? []).filter((a) => (passedState(a.state) || (a.state === "waiting" && a.job === l.job)) && t0(a) < end).sort((a, b) => t0(b) - t0(a))[0];
      if (cand) { if (!landing.has(g)) landing.set(g, new Set()); landing.get(g)!.add(cand); }
    }
  }
  type Row = { run: Run; issue: string; hours: number; week: number; cause: string };
  const rows = new Map<Class, Row[]>(CLASSES.map((c) => [c, []]));
  const skipped: Row[] = [];
  for (const r of runs) {
    const g = issueOf(r);
    if (!isAgentRun(r.role) || g === undefined) continue;
    const a = t0(r), b = Date.parse(r.ended ?? "");
    if (!(a >= since) || a > now || !(b >= a) || b - a > MAX_RUN) continue;
    const reason = r.reason ?? "";
    const row: Row = { run: r, issue: g, hours: (b - a) / 1000 / 3600, week: runShare(fit, r)?.pct ?? 0, cause: "" };
    const lands = landing.get(g) ?? new Set<Run>();
    const mine = (agentsOf.get(g) ?? []);
    const startsBefore = mine.filter((o) => a - HOUR <= t0(o) && t0(o) < a).length;
    const afterLand = lastLand.has(g) && a > lastLand.get(g)!;
    let cls: Class | null = null;
    if (lands.has(r)) cls = "landed";
    else if ([...lands].some((l) => l.job === r.job && t0(l) > a)) cls = "returned";
    else if (afterLand || r.fate === "met" || r.fate === "duplicate") cls = "failed";
    else if (startsBefore >= RUN_CAP() || [...lands].some((l) => l.job !== r.job && (firstStart.get(l.job) ?? Infinity) > (firstStart.get(r.job) ?? Infinity))) cls = "reran";
    else if ([...CLOSED, GONE].includes(statusOf(g) ?? "")) cls = "dropped";
    if (!cls) { skipped.push(row); continue; }
    const stated = CAUSE_NAME[causeOf(r) ?? "other"];
    if (cls === "landed") row.cause = roundsIn(mine.filter((o) => o.job === r.job && t0(o) < a)) ? "After fix rounds" : "First run of the job";
    else if (cls === "failed") row.cause = afterLand ? "Issue had landed" : "Work on main from another issue";
    else if (cls === "reran" && startsBefore >= RUN_CAP()) row.cause = "Restart loop";
    else if (r.state === "waiting") row.cause = "Needed the user";
    else if (r.failed === "review") row.cause = "Reviewer sent back";
    else if (r.failed) row.cause = "Checks failed";
    else if (stated) row.cause = stated;
    // A drop with no stated cause has only its free prose, so this guess stays for the page's breakdown.
    else if (/reviewer/i.test(reason)) row.cause = "Reviewer sent back";
    else if (/ failed$/.test(reason)) row.cause = "Checks failed";
    else if (/time box|stalled|timed out|lost/i.test(reason)) row.cause = "Stalled or timed out";
    else if (/no commit/i.test(reason)) row.cause = "No commit";
    else if (r.fate === "manual") row.cause = "Needed the user";
    else if (passedState(r.state) || /conflict/i.test(reason)) row.cause = "Passed, not landed";
    else row.cause = "Other";
    rows.get(cls)!.push(row);
  }
  const sum = (rs: Row[]): Measure => ({ hours: rs.reduce((x, y) => x + y.hours, 0), week: rs.reduce((x, y) => x + y.week, 0), runs: rs.length });
  const rd = (m: Measure): Measure => ({ hours: round(m.hours, 2), week: round(m.week, 2), runs: m.runs });
  const classes: ClassStat[] = CLASSES.map((key) => {
    const rs = rows.get(key)!;
    const group = <K extends string>(keyOf: (r: Row) => K) => {
      const m = new Map<K, Row[]>();
      for (const r of rs) { const k = keyOf(r); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
      return m;
    };
    const noWeek = ({ week: _w, ...m }: Measure): Omit<Measure, "week"> => m;
    const causes = [...group((r) => r.cause)].map(([name, x]) => ({ name, sum: sum(x) })).sort((a, b) => b.sum.hours - a.sum.hours).map((c) => ({ name: c.name, text: CAUSE_TEXT[c.name], ...noWeek(rd(c.sum)) }));
    const top = [...group((r) => r.issue)].map(([issue, x]) => {
      const last = x.reduce((p, q) => (t0(q.run) > t0(p.run) ? q : p));
      const [repo, n] = splitId(issue);
      return { issue, sum: sum(x), reason: clip((last.run.reason ?? "").replace(/^agent run \S+:\s*/, "").trim(), 140), href: issueHref(`${repo}-${n}`) };
    }).sort((a, b) => b.sum.hours - a.sum.hours).slice(0, 8).map((t) => ({ issue: t.issue, href: t.href, reason: t.reason, ...noWeek(rd(t.sum)) }));
    return { key, lost: LOST.includes(key), text: CLASS_TEXT[key], ...rd(sum(rs)), issues: new Set(rs.map((r) => r.issue)).size, causes, top };
  });
  const hoursOf = (cs: readonly Class[]) => cs.reduce((x, c) => x + sum(rows.get(c)!).hours, 0);
  const total = hoursOf(CLASSES), lostH = hoursOf(LOST);
  return {
    classes,
    notCounted: { runs: skipped.length, issues: new Set(skipped.map((r) => r.issue)).size, hours: round(skipped.reduce((x, y) => x + y.hours, 0), 2) },
    lost: { hours: round(lostH, 2), share: total ? round(lostH / total, 4) : 0 },
    total: round(total, 2),
  };
}
