/**
 * GitHub CI on each factory repo's main. The tick reads the latest runs with `gh` and keeps the
 * result in factory/ci.json; the report and the Status page show a red CI as a health line, and
 * the firefighter sees it as a `red` event, once per red streak.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expand, type Repo } from "./ledger.ts";

/** A repo's CI on main: green, or red since the first failed run of the current streak. */
/** `older` marks a streak that runs past the runs read, so `since` and `runs` are a lower bound. */
export interface Ci { repo: string; ok: boolean; sha: string; url: string; since?: string; sinceSha?: string; runs?: number; older?: boolean }
/** One run as `gh run list --json` gives it. */
export interface GhRun { conclusion: string; status: string; headSha: string; url: string; createdAt: string }
/** The runs of `repo`'s main, the latest first, or null when `gh` cannot read them. */
export type Runs = (repo: Repo) => GhRun[] | null;

const dir = () => expand(process.env.ALEPH_FACTORY_DIR ?? "~/.aleph/factory");
const file = () => join(dir(), "ci.json");

const ghRuns: Runs = (repo) => {
  const r = spawnSync("gh", ["run", "list", "--branch", repo.main, "--limit", "100", "--json", "conclusion,status,headSha,url,createdAt"], { cwd: repo.path, encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
};

/** The CI state from `runs`, the latest first: only finished runs that passed or failed count. Null when there are none. */
export function ciState(repo: string, runs: GhRun[]): Ci | null {
  const done = runs.filter((r) => r.status === "completed" && (r.conclusion === "success" || r.conclusion === "failure"));
  if (!done.length) return null;
  const last = done[0];
  if (last.conclusion === "success") return { repo, ok: true, sha: last.headSha, url: last.url };
  const green = done.findIndex((r) => r.conclusion === "success");
  const streak = green < 0 ? done : done.slice(0, green);
  const first = streak.at(-1)!;
  return { repo, ok: false, sha: last.headSha, url: last.url, since: first.createdAt, sinceSha: first.headSha, runs: streak.length, ...(green < 0 ? { older: true } : {}) };
}

const saved = (): Record<string, Ci> => {
  try { return JSON.parse(readFileSync(file(), "utf8")); } catch { return {}; }
};

/** Reads each repo's CI and saves it; a repo `gh` cannot read keeps what it had. Returns the red ones. */
export function ciStep(repos: Repo[], runs: Runs = ghRuns): Ci[] {
  const all = saved();
  for (const repo of repos) {
    const list = runs(repo);
    const c = list && ciState(repo.key, list);
    if (c) all[repo.key] = c;
  }
  mkdirSync(dir(), { recursive: true });
  writeFileSync(file(), JSON.stringify(all, null, 2) + "\n");
  return redCi();
}

/** The repos whose CI on main is red now. */
export const redCi = (): Ci[] => Object.values(saved()).filter((c) => !c.ok);

/** A red CI as one line. */
export const ciLine = (c: Ci): string =>
  `${c.repo} CI on main has failed ${c.older ? "at least " : ""}${c.runs} run${c.runs === 1 ? "" : "s"} in a row since ${c.older ? "before " : ""}${c.since?.slice(0, 16).replace("T", " ")} UTC (${c.sinceSha?.slice(0, 7)}): ${c.url}`;
