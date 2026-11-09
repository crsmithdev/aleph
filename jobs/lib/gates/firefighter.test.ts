// The firefighter as code: one critical issue per failing commit, from a red baseline or a red CI,
// and a rescue Ask on a land live past 30 minutes. No agent run starts.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as issues from "../../../issues/lib/todo.ts";
import * as store from "../../../issues/lib/store.ts";
import { readList, writeList } from "../../../issues/lib/store.ts";
import { askOf } from "../asks/ask.ts";
import { ciStep, type GhRun } from "./ci.ts";
import { ciFailure, firefight, LOG_CHARS, settleCi, type Ports } from "./firefighter.ts";
import * as record from "../records/record.ts";
import { loadRegistry } from "../records/ledger.ts";
import { readEvents } from "../infra/layout.ts";
import { base, calls, fresh, key, repoPath, run, sh, useDirectorFixture } from "../roles/director.fixture.ts";

useDirectorFixture();

const A = "a1".repeat(20), B = "b2".repeat(20), C = "c3".repeat(20);
const factory = () => process.env.ALEPH_FACTORY_DIR!;
const write = (file: string, text: string) => { mkdirSync(join(factory(), file, ".."), { recursive: true }); writeFileSync(join(factory(), file), text); };
const baselineRed = (commit: string) => write("baseline.json", JSON.stringify({ [key]: { repo: key, commit, ok: false, failed: "tests" } }));
const longLog = (what: string) => Array.from({ length: 500 }, (_, i) => `${what} line ${i}`).join("\n");
const reds = () => readList({ key })!.items.filter((i) => store.areasOf(i).includes("red-main"));
let ciCalls = 0;
const ports = (): Ports => ({ gh: () => { ciCalls++; return { ok: true, out: longLog("ci") }; } });
const listing = (runs: GhRun[]) => () => ({ ok: true, out: JSON.stringify(runs) });
const agentRuns = () => (existsSync(process.env.ALEPH_JOBS_DIR!) ? readdirSync(process.env.ALEPH_JOBS_DIR!).filter((d) => d.endsWith("-firefighter")) : []);

test("a red baseline files exactly one critical issue for its commit across two ticks, with the log's tail", async () => {
  fresh([{ title: "other" }]);
  baselineRed(A);
  write(`baseline/${key}/checks.log`, longLog("checks"));
  const one = await firefight(ports());
  expect(one!.filed).toEqual([{ repo: key, commit: A, source: "baseline", filed: 2 }]);
  expect((await firefight(ports()))!.filed).toEqual([]);
  const [it] = reds();
  expect(reds().length).toBe(1);
  expect(it.title).toBe(`Fix the red main at ${A.slice(0, 7)}`);
  expect([it.fm.priority, it.fm.kind]).toEqual(["critical", "bug"]);
  expect(it.request).toContain(`Failing commit: ${A}`);
  expect(it.request).toContain("checks line 499");
  expect(it.request).not.toContain("checks line 200\n");
  expect(it.request.length).toBeLessThan(LOG_CHARS + 500);
});

test("a red CI on main, read through ciStep, files exactly one issue; the same commit red in the baseline files none more", async () => {
  fresh([]);
  ciCalls = 0;
  const repo = loadRegistry()[key];
  const failed: GhRun[] = [{ conclusion: "failure", status: "completed", headSha: B, url: "https://github.com/x/y/actions/runs/42", createdAt: "2026-11-03T10:00:00Z" }];
  ciStep([repo], listing(failed));
  await firefight(ports());
  ciStep([repo], listing(failed));
  await firefight(ports());
  baselineRed(B);
  await firefight(ports());
  expect(reds().length).toBe(1);
  expect(reds()[0].title).toBe(`Fix the red CI on main at ${B.slice(0, 7)}`);
  expect(reds()[0].request).toContain("ci line 499");
  expect(reds()[0].notes).toEqual([]);
  // The log is read only for the write that files it.
  expect(ciCalls).toBe(1);
});

test("a second failing commit while the first issue is open is one note on it; once it is done, a new commit files a new issue", async () => {
  fresh([]);
  baselineRed(A);
  await firefight(ports());
  baselineRed(B);
  const f = await firefight(ports());
  expect(f!.filed).toEqual([{ repo: key, commit: B, source: "baseline", noted: 1 }]);
  await firefight(ports());
  expect(reds().length).toBe(1);
  expect(reds()[0].notes.filter((n) => n.includes(`Failing commit: ${B}`)).length).toBe(1);
  writeList({ key }, "done", (doc) => { issues.setStatus(issues.find(doc, 1)!, "done"); return true; });
  baselineRed(C);
  await firefight(ports());
  expect(reds().map((i) => [i.id, issues.status(i)])).toEqual([[1, "done"], [2, "open"]]);
  expect(reds()[1].request).toContain(`Failing commit: ${C}`);
});

test("a red whose failing tests differ from the open issue's files a second issue, with no note on the first", async () => {
  fresh([]);
  baselineRed(A);
  write(`baseline/${key}/checks.log`, "checks line 0\nchecks line 1");
  await firefight(ports());
  baselineRed(B);
  write(`baseline/${key}/checks.log`, "(fail) x > y [12.34ms]\n1 tests failed:\n(fail) x > y [12.34ms]");
  const f = await firefight(ports());
  expect(f!.filed).toEqual([{ repo: key, commit: B, source: "baseline", filed: 2 }]);
  expect(reds().map((i) => [i.id, issues.status(i)])).toEqual([[1, "open"], [2, "open"]]);
  expect(reds()[1].request).toContain(`Failing commit: ${B}`);
  expect(reds()[0].notes).toEqual([]);
});

test("a red whose failing tests match an older open issue notes it, though a newer issue is open, and files none", async () => {
  fresh([]);
  const red = (commit: string, log: string) => { baselineRed(commit); write(`baseline/${key}/checks.log`, log); };
  red(A, "(fail) x > y [10.00ms]");
  await firefight(ports());
  red(B, "checks line 0");
  await firefight(ports());
  red(C, "(fail) x > y [20.00ms]");
  const f = await firefight(ports());
  expect(f!.filed).toEqual([{ repo: key, commit: C, source: "baseline", noted: 1 }]);
  expect(reds().length).toBe(2);
  expect(reds()[0].notes.filter((n) => n.includes(`Failing commit: ${C}`)).length).toBe(1);
  expect(reds()[1].notes).toEqual([]);
});

test("a land live past 30 minutes sets one rescue Ask; a land live for 10 minutes sets none; no firefighter agent run starts", async () => {
  process.env.ALEPH_FIREFIGHTER_CMD = join(base, "fake");
  fresh([{ title: "slow one" }, { title: "quick one" }]);
  baselineRed(A);
  const slow = run({ name: `${key}-1`, on: `${key}-1`, kind: "land", condition: "running" }, {}, 35);
  const quick = run({ name: `${key}-2`, on: `${key}-2`, kind: "land", condition: "running" }, {}, 10);
  // Live means the pid's cmdline holds the folder. bash runs only builtins, so it execs nothing that would lose
  // the folder; it blocks on its stdin until killed, and once it has said `up` its cmdline is bash's.
  const procs = [slow, quick].map((folder) => {
    const p = Bun.spawn(["bash", "-c", `echo up; read; : ${folder}`], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    writeFileSync(join(folder, "pid"), String(p.pid));
    return p;
  });
  try {
    await Promise.all(procs.map((p) => p.stdout.getReader().read()));
    const one = await firefight(ports());
    expect(one!.asked).toEqual([`${key}-1`]);
    expect((await firefight(ports()))!.asked).toEqual([]);
    const ask = askOf(`${key}-1`);
    expect(ask).toMatchObject({ kind: "input", reason: "rescue", recommended: "Wait" });
    expect(ask!.options.map((o) => o.label)).toEqual(["Wait", "Kill and rerun", "Drop"]);
    expect(askOf(`${key}-2`)).toBeNull();
    expect(calls()).toBe(0);
    expect(agentRuns()).toEqual([]);
  } finally {
    for (const p of procs) p.kill();
    delete process.env.ALEPH_FIREFIGHTER_CMD;
  }
});

// The shape of `gh run view --log-failed` on 2026-11-04 (run 41907198470): job, step, then a stamped line or an
// annotation's continuation.
const P = "test\tRun bun run test:all\t";
const CI_LOG = [
  `${P}2026-11-04T20:30:21.5200000Z runner cores: 4`,
  `${P}2026-11-04T20:30:21.5346387Z bun test v1.4.4 (38afee6c8) 2x PARALLEL`,
  `${P}2026-11-04T20:30:21.8791958Z (pass) obs hook > scores the previous turn [71.02ms]`,
  `${P}2026-11-04T20:30:44.7100874Z error: expect(received).toEqual(expected)`,
  `${P}2026-11-04T20:30:44.7131692Z ##[error]- []`,
  `${P}+ [`,
  `${P}+   "docs/factory.md:171: says ALEPH_LIVE_CAP defaults to 4, the code has 1",`,
  `${P}+ ]`,
  `${P}2026-11-04T20:30:44.7141611Z (fail) the docs on this tree match the code > every default [35.17ms]`,
  `${P}2026-11-04T20:31:12.9604249Z (fail) the docs on this tree match the code > every default [35.17ms]`,
  `${P}2026-11-04T20:31:12.9605185Z  1011 pass`,
  `${P}2026-11-04T20:31:12.9619497Z ##[error]Process completed with exit code 1.`,
].join("\n");

test("a CI issue quotes the run URL, the failing tests, their failure lines and the runner's cores, and its job record keeps the failure", async () => {
  fresh([]);
  const repo = loadRegistry()[key];
  const url = "https://github.com/x/y/actions/runs/41907198470";
  ciStep([repo], listing([{ conclusion: "failure", status: "completed", headSha: B, url, createdAt: "2026-11-04T20:30:11Z" }]));
  const asked: string[][] = [];
  await firefight({ gh: (_, args) => { asked.push(args); return { ok: true, out: CI_LOG }; } });
  expect(asked).toEqual([["run", "view", "41907198470", "--log-failed"]]);
  const failure = ciFailure(CI_LOG, 24);
  expect(failure).toBe([
    "Failing tests:\n(fail) the docs on this tree match the code > every default [35.17ms]",
    "Failure lines:\n- []\n+ [\n+   \"docs/factory.md:171: says ALEPH_LIVE_CAP defaults to 4, the code has 1\",\n+ ]",
    "Runner: 4 cores; this host: 24. To run as the runner does, pin the run to its cores: `taskset -c 0-3 <the test command>`.",
  ].join("\n\n"));
  const [it] = reds();
  expect(it.request).toContain(url);
  expect(it.request).toContain("(fail) the docs on this tree match the code > every default");
  expect(it.request).toContain("ALEPH_LIVE_CAP defaults to 4, the code has 1");
  expect(it.request).toContain("Runner: 4 cores");
  expect(it.request).not.toContain("(pass)");
  expect(record.read(`${key}-${it.id}`)!.ci).toMatchObject({ url, commit: B, failure: expect.stringContaining("(fail) the docs") });
});

test("a landed CI issue closes on a green CI at or after the land, waits on one before it, and goes back open on a red one", async () => {
  fresh([]);
  const repo = loadRegistry()[key];
  const commit = (m: string) => { sh(repoPath(), "git", "commit", "-q", "--allow-empty", "-m", m); return sh(repoPath(), "git", "rev-parse", "HEAD"); };
  const before = commit("before"), landed = commit("the fix"), after = commit("later");
  let runId = 100;
  const ci = (conclusion: string, sha: string) => ciStep([repo], listing([{ conclusion, status: "completed", headSha: sha, url: `https://github.com/x/y/actions/runs/${++runId}`, createdAt: "2026-11-04T21:00:00Z" }]));
  const gh: Ports = { gh: () => ({ ok: true, out: CI_LOG }) };
  ci("failure", before);
  await firefight(gh);
  const [it] = reds();
  const ref = `${key}-${it.id}`;
  record.update(ref, (r) => { r.ci = { ...r.ci!, landed }; });
  // Green, but on a commit before the land: the land is not tested yet.
  ci("success", before);
  await firefight(gh);
  expect(issues.status(reds()[0])).toBe("open");
  // Red after the land: back open, the land's trailer no longer counts, and the note and the record quote the failure.
  ci("failure", after);
  await firefight(gh);
  expect(issues.status(reds()[0])).toBe("open");
  expect(reds()[0].fm.since).toBe(landed);
  expect(reds()[0].notes.at(-1)).toContain("still red");
  expect(reds()[0].notes.at(-1)).toContain("(fail) the docs on this tree match the code");
  expect(record.read(ref)!.ci).toEqual({ url: "https://github.com/x/y/actions/runs/103", commit: after, failure: ciFailure(CI_LOG) });
  // Landed again; green at the land itself: done.
  record.update(ref, (r) => { r.ci = { ...r.ci!, landed: after }; });
  ci("success", after);
  await firefight(gh);
  expect(issues.status(reds()[0])).toBe("done");
  expect(reds()[0].notes.at(-1)).toContain(`green at ${after.slice(0, 7)}`);
});

const SETUP_LOG = "test\tRun oven-sh/setup-bun@v2\t2026-11-08T09:00:00.0000000Z ##[error]Unexpected HTTP response: 504";

test("a CI run that failed in setup is rerun once; failing again, it files an issue and is not rerun", async () => {
  fresh([]);
  const repo = loadRegistry()[key];
  const url = "https://github.com/x/y/actions/runs/777";
  ciStep([repo], listing([{ conclusion: "failure", status: "completed", headSha: B, url, createdAt: "2026-11-08T09:00:00Z" }]));
  const asked: string[][] = [];
  const p: Ports = { gh: (_, args) => { asked.push(args); return { ok: true, out: args[1] === "rerun" ? "" : SETUP_LOG }; } };
  await firefight(p);
  expect(asked.filter((a) => a[1] === "rerun")).toEqual([["run", "rerun", "777", "--failed"]]);
  expect(readEvents()).toContainEqual(expect.objectContaining({ by: "firefighter", subject: key, action: "reran", on: [B.slice(0, 7)] }));
  expect(reds()).toEqual([]);
  await firefight(p);
  expect(asked.filter((a) => a[1] === "rerun").length).toBe(1);
  expect(reds().length).toBe(1);
  expect(reds()[0].fm.priority).toBe("critical");
});

test("an unlanded CI issue closes when main turns green past its failing commit, and waits on a red or an earlier green", async () => {
  fresh([]);
  const repo = loadRegistry()[key];
  const commit = (m: string) => { sh(repoPath(), "git", "commit", "-q", "--allow-empty", "-m", m); return sh(repoPath(), "git", "rev-parse", "HEAD"); };
  const before = commit("before"), failed = commit("the failure"), fixed = commit("another's fix");
  let runId = 200;
  const ci = (conclusion: string, sha: string) => {
    const url = `https://github.com/x/y/actions/runs/${++runId}`;
    ciStep([repo], listing([{ conclusion, status: "completed", headSha: sha, url, createdAt: "2026-11-04T21:00:00Z" }]));
    return url;
  };
  const gh: Ports = { gh: () => ({ ok: true, out: CI_LOG }) };
  ci("failure", failed);
  await firefight(gh);
  const [it] = reds();
  const ref = `${key}-${it.id}`;
  expect(record.read(ref)!.ci!.landed).toBeUndefined();
  // Red at a later commit: an unlanded issue has no land to be sent back from, so it gets no note and no reopen.
  ci("failure", fixed);
  expect(settleCi(gh)).toEqual([]);
  expect(issues.status(reds()[0])).toBe("open");
  expect(reds()[0].fm.since).toBeUndefined();
  expect(reds()[0].notes).toEqual([]);
  // Green at a commit before the failing one: it does not contain the failure.
  ci("success", before);
  expect(settleCi(gh)).toEqual([]);
  expect(issues.status(reds()[0])).toBe("open");
  // Green at a commit this clone does not have: it waits.
  ci("success", "f".repeat(40));
  expect(settleCi(gh)).toEqual([]);
  expect(issues.status(reds()[0])).toBe("open");
  // Green at a commit past the failing one, from a fix the job never made: done, naming that commit and its run.
  const url = ci("success", fixed);
  expect(settleCi(gh)).toEqual([`${ref} done: CI green at ${fixed.slice(0, 7)}`]);
  expect(issues.status(reds()[0])).toBe("done");
  expect(reds()[0].notes.at(-1)).toContain(`green at ${fixed.slice(0, 7)} (${url})`);
  expect(reds()[0].notes.at(-1)).toContain(`past the failing commit ${failed.slice(0, 7)}`);
});
