import { afterAll, afterEach, beforeAll, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as store from "../issues/lib/store.ts";
import { writeList } from "../issues/lib/store.ts";
import { add, setStatus } from "../issues/lib/todo.ts";
import { jobProjector, state } from "./state.ts";
import { withEnv } from "./test-server.ts";
import { loadRegistry } from "../jobs/lib/records/ledger.ts";
import { allJobs } from "../jobs/lib/records/job.ts";
import { seed, reseed } from "../jobs/job.testkit.ts";
import { conn } from "../lib/db.ts";
import { jobFolder } from "../jobs/lib/records/run-files.ts";
import { spawn } from "node:child_process";
import { facts } from "../jobs/lib/records/status.ts";
import { state as fixture } from "./fixtures/status-state.ts";
import { rows, withAttn } from "./test-now.ts";
import { setAsk } from "../jobs/lib/asks/ask.ts";
import { writeRepos } from "../tests/projects.ts";
import { logEvent } from "../lib/layout.ts";

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
// The jobs a test adds go after it, so no test sees another's. `K` maps the label a test gives a job to its key.
let made = new Set<string>();
const K: Record<string, string> = {}, lastOf: Record<string, string> = {};
/** Make the job `label`, or change it when the label is known. `on` is the issue `<repo>-<n>`; `job` groups runs of one work by `prev`. */
function run(label: string, { on, job, kind, ...extra }: Record<string, unknown>, files: Record<string, string> = {}) {
  const target = on ? { target: `issue.${String(on).split("-")[1]}` } : {};
  let id = K[label];
  if (id) reseed(id, { ...target, ...extra } as any);
  else {
    const prev = typeof job === "string" ? lastOf[job] : undefined;
    ({ id } = seed({ role: (kind ?? "build") as any, repo: "fac", started: ago(3), name: String(job ?? label), ...target, ...(prev ? { prev } : {}), ...extra } as any));
    K[label] = id;
    made.add(id);
  }
  if (typeof job === "string") lastOf[job] = id;
  for (const [f, text] of Object.entries(files)) writeFileSync(join(jobFolder(id), f === "result.md" ? "result.md" : f), text);
  return id;
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
  writeRepos({ fac: { path: repo, sandbox: true, checks: [] } }, items);
  // The fixture has one live run; the default cap (cores / 6) is 1 on a 4-core runner, which would read a queued issue as live-capped.
  restore = withEnv({ ALEPH_JOBS_DIR: jobsDir, ALEPH_DB: join(base, "aleph.db"), ALEPH_ITEMS: items, ALEPH_FACTORY_DIR: factory, ALEPH_LIVE_CAP: "5", ...gitEnv });
  writeList({ key: "fac" }, "seed", (doc) => {
    for (const t of ["needs item", "waiting goal", "stuck item", "running item", "landed item", "old item"]) add(doc, t, t === "waiting goal" ? { spec: "Do it." } : {});
    add(doc, "urgent goal", { spec: "Do it first.", priority: "critical" });
    return true;
  }, true);

  run("20261027-000001-a", { job: "fac-1", name: "fac-1", state: "waiting", ask: HELD, on: "fac-1", stat: " held/x.ts | 2 +-", defaults: ["port? -> 3020"], shown: false, cost: 0.5 },
    { "result.md": "done\nFOLLOWUP: tidy the logs\n" });
  run("20261027-000002-a", { job: "fac-3", name: "fac-3", state: "failed", reason: "a check failed", on: "fac-3" });
  run("20261027-000003-a", { job: "fac-4", name: "fac-4", state: "running", on: "fac-4" });
  run("20261027-000004-a", { job: "fac-5", name: "fac-5", state: "landed", on: "fac-5", commit: "abcdef1234567", ended: ago(2), started: ago(3) });
  run("20261027-000005-a", { job: "fac-6", name: "fac-6", state: "landed", on: "fac-6", commit: "123456abcdef", ended: ago(30), started: ago(31) });
  made = new Set();
});
afterEach(() => {
  for (const id of made) { conn().run("DELETE FROM jobs WHERE id = ?", [id]); rmSync(jobFolder(id), { recursive: true, force: true }); }
  for (const l of Object.keys(K)) if (made.has(K[l])) { delete K[l]; }
  for (const j of Object.keys(lastOf)) delete lastOf[j];
  made = new Set();
});
afterAll(() => {
  restore();
  rmSync(base, { recursive: true, force: true });
});

const runAsks = (s: ReturnType<typeof state>) => s.asks.filter((a) => a.key.startsWith("run:"));

describe("state", () => {

  test("factory.liveRuns counts live agent runs only; land and plain runs stay in running", () => {
    const before = state(now);
    const kids: ReturnType<typeof spawn>[] = [];
    const ids = [["20261027-000050-a", "build", "fac-8"], ["20261027-000051-a", "land", "fac-9"], ["20261027-000052-a", "plain", "plain-1"]] as const;
    try {
      for (const [id, kind, name] of ids) {
        const dir = jobFolder(run(id, { kind, job: name, name, state: "running" }));
        const child = spawn("bash", ["-c", "read; true", "_", dir], { stdio: ["pipe", "ignore", "ignore"] }); // blocks on its stdin until killed
        kids.push(child);
        writeFileSync(join(dir, "pid"), String(child.pid));
      }
      const s = state(now);
      expect(s.factory.liveRuns).toBe(before.factory.liveRuns + 1);
      expect(s.running.some((j) => j.run?.kind === "land")).toBe(true);
      expect(s.running.some((j) => j.run?.kind === "plain")).toBe(true);
    } finally {
      for (const k of kids) k.kill();
    }
  });

  test("trailers: a landed job's from its commit, an awaiting job's as the land will write them", () => {
    const repo = join(base, "repo");
    const job = run("20261027-000007-a", { job: "fac-7", name: "fac-7", state: "landed", on: "fac-1", ended: ago(1), started: ago(2) });
    sh(repo, "git", "commit", "-q", "--allow-empty", "-m", `land\n\nIssue: issue.1\nJob: ${job}`);
    const commit = sh(repo, "git", "rev-parse", "HEAD").trim();
    run("20261027-000007-a", { commit });
    const s = state(now);
    const landed = jobProjector().toJob(allJobs().find((rs) => rs[0].run.name === "fac-7")!);
    expect(landed.trailers).toEqual([{ key: "Issue", value: "issue.1" }, { key: "Job", value: job }]);
    expect(runAsks(s)[0].trailers).toEqual([{ key: "Issue", value: "issue.1" }, { key: "Job", value: K["20261027-000001-a"] }, { key: "Held-by", value: "Chris" }]);
  });

});

describe("a land that found the job lock busy", () => {
  test("does not make the job stuck, in the UI or in the facts", () => {
    run("20261027-000040-a", { job: "fac-7", name: "fac-7", state: "passed", on: "fac-2", started: ago(3) });
    run("20261027-000041-a", { role: "land", job: "fac-7", name: "fac-7", state: "failed", cause: "locked", reason: "job lock busy", on: "fac-2", started: ago(2) });
    const s = state(now);
    expect(s.stuck.map((j) => j.name)).not.toContain("fac-7");
    expect(s.stuck.map((j) => j.name)).toEqual(["fac-3"]);
    const card = s.running.find((j) => j.name === "fac-7")!;
    expect(card.state).toBe("passed");
    expect(card.reason).not.toBe("job lock busy");
    expect(card.run.kind).toBe("build");
    expect(facts(loadRegistry().fac).open[2]).toBe("passed");
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
    run(ids[0], { role: "intake", job: "intake-fac-2", name: "intake-fac-2", state: "running", on: "fac-2", started: ago(1) });
    let s = state(now);
    expect(s.running.map((j) => j.name)).toContain("intake-fac-2");
    expect(runAsks(s).map((a) => a.id)).toEqual(["fac-1"]);
    expect(s.stuck.map((j) => j.name)).toEqual(["fac-3"]);
    run(ids[0], { role: "intake", job: "intake-fac-2", name: "intake-fac-2", state: "done", on: "fac-2", started: ago(1), ended: ago(0.5) });
    s = state(now);
    expect(s.running.map((j) => j.name)).not.toContain("intake-fac-2");
    expect(s.queued.filter((q) => q.id === 2)).toEqual([{ repo: "fac", id: 2, title: "waiting goal", priority: "medium", stage: "queued", at: expect.any(String), since: expect.any(String), kind: "ready" }]);
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
    run("20261027-000060-a", { job: "fac-60", name: "fac-60", state: "waiting", ask: HELD, reason: "held path held/x.ts", stat: " held/x.ts | 1 +", phase: "check oracle", review: { call: "passed" } },
      { "review.md": "Fine.\nVERDICT: pass\n", "call-prompt.md": "old recipe\n" });
    try {
      const a = runAsks(state(now)).find((x) => x.id === "fac-60");
      expect(a).toBeDefined();
      expect(a!.details).toEqual({ note: "held path held/x.ts", stat: " held/x.ts | 1 +", review: { call: "passed" } });
      // The Now card renders it.
      const card = rows(withAttn({ ...fixture, stuck: [], factory: { ...fixture.factory, health: [] }, asks: [a!] }))[0];
      expect(card).toContain("Reviewer: passed");
    } finally {
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
    setAsk(`issue.${partId}`, { kind: "input", reason: "run-cap", question: "", options: [], why: [] });
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
    setAsk(`issue.${id[0]}`, { kind: "approval", reason: "core-change", question: "Apply it?", options: [], why: [] });
    setAsk(`issue.${id[1]}`, { kind: "input", reason: "question", question: "Which?", options: [], why: [] });
    expect(state(now).asks.filter((a) => id.some((n) => a.id === `fac-${n}`)).map((a) => [a.id, a.reason])).toEqual([[`fac-${id[0]}`, "core-change"]]);
  });
});

describe("a passed job whose issue is parked", () => {
  test("is not running, so the Herald's Running does not show it; reopening the issue runs it again", () => {
    let id = 0;
    writeList({ key: "fac" }, "parked land", (doc) => { const it = add(doc, "held land"); setStatus(it, "parked"); id = it.id; return true; });
    run("20261027-000090-a", { job: `fac-${id}`, name: `fac-${id}`, state: "passed", next: "land", on: `fac-${id}` });
    const names = (l: { name: string }[]) => l.map((j) => j.name);
    const set = (to: "parked" | "open" | "dropped") => writeList({ key: "fac" }, `fac-${id} ${to}`, (doc) => { setStatus(doc.items.find((i) => i.id === id)!, to); return true; }, true);
    try {
      expect(names(state(now).running)).not.toContain(`fac-${id}`);
      set("open");
      expect(names(state(now).running)).toContain(`fac-${id}`);
    } finally { set("dropped"); }
  });
});

describe("the Herald's attempts and chats", () => {
  test("an intake, a build, a review and a land job linked by prev are one attempt: the intake's job", () => {
    const ids = (["intake", "build", "review", "land"] as const).map((kind, i) => run(`20261027-00019${i}-a`, { job: "fac-90", kind, name: "fac-90", on: "fac-90", state: "done" }));
    const other = run("20261027-000199-a", { job: "fac-91", name: "fac-91", on: "fac-91", state: "done" });
    for (const id of [...ids, other]) logEvent({ subject: "gate", action: "running", object: id });
    const h = state(now).herald!;
    expect(ids.map((id) => h.attempts[id])).toEqual([ids[0], ids[0], ids[0], ids[0]]);
    expect(h.attempts[other]).toBe(other);
  });

  test("two turns on one chat session are one conversation: its session, start, last turn and first prompt", () => {
    const projects = join(base, "projects"), sessions = process.env.ALEPH_SESSIONS_DIR!;
    const turn = (type: string, timestamp: string, content: unknown) => JSON.stringify({ type, timestamp, message: { content } });
    mkdirSync(join(projects, "-repo"), { recursive: true });
    writeFileSync(join(projects, "-repo", "chat-1.jsonl"), [
      turn("user", ago(3), "fix the footer\n\nChris points at these annotations:"), turn("assistant", ago(3), [{ type: "text", text: "done" }]),
      turn("user", ago(2), "and the header"), turn("assistant", ago(2), [{ type: "text", text: "done" }]),
    ].join("\n"));
    // A session the server did not run as a chat, and a chat whose last turn is older than the feed's day.
    writeFileSync(join(projects, "-repo", "terminal-1.jsonl"), turn("user", ago(1), "typed in a terminal"));
    writeFileSync(join(projects, "-repo", "old-1.jsonl"), turn("user", ago(30), "yesterday's"));
    for (const id of ["chat-1", "old-1"]) mkdirSync(join(sessions, id), { recursive: true });
    const end = withEnv({ ALEPH_CLAUDE_PROJECTS: projects });
    try { expect(state(now).herald!.chats).toEqual([{ id: "chat-1", start: ago(3), last: ago(2), title: "fix the footer" }]); } finally { end(); rmSync(sessions, { recursive: true, force: true }); }
  });
});

describe("a returned run with its rework queued", () => {
  test("is running, not stuck, so the Herald does not call it unhealthy; one with no next stays stuck", () => {
    run("20261027-000080-a", { job: "fac-80", name: "fac-80", state: "returned", failed: "review", next: "worker", on: "fac-80" });
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
    run("20261027-000081-a", { job: "fac-81", name: "fac-81", state: "returned", reason: "a check failed", on: "fac-81" });
    expect(names(state(now).stuck)).toContain("fac-81");
  });
});

describe("a stuck job whose last run failed a check", () => {
  test("carries the failed check's name, so its card line can name the check", () => {
    run("20261027-000070-a", { job: "fac-70", name: "fac-70", state: "failed", cause: "check", checkName: "tests", reason: "tests failed", started: ago(2) });
    try {
      const j = state(now).stuck.find((x) => x.name === "fac-70")!;
      expect(j.cause).toBe("check");
      expect(j.checkName).toBe("tests");
    } finally {
    }
  });
});

describe("a returned run whose rework is queued", () => {
  test("is not stuck, so the status does not flash an alert before the rework starts", () => {
    run("20261027-000071-a", { job: "fac-71", name: "fac-71", state: "returned", cause: "check", next: "worker", started: ago(2) });
    try {
      expect(state(now).stuck.some((x) => x.name === "fac-71")).toBe(false);
    } finally {
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
    run("20261027-000090-a", { job: held, name: held, state: "passed", next: "land", reason: `issue ${held} is parked`, on: held });
    run("20261027-000091-a", { job: open, name: open, state: "passed", next: "land", on: open });
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
    run("20261027-000092-a", { job: live, name: live, state: "running", on: live });
    run("20261027-000093-a", { job: held, name: held, state: "returned", failed: "review", next: "worker", on: held });
    const names = state(now).running.map((j) => j.name);
    expect(names).toContain(live);
    expect(names).not.toContain(held);
  });
});
