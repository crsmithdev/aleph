// The firefighter as code: one critical issue per failing commit, from a red baseline or a red CI,
// and a rescue Ask on a land live past 30 minutes. No agent run starts.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import * as store from "../../todo/lib/store.ts";
import { readList, writeList } from "../../todo/lib/store.ts";
import { askOf } from "./ask.ts";
import { ciStep, type GhRun } from "./ci.ts";
import { firefight, LOG_CHARS, type Ports } from "./firefighter.ts";
import { loadRegistry } from "./ledger.ts";
import { base, calls, fresh, key, run, useDirectorFixture } from "./director.fixture.ts";

useDirectorFixture();

const A = "a1".repeat(20), B = "b2".repeat(20), C = "c3".repeat(20);
const factory = () => process.env.ALEPH_FACTORY_DIR!;
const write = (file: string, text: string) => { mkdirSync(join(factory(), file, ".."), { recursive: true }); writeFileSync(join(factory(), file), text); };
const baselineRed = (commit: string) => write("baseline.json", JSON.stringify({ [key]: { repo: key, commit, ok: false, failed: "tests" } }));
const longLog = (what: string) => Array.from({ length: 500 }, (_, i) => `${what} line ${i}`).join("\n");
const reds = () => readList({ key })!.items.filter((i) => store.areasOf(i).includes("red-main"));
let ciCalls = 0;
const ports = (): Ports => ({ ciLog: () => { ciCalls++; return longLog("ci"); } });
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
  ciStep([repo], () => failed);
  await firefight(ports());
  ciStep([repo], () => failed);
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
