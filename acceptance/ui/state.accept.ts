// Archived goal tests from ui/state.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, renameSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { partsOf, readList, writeList } from "../../todo/lib/store.ts";
import { buildReviewFixture } from "../../ui/fixtures/review/build.ts";
import { add, refOf, setStatus, type Issue } from "../../todo/lib/todo.ts";
import { state } from "../../ui/state.ts";
import { withEnv } from "../../ui/test-server.ts";
import { loadRegistry } from "../../jobs/lib/ledger.ts";
import { spawn } from "node:child_process";
import { repoStages } from "../../jobs/lib/status.ts";

let base: string, jobsDir: string, factory: string;
let restore: () => void;
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

const now = new Date();
const ago = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
const HELD = { kind: "approval", reason: "held-path", question: "", options: [], why: [], situation: "The run changes hooks/x.ts.", effects: [{ action: "land", text: "Merges it." }, { action: "drop", text: "Throws it away." }], recommend: { action: "drop", why: "the path is held" } };
function run(id: string, extra: Record<string, unknown>, files: Record<string, string> = {}) {
  const dir = join(jobsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ kind: "build", repo: "fac", told: true, started: ago(3), ...extra }));
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
  test("Queued lists a critical goal before a medium one with a lower number; items carry priority, none reads medium", () => {
    const s = state(now);
    const ids = s.queued.map((q) => q.id);
    expect(ids.indexOf(7)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(7)).toBeLessThan(ids.indexOf(2));
    expect(s.queued.find((q) => q.id === 7)?.priority).toBe("critical");
    expect(s.queued.find((q) => q.id === 2)?.priority).toBe("medium");
    expect(s.done.every((d) => d.priority === "medium")).toBe(true);
    expect(s.stuck[0].item?.priority).toBe("medium");
  });
  test("sorts the runs into their lists", () => {
    const before = readFileSync(join(jobsDir, "20261027-000001-a", "state.json"), "utf8");
    const s = state(now);
    expect(runAsks(s).map((a) => a.id)).toEqual(["fac-1"]);
    expect(runAsks(s)[0].details.stat).toBe(" held/x.ts | 2 +-");
    expect(runAsks(s)[0].defaults).toEqual(["port? -> 3020"]);
    expect(runAsks(s)[0].followups).toEqual(["tidy the logs"]);
    expect(runAsks(s)[0]).toMatchObject({ title: "needs item", on: "fac-1" });
    expect(s.stuck.map((j) => j.name)).toEqual(["fac-3"]);
    expect(s.running.map((j) => j.name)).toEqual(["fac-4"]);
    // Delivered is the latest lands, not only today's: fac-6 landed 30 hours ago.
    expect(s.delivered.map((j) => j.name)).toEqual(["fac-5", "fac-6"]);
    expect(s.delivered[0].commitUrl).toBe("https://github.com/chris/demo/commit/abcdef1234567");
    expect(s.queued.filter((q) => q.id === 2)).toEqual([{ repo: "fac", id: 2, title: "waiting goal", priority: "medium", stage: "queued", at: expect.any(String), since: "", why: "Starts at the next dispatch", kind: "ready" }]);
    expect(s.factory.runsToday).toBe(4);
    expect(s.factory.paused).toBe(false);
    expect(readFileSync(join(jobsDir, "20261027-000001-a", "state.json"), "utf8")).toBe(before);
    expect(JSON.parse(before).shown).toBe(false);
  });

  test("an awaiting run's whole Ask reaches the state and the entry", () => {
    const j = state(now).asks[0];
    expect(j.situation).toBe("The run changes hooks/x.ts.");
    expect(j.escalated).toBe(true);
    expect(j.actions.map((a) => [a.act, a.hint, a.recommended])).toEqual([["land", "Merges it.", false], ["drop", "Throws it away. The path is held.", true]]);
  });

  test("asks lists the held run with its kind and reason, and always shows a rule; a rule hands no Ask to anyone", () => {
    let s = state(now);
    expect(s.asks.map((a) => [a.kind, a.reason, a.id])).toEqual([["approval", "held-path", "fac-1"]]);
    expect(s.always).toEqual([]);
    writeFileSync(join(factory, "always.json"), JSON.stringify({ "held-path": { action: "land", at: "2026-10-28T00:00:00.000Z" } }));
    try {
      s = state(now);
      expect(s.always).toEqual([{ reason: "held-path", action: "land", at: "2026-10-28T00:00:00.000Z" }]);
      expect(s.asks.map((a) => [a.reason, a.id])).toEqual([["held-path", "fac-1"]]);
      expect(s.asks[0].actions.some((a) => a.act === "land")).toBe(true);
    } finally { rmSync(join(factory, "always.json")); }
  });

  test("velocity counts lands and done triage runs over 24 hours and 7 days; agent marks a job with a live run", () => {
    run("20261027-000020-a", { kind: "triage", job: "fac-t1", name: "fac-t1", condition: "done", started: ago(5), ended: ago(4) });
    run("20261027-000021-a", { kind: "triage", job: "fac-t2", name: "fac-t2", condition: "failed", started: ago(5), ended: ago(4) });
    run("20261027-000022-a", { kind: "triage", job: "fac-t3", name: "fac-t3", condition: "done", started: ago(49), ended: ago(48) });
    const s = state(now);
    expect(s.velocity.triaged.day).toBe(1);
    expect(s.velocity.triaged.avg).toBeCloseTo(2 / 7);
    expect(s.velocity.landed.day).toBe(1);
    expect(s.velocity.landed.avg).toBeCloseTo(2 / 7);
    // fac-4 runs on item 4; fac-1 and fac-3 have no live run.
    expect(runAsks(s)[0].agent).toBe(false);
    run("20261027-000023-a", { job: "fac-1b", name: "fac-1b", condition: "running", on: "fac-1" });
    expect(runAsks(state(now))[0].agent).toBe(true);
    for (const id of ["20261027-000020-a", "20261027-000021-a", "20261027-000022-a", "20261027-000023-a"]) rmSync(join(jobsDir, id), { recursive: true });
  });

  test("openIssues counts every open issue, past the 10 that issues lists and whatever the labels", () => {
    const before = state(now);
    writeList({ key: "fac" }, "many", (doc) => {
      for (let i = 0; i < 12; i++) add(doc, `bulk ${i}`);
      add(doc, "sorted", { spec: "Do it." });
      return true;
    }, true);
    const s = state(now);
    expect(s.openIssues).toBe(before.openIssues + 13);
    expect(s.openIssues).toBeGreaterThan(10);
    expect(s.issues.length).toBe(10);
    expect(s.newIssues).toBe(before.newIssues + 12);
    expect(s.openIssues).toBeGreaterThan(s.newIssues);
  });

  test("a running job's run is its last run; started stays the first run's", () => {
    run("20261027-000010-a", { job: "fac-9", name: "fac-9", condition: "done", started: ago(2) });
    run("20261027-000011-a", { kind: "land", job: "fac-9", name: "fac-9", condition: "running", started: ago(1) });
    const j = state(now).running.find((x) => x.name === "fac-9")!;
    expect(j.run).toEqual({ kind: "land", started: ago(1) });
    expect(j.started).toBe(ago(2));
    for (const id of ["20261027-000010-a", "20261027-000011-a"]) rmSync(join(jobsDir, id), { recursive: true });
  });

  test("caps.json gives the live cap when the environment does not, and a bad file gives the default", () => {
    const keep = process.env.ALEPH_LIVE_CAP;
    delete process.env.ALEPH_LIVE_CAP;
    const file = join(factory, "caps.json");
    try {
      expect(state(now).factory.liveCap).toBe(10);
      writeFileSync(file, JSON.stringify({ day: 999, live: 12 }));
      expect(state(now).factory.liveCap).toBe(12);
      writeFileSync(file, "not json");
      expect(state(now).factory.liveCap).toBe(10);
    } finally {
      rmSync(file, { force: true });
      if (keep !== undefined) process.env.ALEPH_LIVE_CAP = keep;
    }
  });

  test("only the shown lands are projected: no git log for the older commits, yet velocity counts them all", () => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const id = `20261027-0002${String(i).padStart(2, "0")}-a`;
      ids.push(id);
      run(id, { job: `fac-p${i}`, name: `fac-p${i}`, condition: "landed", commit: `c0ffee${String(i).padStart(2, "0")}`, ended: ago(0.1 + i / 100), started: ago(1) });
    }
    const spy = spyOn(Bun, "spawnSync");
    try {
      const s = state(now);
      const logged = spy.mock.calls.map((c) => (c[0] as string[]).join(" ")).filter((c) => c.includes(" log "));
      const landRuns = s.delivered.filter((j) => j.condition !== "landed").length;
      const shown = 10 - landRuns;
      for (let i = 0; i < 12; i++) {
        const asked = logged.some((c) => c.includes(`c0ffee${String(i).padStart(2, "0")}`));
        // Newest first: fac-p0 is the newest, so only the first `shown` are asked for.
        expect(asked).toBe(i < shown);
      }
      expect(s.velocity.landed.day).toBeGreaterThanOrEqual(12);
    } finally {
      spy.mockRestore();
      for (const id of ids) rmSync(join(jobsDir, id), { recursive: true });
    }
  });
});

describe("the review fixture", () => {
  const LISTS = ["issues", "queued", "running", "asks", "stuck", "done"] as const;
  /** The list that holds an item of this stage; none for the stages the lists do not name. */
  const LIST_OF: Record<string, (typeof LISTS)[number][]> = {
    new: ["issues"], queued: ["queued"], working: ["running"], landing: ["running"], awaiting: ["asks"], stuck: ["stuck"], done: ["done"],
    blocked: ["queued"], planning: [], dropped: [],
  };

  test("every item's Incoming status is its `aleph status` stage, and its list is the list of that stage", () => {
    const home = mkdtempSync(join(tmpdir(), "aleph-ui-review-"));
    const env = buildReviewFixture(home);
    const restoreEnv = withEnv(env);
    try {
      const s = state();
      const incoming = new Map(s.incoming.map((i) => [i.id, i.stage]));
      const held = (id: string, repo: string, item: Issue) => {
        const of = (js: { repo: string; item?: { id: number } | null; id?: number }[]) => js.some((j) => j.repo === repo && (j.item?.id ?? j.id) === item.id);
        return LISTS.filter((l) => l === "asks" ? s.asks.some((a) => a.id === id || a.on === id) : l === "issues" ? s[l].some((i) => i.id === id) : l === "done" ? s.done.some((d) => d.id === id) : l === "queued" ? s.queued.some((q) => q.repo === repo && String(q.id) === refOf(item)) : of(s[l] as any));
      };
      const stages: Record<string, number> = {};
      const registry = loadRegistry();
      for (const key of Object.keys(registry)) {
        const doc = readList({ key })!;
        // The function `aleph status <id>` calls, once for the repo instead of one process per item.
        const of = new Map(repoStages(registry[key], { fetch: true }).map((st) => [st.id, st.stage]));
        for (const item of doc.items) {
          const id = `${key}-${refOf(item)}`;
          expect(of.has(id), id).toBe(true);
          const stage = of.get(id)!;
          stages[stage] = (stages[stage] ?? 0) + 1;
          if (incoming.has(id)) expect(incoming.get(id), id).toBe(stage);
          // A part has no list entry of its own: the lists hold its parent.
          if (item.sub !== undefined) continue;
          // A planned goal is held out of Waiting; a job's own list holds an item whose stage came from the job.
          const lists = held(id, key, item);
          const want = LIST_OF[stage];
          if (want.length === 0) expect(lists.filter((l) => l !== "running"), id).toEqual([]);
          // An issue that stands on its goals has no run of its own: its goals' runs are in the lists.
          else if (!(item.sub === undefined && partsOf(doc, item).length)) expect(lists.some((l) => want.includes(l)), `${id} ${stage} in ${lists}`).toBe(true);
          for (const l of lists) if (l !== "running" && l !== "asks" && l !== "stuck") expect(want, `${id} ${stage} is in ${l}`).toContain(l);
        }
      }
      // Every stage has an item, and the fixture holds one of each shape.
      expect(Object.keys(stages).sort()).toEqual(Object.keys(LIST_OF).sort());
    } finally {
      restoreEnv();
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("waiting entries", () => {
  test("carry why, kind, and the links the Queued lane shows", async () => {
    writeList({ key: "fac" }, "waiting fixtures", (doc) => {
      const goal = add(doc, "waits goal");

      goal.fm.after = ["fac-2"];
      add(doc, "after a closed goal", { spec: "Do it." }).fm.after = ["fac-9999"];
      return true;
    }, true);
    // Set the stuck fac-3 aside, so only the reasons under test remain.
    const stuckDir = join(jobsDir, "20261027-000002-a"), aside = join(base, "stuck-aside");
    renameSync(stuckDir, aside);
    try { await check(); } finally { renameSync(aside, stuckDir); }
    async function check() {
    const by = (s: ReturnType<typeof state>, title: string) => s.queued.find((w) => w.title === title)!;
    const s = state(now);
    expect(by(s, "waits goal")).toMatchObject({ kind: "not-ready", why: "Waits on fac-2", stage: "blocked", waits: [{ id: "fac-2", href: "#/issues/fac/2", title: expect.any(String), state: "queued", dead: null }] });
    // A goal that asks for you is awaiting: it is in asks, not Queued.
    expect(by(s, "waiting goal").why).toBe("Starts at the next dispatch");
    // A ref the read list lacks is closed work: the dispatch counts it as done, so the lane does too.
    expect(by(s, "after a closed goal")).toMatchObject({ kind: "ready" });
    // The Loop guard stops a goal on its no-commit streak, so the lane says so and not "Starts at the next dispatch".
    const streak = [1, 2, 3].map((n) => `20261027-00007${n}-a`);
    streak.forEach((id, n) => run(id, { job: `fac-2-${n}`, name: "fac-2", on: "fac-2", condition: "dropped", reason: "x", noCommit: true, started: ago(3 + n) }));
    expect(by(state(now), "waiting goal")).toMatchObject({ kind: "loop-guard", why: "The last 3 runs ended with no commit; the next dispatch asks the director" });
    for (const id of streak) rmSync(join(jobsDir, id), { recursive: true });

    const dir = join(jobsDir, "20261027-000060-a");
    run("20261027-000060-a", { job: "live-x", name: "live-x", condition: "running" });
    const child = spawn("bash", ["-c", "sleep 30; true", "_", dir], { stdio: "ignore" });
    writeFileSync(join(dir, "pid"), String(child.pid));
    const restoreCap = withEnv({ ALEPH_LIVE_CAP: "1" });
    try {
      expect(by(state(now), "waiting goal")).toMatchObject({ kind: "live-cap", why: "Waiting for a slot (1 of 1 running)" });
    } finally {
      restoreCap();
      child.kill();
      rmSync(dir, { recursive: true });
    }
    }
  });
});

describe("a parked goal", () => {
  test("is not in Queued, though it has a spec; the same goal open is", () => {
    let id = 0;
    writeList({ key: "fac" }, "parked goal", (doc) => { const g = add(doc, "parked with spec", { spec: "Do it." }); setStatus(g, "parked"); id = g.id; return true; });
    try {
      expect(state(now).queued.some((q) => q.id === id)).toBe(false);
      writeList({ key: "fac" }, "unpark", (doc) => { setStatus(doc.items.find((i) => i.id === id && i.sub === undefined)!, "open"); return true; });
      expect(state(now).queued.some((q) => q.id === id)).toBe(true);
    } finally {
      writeList({ key: "fac" }, "drop", (doc) => { setStatus(doc.items.find((i) => i.id === id && i.sub === undefined)!, "dropped"); return true; });
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
  test("no next elapse and the service activating is a tick in progress", () => {
    expect(withSystemctl(`${noNext}\necho activating; exit 3`)).toEqual({ nextTick: null, tickInProgress: true });
  });
});

describe("an awaiting issue with the three flat fields", () => {
  test("its entry carries the situation, the effect hints and the recommended action", () => {
    let goalId = 0;
    writeList({ key: "fac" }, "goal with a stored ask", (doc) => {
      const goal = add(doc, "stored ask goal");
      goal.fm.ask = "input";
      goal.fm.reason = "no-commit";
      goal.fm.situation = "Three runs ended with no commit.";
      goal.fm.effects = ["rerun :: Starts the goal again.", "close :: Closes the goal."];
      goal.fm.recommend = "rerun :: the goal is clear";
      goalId = goal.id;
      return true;
    });
    const a = state(now).asks.find((x) => x.id === `fac-${goalId}`)!;
    expect(a.escalated).toBe(true);
    expect(a.situation).toBe("Three runs ended with no commit.");
    expect(a.actions.map((x) => [x.act, x.hint, x.recommended])).toEqual([["rerun", "Starts the goal again. The goal is clear.", true], ["close", "Closes the goal.", false]]);
  });
});
