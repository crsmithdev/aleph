import { afterAll, afterEach, beforeAll, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import * as store from "../issues/lib/store.ts";
import { writeList } from "../issues/lib/store.ts";
import { add, setStatus } from "../issues/lib/todo.ts";
import { addPart } from "../issues/lib/parts.fixture.ts";
import { jobProjector, state } from "./state.ts";
import { withEnv } from "./test-server.ts";
import { loadRegistry } from "../jobs/lib/records/ledger.ts";
import { allJobs } from "../jobs/lib/records/job.ts";
import { archiveOld, putRun, removeRun } from "../jobs/lib/records/record.ts";
import { spawn } from "node:child_process";
import { facts } from "../jobs/lib/records/status.ts";
import { state as fixture } from "./fixtures/status-state.ts";
import { rows, withAttn } from "./test-now.ts";
import { setAsk } from "../jobs/lib/asks/ask.ts";

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
let seq = 0;
// The runs a test adds, removed after it, so no test sees another's runs.
let made = new Set<string>();
function run(id: string, extra: Record<string, unknown>, files: Record<string, string> = {}) {
  const dir = join(jobsDir, id);
  mkdirSync(dir, { recursive: true });
  made.add(id);
  putRun(basename(join(dir)), { kind: "build", repo: "fac", told: true, started: ago(3), n: ++seq, ...extra } as any);
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

  run("20261027-000001-a", { job: "fac-1", name: "fac-1", condition: "waiting", ask: HELD, on: "fac-1", stat: " held/x.ts | 2 +-", defaults: ["port? -> 3020"], shown: false, cost: 0.5 },
    { "result.md": "done\nFOLLOWUP: tidy the logs\n" });
  run("20261027-000002-a", { job: "fac-3", name: "fac-3", condition: "failed", reason: "a check failed", on: "fac-3" });
  run("20261027-000003-a", { job: "fac-4", name: "fac-4", condition: "running", on: "fac-4" });
  run("20261027-000004-a", { job: "fac-5", name: "fac-5", condition: "landed", on: "fac-5", commit: "abcdef1234567", ended: ago(2), started: ago(3) });
  run("20261027-000005-a", { job: "fac-6", name: "fac-6", condition: "landed", on: "fac-6", commit: "123456abcdef", ended: ago(30), started: ago(31) });
  made = new Set();
});
afterEach(() => {
  for (const id of made) (rmSync(join(jobsDir, id), { recursive: true, force: true }), removeRun(id));
  made = new Set();
});
afterAll(() => {
  restore();
  rmSync(base, { recursive: true, force: true });
});

const runAsks = (s: ReturnType<typeof state>) => s.asks.filter((a) => a.key.startsWith("run:"));

describe("state", () => {

  test("a build reads the records that are not archived, while allJobs still reads the archived ones", () => {
    const ids = ["20261027-000070-a", "20261027-000071-a"];
    run(ids[0], { job: "fac-70", name: "fac-70", condition: "failed", reason: "a check failed", on: "fac-70", started: ago(240), ended: ago(239) });
    run(ids[1], { job: "fac-71", name: "fac-71", condition: "failed", reason: "a check failed", on: "fac-71", started: ago(3), ended: ago(2) });
    try {
      expect(archiveOld(now.getTime())).toEqual(["fac-70"]);
      const names = (s: ReturnType<typeof state>) => s.stuck.map((j) => j.name).filter((m) => m === "fac-70" || m === "fac-71");
      expect(names(state(now))).toEqual(["fac-71"]);
      expect(allJobs().map((j) => j[0].run.name)).toContain("fac-70");
    } finally {
      for (const id of ids) (rmSync(join(jobsDir, id), { recursive: true }), removeRun(id));
    }
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
    const landed = jobProjector().toJob(allJobs().find((rs) => rs[0].run.name === "fac-7")!);
    expect(landed.trailers).toEqual([{ key: "Issue", value: "fac-1" }, { key: "Job", value: "fac-7" }]);
    expect(runAsks(s)[0].trailers).toEqual([{ key: "Issue", value: "fac-1" }, { key: "Job", value: "fac-1" }, { key: "Held-by", value: "Chris" }]);
  });

  test("trailers: an awaiting run on a part previews the part, then its job", () => {
    writeList({ key: "fac" }, "goal of fac-1", (doc) => {
      addPart(doc, doc.items.find((i) => i.id === 1)!, { title: "a goal", spec: "Do it." });
      return true;
    });
    run("20261027-000040-a", { job: "fac-g1", name: "fac-g1", condition: "waiting", ask: { kind: "input", reason: "question", question: "q", options: [], why: [] }, on: "fac-1.1", ended: ago(1), started: ago(2) });
    const j = state(now).asks.find((x) => x.id === "fac-g1")!;
    expect(j.trailers).toEqual([{ key: "Issue", value: "fac-1.1" }, { key: "Job", value: "fac-g1" }]);
  });
});

describe("a land that found the job lock busy", () => {
  test("does not make the job stuck, in the UI or in the facts", () => {
    run("20261027-000040-a", { job: "fac-7", name: "fac-7", condition: "passed", on: "fac-2", started: ago(3) });
    run("20261027-000041-a", { kind: "land", job: "fac-7", name: "fac-7", condition: "failed", cause: "locked", reason: "job lock busy", on: "fac-2", started: ago(2) });
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

describe("a dropped issue", () => {
  test("holds no ask and no stuck entry", () => {
    expect(runAsks(state(now)).map((a) => a.id)).toEqual(["fac-1"]);
    const setAll = (to: "dropped" | "open") => writeList({ key: "fac" }, to, (doc) => { for (const i of doc.items) if (i.id === 1 || i.id === 3) setStatus(i, to); return true; }, true);
    setAll("dropped");
    const s = state(now);
    setAll("open");
    expect(s.asks.filter((a) => a.id === "fac-1" || a.on === "fac-1")).toEqual([]);
    expect(s.stuck).toEqual([]);
  });
});

describe("an intake run", () => {
  test("counts as running; a done one does not", () => {
    const ids = ["20261027-000050-a"];
    run(ids[0], { kind: "intake", job: "intake-fac-2", name: "intake-fac-2", condition: "running", on: "fac-2", started: ago(1) });
    let s = state(now);
    expect(s.running.map((j) => j.name)).toContain("intake-fac-2");
    expect(runAsks(s).map((a) => a.id)).toEqual(["fac-1"]);
    expect(s.stuck.map((j) => j.name)).toEqual(["fac-3"]);
    run(ids[0], { kind: "intake", job: "intake-fac-2", name: "intake-fac-2", condition: "done", on: "fac-2", started: ago(1), ended: ago(0.5) });
    s = state(now);
    expect(s.running.map((j) => j.name)).not.toContain("intake-fac-2");
    expect(s.queued.filter((q) => q.id === 2)).toEqual([{ repo: "fac", id: 2, title: "waiting goal", priority: "medium", stage: "queued", at: expect.any(String), since: expect.any(String), kind: "ready" }]);
    for (const id of ids) (rmSync(join(jobsDir, id), { recursive: true }), removeRun(id));
  });
});

describe("a chat run", () => {
  test("is in no job lane and no Ask, and a build run beside it still runs", () => {
    run("20261027-000051-a", { kind: "chat", job: "chat-1", name: "chat-1", condition: "running", started: ago(1) });
    run("20261027-000052-a", { kind: "chat", job: "chat-2", name: "chat-2", condition: "returned", started: ago(1) });
    run("20261027-000053-a", { kind: "build", job: "fac-53", name: "fac-53", condition: "running", started: ago(1) });
    const s = state(now);
    const names = (l: { name: string }[]) => l.map((j) => j.name);
    expect(names(s.running)).toContain("fac-53");
    for (const n of ["chat-1", "chat-2"]) {
      expect(names(s.running)).not.toContain(n);
      expect(names(s.stuck)).not.toContain(n);
      expect(JSON.stringify(s.asks)).not.toContain(n);
    }
    for (const id of ["20261027-000051-a", "20261027-000052-a", "20261027-000053-a"]) (rmSync(join(jobsDir, id), { recursive: true }), removeRun(id));
  });
});

// Returns a function that puts the repo's main back where it is now and drops origin/main, which a test moves.
function keepMain(repo: string) {
  const head = Bun.spawnSync(["git", "rev-parse", "-q", "--verify", "HEAD"], { cwd: repo, stdout: "pipe", stderr: "ignore" });
  const before = head.exitCode === 0 ? head.stdout.toString().trim() : null;
  return () => {
    Bun.spawnSync(["git", "update-ref", "-d", "refs/remotes/origin/main"], { cwd: repo, stdout: "ignore", stderr: "ignore" });
    if (before) sh(repo, "git", "update-ref", "refs/heads/main", before);
    else Bun.spawnSync(["git", "update-ref", "-d", "refs/heads/main"], { cwd: repo, stdout: "ignore", stderr: "ignore" });
  };
}

describe("an issue that acceptance failed twice", () => {
  test("a held run from before v6 phase 6 still reads: its old phase, and its stored second review as the Ask's review", () => {
    run("20261027-000060-a", { job: "fac-60", name: "fac-60", condition: "waiting", ask: HELD, reason: "held path held/x.ts", stat: " held/x.ts | 1 +", phase: "check oracle", review: { call: "passed" } },
      { "review.md": "Fine.\nVERDICT: pass\n", "call-prompt.md": "old recipe\n" });
    try {
      const a = runAsks(state(now)).find((x) => x.id === "fac-60");
      expect(a).toBeDefined();
      expect(a!.details).toEqual({ note: "held path held/x.ts", stat: " held/x.ts | 1 +", review: { call: "passed" } });
      // The Now card renders it.
      const card = rows(withAttn({ ...fixture, stuck: [], factory: { ...fixture.factory, health: [] }, asks: [a!] }))[0];
      expect(card).toContain("Reviewer: passed");
    } finally {
      (rmSync(join(jobsDir, "20261027-000060-a"), { recursive: true }), removeRun("20261027-000060-a"));
    }
  });

  test("a trailer commit from before the item's since does not make it done, and the build loads the list once", () => {
    const restore = keepMain(join(base, "repo"));
    const repo = join(base, "repo");
    let id = 0;
    try {
      writeList({ key: "fac" }, "reopened item", (doc) => { id = add(doc, "reopened item").id; return true; });
      sh(repo, "git", "commit", "-q", "--allow-empty", "-m", `Old land\n\nIssue: fac-${id}`);
      sh(repo, "git", "commit", "-q", "--allow-empty", "-m", "Reopen");
      const since = sh(repo, "git", "rev-parse", "HEAD");
      sh(repo, "git", "update-ref", "refs/remotes/origin/main", since);
      writeList({ key: "fac" }, "reopen", (doc) => { doc.items.find((i) => i.id === id)!.fm.since = since; return true; });
      // The trailer commit sits before `since`: the item is not done.
      const loads = [spyOn(store, "readList"), spyOn(store, "readFetched")];
      try {
        expect(state(now).done.some((d) => d.id === `fac-${id}`)).toBe(false);
        expect(loads.flatMap((l) => l.mock.calls).filter(([r]) => r.key === "fac")).toHaveLength(1);
      } finally { for (const l of loads) l.mockRestore(); }
    } finally {
      restore();
    }
  });

  test("lists under Needs you, and not under Queued or Done, though a trailer commit on main names it", () => {
    const restore = keepMain(join(base, "repo"));
    const repo = join(base, "repo");
    let partId = 0;
    writeList({ key: "fac" }, "goal that failed acceptance twice", (doc) => {
      const it = add(doc, "acceptance it");

      it.notes.push("- Oracle: `bun test ui/state.test.ts` fails on the acceptance check.");
      partId = it.id;
      return true;
    });
    setAsk(`fac-${partId}`, { kind: "input", reason: "run-cap", question: "", options: [], why: [] });
    try {
      // The trailer commit on main names the issue; origin/main points at it, as a land would leave it.
      sh(repo, "git", "commit", "-q", "--allow-empty", "-m", `Reopen the goal\n\nIssue: fac-${partId}`);
      sh(repo, "git", "update-ref", "refs/remotes/origin/main", sh(repo, "git", "rev-parse", "HEAD"));
      const s = state(now);
      expect(s.asks.some((a) => a.id === `fac-${partId}` && a.reason === "run-cap")).toBe(true);
      expect(s.queued.some((q) => q.id === partId)).toBe(false);
      expect(s.done.some((d) => d.id === `fac-${partId}`)).toBe(false);
    } finally {
      restore();
    }
  });
});

describe("a parked issue with a core-change Ask", () => {
  test("lists under Needs you; a parked issue with any other Ask does not", () => {
    const id: number[] = [];
    writeList({ key: "fac" }, "parked asks", (doc) => {
      for (const t of ["held core note", "shelved question"]) { const it = add(doc, t); setStatus(it, "parked"); id.push(it.id); }
      return true;
    });
    setAsk(`fac-${id[0]}`, { kind: "approval", reason: "core-change", question: "Apply it?", options: [], why: [] });
    setAsk(`fac-${id[1]}`, { kind: "input", reason: "question", question: "Which?", options: [], why: [] });
    expect(state(now).asks.filter((a) => id.some((n) => a.id === `fac-${n}`)).map((a) => [a.id, a.reason])).toEqual([[`fac-${id[0]}`, "core-change"]]);
  });
});

describe("a passed job whose issue is parked", () => {
  test("is not running, so the Herald's Running does not show it; reopening the issue runs it again", () => {
    let id = 0;
    writeList({ key: "fac" }, "parked land", (doc) => { const it = add(doc, "held land"); setStatus(it, "parked"); id = it.id; return true; });
    run("20261027-000090-a", { job: `fac-${id}`, name: `fac-${id}`, condition: "passed", next: "land", on: `fac-${id}` });
    const names = (l: { name: string }[]) => l.map((j) => j.name);
    const set = (to: "parked" | "open" | "dropped") => writeList({ key: "fac" }, `fac-${id} ${to}`, (doc) => { setStatus(doc.items.find((i) => i.id === id)!, to); return true; }, true);
    try {
      expect(names(state(now).running)).not.toContain(`fac-${id}`);
      set("open");
      expect(names(state(now).running)).toContain(`fac-${id}`);
    } finally { set("dropped"); }
  });
});

describe("a returned run with its rework queued", () => {
  test("is running, not stuck, so the Herald does not call it unhealthy; one with no next stays stuck", () => {
    run("20261027-000080-a", { job: "fac-80", name: "fac-80", condition: "returned", failed: "review", next: "worker", on: "fac-80" });
    const names = (l: { name: string }[]) => l.map((j) => j.name);
    // fac-3 is the fixture's only stuck job: dropping it isolates fac-80 in the status sentence.
    const drop3 = (to: "dropped" | "open") => writeList({ key: "fac" }, `fac-3 ${to}`, (doc) => { setStatus(doc.items.find((i) => i.id === 3)!, to); return true; }, true);
    try {
      drop3("dropped");
      const s = state(now);
      expect(names(s.stuck)).not.toContain("fac-80");
      expect(names(s.running)).toContain("fac-80");
      expect(s.herald!.history[0].text.toLowerCase()).not.toContain("jobs are unhealthy");
    } finally { drop3("open"); }
    run("20261027-000081-a", { job: "fac-81", name: "fac-81", condition: "returned", reason: "a check failed", on: "fac-81" });
    expect(names(state(now).stuck)).toContain("fac-81");
  });
});

describe("a stuck job whose last run failed a check", () => {
  test("carries the failed check's name, so its card line can name the check", () => {
    run("20261027-000070-a", { job: "fac-70", name: "fac-70", condition: "failed", cause: "check", checkName: "tests", reason: "tests failed", started: ago(2) });
    try {
      const j = state(now).stuck.find((x) => x.name === "fac-70")!;
      expect(j.cause).toBe("check");
      expect(j.checkName).toBe("tests");
    } finally {
      (rmSync(join(jobsDir, "20261027-000070-a"), { recursive: true }), removeRun("20261027-000070-a"));
    }
  });
});

describe("a returned run whose rework is queued", () => {
  test("is not stuck, so the status does not flash an alert before the rework starts", () => {
    run("20261027-000071-a", { job: "fac-71", name: "fac-71", condition: "returned", cause: "check", next: "worker", started: ago(2) });
    try {
      expect(state(now).stuck.some((x) => x.name === "fac-71")).toBe(false);
    } finally {
      (rmSync(join(jobsDir, "20261027-000071-a"), { recursive: true }), removeRun("20261027-000071-a"));
    }
  });
});

describe("a passed job whose issue is parked", () => {
  test("is not running, because its land waits for the issue to reopen; one whose issue is open is", () => {
    const id: number[] = [];
    writeList({ key: "fac" }, "held lands", (doc) => {
      for (const t of ["parked land", "open land"]) id.push(add(doc, t).id);
      setStatus(doc.items.find((i) => i.id === id[0])!, "parked");
      return true;
    });
    const [held, open] = id.map((n) => `fac-${n}`);
    run("20261027-000090-a", { job: held, name: held, condition: "passed", next: "land", reason: `issue ${held} is parked`, on: held });
    run("20261027-000091-a", { job: open, name: open, condition: "passed", next: "land", on: open });
    const names = state(now).running.map((j) => j.name);
    expect(names).not.toContain(held);
    expect(names).toContain(open);
  });
});

describe("a live job on a parked issue", () => {
  test("is running, because parking stops new work and not a run; one between steps is not", () => {
    const id: number[] = [];
    writeList({ key: "fac" }, "parked jobs", (doc) => {
      for (const t of ["live run", "queued rework"]) { const it = add(doc, t); setStatus(it, "parked"); id.push(it.id); }
      return true;
    });
    const [live, held] = id.map((n) => `fac-${n}`);
    run("20261027-000092-a", { job: live, name: live, condition: "running", on: live });
    run("20261027-000093-a", { job: held, name: held, condition: "returned", failed: "review", next: "worker", on: held });
    const names = state(now).running.map((j) => j.name);
    expect(names).toContain(live);
    expect(names).not.toContain(held);
  });
});
