/** The factory's tables: flakes, baselines, suite history, stalls and the tick, with the red-main readers. */
import { conn, getJson, putJson, tx } from "../../../lib/db.ts";
import { ciLine, redCi } from "./ci.ts";
import type { Repo } from "../records/ledger.ts";

/** Add a row to the `flaky` table. */
export const recordFlake = (row: Flake): void => {
  conn().query("INSERT INTO flaky (time, repo, check_name, run, tests) VALUES (?, ?, ?, ?, ?)").run(row.at, row.repo, row.check, row.run, row.tests ? JSON.stringify(row.tests) : null);
};

export interface Flake { repo: string; check: string; run: string; at: string; tests?: string[] }
export const flakes = (): Flake[] =>
  (conn().query("SELECT time AS at, repo, check_name AS `check`, run, tests FROM flaky ORDER BY seq").all() as (Omit<Flake, "tests"> & { tests: string | null })[])
    .map(({ tests, ...r }) => ({ ...r, ...(tests ? { tests: JSON.parse(tests) } : {}) }));

/** `config`: the setup and checks the record ran, as JSON; a record from before it has none. */
export interface Baseline { repo: string; commit: string; config?: string; ok: boolean; failed?: string }

export const baselines = (): Record<string, Baseline> => getJson("state", "baseline", {});

/**
 * The one write of the `baseline` row. In one transaction it reads the entries, lets `decide` turn the repo's old
 * entry into its new one (null leaves the row alone), and writes them back. Returns whether it wrote.
 */
export const writeBaseline = (key: string, decide: (old: Baseline | undefined) => Baseline | null): boolean => tx(() => {
  const all = baselines();
  const next = decide(all[key]);
  if (!next) return false;
  putJson("state", "baseline", { ...all, [key]: next });
  return true;
});

/** One full suite run: the test counts of its bun test checks, and the tests that failed on the first run and passed on the rerun. */
export interface SuiteRecord { repo: string; commit: string; at: string; ran: number; passed: number; failed: number; skipped: number; rerunPassed: number }

/** The suite records in the order they were added, of `repo` when given. */
export const suiteHistory = (repo?: string): SuiteRecord[] =>
  conn().query(`SELECT repo, commit_sha AS \`commit\`, time AS at, ran, passed, failed, skipped, rerun_passed AS rerunPassed FROM suite_history${repo ? " WHERE repo = ?" : ""} ORDER BY seq`).all(...(repo ? [repo] : [])) as SuiteRecord[];

export const appendSuiteHistory = (r: SuiteRecord): void => {
  conn().query("INSERT INTO suite_history (time, repo, commit_sha, ran, passed, failed, skipped, rerun_passed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(r.at, r.repo, r.commit, r.ran, r.passed, r.failed, r.skipped, r.rerunPassed);
};

export const redLine = (b: Baseline) => `main is red at ${b.commit.slice(0, 7)}: ${b.failed}`;

/** A red main: a failed baseline or a red GitHub CI streak. `id` names the red commit or streak; `line` says it with the repo. */
export interface RedMain { repo: string; source: "baseline" | "ci"; id: string; line: string }

/** Every red main now, the baselines first: what the health lines and the Gates page report, and the firefighter files. */
export function redMains(): RedMain[] {
  const base = Object.values(baselines()).filter((b) => !b.ok)
    .map((b): RedMain => ({ repo: b.repo, source: "baseline", id: `red:${b.repo}:${b.commit}`, line: `${b.repo} ${redLine(b)}` }));
  const ci = redCi().map((c): RedMain => ({ repo: c.repo, source: "ci", id: `ci:${c.repo}:${c.sinceSha}:${c.sha}`, line: ciLine(c) }));
  return [...base, ...ci];
}

/**
 * The red line that stops an issue start, per repo: its last baseline failed. The full suite runs on its own timer, so a
 * red record stays until a later suite run is green, also when main has moved since.
 */
export function mainRed(): (repo: Repo) => string | null {
  const base = baselines();
  return (repo) => {
    const b = base[repo.key];
    return b && !b.ok ? redLine(b) : null;
  };
}

/** The tick's record of stalled work: each key with the time a tick first saw it. */
export function writeStalls(stalls: Record<string, string>): void {
  putJson("state", "stalls", stalls);
}

export const readStalls = (): Record<string, string> => getJson("state", "stalls", {});

/** The names a flake row stands for: one per test it names, or its check when it names none. */
export function flakeNames(f: Flake): { kind: "test" | "check"; name: string }[] {
  const tests = [...new Set(f.tests ?? [])];
  return tests.length ? tests.map((name) => ({ kind: "test" as const, name })) : [{ kind: "check", name: f.check }];
}

/** The state of a factory repo's main: green, or red, unchecked or running with its line. */
export type MainState = { state: "green" } | { state: "red" | "unchecked" | "running"; line: string };

/** A row of `tick`: when a step last ran and what it said; a column is null until a write gives it. */
export interface TickRow { last: string | null; result: string | null }

export const tickRows = (): Record<string, TickRow> =>
  Object.fromEntries((conn().query("SELECT * FROM tick").all() as (TickRow & { step: string })[]).map(({ step, ...row }) => [step, row]));

/** The tick keys the sweep has acted on and that are still missed (tick.ts writes them). */
export const tickMissed = (): string[] => getJson("state", "tick.missed", []);

/** Sets the columns that `row` gives for `step`; the other column keeps its value. */
export const setTick = (step: string, row: Partial<TickRow>): void => {
  conn().query("INSERT INTO tick (step, last, result) VALUES (?1, ?2, ?3) ON CONFLICT (step) DO UPDATE SET last = coalesce(?2, last), result = coalesce(?3, result)")
    .run(step, row.last ?? null, row.result ?? null);
};

/** The result of a scheduled step (`suite <repo>`, `monitor`) and its time, in its row of `tick`. */
export const recordRan = (key: string, result: string): void => setTick(key, { last: new Date().toISOString(), result });
