/**
 * GitHub CI on each factory repo's main. The tick reads the latest runs with `gh` and keeps the
 * result in the `ci` row of `state`; the report and the Status page show a red CI as a health line, and
 * the firefighter files one critical issue per failing head (firefighter.ts).
 */
import { spawnSync } from "node:child_process";
import { type Repo } from "../records/ledger.ts";
import { getJson, putJson } from "../../../lib/db.ts";

/** A repo's CI on main: green, or red since the first failed run of the current streak. */
/** `older` marks a streak that runs past the runs read, so `since` and `runs` are a lower bound. */
interface Ci { repo: string; ok: boolean; sha: string; url: string; since?: string; sinceSha?: string; runs?: number; older?: boolean }
/** One run as `gh run list --json` gives it. */
export interface GhRun { conclusion: string; status: string; headSha: string; url: string; createdAt: string }
/** A `gh` call in `repo`: its stdout when it exits 0, else its error. Every `gh` call of the CI watch goes through one; tests replace it. */
export type Gh = (repo: Repo, args: string[]) => { ok: boolean; out: string };

/** `Gh` that does not block, so the repos are read at once. */
type GhAsync = (repo: Repo, args: string[]) => Promise<{ ok: boolean; out: string }>;

const LIMITS = { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }; // 60 s and 64 MiB of output one `gh` call may take

/** A `gh` call's result: its stdout on exit 0, else its stderr, the spawn error or the exit code. */
const result = (code: number | null, out: string, err: string, spawnError?: Error): { ok: boolean; out: string } =>
  code === 0 ? { ok: true, out } : { ok: false, out: (err || spawnError?.message || `exit ${code}`).trim() };

export const gh: Gh = (repo, args) => {
  const r = spawnSync("gh", args, { cwd: repo.path, encoding: "utf8", ...LIMITS });
  return result(r.status, r.stdout, r.stderr, r.error);
};

/** The CI watch's `gh` call: `gh` in an async spawn, with the same limits. */
const ghAsync: GhAsync = async (repo, args) => {
  try {
    const p = Bun.spawn(["gh", ...args], { cwd: repo.path, stdin: "ignore", stdout: "pipe", stderr: "pipe", ...LIMITS });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return result(code, out, err);
  } catch (e) {
    return result(null, "", "", e as Error);
  }
};

/** The runs of `repo`'s main, the latest first, or null when `gh` cannot read them. */
const ghRuns = async (repo: Repo, call: Gh | GhAsync): Promise<GhRun[] | null> => {
  const r = await call(repo, ["run", "list", "--branch", repo.main, "--limit", "100", "--json", "conclusion,status,headSha,url,createdAt"]);
  if (!r.ok) return null;
  try { return JSON.parse(r.out); } catch { return null; }
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

const saved = (): Record<string, Ci> => getJson("state", "ci", {});
const savedRunning = (): Record<string, boolean> => getJson("state", "ci.running", {});

/** Reads each repo's CI and saves it, and whether a run on its main is not completed (the `ci.running` row); a repo `gh` cannot read keeps what it had. Returns the red ones. */
export async function ciStep(repos: Repo[], call: Gh | GhAsync = ghAsync): Promise<Ci[]> {
  const lists = await Promise.all(repos.map((repo) => ghRuns(repo, call)));
  const all = saved(), running = savedRunning();
  for (const [k, repo] of repos.entries()) {
    const list = lists[k];
    const c = list && ciState(repo.key, list);
    if (c) all[repo.key] = c;
    if (list) running[repo.key] = list.some((r) => r.status !== "completed");
  }
  putJson("state", "ci", all);
  putJson("state", "ci.running", running);
  return redCi();
}

/** The repo's CI on main as the last read saved it, or undefined. */
export const ciOf = (repo: string): Ci | undefined => saved()[repo];

/** Whether the repo's latest CI read saw a run on main that is not completed. */
export const ciRunning = (repo: string): boolean => savedRunning()[repo] === true;

/** The repos whose CI on main is red now. */
export const redCi = (): Ci[] => Object.values(saved()).filter((c) => !c.ok);

/** A red CI as one line. */
export const ciLine = (c: Ci): string =>
  `${c.repo} CI on main has failed ${c.older ? "at least " : ""}${c.runs} run${c.runs === 1 ? "" : "s"} in a row since ${c.older ? "before " : ""}${c.since?.slice(0, 16).replace("T", " ")} UTC (${c.sinceSha?.slice(0, 7)}): ${c.url}`;
