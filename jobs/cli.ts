#!/usr/bin/env bun
/**
 * aleph <job|run|land|drop|jobs|unit> — detached agent jobs and plain runs.
 * Ledger: $ALEPH_JOBS_DIR or ~/.aleph/jobs. Registry: $ALEPH_REPOS or
 * ~/.aleph/repos.json. JSON on stdout, findings on stderr, exit 1 on refusal.
 * See docs/specs/2026-09-24-agent-jobs.md.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { allJobs, allRuns, isLive, isLost, isOpen, jobsDir, loadRegistry, lock, newsLine, stamp, updateRun, writeRun, type Entry, type Run } from "./lib/ledger.ts";
import { git, unit } from "./lib/unit.ts";

const CLI = import.meta.path;
const CAP = 5;
const PID_WAIT_MS = 10_000;

class Refusal extends Error {}
const refuse = (msg: string): never => { throw new Refusal(msg); };
const out = (value: unknown) => console.log(JSON.stringify(value, null, 2));

const [cmd, ...rest] = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}
const positional = rest.filter((a, i) => !a.startsWith("--") && !["--spec", "--model"].includes(rest[i - 1]));

function checkName(name: string | undefined): string {
  if (!name || !/^[A-Za-z0-9-]+$/.test(name)) refuse("the name must be letters, digits and hyphens");
  return name!;
}

const quote = (argv: string[]) => argv.map((a) => /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replaceAll("'", `'\\''`)}'`).join(" ");

/**
 * Create the run folder and start its unit, under the dispatch lock. The lock
 * is held until the unit writes `pid`, so a second dispatch counts this run.
 */
/** Returns the unit's process in foreground mode, for the caller to wait on after it drops its locks. */
async function dispatch(run: Omit<Run, "job"> & { job?: string }, tag: string, cwd: string, prep: (folder: string) => void): Promise<ReturnType<typeof Bun.spawn> | undefined> {
  const release = await lock("dispatch");
  if (!release) refuse("another dispatch holds the lock");
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let id: string;
  try {
    if (run.kind === "agent") {
      const live = allRuns().filter((e) => e.run.kind === "agent" && isLive(e.folder));
      if (live.length >= CAP) refuse(`${live.length} agent runs are live: ${live.map((e) => e.run.name).join(", ")}`);
    }
    mkdirSync(jobsDir(), { recursive: true });
    for (;;) {
      id = `${stamp()}-${tag}-${run.kind}`;
      if (!existsSync(join(jobsDir(), id))) break;
      await Bun.sleep(200);
    }
    const folder = join(jobsDir(), id);
    mkdirSync(folder);
    writeFileSync(join(folder, "command.txt"), quote(["aleph", ...process.argv.slice(2)]) + "\n");
    prep(folder);
    writeRun(folder, { ...run, job: run.job ?? id } as Run);

    if (process.env.ALEPH_JOB_FOREGROUND === "1") {
      child = Bun.spawn([process.execPath, CLI, "unit", folder], { cwd, env: process.env, stdout: "inherit", stderr: "inherit" });
    } else {
      const pass = Object.entries(process.env).filter(([k]) => k.startsWith("ALEPH_") || k.startsWith("SIDETONE_")).map(([k, v]) => `--setenv=${k}=${v}`);
      const p = Bun.spawnSync(["systemd-run", "--user", "--collect", "--quiet", `--unit=aleph-${id}`, `--working-directory=${cwd}`,
        `--setenv=PATH=${process.env.PATH}`, ...pass, process.execPath, CLI, "unit", folder], { stdout: "pipe", stderr: "pipe" });
      if (p.exitCode !== 0) {
        updateRun(folder, { state: "failed", reason: `systemd-run failed: ${p.stderr.toString().trim()}`, ended: new Date().toISOString() });
        refuse(`systemd-run failed: ${p.stderr.toString().trim()}`);
      }
    }
    const deadline = Date.now() + PID_WAIT_MS;
    while (!existsSync(join(folder, "pid")) && Date.now() < deadline) await Bun.sleep(25);
    if (!existsSync(join(folder, "pid"))) console.error(`warn: ${id} wrote no pid in ${PID_WAIT_MS / 1000} s`);
  } finally {
    release!();
  }
  out({ run: id!, job: run.job ?? id!, folder: join(jobsDir(), id!) });
  return child;
}

async function job(): Promise<void> {
  const [repoArg, nameArg] = positional;
  const registry = loadRegistry();
  const key = (repoArg ?? "").toLowerCase().replace(/\s+/g, "");
  const repo = registry[key] ?? refuse(`unknown repo "${repoArg ?? ""}"; known: ${Object.keys(registry).join(", ")}`);
  const name = checkName(nameArg);
  const specArg = flag("spec") ?? refuse("--spec <file|-> is required");
  const spec = specArg === "-" ? await Bun.stdin.text() : readFileSync(specArg, "utf8");

  const release = await lock(`job-${repo.key}-${name}`);
  if (!release) refuse(`job ${name} is busy`);
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const open = allJobs().find((j) => isOpen(j) && j.at(-1)!.run.name === name);
    const last = open?.at(-1);
    if (last && last.run.repo !== repo.key) refuse(last.run.repo ? `${name} is open in ${last.run.repo}` : `${name} is running as ${last.id}`);
    if (last && isLive(last.folder)) refuse(`${name} is running as ${last.id}`);
    const first = open?.[0];
    const worktree = first?.run.worktree ?? join(repo.path, ".worktrees", `job-${name}`);
    const model = flag("model");
    child = await dispatch({
      kind: "agent", job: first?.id, name, repo: repo.key, branch: `job/${name}`, worktree,
      state: "running", phase: "starting", session: crypto.randomUUID(), ...(model ? { model } : {}),
      told: false, started: new Date().toISOString(),
    }, `${repo.key}-${name}`, repo.path, (folder) => {
      if (!first) return writeFileSync(join(folder, "spec.md"), spec);
      const notes = join(first.folder, "notes");
      mkdirSync(notes, { recursive: true });
      writeFileSync(join(notes, `${String(readdirSync(notes).length + 1).padStart(3, "0")}.md`), spec);
    });
  } finally {
    release!();
  }
  await child?.exited;
}

async function plain(): Promise<void> {
  const dash = rest.indexOf("--");
  const name = checkName(rest[0]);
  const argv = dash >= 0 ? rest.slice(dash + 1) : [];
  if (!argv.length) refuse("usage: aleph run <name> -- <command> [args...]");
  const release = await lock(`job--${name}`);
  if (!release) refuse(`${name} is busy`);
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const live = allJobs().find((j) => isOpen(j) && j.at(-1)!.run.name === name);
    if (live) refuse(`${name} is open as ${live.at(-1)!.id}`);
    // A command inside a registered repo gets that repo's env file, as scripts/job gave Sidetone's.
    const cwd = process.cwd();
    const home = Object.values(loadRegistry()).find((r) => r.env && (cwd === r.path || cwd.startsWith(r.path + "/")));
    if (home?.env) process.env.ALEPH_RUN_ENV = home.env;
    child = await dispatch({ kind: "plain", name, state: "running", phase: "command", told: false, started: new Date().toISOString() }, name, cwd, (folder) => {
      writeFileSync(join(folder, "command.txt"), quote(argv) + "\n");
    });
  } finally {
    release!();
  }
  await child?.exited;
}

function read(folder: string, file: string): string | undefined {
  const p = join(folder, file);
  return existsSync(p) ? readFileSync(p, "utf8") : undefined;
}

function summary(runs: Entry[]) {
  const first = runs[0];
  const last = runs.at(-1)!;
  const r = last.run;
  const goal = (read(first.folder, "spec.md") ?? read(first.folder, "command.txt") ?? "").trim().split("\n")[0];
  return {
    name: r.name, repo: r.repo, kind: r.kind, job: r.job, run: last.id, goal, state: r.state, needs: r.needs, phase: r.phase,
    reason: r.reason, say: r.say, session: r.session, started: first.run.started, ended: r.ended,
    ...(isLost(last.folder) ? { lost: true } : {}),
  };
}

function jobs(): void {
  if (rest.includes("--news")) {
    const news: { run: string; line: string }[] = [];
    for (const e of allRuns()) {
      if (e.run.state === "running" || e.run.told) continue;
      news.push({ run: e.id, line: newsLine(e.run, e.run.repo ? loadRegistry()[e.run.repo]?.note : undefined) });
      updateRun(e.folder, { told: true });
    }
    return out(news);
  }
  const all = allJobs();
  const name = positional[0];
  if (!name) return out(all.filter(isOpen).map(summary));
  const runs = all.filter(isOpen).find((j) => j.at(-1)!.run.name === name) ?? all.filter((j) => j.at(-1)!.run.name === name).at(-1);
  if (!runs) refuse(`no job named ${name}`);
  const last = runs!.at(-1)!;
  const checks = read(last.folder, "checks.log");
  out({
    ...summary(runs!), question: last.run.question, result: read(last.folder, "result.md"),
    checks: checks?.trimEnd().split("\n").slice(-40).join("\n"), land: read(last.folder, "land.log"),
  });
}

async function drop(): Promise<void> {
  const name = checkName(positional[0]);
  const reason = positional.slice(1).join(" ") || "dropped by Chris";
  const runs = allJobs().find((j) => isOpen(j) && j.at(-1)!.run.name === name) ?? refuse(`no open job named ${name}`);
  const last = runs.at(-1)!;
  const release = await lock(`job-${last.run.repo ?? ""}-${name}`);
  if (!release) refuse(`job ${name} is busy`);
  try {
    if (runs.some((e) => e.run.kind === "land" && isLive(e.folder))) refuse("landing");
    if (isLive(last.folder)) {
      Bun.spawnSync(["systemctl", "--user", "stop", `aleph-${last.id}`], { stdout: "ignore", stderr: "ignore" });
      if (isLive(last.folder)) process.kill(Number(readFileSync(join(last.folder, "pid"), "utf8")), "SIGTERM");
      const deadline = Date.now() + 35_000;
      while (isLive(last.folder) && Date.now() < deadline) await Bun.sleep(50);
    }
    if (!existsSync(join(last.folder, "exit"))) writeFileSync(join(last.folder, "exit"), "143");
    const repo = last.run.repo ? loadRegistry()[last.run.repo] : undefined;
    if (repo && last.run.worktree) {
      git(repo.path, "worktree", "remove", "--force", last.run.worktree);
      git(repo.path, "worktree", "prune");
      git(repo.path, "branch", "-D", last.run.branch!);
    }
    // Chris asked for the drop, so it is not news.
    updateRun(last.folder, { state: "dropped", reason, needs: undefined, phase: undefined, told: true, ended: new Date().toISOString() });
    out({ job: last.run.job, name, state: "dropped", reason });
  } finally {
    release!();
  }
}

try {
  switch (cmd) {
    case "job": await job(); break;
    case "run": await plain(); break;
    case "jobs": jobs(); break;
    case "drop": await drop(); break;
    case "unit": await unit(resolve(positional[0])); break;
    case "land": refuse("land is not built yet (milestone 2)"); break;
    default: refuse("usage: aleph <job|run|land|drop|jobs> ...");
  }
} catch (e) {
  if (!(e instanceof Refusal)) throw e;
  console.error(e.message);
  process.exit(1);
}
