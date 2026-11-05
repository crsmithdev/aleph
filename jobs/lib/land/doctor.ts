/**
 * `aleph doctor`: one command that checks the machine after an outage. Read-only
 * unless `fix` is set; `fix` starts the tick and nothing else.
 */
import { existsSync, lstatSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { git } from "../infra/git.ts";
import { allRuns, loadRegistry } from "../records/ledger.ts";
import { isLost } from "../infra/process.ts";
import { SKEW_LIMIT_MS, STEP_LIMIT_MS, watchWall, windowsSkew } from "../infra/clock.ts";
import { doctorClockMs, homeUrl, systemctlBin, unitDir } from "../infra/settings.ts";

export interface Check { name: string; ok: boolean; detail: string }

const ok = (name: string, detail: string): Check => ({ name, ok: true, detail });
const bad = (name: string, detail: string): Check => ({ name, ok: false, detail });

const CLOCK_WINDOW_MS = () => doctorClockMs();
const HOME_URL = () => homeUrl();

function systemctl(...args: string[]): { ok: boolean; out: string } {
  const bin = systemctlBin();
  try {
    const p = Bun.spawnSync([bin, "--user", ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: 15_000 });
    return { ok: p.exitCode === 0, out: (p.stdout.toString() + p.stderr.toString()).trim() };
  } catch (e: any) {
    return { ok: false, out: e?.message ?? String(e) };
  }
}

/** The repo's object directory (a worktree's .git is a file, so ask git), or null when it is not a repo. */
function objectsDir(path: string): string | null {
  if (!existsSync(path)) return null;
  const r = git(path, "rev-parse", "--path-format=absolute", "--git-path", "objects");
  return r.ok ? resolve(path, r.out) : null;
}

/**
 * Zero-length loose objects and packs under .git/objects: the files a power loss leaves.
 * Other files there, such as git's *.lock files, are not objects and are not counted.
 */
export function emptyObjects(path: string): string[] {
  const dir = objectsDir(path);
  if (!dir) return [];
  const found: string[] = [];
  const walk = (d: string, depth: number) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const s = statSync(p);
      if (s.isDirectory()) { if (depth < 2) walk(p, depth + 1); }
      else if (s.size === 0 && (looseId(p) !== null || isPack(p))) found.push(p);
    }
  };
  walk(dir, 0);
  return found;
}

/** A `pack-*` file directly in objects/pack. */
function isPack(file: string): boolean {
  return basename(file).startsWith("pack-") && basename(dirname(file)) === "pack" && basename(dirname(dirname(file))) === "objects";
}

/** The object id a loose object file holds, or null for a pack or anything else. */
function looseId(file: string): string | null {
  const id = basename(dirname(file)) + basename(file);
  return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(id) && basename(dirname(dirname(file))) === "objects" ? id : null;
}

export async function clockChecks(): Promise<Check[]> {
  const step = await watchWall(CLOCK_WINDOW_MS());
  const secs = Math.round(CLOCK_WINDOW_MS() / 1000);
  const checks = [Math.abs(step) > STEP_LIMIT_MS
    ? bad("wall clock", `stepped ${Math.round(step)} ms against the monotonic clock in ${secs} s`)
    : ok("wall clock", `held against the monotonic clock over ${secs} s (${Math.round(step)} ms)`)];
  const skew = windowsSkew();
  checks.push(skew === null ? ok("WSL clock", "no Windows time to compare (not WSL, or Windows did not answer)")
    : Math.abs(skew) > SKEW_LIMIT_MS ? bad("WSL clock", `${Math.round(skew / 1000)} s from Windows time`)
    : ok("WSL clock", `${Math.round(skew)} ms from Windows time`));
  return checks;
}

export function gitChecks(): Check[] {
  const repos = Object.values(loadRegistry());
  const empties: string[] = [];
  const broken: string[] = [];
  for (const repo of repos) {
    for (const f of emptyObjects(repo.path)) empties.push(`${repo.key}: ${f}`);
    if (objectsDir(repo.path) && !git(repo.path, "fsck", "--no-dangling").ok) broken.push(repo.key);
  }
  return [
    empties.length ? bad("empty objects", `${empties.length} in ${repos.length} repos: ${empties.join("; ")}`) : ok("empty objects", `none in ${repos.length} repos`),
    broken.length ? bad("git fsck", `fails in ${broken.join(", ")}`) : ok("git fsck", `clean in ${repos.length} repos`),
  ];
}

/** The timers whose next run doctor checks: the tick and the suite. */
const TIMERS = ["aleph-tick.timer", "aleph-suite.timer"];

/**
 * The time to each timer's next run, from `systemctl list-timers --output=json`, whose `next` is wall-clock
 * microseconds. `NextElapseUSecMonotonic` is not that time: for an `OnUnitActiveSec` timer it is a point on the
 * monotonic clock, counted from boot, so it reads as the uptime plus the wait.
 */
export function timerChecks(now = Date.now()): Check[] {
  const r = systemctl("list-timers", "--all", "--output=json", ...TIMERS);
  let rows: { unit: string; next?: number | null }[] = [];
  try { rows = r.ok ? JSON.parse(r.out) : []; } catch {}
  return TIMERS.map((unit) => {
    const name = `${unit} next run`;
    const next = rows.find((x) => x.unit === unit)?.next;
    if (next) return ok(name, `in ${wait(next / 1000 - now)} (${new Date(next / 1000).toISOString()})`);
    const service = unit.replace(/\.timer$/, ".service");
    if (r.ok && inProgress(service)) return ok(name, `${service} is running`);
    return bad(name, r.ok ? `${unit} has no next run` : r.out.split("\n")[0] || "systemctl failed");
  });
}

/** `4 min 10 s`, `45 s`; a time past is `0 s`. */
function wait(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}

export function unitChecks(now = Date.now()): Check[] {
  const checks: Check[] = [];
  for (const unit of ["aleph-ui", "home-proxy", ...TIMERS]) {
    const r = systemctl("is-active", unit);
    checks.push(r.ok && r.out === "active" ? ok(`unit ${unit}`, "active") : bad(`unit ${unit}`, r.out.split("\n")[0] || "not active"));
  }
  return [...checks, ...timerChecks(now)];
}

/** A oneshot service reports `activating` while it runs (exit 3), so read the state word and ignore the exit code. */
function inProgress(service: string): boolean {
  const state = systemctl("is-active", service).out.split("\n")[0]?.trim();
  return state === "activating" || state === "active";
}

export async function homeCheck(): Promise<Check> {
  const url = HOME_URL();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "manual" });
    return r.status < 400 ? ok("aleph.home", `${url} answered ${r.status}`) : bad("aleph.home", `${url} answered ${r.status}`);
  } catch (e: any) {
    return bad("aleph.home", `${url}: ${e?.message ?? e}`);
  }
}

export function lostCheck(): Check {
  const lost = allRuns().filter((e) => isLost(e.folder)).map((e) => e.id);
  return lost.length ? bad("lost runs", `${lost.length}: ${lost.join(", ")}`) : ok("lost runs", "none");
}

/** Every symlink in the unit folder and its *.wants folders must point at a file outside `.worktrees/`. */
export function linkCheck(): Check {
  const root = unitDir();
  const dirs = [root, ...(existsSync(root) ? readdirSync(root).filter((n) => n.endsWith(".wants")).map((n) => join(root, n)) : [])];
  const badLinks: string[] = [];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (!lstatSync(p).isSymbolicLink()) continue;
      const target = resolve(d, readlinkSync(p));
      if (target.split("/").includes(".worktrees")) badLinks.push(`${p} -> ${target} (in a worktree)`);
      else if (!existsSync(p)) badLinks.push(`${p} -> ${target} (missing)`);
    }
  }
  return badLinks.length ? bad("unit links", badLinks.join("; ")) : ok("unit links", "none point into a worktree or a missing file");
}

export async function doctor(): Promise<Check[]> {
  const [clock, home] = await Promise.all([clockChecks(), homeCheck()]);
  return [...clock, ...gitChecks(), ...unitChecks(), home, lostCheck(), linkCheck()];
}

/** The safe repair: the tick starts. An empty object stays: `aleph doctor` names it, and Chris decides. */
export function fix(): string[] {
  const said: string[] = [];
  const t = systemctl("start", "--no-block", "aleph-tick.service");
  said.push(t.ok ? "started aleph-tick.service" : `could not start aleph-tick.service: ${t.out}`);
  return said;
}
