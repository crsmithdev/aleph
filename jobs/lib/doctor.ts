/**
 * `aleph doctor`: one command that checks the machine after an outage. Read-only
 * unless `fix` is set; `fix` makes the two safe repairs and nothing else.
 */
import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { git } from "./git.ts";
import { allRuns, isLost, loadRegistry } from "./ledger.ts";
import { lastProbe } from "./factory.ts";
import { SKEW_LIMIT_MS, STEP_LIMIT_MS, watchWall, windowsSkew } from "./clock.ts";
import { FACTS_REF, writeFacts } from "./status.ts";

export interface Check { name: string; ok: boolean; detail: string }

const ok = (name: string, detail: string): Check => ({ name, ok: true, detail });
const bad = (name: string, detail: string): Check => ({ name, ok: false, detail });

const PROBE_STALE_MS = 26 * 3600_000;
const CLOCK_WINDOW_MS = () => Number(process.env.ALEPH_DOCTOR_CLOCK_MS ?? 15_000);
const HOME_URL = () => process.env.ALEPH_HOME_URL ?? "http://aleph.home/";

function systemctl(...args: string[]): { ok: boolean; out: string } {
  const bin = process.env.ALEPH_SYSTEMCTL ?? "systemctl";
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

/** Zero-length loose objects and packs under .git/objects: the files a power loss leaves. */
export function emptyObjects(path: string): string[] {
  const dir = objectsDir(path);
  if (!dir) return [];
  const found: string[] = [];
  const walk = (d: string, depth: number) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const s = statSync(p);
      if (s.isDirectory()) { if (depth < 2) walk(p, depth + 1); }
      else if (s.size === 0) found.push(p);
    }
  };
  walk(dir, 0);
  return found;
}

/** The object id a loose object file holds, or null for a pack or anything else. */
function looseId(file: string): string | null {
  const id = basename(dirname(file)) + basename(file);
  return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(id) && basename(dirname(dirname(file))) === "objects" ? id : null;
}

/** Ids of everything the refs other than refs/aleph/facts reach (rev-list lists blobs without opening them), or null when that walk fails. */
function realIds(path: string): Set<string> | null {
  if (!git(path, "rev-parse", "--verify", "-q", FACTS_REF).ok) return null;
  const r = git(path, "rev-list", "--objects", `--exclude=${FACTS_REF}`, "--all");
  return r.ok ? new Set(r.out.split("\n").map((l) => l.split(" ")[0]!).filter(Boolean)) : null;
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

export function unitChecks(): Check[] {
  const checks: Check[] = [];
  for (const unit of ["aleph-ui", "home-proxy", "aleph-tick.timer"]) {
    const r = systemctl("is-active", unit);
    checks.push(r.ok && r.out === "active" ? ok(`unit ${unit}`, "active") : bad(`unit ${unit}`, r.out.split("\n")[0] || "not active"));
  }
  const t = systemctl("show", "aleph-tick.timer", "-p", "NextElapseUSecRealtime", "-p", "NextElapseUSecMonotonic");
  const next = t.out.split("\n").map((l) => l.split("=")[1]?.trim()).filter((v) => v && v !== "0" && v !== "n/a" && v !== "infinity");
  checks.push(t.ok && next.length ? ok("timer next run", next[0]!) : bad("timer next run", "aleph-tick.timer has no next run"));
  return checks;
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

export function probeCheck(now = Date.now()): Check {
  const p = lastProbe();
  if (!p) return bad("last probe", "none recorded");
  if (!p.ok) return bad("last probe", `failed at ${p.at}: ${p.failed.join("; ")}`);
  if (now - Date.parse(p.at) > PROBE_STALE_MS) return bad("last probe", `passed at ${p.at}, more than 26 hours ago`);
  return ok("last probe", `passed at ${p.at}`);
}

export function lostCheck(): Check {
  const lost = allRuns().filter((e) => isLost(e.folder)).map((e) => e.id);
  return lost.length ? bad("lost runs", `${lost.length}: ${lost.join(", ")}`) : ok("lost runs", "none");
}

export async function doctor(): Promise<Check[]> {
  const [clock, home] = await Promise.all([clockChecks(), homeCheck()]);
  return [...clock, ...gitChecks(), ...unitChecks(), home, probeCheck(), lostCheck()];
}

/**
 * The safe repairs. An empty object is removed only when every other ref still
 * walks clean, so the only thing behind it is refs/aleph/facts, which the
 * ledger and the store make again. Then the tick starts.
 */
export function fix(): string[] {
  const said: string[] = [];
  for (const repo of Object.values(loadRegistry())) {
    const empties = emptyObjects(repo.path);
    if (!empties.length) continue;
    const real = realIds(repo.path);
    const gone = real ? empties.filter((f) => { const id = looseId(f); return id !== null && !real.has(id); }) : [];
    if (gone.length < empties.length) said.push(`${repo.key}: ${empties.length - gone.length} empty object(s) left: not only behind ${FACTS_REF}`);
    if (!gone.length) continue;
    for (const f of gone) unlinkSync(f);
    git(repo.path, "update-ref", "-d", FACTS_REF);
    const wrote = (() => { try { writeFacts(repo); return true; } catch { return false; } })();
    said.push(`${repo.key}: removed ${gone.length} empty object(s); ${wrote ? `wrote ${FACTS_REF} again` : `${FACTS_REF} is gone and the next run writes it`}`);
  }
  const t = systemctl("start", "--no-block", "aleph-tick.service");
  said.push(t.ok ? "started aleph-tick.service" : `could not start aleph-tick.service: ${t.out}`);
  return said;
}
