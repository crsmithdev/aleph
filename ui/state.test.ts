import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../todo/lib/store.ts";
import { add, addPart } from "../todo/lib/todo.ts";
import { state } from "./state.ts";
import { withEnv } from "./test-server.ts";
import { loadRegistry, writeRun } from "../jobs/lib/ledger.ts";
import { removeRun } from "../jobs/lib/record.ts";
import { spawn } from "node:child_process";
import { facts } from "../jobs/lib/status.ts";
import { state as fixture } from "./fixtures/status-state.ts";
import { rows, withAttn } from "./test-now.ts";
import { setAsk } from "../jobs/lib/ask.ts";

// The test's clock: the code under test reads it, and the fixtures sit at known distances from it.
const NOW = Date.parse("2026-11-04T12:00:00Z");
beforeAll(() => setSystemTime(NOW));
afterAll(() => setSystemTime());

let base: string, jobsDir: string, factory: string;
let restore: () => void;
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

const now = new Date(NOW);
const ago = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
const HELD = { kind: "approval", reason: "held-path", question: "", options: [], why: [], situation: "The run changes hooks/x.ts.", effects: [{ action: "land", text: "Merges it." }, { action: "drop", text: "Throws it away." }], recommend: { action: "drop", why: "the path is held" } };
function run(id: string, extra: Record<string, unknown>, files: Record<string, string> = {}) {
  const dir = join(jobsDir, id);
  mkdirSync(dir, { recursive: true });
  writeRun(join(dir), { kind: "build", repo: "fac", told: true, started: ago(3), ...extra } as any);
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-"));
  jobsDir = join(base, "jobs");
  factory = join(base, "factory");
  mkdirSync(jobsDir); mkdirSync(factory);
  const repo = join(base, "repo");
  sh(base, "git", "init", "-q", "-b", "main", repo);
  sh(repo, "git", "remote", "add", "origin", "git@github.com:chris/demo.git");
  const itemsRemote = join(base, "items.git"), items = join(base, "items");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", itemsRemote);
  sh(base, "git", "clone", "-q", itemsRemote, items);
  sh(items, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "git", "push", "-q", "origin", "main");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: repo, sandbox: true, checks: [] } }));
  restore = withEnv({ ALEPH_JOBS_DIR: jobsDir, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: items, ALEPH_FACTORY_DIR: factory, ...gitEnv });
  writeList({ key: "fac" }, "seed", (doc) => {
    for (const t of ["needs item", "waiting goal", "stuck item", "running item", "landed item", "old item"]) add(doc, t, t === "waiting goal" ? { spec: "Do it." } : {});
    add(doc, "urgent goal", { spec: "Do it first.", priority: "critical" });
    return true;
  }, true);

  run("20261027-000001-a", { job: "fac-1", name: "fac-1", condition: "awaiting", ask: HELD, on: "fac-1", stat: " held/x.ts | 2 +-", defaults: ["port? -> 3020"], shown: false, cost: 0.5 },
    { "result.md": "done\nFOLLOWUP: tidy the logs\n" });
  run("20261027-000002-a", { job: "fac-3", name: "fac-3", condition: "stuck", reason: "a check failed", on: "fac-3" });
  run("20261027-000003-a", { job: "fac-4", name: "fac-4", condition: "running", on: "fac-4" });
  run("20261027-000004-a", { job: "fac-5", name: "fac-5", condition: "landed", on: "fac-5", commit: "abcdef1234567", ended: ago(2), started: ago(3) });
  run("20261027-000005-a", { job: "fac-6", name: "fac-6", condition: "landed", on: "fac-6", commit: "123456abcdef", ended: ago(30), started: ago(31) });
  writeFileSync(join(factory, "tick.log"), `${ago(30)} yesterday line\n${now.toISOString()} started none\n`);
});
afterAll(() => {
  restore();
  rmSync(base, { recursive: true, force: true });
});

const runAsks = (s: ReturnType<typeof state>) => s.asks.filter((a) => a.key.startsWith("run:"));

describe("state", () => {

  test("triage lists running runs first, then finished ones with their outcome, and keeps them out of the jobs lists; issues lists the new ones", () => {
    run("20261027-000030-a", { kind: "triage", job: "fac-t1", name: "triage-fac-1", condition: "done", reason: "close", on: "fac-1", started: ago(5), ended: ago(4) });
    run("20261027-000031-a", { kind: "triage", job: "fac-t2", name: "triage-fac-2", condition: "running", on: "fac-2", started: ago(0.1) });
    run("20261027-000032-a", { kind: "triage", job: "fac-t3", name: "triage-fac-3", condition: "done", reason: "malformed verdict: x", on: "fac-3", started: ago(7), ended: ago(6) });
    const s = state(now);
    expect("triage" in s).toBe(false);
    expect(s.running.map((j) => j.name)).toEqual(["fac-4"]);
    expect(s.issues.length).toBe(s.newIssues);
    expect(s.issues.every((i) => i.id.startsWith("fac-") && i.href.startsWith("#/issues/fac/") && i.status === "new")).toBe(true);
    for (const id of ["20261027-000030-a", "20261027-000031-a", "20261027-000032-a"]) (rmSync(join(jobsDir, id), { recursive: true }), removeRun(id));
  });

  test("landing counts land runs in progress; New counts open unlabelled issues, not goals or labelled ones", () => {
    writeList({ key: "fac" }, "more", (doc) => {
      add(doc, "labelled", { spec: "Do it." });
      add(doc, "bare");
      return true;
    }, true);
    run("20261027-000009-a", { kind: "land", job: "fac-8", name: "fac-8", condition: "running" });
    const s = state(now);
    expect(s.landing).toBe(1);
    // New is stage "new": the items with a job (fac-1, 3, 4), the goal and the triaged one are not.
    expect(s.newIssues).toBe(3);
  });

  test("factory.liveRuns counts live agent runs only; land and plan runs stay in running", () => {
    const before = state(now);
    const kids: ReturnType<typeof spawn>[] = [];
    const ids = [["20261027-000050-a", "build", "fac-8"], ["20261027-000051-a", "land", "fac-9"], ["20261027-000052-a", "plan", "plan-fac-2"]] as const;
    try {
      for (const [id, kind, name] of ids) {
        const dir = join(jobsDir, id);
        run(id, { kind, job: name, name, condition: "running" });
        const child = spawn("bash", ["-c", "read; true", "_", dir], { stdio: ["pipe", "ignore", "ignore"] }); // blocks on its stdin until killed
        kids.push(child);
        writeFileSync(join(dir, "pid"), String(child.pid));
      }
      const s = state(now);
      expect(s.factory.liveRuns).toBe(before.factory.liveRuns + 1);
      expect(s.running.some((j) => j.run?.kind === "land")).toBe(true);
      expect(s.running.some((j) => j.run?.kind === "plan")).toBe(true);
    } finally {
      for (const k of kids) k.kill();
      for (const [id] of ids) (rmSync(join(jobsDir, id), { recursive: true }), removeRun(id));
    }
  });

  test("trailers: a landed job's from its commit, an awaiting job's as the land will write them", () => {
    const repo = join(base, "repo");
    sh(repo, "git", "commit", "-q", "--allow-empty", "-m", "land\n\nIssue: fac-1\nJob: fac-7");
    const commit = sh(repo, "git", "rev-parse", "HEAD").trim();
    run("20261027-000007-a", { job: "fac-7", name: "fac-7", condition: "landed", on: "fac-1", commit, ended: ago(1), started: ago(2) });
    const s = state(now);
    expect(s.delivered.find((j) => j.name === "fac-7")!.trailers).toEqual([{ key: "Issue", value: "fac-1" }, { key: "Job", value: "fac-7" }]);
    expect(runAsks(s)[0].trailers).toEqual([{ key: "Issue", value: "fac-1" }, { key: "Job", value: "fac-1" }, { key: "Held-by", value: "Chris" }]);
  });

  test("trailers: an awaiting run on a part previews the part, then its job", () => {
    writeList({ key: "fac" }, "goal of fac-1", (doc) => {
      addPart(doc, doc.items.find((i) => i.id === 1)!, { title: "a goal", spec: "Do it." });
      return true;
    });
    run("20261027-000040-a", { job: "fac-g1", name: "fac-g1", condition: "awaiting", ask: { kind: "input", reason: "question", question: "q", options: [], why: [] }, on: "fac-1.1", ended: ago(1), started: ago(2) });
    const j = state(now).asks.find((x) => x.id === "fac-g1")!;
    expect(j.trailers).toEqual([{ key: "Issue", value: "fac-1.1" }, { key: "Job", value: "fac-g1" }]);
  });

  test("delivered holds the 10 latest lands, newest first", () => {
    for (let i = 0; i < 11; i++) run(`20261027-0001${String(i).padStart(2, "0")}-a`, { job: `fac-l${i}`, name: `fac-l${i}`, condition: "landed", commit: "abcdef1234567", ended: ago(40 + i), started: ago(41 + i) });
    const s = state(now);
    expect(s.delivered).toHaveLength(10);
    // The land in progress (fac-8) comes first, then the landed ones, newest first.
    expect(s.delivered[0].condition).not.toBe("landed");
    expect(s.delivered.slice(0, 4).map((j) => j.name)).toEqual(["fac-8", "fac-7", "fac-5", "fac-6"]);
    expect(s.delivered.map((j) => j.name)).not.toContain("fac-l10");
  });
});

describe("a land that found the job lock busy", () => {
  test("does not make the job stuck, in the UI or in the facts", () => {
    run("20261027-000040-a", { job: "fac-7", name: "fac-7", condition: "passed", on: "fac-2", started: ago(3) });
    run("20261027-000041-a", { kind: "land", job: "fac-7", name: "fac-7", condition: "failed", reason: "job lock busy", on: "fac-2", started: ago(2) });
    const s = state(now);
    expect(s.stuck.map((j) => j.name)).not.toContain("fac-7");
    expect(s.stuck.map((j) => j.name)).toEqual(["fac-3"]);
    const card = s.running.find((j) => j.name === "fac-7")!;
    expect(card.condition).toBe("passed");
    expect(card.reason).not.toBe("job lock busy");
    expect(card.run.kind).toBe("build");
    expect(facts(loadRegistry().fac).open[2]).toBe("passed");
    for (const id of ["20261027-000040-a", "20261027-000041-a"]) (rmSync(join(jobsDir, id), { recursive: true }), removeRun(id));
  });
});

describe("an intake run", () => {
  test("counts as running; triage does not; a done one does not", () => {
    const landing = state(now).landing;
    const ids = ["20261027-000050-a", "20261027-000051-a"];
    run(ids[0], { kind: "intake", job: "intake-fac-2", name: "intake-fac-2", condition: "running", on: "fac-2", started: ago(1) });
    run(ids[1], { kind: "triage", job: "triage-fac-2", name: "triage-fac-2", condition: "running", on: "fac-2", started: ago(1) });
    let s = state(now);
    expect(s.running.map((j) => j.name)).toContain("intake-fac-2");
    expect(s.running.map((j) => j.name)).not.toContain("triage-fac-2");
    expect(runAsks(s).map((a) => a.id)).toEqual(["fac-1"]);
    expect(s.stuck.map((j) => j.name)).toEqual(["fac-3"]);
    expect(s.landing).toBe(landing);
    run(ids[0], { kind: "intake", job: "intake-fac-2", name: "intake-fac-2", condition: "done", on: "fac-2", started: ago(1), ended: ago(0.5) });
    s = state(now);
    expect(s.running.map((j) => j.name)).not.toContain("intake-fac-2");
    expect(s.queued.filter((q) => q.id === 2)).toEqual([{ repo: "fac", id: 2, title: "waiting goal", priority: "medium", stage: "queued", at: expect.any(String), since: expect.any(String), why: "Starts at the next dispatch", kind: "ready" }]);
    for (const id of ids) (rmSync(join(jobsDir, id), { recursive: true }), removeRun(id));
  });
});

describe("a goal that acceptance failed twice", () => {
  test("a held run from before v6 phase 6 still reads: its old phase, and its second review's call.md as the Ask's review", () => {
    run("20261027-000060-a", { job: "fac-60", name: "fac-60", condition: "awaiting", ask: HELD, reason: "held path held/x.ts", stat: " held/x.ts | 1 +", phase: "check oracle" },
      { "review.md": "Fine.\nVERDICT: pass\n", "call.md": "Merged and checked.\nVERDICT: land\n", "call-prompt.md": "old recipe\n" });
    try {
      const a = runAsks(state(now)).find((x) => x.id === "fac-60");
      expect(a).toBeDefined();
      expect(a!.details).toEqual({ note: "held path held/x.ts", stat: " held/x.ts | 1 +", review: { call: "land" } });
      // The Now card renders it.
      const card = rows(withAttn({ ...fixture, stuck: [], factory: { ...fixture.factory, health: [] }, asks: [a!] }))[0];
      expect(card).toContain("Reviewer: land");
    } finally {
      (rmSync(join(jobsDir, "20261027-000060-a"), { recursive: true }), removeRun("20261027-000060-a"));
    }
  });

  test("lists under Needs you, and not under Queued or Done, though a trailer commit on main names it", () => {
    const repo = join(base, "repo");
    const headBefore = Bun.spawnSync(["git", "rev-parse", "-q", "--verify", "HEAD"], { cwd: repo, stdout: "pipe", stderr: "ignore" });
    const before = headBefore.exitCode === 0 ? headBefore.stdout.toString().trim() : null;
    let goalId = 0;
    writeList({ key: "fac" }, "goal that failed acceptance twice", (doc) => {
      const goal = add(doc, "acceptance goal");

      goal.notes.push("- Oracle: `bun test ui/state.test.ts` fails on the acceptance check.");
      goalId = goal.id;
      return true;
    });
    setAsk(`fac-${goalId}`, { kind: "input", reason: "run-cap", question: "", options: [], why: [] });
    try {
      // The trailer commit on main names the goal; origin/main points at it, as a land would leave it.
      sh(repo, "git", "commit", "-q", "--allow-empty", "-m", `Reopen the goal\n\nIssue: fac-${goalId}`);
      sh(repo, "git", "update-ref", "refs/remotes/origin/main", sh(repo, "git", "rev-parse", "HEAD"));
      const s = state(now);
      expect(s.asks.some((a) => a.id === `fac-${goalId}` && a.reason === "run-cap")).toBe(true);
      expect(s.queued.some((q) => q.id === goalId)).toBe(false);
      expect(s.done.some((d) => d.id === `fac-${goalId}`)).toBe(false);
    } finally {
      Bun.spawnSync(["git", "update-ref", "-d", "refs/remotes/origin/main"], { cwd: repo, stdout: "ignore", stderr: "ignore" });
      if (before) sh(repo, "git", "update-ref", "refs/heads/main", before);
      else Bun.spawnSync(["git", "update-ref", "-d", "refs/heads/main"], { cwd: repo, stdout: "ignore", stderr: "ignore" });
    }
  });
});

describe("factory.nextTick and tickInProgress read systemctl show and is-active", () => {
  function withSystemctl(script: string) {
    const dir = mkdtempSync(join(tmpdir(), "aleph-ui-systemctl-"));
    writeFileSync(join(dir, "systemctl"), `#!/bin/sh\n${script}\n`);
    Bun.spawnSync(["chmod", "+x", join(dir, "systemctl")]);
    const restorePath = withEnv({ PATH: `${dir}:${process.env.PATH}` });
    try { const s = state(); return { nextTick: s.factory.nextTick, tickInProgress: s.factory.tickInProgress }; }
    finally { restorePath(); rmSync(dir, { recursive: true, force: true }); }
  }
  const noNext = `if [ "$2" = show ]; then printf 'NextElapseUSecRealtime=\\nNextElapseUSecMonotonic=0\\n'; exit 0; fi`;
  test("a next elapse is the next tick", () => {
    expect(withSystemctl(`[ "$2" = show ] && echo 'NextElapseUSecRealtime=Fri 2026-10-30 18:00:00 UTC' && echo NextElapseUSecMonotonic=0 && exit 0\nexit 1`))
      .toEqual({ nextTick: "2026-10-30T18:00:00.000Z", tickInProgress: false });
  });
  test("a monotonic elapse alone is the next tick, read from list-timers", () => {
    const show = `[ "$2" = show ] && printf 'NextElapseUSecRealtime=\\nNextElapseUSecMonotonic=1d 18h 33min\\n' && exit 0`;
    expect(withSystemctl(`${show}\n[ "$2" = list-timers ] && echo 'Sun 2026-11-01 17:29:05 UTC 2min left Sun 2026-11-01 17:24:05 UTC 3min ago aleph-tick.timer aleph-tick.service' && exit 0\nexit 1`))
      .toEqual({ nextTick: "2026-11-01T17:29:05.000Z", tickInProgress: false });
  });
  test("no next elapse and the service failed or inactive is a dead timer", () => {
    for (const word of ["failed", "inactive"]) expect(withSystemctl(`${noNext}\necho ${word}; exit 3`)).toEqual({ nextTick: null, tickInProgress: false });
  });
  test("systemctl failing gives null and false", () => {
    expect(withSystemctl("exit 1")).toEqual({ nextTick: null, tickInProgress: false });
  });
});
