import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, watch, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readList, writeList } from "../../../issues/lib/store.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { baseline, dispatchIssues, report, setPaused, stalled } from "./factory.ts";
import { readTick, sweep } from "./tick.ts";
import { spentToday, runsToday, health, writeBaseline, suiteHistory, factorySnapshot, issueFacts } from "../gates/factory-status.ts";
import { allJobs, loadRegistry } from "../records/ledger.ts";
import { lock } from "../infra/locks.ts";
import { type Run } from "../records/ledger.ts";
import { getRun, putRun } from "../records/record.ts";
import { ctx, sh, newIssue, change, mk, setup, teardown } from "./factory.helpers.ts";

beforeEach(setup);
afterEach(() => { setSystemTime(); teardown(); });
// The clock of the tests that set it: the day's spend, the runs of today and the starting rule read it.
const NOW = Date.parse("2026-11-04T12:00:00Z");


test("report lists each new episode page once, and nothing without an episodes folder", () => {
  const dir = join(ctx.base, "factory", "episodes");
  rmSync(dir, { recursive: true, force: true });
  expect(report()).not.toContain("episodes:");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "fac-1 Ship it.md"), "x\n");
  writeFileSync(join(dir, "fac-2 Other.md"), "x\n");
  const first = report();
  expect(first).toContain("episodes:\n  fac-1 Ship it\n  fac-2 Other");
  const second = report();
  expect(second).not.toContain("fac-1 Ship it");
  expect(second).not.toContain("fac-2 Other");
});

test("the report groups each unshown run under its report lane, in the order of the naming standard", () => {
  mk("fac-11", "build", "landed", { shown: false });
  mk("fac-12", "build", "waiting", { shown: false });
  mk("fac-13", "build", "failed", { shown: false });
  const out = report();
  const at = (s: string) => out.indexOf(s);
  expect(at("landed:")).toBeLessThan(at("waiting:"));
  expect(at("waiting:")).toBeLessThan(at("failed:"));
  expect(out).toContain("landed:\nfac-11 landed");
  expect(out).toContain("waiting:\nfac-12 waiting");
  expect(out).toContain("failed:\nfac-13 failed");
  expect(out).not.toContain("delivered:");
  expect(out).not.toContain("needs you:");
  expect(out).not.toContain("stuck:");
});

test("a peek lists the unshown runs and leaves them unshown", () => {
  mk("fac-14", "build", "landed", { shown: false });
  expect(report(Date.now(), true)).toContain("fac-14 landed");
  expect(report(Date.now(), true)).toContain("fac-14 landed");
  expect(report()).toContain("fac-14 landed");
  expect(report()).not.toContain("fac-14 landed");
});

test("a deleted episode page leaves the seen file, and a page still on disk is not listed again", () => {
  const dir = join(ctx.base, "factory", "episodes");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "fac-3 Old.md"), "x\n");
  writeFileSync(join(dir, "fac-4 Kept.md"), "x\n");
  report();
  rmSync(join(dir, "fac-3 Old.md"));
  expect(report()).not.toContain("episodes:");
  const seen = readFileSync(join(ctx.base, "factory", "episodes-seen"), "utf8");
  expect(seen).not.toContain("fac-3 Old");
  expect(seen).toContain("fac-4 Kept");
});

test("a dispatch with checks, three factory repos and no open issues fetches the work store at most twice", async () => {
  const items = join(ctx.base, "items");
  writeFileSync(join(ctx.base, "repos.json"), JSON.stringify(Object.fromEntries(["fac", "fac2", "fac3"].map((k) => [k, { path: join(ctx.base, "repo"), sandbox: true, autoland: false }]))));
  const log = join(ctx.base, "fetch.log");
  mkdirSync(join(ctx.base, "bin"));
  const real = Bun.spawnSync(["which", "git"]).stdout.toString().trim();
  writeFileSync(log, "");
  writeFileSync(join(ctx.base, "bin", "git"), `#!/bin/sh\n[ "$1" = fetch ] && [ "$PWD" = ${items} ] && echo fetch >> ${log}\nexec ${real} "$@"\n`);
  Bun.spawnSync(["chmod", "+x", join(ctx.base, "bin", "git")]);
  const path = process.env.PATH;
  process.env.PATH = `${join(ctx.base, "bin")}:${path}`;
  try {
    const out = await dispatchIssues(async () => null, undefined, undefined, undefined);
    expect(out.started).toEqual([]);
  } finally {
    process.env.PATH = path;
  }
  const n = readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  console.log(`store fetches: ${n}`);
  expect(n).toBeLessThanOrEqual(2);
});

test("the day's spend counts every kind that records a cost", () => {
  for (const [name, kind, cost] of [["fac-1", "build", 1], ["fac-2", "intake", 2], ["fac-5", "director", 16]] as const) mk(name, kind, "done", { cost });
  expect(spentToday()).toBe(19);
});

test("runStarts counts an issue's job starts in the hour, not its fix rounds, and matches the loop guard", () => {
  const id = newIssue();
  const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
  const { job } = mk(`fac-${id}`, "build", "failed", { started: ago(40) });
  mk(`fac-${id}`, "build", "failed", { job, started: ago(30) });
  mk(`fac-${id}`, "build", "passed", { job, started: ago(10) });
  mk(`fac-${id}`, "build", "passed", { started: ago(5) });
  const item = readList({ key: "fac" })!.items.find((i) => i.id === id)!;
  const jobs = allJobs();
  expect(factorySnapshot(NOW, jobs).runStarts).toBe(2);
  expect(factorySnapshot(NOW, jobs).runStarts).toBe(issueFacts(loadRegistry().fac, item, jobs, NOW).startsInHour);
});

test("a director run has no repo; its cost counts in the day's spend, not in runsToday, and an old one adds nothing", () => {
  setSystemTime(NOW);
  const old = new Date(NOW - 25 * 3600_000).toISOString();
  mk("fac-6", "director", "done", { cost: 3, repo: undefined, on: "fac-6" });
  mk("fac-7", "director", "done", { cost: 5, repo: undefined, on: "20261028-000001-fac-fac-1-build", started: old });
  expect(spentToday()).toBe(3);
  expect(runsToday().filter((e) => e.run.kind === "director")).toEqual([]);
});

test("an issue that names a busy file an open job also names waits; a job waiting for Chris does not count", async () => {
  const surface = "## Edit surface\n- jobs/busy.ts (the change)\n- jobs/other.ts\n";
  const withSurface = () => writeList({ key: "fac" }, "add a goal", (doc) => { const item = issues.add(doc, "ship it", { spec: surface }); return item.id; }, true)!.value;
  for (const n of [901, 902, 903]) mk(`fac-${n}`, "land", "dropped", { conflicts: ["jobs/busy.ts"] });
  const first = withSurface();
  const second = withSurface();
  const { folder } = mk(`fac-${first}`, "build", "passed");
  const calls: string[] = [];
  const start = async (_repo: unknown, name: string) => { calls.push(name); return null; };
  const out = await dispatchIssues(start);
  expect(calls).toEqual([]);
  expect(out.skipped).toContain(`fac-${second}: waits for fac-${first}: both change the busy file jobs/busy.ts`);
  putRun(basename(folder), { ...getRun(basename(folder))!, condition: "waiting", ask: { kind: "approval", reason: "held-path", question: "q", options: [], why: [] } });
  await dispatchIssues(start);
  expect(calls).toEqual([`fac-${second}`]);
});

test("an issue that uses the gpt-oss server waits for an open job that uses it; an issue that does not is not held", async () => {
  const add = (spec: string) => writeList({ key: "fac" }, "add a goal", (doc) => { const item = issues.add(doc, "ship it", { spec }); return item.id; }, true)!.value;
  const first = add("Call the model on 127.0.0.1:8012.\n");
  const second = add("Start aleph-gpt-oss first.\n");
  const third = add("Change a label.\n");
  const { folder } = mk(`fac-${first}`, "build", "passed");
  const calls: string[] = [];
  const start = async (_repo: unknown, name: string) => { calls.push(name); return null; };
  const out = await dispatchIssues(start);
  expect(calls).toEqual([`fac-${third}`]);
  expect(out.skipped).toContain(`fac-${second}: waits for fac-${first}: both use the gpt-oss server`);
  putRun(basename(folder), { ...getRun(basename(folder))!, condition: "waiting", ask: { kind: "approval", reason: "held-path", question: "q", options: [], why: [] } });
  await dispatchIssues(start);
  expect(calls).toContain(`fac-${second}`);
});

test("an issue that shares only a quiet file with an open job starts", async () => {
  const body = "## Edit surface\n- jobs/quiet.ts\n";
  const add = () => writeList({ key: "fac" }, "add a goal", (doc) => { const item = issues.add(doc, "ship it", { spec: body }); return item.id; }, true)!.value;
  mk("fac-901", "land", "dropped", { conflicts: ["jobs/quiet.ts"] });
  const first = add();
  const second = add();
  mk(`fac-${first}`, "build", "passed");
  const calls: string[] = [];
  await dispatchIssues(async (_repo, name) => { calls.push(name); return null; });
  expect(calls).toEqual([`fac-${second}`]);
});

test("stalled lists what could move: a ready issue, a new issue and a passed run, each until a gate or a live run explains it", async () => {
  const id = newIssue();
  const fresh = writeList({ key: "fac" }, "add an issue", (doc) => issues.add(doc, "new thing").id, true)!.value;
  expect(await stalled()).toEqual([`goal:fac-${id}`, `ingest:fac-${fresh}`]);
  writeFileSync(join(ctx.base, "repos.json"), JSON.stringify({ fac: { path: join(ctx.base, "repo"), sandbox: true, autoland: true } }));
  const { folder } = mk(`fac-${id}`, "build", "passed", { next: "land" });
  expect(await stalled()).toEqual([`land:fac-${id}`, `ingest:fac-${fresh}`]);
  setPaused(true);
  expect(await stalled()).toEqual([]);
  setPaused(false);
  putRun(basename(folder), { ...getRun(basename(folder))!, condition: "failed", next: undefined });
  // A stuck run holds only its own issue, which its open job keeps not ready; the new issue can still move.
  expect(await stalled()).toEqual([`ingest:fac-${fresh}`]);
});

test("stalled counts a red baseline until a later suite run is green, also after main moves", async () => {
  const repo = join(ctx.base, "repo");
  const head = () => Bun.spawnSync(["git", "-C", repo, "rev-parse", "origin/main"], { stdout: "pipe", stderr: "ignore" }).stdout.toString().trim();
  const id = newIssue();
  const fresh = writeList({ key: "fac" }, "add a plan", (doc) => { const i = issues.add(doc, "plan me"); i.fm.plan = "true"; return i.id; }, true)!.value;
  await writeBaseline("fac", () => ({ repo: "fac", commit: head(), ok: false, failed: "tests" }));
  sh(repo, "git", "commit", "-q", "--allow-empty", "-m", "next");
  sh(repo, "git", "push", "-q", "origin", "main");
  expect(await stalled()).toEqual([]);
  await writeBaseline("fac", () => ({ repo: "fac", commit: head(), ok: true }));
  expect(await stalled()).toEqual([`goal:fac-${id}`, `ingest:fac-${fresh}`]);
});

test("writeBaseline waits for the baseline-file lock, here and in another process, and both entries survive", async () => {
  const file = join(ctx.base, "factory", "baseline.json");
  const release = (await lock("baseline-file"))!;
  const child = Bun.spawn(["bun", "-e", `import { writeBaseline } from ${JSON.stringify(join(import.meta.dir, "..", "gates", "factory-status.ts"))};
await writeBaseline("b", () => ({ repo: "b", commit: "2", ok: true }));`], { env: { ...process.env }, stdout: "ignore", stderr: "pipe" });
  const here = writeBaseline("a", () => ({ repo: "a", commit: "1", ok: true }));
  // Both writers wait on the lock: lock() makes a `<name>.new.<pid>.<uuid>` directory for each before it tries the name.
  const waiters = () => readdirSync(join(ctx.base, "run", "aleph")).filter((n) => n.startsWith("baseline-file.new.")).length;
  await new Promise<void>((r) => {
    const w = watch(join(ctx.base, "run", "aleph"), () => { if (waiters() === 2) { w.close(); r(); } });
    if (waiters() === 2) { w.close(); r(); }
  });
  expect(existsSync(file)).toBe(false);
  expect(child.exitCode).toBeNull();
  release();
  expect(await here).toBe(true);
  expect(await child.exited, await new Response(child.stderr).text()).toBe(0);
  expect(Object.keys(JSON.parse(readFileSync(file, "utf8"))).sort()).toEqual(["a", "b"]);
});

test("a blocked issue does not stall; a live agent run leaves a ready issue out", async () => {
  const blocker = newIssue();
  const after = newIssue();
  await change(after, (item) => { item.fm.after = [`fac-${blocker}`]; });
  expect(await stalled()).toEqual([`goal:fac-${blocker}`]);
  setSystemTime(NOW);
  mk("fac-other", "build", "running", { made: NOW });
  expect(await stalled()).toEqual([]);
});

test("health says a stall only after 15 minutes of ticks, and stops when the work moves", async () => {
  const id = newIssue();
  const t0 = Date.parse("2026-11-01T12:00:00Z"), min = 60_000;
  const said = (at: number) => health(at).filter((l) => l.text.includes("can start"));
  // The sweep's ports start nothing: the issue stays ready.
  const stallStep = (at: number) => sweep(at, readTick(), { dispatch: async () => {}, suite: () => {} });
  await stallStep(t0);
  await stallStep(t0 + 5 * min);
  expect(said(t0 + 14 * min)).toEqual([]);
  expect(said(t0 + 15 * min)).toEqual([{ text: "health: 1 goal can start, but no run started in 15 minutes", kind: "alert", key: "queue-stuck" }]);
  await change(id, (item) => { issues.setStatus(item, "done"); });
  await stallStep(t0 + 16 * min);
  expect(said(t0 + 16 * min)).toEqual([]);
  expect(health(t0).some((l) => l.text.includes("24 hours"))).toBe(false);
});

test("health warns when the last full suite of a repo took more than the budget", () => {
  const suite = (id: string, ended: string, seconds: number, extra: object = {}) => {
    const dir = join(ctx.base, "jobs", id);
    mkdirSync(dir, { recursive: true });
    putRun(basename(dir), { kind: "build", job: id, name: id, repo: "fac", condition: "done", told: true, started: ended, ended, checks: [{ name: "tests", ok: true, seconds, ...extra }, { name: "types", ok: true, seconds: 1 }] } as Run);
  };
  const said = () => health().filter((l) => l.text.includes("full suite"));
  suite("20261103-000001-a", "2026-11-03T00:01:00Z", 135);
  expect(said()).toEqual([{ text: "health: fac full suite took 135 s; the budget is 120 s", kind: "warn" }]);
  // A pass on rerun does not count: its time holds two runs.
  suite("20261103-000002-b", "2026-11-03T00:02:00Z", 300, { rerun: true });
  expect(said()).toEqual([{ text: "health: fac full suite took 135 s; the budget is 120 s", kind: "warn" }]);
  process.env.ALEPH_SUITE_BUDGET_S = "200";
  try { expect(said()).toEqual([]); } finally { delete process.env.ALEPH_SUITE_BUDGET_S; }
  // The last run is the one that ended last, not the one that started last.
  suite("20261103-000000-c", "2026-11-03T00:03:00Z", 90);
  expect(said()).toEqual([]);
});

test("a suite record holds for its commit and its checks: a change of the repo's checks runs them again on the same commit", async () => {
  const repo = { key: "fac", path: join(ctx.base, "repo"), main: "main", setup: ["bun install"], checks: [{ name: "tests", run: "bun test" }] } as any;
  let ran = 0;
  const failing = async () => { ran++; return { cause: "check", reason: "setup failed", checkName: "setup" } as any; };
  const passing = async () => { ran++; return null; };
  expect(await baseline(repo, failing)).toMatchObject({ state: "red" });
  expect(await baseline(repo, failing)).toMatchObject({ state: "red" });
  expect(ran).toBe(1);
  repo.setup = [];
  repo.checks = [];
  expect(await baseline(repo, passing)).toEqual({ state: "green" });
  expect(ran).toBe(2);
});

test("each suite run appends a history record with the test counts of its checks; a known commit runs nothing and adds none", async () => {
  const repo = { key: "fac", path: join(ctx.base, "repo"), main: "main", setup: [], checks: [] } as any;
  let ran = 0;
  const counts = (n: number) => async (_r: unknown, _c: string, _l: string, record?: (c: any) => void) => {
    ran++;
    record?.({ name: "a", ok: true, seconds: 1, tests: { ran: n, passed: n - 2, failed: 1, skipped: 1, failures: [] }, rerunPassed: 1 });
    record?.({ name: "b", ok: true, seconds: 1, tests: { ran: 1, passed: 1, failed: 0, skipped: 0, failures: [] } });
    return null;
  };
  await baseline(repo, counts(10));
  const head = () => Bun.spawnSync(["git", "rev-parse", "origin/main"], { cwd: repo.path }).stdout.toString().trim();
  const first = head();
  expect(await baseline(repo, counts(10))).toEqual({ state: "green" });
  expect(ran).toBe(1);
  sh(repo.path, "git", "commit", "-q", "--allow-empty", "-m", "next");
  sh(repo.path, "git", "push", "-q", "origin", "main");
  await baseline(repo, counts(20));
  const h = suiteHistory("fac");
  expect(h.map((r) => r.commit)).toEqual([first, head()]);
  expect(h.map(({ ran, passed, failed, skipped, rerunPassed }) => ({ ran, passed, failed, skipped, rerunPassed }))).toEqual([
    { ran: 11, passed: 9, failed: 1, skipped: 1, rerunPassed: 1 },
    { ran: 21, passed: 19, failed: 1, skipped: 1, rerunPassed: 1 },
  ]);
});

test("the report heads a run with its short id once repos.json gives the code", () => {
  writeFileSync(join(process.env.ALEPH_REPOS!, "..", "repos.json"), JSON.stringify({ fac: { code: "f", path: join(process.env.ALEPH_REPOS!, "..", "repo"), sandbox: true, autoland: false } }));
  mk("fac-1421", "build", "landed", { shown: false });
  const out = report();
  expect(out).toContain("f1421 landed");
  expect(out).not.toContain("fac/fac-1421");
});
