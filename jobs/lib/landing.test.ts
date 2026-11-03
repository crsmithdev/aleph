import type { ChecksStop } from "./checks.ts";
import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterLand, bounceNote, brief as unitPrompt, isMergeBounce, MERGE_MODEL, MERGE_SECONDS } from "./continuation.ts";
import { land, landTerms, type LandPorts } from "./landing.ts";
import * as issues from "../../todo/lib/todo.ts";
import * as store from "../../todo/lib/store.ts";
import { readRun, writeRun, type Check, type Entry, type Repo, type Run } from "./ledger.ts";

setDefaultTimeout(120_000);

const KEYS = ["ALEPH_FACTORY_DIR", "ALEPH_JOBS_DIR", "XDG_RUNTIME_DIR", "ALEPH_LAND_BATCH", "ALEPH_ISSUES", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
let dir: string, repo: Repo, saved: Record<string, string | undefined>;
let sleepers: ReturnType<typeof Bun.spawn>[];
let made: number;

const sh = (cwd: string, ...args: string[]): string => {
  const p = Bun.spawnSync(args, { cwd, env: process.env, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
};
const remote = (...a: string[]) => sh(dir, "git", "--git-dir", join(dir, "repo.git"), ...a);
const filesAt = (commit: string) => sh(repo.path, "git", "ls-tree", "-r", "--name-only", commit).split("\n");
const mainFiles = () => remote("ls-tree", "-r", "--name-only", "main").split("\n");
const pushes = () => existsSync(join(dir, "pushes")) ? readFileSync(join(dir, "pushes"), "utf8").trim().split("\n").length : 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aleph-landing-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  delete process.env.ALEPH_LAND_BATCH;
  Object.assign(process.env, { ALEPH_JOBS_DIR: join(dir, "jobs"), XDG_RUNTIME_DIR: join(dir, "run"), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" });
  mkdirSync(join(dir, "jobs"));
  sh(dir, "git", "init", "-q", "--bare", "-b", "main", "repo.git");
  writeFileSync(join(dir, "repo.git", "hooks", "pre-receive"), `#!/bin/sh\necho x >> ${join(dir, "pushes")}\ncat > /dev/null\n`, { mode: 0o755 });
  sh(dir, "git", "clone", "-q", "repo.git", "repo");
  sh(join(dir, "repo"), "git", "commit", "-q", "--allow-empty", "-m", "init");
  sh(join(dir, "repo"), "git", "push", "-q", "origin", "main");
  sh(dir, "git", "clone", "-q", "repo.git", "other");
  rmSync(join(dir, "pushes"), { force: true });
  repo = { key: "demo", path: join(dir, "repo"), main: "main", checks: [], setup: [] } as unknown as Repo;
  sleepers = [];
  made = 1;
});

afterEach(() => {
  for (const s of sleepers) s.kill("SIGKILL");
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(dir, { recursive: true, force: true });
});

/** A commit on main that the land did not make. */
function moveMain(file = `moved-${Math.random()}`, text = "x\n"): void {
  const o = join(dir, "other");
  sh(o, "git", "pull", "-q", "--rebase", "origin", "main");
  mkdirSync(join(o, file, ".."), { recursive: true });
  writeFileSync(join(o, file), text);
  sh(o, "git", "add", ".");
  sh(o, "git", "commit", "-qm", `other ${file}`);
  sh(o, "git", "push", "-q", "origin", "main");
}

/** A branch with one commit per file text, from origin/main. */
function branch(name: string, commits: [string, string][]): void {
  sh(repo.path, "git", "fetch", "-q", "origin");
  sh(repo.path, "git", "checkout", "-q", "-b", `job/${name}`, "origin/main");
  for (const [file, text] of commits) {
    mkdirSync(join(repo.path, file, ".."), { recursive: true });
    writeFileSync(join(repo.path, file), text);
    sh(repo.path, "git", "add", ".");
    sh(repo.path, "git", "commit", "-qm", `add ${file}`);
  }
  sh(repo.path, "git", "checkout", "-q", "main");
}

/** A passed job and its land run, not started. `extra` goes on the land run, `agent` on the agent run. */
function job(name: string, commits: [string, string][], extra: Partial<Run> = {}, agent: Partial<Run> = {}): Entry {
  if (commits.length) branch(name, commits);
  const buildId = `20261101-000000-demo-${name}-build`;
  const started = new Date().toISOString();
  const base = { name, repo: "demo", job: buildId, branch: `job/${name}`, told: true, started } as const;
  mkdirSync(join(dir, "jobs", buildId));
  writeFileSync(join(dir, "jobs", buildId, "spec.md"), "");
  writeRun(join(dir, "jobs", buildId), { ...base, kind: "build", condition: "passed", ...agent } as Run);
  const id = `20261101-000001-demo-${name}-land`;
  const folder = join(dir, "jobs", id);
  mkdirSync(folder);
  const run = { ...base, kind: "land", condition: "running", made: made++, ...extra } as Run;
  writeRun(folder, run);
  return { id, folder, run };
}

/** A land run that counts as live, queued behind a leader. */
function queued(e: Entry): Entry {
  const s = Bun.spawn(["bash", "-c", "sleep 300; :", e.folder], { stdout: "ignore", stderr: "ignore" });
  sleepers.push(s);
  writeFileSync(join(e.folder, "pid"), String(s.pid));
  return e;
}

/** Checks that fail when `bad` says why, and move main during the first `races` calls. */
function ports(o: { bad?: (files: string[]) => string | null; races?: number; raceOn?: (names: string[]) => boolean; room?: number[] } = {}): LandPorts & { calls: string[][]; only: (Check[] | undefined)[] } {
  const calls: string[][] = [];
  const only: (Check[] | undefined)[] = [];
  let races = o.races ?? 0;
  return {
    calls,
    only,
    pull: async (room) => { o.room?.push(room); },
    check: async (commit, runs, _changed, narrowed) => {
      calls.push(runs.map((r) => r.name));
      only.push(narrowed);
      if (races > 0 && (o.raceOn?.(runs.map((r) => r.name)) ?? true)) { races--; moveMain(); }
      const reason = o.bad?.(filesAt(commit)) ?? null;
      const why: ChecksStop | null = reason ? { cause: "check", checkName: reason.replace(/ failed$/, ""), reason } : null;
      return { why, checks: [{ name: "fake", ok: !why, seconds: 0 }], log: reason ? `the log of ${reason}\n` : "" };
    },
  };
}

const given = (e: Entry) => JSON.parse(readFileSync(join(e.folder, "batch.json"), "utf8"));
const landLog = (e: Entry) => readFileSync(join(e.folder, "land.log"), "utf8");
/** Fails only with both files in the tree, as a check does that two runs break together. */
const both = (a: string, b: string) => (files: string[]) => files.includes(a) && files.includes(b) ? "bad failed" : null;

test("the check issue filed after a land takes the priority of the landed issue", async () => {
  sh(dir, "git", "init", "-q", "--bare", "-b", "main", "items.git");
  sh(dir, "git", "clone", "-q", "items.git", "items");
  sh(join(dir, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(dir, "items"), "git", "push", "-q", "origin", "main");
  process.env.ALEPH_ISSUES = join(dir, "items");
  store.writeList(repo, "start", (doc) => { issues.add(doc, "landed one", { priority: "critical" }); return true; }, true);
  const a = job("t1", [["t1.txt", "1\n"]], { on: "demo-1", check: "open" });
  expect(await land(a, repo, ports())).toMatchObject({ code: 0, outcome: { condition: "landed" } });
  const doc = store.readList(repo)!;
  expect(issues.status(issues.find(doc, 1)!)).toBe("done");
  expect(issues.find(doc, 2)!.fm.priority).toBe("critical");
});

test("a batch of three: one check call, one push, three commits, each with its own Job trailer", async () => {
  const [a, b, c] = [job("t1", [["t1.txt", "1\n"]]), queued(job("t2", [["t2.txt", "2\n"]])), queued(job("t3", [["t3.txt", "3\n"]]))];
  const p = ports();
  const r = await land(a, repo, p);
  expect(r).toMatchObject({ code: 0, outcome: { condition: "landed" } });
  expect(p.calls).toEqual([["t1", "t2", "t3"]]);
  expect(pushes()).toBe(1);
  expect(given(b).verdict.condition).toBe("landed");
  expect(given(c).checks).toEqual([{ name: "fake", ok: true, seconds: 0 }]);
  for (const e of [a, b, c]) expect(remote("log", "-1", "--format=%s", `--grep=^Job: ${e.run.job}$`, "main")).toBe(`add ${e.run.name}.txt`);
  expect(remote("log", "-1", "--format=%H", `--grep=^Job: ${b.run.job}$`, "main")).toBe(given(b).verdict.commit);
  expect(remote("rev-list", "--count", "main")).toBe("4");
  expect(landLog(a)).toContain("batch of 3");
  expect(existsSync(join(repo.path, "t3.txt"))).toBe(true);
});

test("in a batch each commit has the Issue trailer of its own run", async () => {
  const [a, b, c] = [job("t1", [["t1.txt", "1\n"]], { on: "demo-11" }), queued(job("t2", [["t2.txt", "2\n"]], { on: "demo-12" })), queued(job("t3", [["t3.txt", "3\n"]], { on: "demo-13" }))];
  expect(await land(a, repo, ports())).toMatchObject({ code: 0, outcome: { condition: "landed" } });
  for (const [e, n] of [[a, 11], [b, 12], [c, 13]] as const) expect(remote("log", "-1", "--format=%b", `--grep=^Job: ${e.run.job}$`, "main")).toContain(`Issue: demo-${n}\n`);
});

test("a queued land with a batch verdict in its folder returns that verdict", async () => {
  const e = job("given", []);
  writeFileSync(join(e.folder, "batch.json"), JSON.stringify({ verdict: { condition: "landed", commit: "abc" }, code: 0, checks: [] }));
  const p = ports();
  expect(await land(e, repo, p)).toEqual({ outcome: { condition: "landed", commit: "abc" }, code: 0 });
  expect(p.calls).toEqual([]);
});

test("a queued land whose job can no longer land stays out of the batch", async () => {
  const leader = job("lead", [["lead.txt", "l\n"]]);
  const out = queued(job("gone", [["gone.txt", "g\n"]], {}, { condition: "failed" }));
  const p = ports();
  await land(leader, repo, p);
  expect(p.calls).toEqual([["lead"]]);
  expect(existsSync(join(out.folder, "batch.json"))).toBe(false);
});

test("the land asks for as many runs as the batch has room for, and for none when it is full", async () => {
  process.env.ALEPH_LAND_BATCH = "3";
  const room: number[] = [];
  const a = job("r1", [["r1.txt", "1\n"]]);
  const b = queued(job("r2", [["r2.txt", "2\n"]]));
  await land(a, repo, ports({ room }));
  expect(room).toEqual([1]);
  // The queued run ends when it reads its verdict; a live older land would hold the next one back.
  writeFileSync(join(b.folder, "exit"), "0");
  process.env.ALEPH_LAND_BATCH = "1";
  const none: number[] = [];
  await land(job("r3", [["r3.txt", "3\n"]]), repo, ports({ room: none }));
  expect(none).toEqual([]);
});

test("a run that breaks the check fails with the check's reason; the others land; at most 1 + 2 + 2 checks", async () => {
  const [a, bad, c] = [job("a", [["a.txt", "a\n"]]), queued(job("bad", [["bad.txt", "b\n"]])), queued(job("c", [["c.txt", "c\n"]]))];
  const p = ports({ bad: both("a.txt", "bad.txt") });
  const r = await land(a, repo, p);
  expect(r.outcome.condition).toBe("landed");
  expect(given(bad).verdict).toMatchObject({ condition: "failed", reason: "bad failed" });
  expect(given(bad).code).toBe(1);
  expect(given(bad).checks).toEqual([{ name: "fake", ok: false, seconds: 0 }]);
  expect(landLog(bad)).toContain("the log of bad failed");
  expect(given(c).verdict.condition).toBe("landed");
  expect(p.calls.length).toBeLessThanOrEqual(5);
  expect(mainFiles()).toEqual(["a.txt", "c.txt"]);
  expect(pushes()).toBe(1);
});

test("a conflict in one run takes only that run out", async () => {
  const [k1, k2, k3] = [job("k1", [["k.txt", "one\n"]]), queued(job("k2", [["k.txt", "two\n"]])), queued(job("k3", [["k3.txt", "3\n"]]))];
  const r = await land(k1, repo, ports());
  expect(r.outcome.condition).toBe("landed");
  expect(given(k2).verdict).toMatchObject({ condition: "failed", reason: "merge conflict", conflicts: ["k.txt"] });
  expect(landLog(k2)).toContain("k.txt");
  expect(given(k3).verdict.condition).toBe("landed");
  expect(mainFiles()).toEqual(["k.txt", "k3.txt"]);
});

test("a conflict that a mechanical rebase clears lands", async () => {
  moveMain("step.txt", "start\n");
  const e = job("rebase", [["step.txt", "theirs\n"], ["step.txt", "mine\n"]]);
  moveMain("step.txt", "theirs\n");
  const r = await land(e, repo, ports());
  expect(r.outcome.condition).toBe("landed");
  expect(landLog(e)).toContain("mechanical rebase: ok");
  expect(remote("show", "main:step.txt")).toBe("mine");
});

test("a change main already has ends done with no net change and takes the branch", async () => {
  const e = job("twin", [["twin.txt", "same\n"]]);
  moveMain("twin.txt", "same\n");
  const r = await land(e, repo, ports());
  expect(r).toMatchObject({ outcome: { condition: "done", reason: "no net change" }, code: 0 });
  expect(sh(repo.path, "git", "branch", "--list", "job/twin")).toBe("");
});

test("a branch that changes the list is refused, and the note names the list", async () => {
  const e = job("own", [["docs/todo.md", "x\n"]]);
  const before = remote("rev-parse", "main");
  const r = await land(e, repo, ports());
  expect(r.outcome).toMatchObject({ condition: "failed", conflicts: ["docs/todo.md"] });
  expect(remote("rev-parse", "main")).toBe(before);
  expect(bounceNote(r.outcome as Run)).toContain("Only aleph issue writes the list");
});

test("a branch that is gone fails", async () => {
  const r = await land(job("nobranch", []), repo, ports());
  expect(r.outcome).toMatchObject({ condition: "failed", reason: "branch gone: job/nobranch" });
});

test("a run whose checked base is origin/main lands with no check call; one behind main runs the checks", async () => {
  const fresh = job("fresh", [["fresh.txt", "f\n"]]);
  const stamp = { checkedBase: remote("rev-parse", "main"), checkedTip: sh(repo.path, "git", "rev-parse", "job/fresh") };
  const p = ports();
  const e = { ...fresh, run: { ...fresh.run, ...stamp } };
  writeRun(e.folder, e.run);
  expect((await land(e, repo, p)).outcome.condition).toBe("landed");
  expect(p.calls).toEqual([]);
  expect(landLog(e)).toContain("checks skipped: main unchanged since");

  const stale = job("stale", [["stale.txt", "s\n"]]);
  const staleStamp = { checkedBase: remote("rev-parse", "main"), checkedTip: sh(repo.path, "git", "rev-parse", "job/stale") };
  moveMain();
  const q = ports();
  const e2 = { ...stale, run: { ...stale.run, ...staleStamp } };
  writeRun(e2.folder, e2.run);
  expect((await land(e2, repo, q)).outcome.condition).toBe("landed");
  expect(q.calls).toEqual([["stale"]]);
});

const LINES = Array.from({ length: 12 }, (_, i) => `line ${i}`);
const edit = (n: number, text: string) => LINES.map((l, i) => (i === n ? text : l)).join("\n") + "\n";

/** A run on `files`, checked on the current main, then `moved` lands on main from elsewhere. */
async function behind(name: string, files: [string, string][], moved: [string, string][]) {
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory");
  repo.checks = [{ name: "tests", run: "bun run test", tests: ["**/*.test.ts"] }, { name: "types", run: "bunx tsc" }];
  const e = job(name, files);
  const run = { ...e.run, checkedBase: remote("rev-parse", "main"), checkedTip: sh(repo.path, "git", "rev-parse", `job/${name}`) };
  writeRun(e.folder, run);
  for (const [f, t] of moved) moveMain(f, t);
  const p = ports();
  const r = await land({ ...e, run }, repo, p);
  return { r, p, log: landLog(e) };
}

/** Main with a.ts, its test, an unrelated test, and a test that spawns cli.ts, which imports a.ts. */
function seedTree(): void {
  for (const [f, t] of [["a.ts", edit(-1, "")], ["a.test.ts", `import "./a.ts";\n`], ["b.ts", "export {};\n"], ["b.test.ts", `import "./b";\n`],
    ["cli.ts", `import "./a.ts";\n`], ["sub/cli.test.ts", `Bun.spawn(["bun", "cli.ts"]);\n`], ["notes.md", edit(-1, "")]] as const) moveMain(f, t);
}

test("a run behind main whose files main's new commits do not touch runs the checks without tests, and does not cover the tip", async () => {
  seedTree();
  const { r, p, log } = await behind("apart", [["b.ts", "export const b = 1;\n"]], [["a.ts", edit(1, "main")]]);
  expect(r.outcome.condition).toBe("landed");
  expect(p.only).toEqual([[{ name: "types", run: "bunx tsc" }]]);
  expect(log).toContain("checks narrowed: main's new commits share no file with the run");
  expect(existsSync(join(dir, "factory", "baseline.json"))).toBe(false);
});

test("a run behind main that shares a module with main's new commits runs only the tests that reach it", async () => {
  seedTree();
  const { r, p, log } = await behind("shared", [["a.ts", edit(1, "run")]], [["a.ts", edit(9, "main")]]);
  expect(r.outcome.condition).toBe("landed");
  expect(p.only).toEqual([[{ name: "tests", run: "bun run test './a.test.ts' './sub/cli.test.ts'", tests: ["**/*.test.ts"] }, { name: "types", run: "bunx tsc" }]]);
  expect(log).toContain("1 file changed on both sides, 2 related test files");
});

test("a run behind main that shares a file that is not a module runs every check", async () => {
  seedTree();
  const { p, log } = await behind("prose", [["notes.md", edit(1, "run")]], [["notes.md", edit(9, "main")]]);
  expect(p.only).toEqual([undefined]);
  expect(log).not.toContain("checks narrowed");
});

test("a commit added to the branch after its checks gets the checks on land", async () => {
  const e = job("tipped", [["tipped.txt", "t\n"]]);
  const run = { ...e.run, checkedBase: remote("rev-parse", "main"), checkedTip: "0000000" };
  writeRun(e.folder, run);
  const p = ports();
  await land({ ...e, run }, repo, p);
  expect(p.calls).toEqual([["tipped"]]);
});

test("a push that loses a race merges again in the same land, and lands", async () => {
  const e = job("racer", [["x.txt", "x\n"]]);
  const r = await land(e, repo, ports({ races: 1 }));
  expect(r.outcome.condition).toBe("landed");
  expect(landLog(e)).toContain("## main moved; merging again");
  expect(remote("log", "-1", "--format=%s", "main")).toBe("add x.txt");
});

test("a push that keeps losing fails as moved, and the unit lands again", async () => {
  const e = job("loser", [["x.txt", "x\n"]]);
  const r = await land(e, repo, ports({ races: 99 }));
  expect(r.code).toBe(1);
  writeRun(e.folder, { ...e.run, ...r.outcome } as Run);
  expect(afterLand({ ...e.run, ...r.outcome } as Run)).toBe("land");
  expect(mainFiles()).not.toContain("x.txt");
});

test("a push the remote refuses with main in place fails and leaves main alone", async () => {
  writeFileSync(join(dir, "repo.git", "hooks", "pre-receive"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const before = remote("rev-parse", "main");
  const r = await land(job("nope", [["x.txt", "x\n"]]), repo, ports());
  expect(r.outcome).toMatchObject({ condition: "failed", reason: "push refused" });
  expect(remote("rev-parse", "main")).toBe(before);
});

test("a member that failed its checks in attempt 1 is not in the retry after main moved", async () => {
  const [a, bad, c] = [job("ra", [["ra.txt", "a\n"]]), queued(job("rbad", [["rbad.txt", "b\n"]])), queued(job("rr", [["rr.txt", "r\n"]]))];
  const p = ports({ bad: both("ra.txt", "rbad.txt"), races: 1 });
  await land(a, repo, p);
  expect(given(bad).verdict.condition).toBe("failed");
  expect(given(c).verdict.condition).toBe("landed");
  const retry = landLog(a).slice(landLog(a).indexOf("main moved; merging again"));
  expect(retry).toContain("checks on");
  expect(retry).not.toContain("rbad");
  expect(mainFiles()).not.toContain("rbad.txt");
});

for (const names of [["tla", "tlbad", "tlr"], ["tl2a", "tl2bad"]]) {
  test(`a member that failed in attempt 1 does not take the leader out when main moves twice: batch of ${names.length}`, async () => {
    const [lead, bad, ...rest] = names.map((n, i) => { const e = job(n, [[`${n}.txt`, "x\n"]]); return i ? queued(e) : e; });
    const r = await land(lead, repo, ports({ bad: both(`${names[0]}.txt`, `${names[1]}.txt`), races: 2, raceOn: (n) => n[0] === names[0] && !n.includes(names[1]) }));
    expect(r.outcome.condition).toBe("landed");
    expect(given(bad).verdict.condition).toBe("failed");
    for (const e of rest) expect(given(e).verdict.condition).toBe("landed");
    expect(landLog(lead).split("main moved; merging again").length - 1).toBe(2);
    expect(mainFiles()).toContain(`${names[0]}.txt`);
    expect(mainFiles()).not.toContain(`${names[1]}.txt`);
  });
}

test("a job already on main by its Job trailer lands as that commit and does not merge again", async () => {
  const e = job("pushed", [["p.txt", "p\n"]]);
  const o = join(dir, "other");
  sh(o, "git", "pull", "-q", "origin", "main");
  sh(o, "git", "commit", "-q", "--allow-empty", "-m", `hand\n\nJob: ${e.run.job}`);
  sh(o, "git", "push", "-q", "origin", "main");
  const p = ports();
  const r = await land(e, repo, p);
  expect(r.outcome).toEqual({ condition: "landed", commit: remote("rev-parse", "main") });
  expect(p.calls).toEqual([]);
  expect(sh(repo.path, "git", "branch", "--list", "job/pushed")).toBe("");
});

test("afterLand sends a conflict back to the worker at most twice", () => {
  const e = job("clash", []);
  const fail = { ...e.run, condition: "failed", cause: "conflict", reason: "merge conflict", conflicts: ["f"] } as Run;
  writeRun(e.folder, fail);
  expect(afterLand(fail)).toBe("worker");
  expect(afterLand({ ...fail, condition: "landed" })).toBeUndefined();
  expect(afterLand({ ...fail, conflicts: undefined, cause: "check", reason: "x failed" })).toBeUndefined();
  for (const n of [2, 3]) {
    const f = join(dir, "jobs", `20261101-00000${n}-demo-clash-land`);
    mkdirSync(f);
    writeRun(f, fail);
    expect(afterLand(fail)).toBe(n === 2 ? "worker" : undefined);
  }
});

test("landTerms: which runs may land, and how", () => {
  const ask = (reason: string, kind = "review") => ({ condition: "awaiting", ask: { kind, reason, question: "", options: [], why: [] } });
  const needs = (n: Partial<Run>) => landTerms({ kind: "build", ...n } as Run);
  expect(needs({ condition: "passed" })).toEqual({ manual: false, held: false, asked: false });
  expect(needs({ condition: "passed", say: "look" })).toEqual({ manual: true, held: false, asked: false });
  expect(landTerms({ kind: "recheck", condition: "passed" } as Run)).toEqual({ manual: false, held: false, asked: false });
  expect(needs(ask("manual") as Partial<Run>)).toEqual({ manual: true, held: false, asked: true });
  expect(needs(ask("held-path") as Partial<Run>)).toEqual({ manual: false, held: true, asked: true });
  expect(needs(ask("question", "input") as Partial<Run>)).toBeNull();
  expect(needs({ condition: "failed" })).toBeNull();
  expect(landTerms({ kind: "land", condition: "passed" } as Run)).toBeNull();
});

test("the run after a conflicted land has a merge prompt: the paths and the last commit on main, no spec text", async () => {
  const e = job("mrg", [["clash.txt", "branch\n"]]);
  moveMain("clash.txt", "main\n");
  const spec = "SPEC-SECRET-TEXT: build the whole thing";
  writeFileSync(join(e.folder, "..", e.run.job, "spec.md"), spec);
  const r = await land(e, repo, ports());
  expect(r.outcome).toMatchObject({ condition: "failed", conflicts: ["clash.txt"] });
  writeRun(e.folder, { ...e.run, ...r.outcome } as Run);
  const id = "20261101-000009-demo-mrg-build";
  const folder = join(dir, "jobs", id);
  mkdirSync(folder);
  writeRun(folder, { name: "mrg", repo: "demo", job: e.run.job, kind: "build", condition: "running", merge: true, model: MERGE_MODEL, made: 99, started: new Date().toISOString() } as Run);
  const text = unitPrompt(id, folder, readRun(folder)!, repo);
  expect(text).toContain("clash.txt");
  expect(text).toContain("other clash.txt");
  expect(text).toContain("origin/main");
  expect(text).not.toContain("SPEC-SECRET");
  expect(text).not.toContain("## Spec");
  expect(MERGE_SECONDS).toBe(600);
  expect(isMergeBounce({ ...e.run, ...r.outcome } as Run)).toBe(true);
  expect(isMergeBounce({ ...e.run, cause: "own-list", conflicts: ["docs/todo.md"] } as Run)).toBe(false);
});

const baselineJson = () => {
  const f = join(dir, "factory", "baseline.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
};

test("a land whose checks run and pass records the pushed commit as green in baseline.json", async () => {
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory");
  repo.checks = [{ name: "all", run: "true" }];
  const e = job("g1", [["g1.txt", "1\n"]]);
  expect(await land(e, repo, ports())).toMatchObject({ code: 0, outcome: { condition: "landed" } });
  expect(baselineJson()).toEqual({ demo: { repo: "demo", commit: remote("rev-parse", "main"), ok: true } });
});

test("a land with checks skipped: main unchanged since records the pushed commit as green", async () => {
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory");
  const fresh = job("g2", [["g2.txt", "2\n"]]);
  const e = { ...fresh, run: { ...fresh.run, checkedBase: remote("rev-parse", "main"), checkedTip: sh(repo.path, "git", "rev-parse", "job/g2") } };
  writeRun(e.folder, e.run);
  const p = ports();
  expect((await land(e, repo, p)).outcome.condition).toBe("landed");
  expect(p.calls).toEqual([]);
  expect(landLog(e)).toContain("checks skipped: main unchanged since");
  expect(baselineJson().demo).toEqual({ repo: "demo", commit: remote("rev-parse", "main"), ok: true });
});

test("a land whose diff matches no globs of a check records no baseline", async () => {
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory");
  repo.checks = [{ name: "all", run: "true" }, { name: "android", run: "true", when: ["android/**"] }];
  const e = job("g3", [["g3.txt", "3\n"]]);
  expect((await land(e, repo, ports())).outcome.condition).toBe("landed");
  expect(baselineJson()).toEqual({});
});

test("a failed land records no baseline, and a newer entry is kept", async () => {
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory");
  const bad = job("g4", [["bad.txt", "x\n"]]);
  expect((await land(bad, repo, ports({ bad: () => "all failed" }))).outcome.condition).toBe("failed");
  expect(baselineJson()).toEqual({});
  moveMain();
  const newer = remote("rev-parse", "main");
  mkdirSync(join(dir, "factory"), { recursive: true });
  writeFileSync(join(dir, "factory", "baseline.json"), JSON.stringify({ demo: { repo: "demo", commit: newer, ok: false } }));
  const e = job("g5", [["g5.txt", "5\n"]]);
  // The branch is cut from main, so main moves past the entry once this land pushes: the entry is an ancestor and is replaced.
  expect((await land(e, repo, ports())).outcome.condition).toBe("landed");
  expect(baselineJson().demo).toEqual({ repo: "demo", commit: remote("rev-parse", "main"), ok: true });
});
