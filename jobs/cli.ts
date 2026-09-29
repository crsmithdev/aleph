#!/usr/bin/env bun
/**
 * aleph <job|run|land|checked|drop|jobs|todo|unit> — detached agent jobs, plain runs
 * and each repo's to-do list.
 * Ledger: $ALEPH_JOBS_DIR or ~/.aleph/jobs. Registry: $ALEPH_REPOS or
 * ~/.aleph/repos.json. JSON on stdout, findings on stderr, exit 1 on refusal.
 * See docs/specs/2026-09-24-agent-jobs.md.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { allJobs, allRuns, isLive, isLost, isOpen, jobsDir, loadRegistry, lock, newsLine, stamp, updateRun, writeRun, type Entry, type Run } from "./lib/ledger.ts";
import { git, unit } from "./lib/unit.ts";
import * as todos from "../todo/lib/todo.ts";

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

/**
 * Start a land run. The latest agent run decides: passed, or needs-you for a
 * manual check that Chris confirmed with --checked. With --unchecked, Chris
 * lands before the check and the land run keeps the check open. The land unit
 * takes the job lock.
 */
async function landJob(): Promise<void> {
  const name = checkName(positional[0]);
  const runs = allJobs().find((j) => isOpen(j) && j.at(-1)!.run.name === name) ?? refuse(`no open job named ${name}`);
  const live = runs.find((e) => isLive(e.folder));
  if (live) refuse(`${name} is running as ${live.id}`);
  const agent = runs.filter((e) => e.run.kind === "agent").at(-1)!.run;
  const manual = agent.state === "needs-you" && agent.needs === "manual";
  const unchecked = manual && rest.includes("--unchecked");
  if (manual && !rest.includes("--checked") && !unchecked) {
    refuse(`${name} needs a manual check: ${agent.say}; land with --checked after it, or with --unchecked only when Chris asks to land before the check`);
  }
  if (agent.state !== "passed" && !manual) refuse(`${name} is ${agent.state}${agent.needs ? ` (${agent.needs})` : ""}, not passed`);
  const repo = loadRegistry()[agent.repo!];
  const child = await dispatch({
    kind: "land", job: agent.job, name, repo: agent.repo, branch: agent.branch, worktree: agent.worktree,
    state: "running", phase: "land", told: false, started: new Date().toISOString(),
    ...(unchecked ? { check: "open" as const, say: agent.say } : {}),
  }, `${repo.key}-${name}`, repo.path, () => {});
  await child?.exited;
}

/** Close the manual check of a job that landed with --unchecked. */
function checked(): void {
  const name = checkName(positional[0]);
  const last = allJobs().filter((j) => j.at(-1)!.run.name === name).at(-1)?.at(-1);
  if (!last || last.run.state !== "landed" || last.run.check !== "open") refuse(`${name} has no open check`);
  updateRun(last!.folder, { check: "done" });
  out({ job: last!.run.job, name, state: "landed", check: "done" });
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
    reason: r.reason, say: r.say, ...(r.state === "landed" && r.check ? { check: r.check } : {}), session: r.session, started: first.run.started, ended: r.ended,
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
  // A job that landed with its check open stays in the list until `aleph checked`.
  if (!name) return out(all.filter((j) => isOpen(j) || (j.at(-1)!.run.state === "landed" && j.at(-1)!.run.check === "open")).map(summary));
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

/**
 * aleph todo <add|list|show|note|done|drop|lint> <repo> ... — every repo in the
 * registry has a list; `docs/todo.md` is the file. Status is a field, so an
 * item never moves and never gets a new number.
 */
function todoCmd(): void {
  const [verb, repoKey, ...args] = positional;
  const sub = verb ?? refuse("usage: aleph todo <add|list|show|note|done|drop|lint> <repo> ...");
  const repo = loadRegistry()[repoKey ?? ""] ?? refuse(repoKey ? `no repo named ${repoKey}` : "name a repo");
  const file = todos.todoPath(repo.path);
  if (!existsSync(file)) refuse(`no ${file}`);
  const doc = todos.parse(readFileSync(file, "utf8"));

  const item = (): todos.Item => {
    const id = Number(args[0]);
    if (!Number.isInteger(id)) refuse("name an item by its number");
    return todos.find(doc, id) ?? refuse(`${repo.key} has no item ${id}`);
  };
  const save = () => writeFileSync(file, todos.render(doc));
  const brief = (i: todos.Item) => ({ id: i.id, title: i.title, status: todos.status(i), priority: i.fm.priority ?? null, labels: i.fm.labels ?? [], updated: i.fm.updated ?? null, notes: i.notes.length, legacy: i.legacy || undefined });

  switch (sub) {
    case "add": {
      const title = args.join(" ").trim() || refuse("give the item a title");
      const labels = (flag("labels") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const made = todos.add(doc, title, { priority: flag("priority"), labels });
      save();
      out({ repo: repo.key, added: made.id, title: made.title, file });
      return;
    }
    case "list": {
      const want = flag("status");
      if (want && !todos.STATUSES.includes(want as todos.Status)) refuse(`status must be one of ${todos.STATUSES.join(", ")}`);
      const label = flag("label");
      const rows = doc.items
        .filter((i) => (want ? todos.status(i) === want : true))
        .filter((i) => (label ? ((i.fm.labels as string[]) ?? []).includes(label) : true));
      if (rest.includes("--json")) { out(rows.map(brief)); return; }
      if (!rows.length) { console.log("no items"); return; }
      const w = String(Math.max(...rows.map((i) => i.id))).length;
      for (const i of rows) console.log(`${String(i.id).padStart(w)}  ${todos.status(i).padEnd(7)} ${i.title}`);
      return;
    }
    case "show": {
      const i = item();
      if (rest.includes("--json")) { out({ ...brief(i), body: i.body, notes: i.notes }); return; }
      console.log(`## ${i.id}. ${i.title}`);
      console.log(`status ${todos.status(i)}   priority ${i.fm.priority ?? "-"}   labels ${(((i.fm.labels as string[]) ?? []).join(", ")) || "-"}   updated ${i.fm.updated ?? "-"}`);
      if (i.body.trim()) console.log(`\n${i.body}`);
      if (i.notes.length) console.log(`\n### Notes\n${i.notes.join("\n")}`);
      return;
    }
    case "note": {
      const i = item();
      const text = args.slice(1).join(" ").trim() || refuse("give the note some text");
      const line = todos.note(i, text);
      save();
      out({ repo: repo.key, id: i.id, note: line });
      return;
    }
    case "done":
    case "drop": {
      const i = item();
      const text = args.slice(1).join(" ").trim();
      if (sub === "drop" && !text) refuse("say why it is dropped");
      todos.setStatus(i, sub === "done" ? "done" : "dropped");
      if (text) todos.note(i, text);
      save();
      out({ repo: repo.key, id: i.id, status: todos.status(i), title: i.title });
      return;
    }
    case "lint": {
      if (rest.includes("--fix")) {
        const fixed = todos.fix(doc);
        if (fixed.length) save();
        const left = todos.lint(doc);
        out({ repo: repo.key, fixed, remaining: left });
        if (left.length) process.exit(1);
        return;
      }
      const findings = todos.lint(doc);
      if (!findings.length) { out({ repo: repo.key, items: doc.items.length, findings: [] }); return; }
      for (const f of findings) console.error(`item ${f.id}: ${f.problem}${f.fixable ? " (--fix repairs this)" : ""}`);
      refuse(`${findings.length} problem${findings.length > 1 ? "s" : ""} in ${file}`);
    }
    default: refuse("usage: aleph todo <add|list|show|note|done|drop|lint> <repo> ...");
  }
}

try {
  switch (cmd) {
    case "job": await job(); break;
    case "run": await plain(); break;
    case "jobs": jobs(); break;
    case "drop": await drop(); break;
    case "unit": await unit(resolve(positional[0])); break;
    case "land": await landJob(); break;
    case "checked": checked(); break;
    case "todo": todoCmd(); break;
    default: refuse("usage: aleph <job|run|land|checked|drop|jobs|todo> ...");
  }
} catch (e) {
  if (!(e instanceof Refusal)) throw e;
  console.error(e.message);
  process.exit(1);
}
