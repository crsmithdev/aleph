import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { areasOf, isSorted, readList, writeList } from "../../todo/lib/store.ts";

import { countsLine, parseRoute, prompt, triageIssue, triageOpen, TRIAGE_MODEL } from "./triage.ts";
import { saveProbe } from "./factory-status.ts";
import { lock, readRun, stamp, writeRun, type Repo } from "./ledger.ts";
import { askOf, clearAsk, setAsk } from "./ask.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base: string;
// The factory dir for the whole file: nothing here may read or write ~/.aleph/factory.
let factoryHome: string;
const repo = { key: "tri", path: "" } as Repo;

function sh(cwd: string, ...args: string[]): void {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}

// The fake triage command: the verdict is named by a `VERDICT:<word>` line in the issue's body.
const FAKE = `#!/bin/bash
prompt=$(cat)
echo "$PWD $*" >> "$FAKE_LOG"
case $prompt in
  *VERDICT:goal*) echo '{"route":"build","spec":"## Goal\\nDo it.\\n## Edit surface\\nx.ts\\n## Oracle\\nbun test\\n## Time box\\n45 minutes"}' ;;
  *VERDICT:close*) echo 'Looked at it. {"route":"close","reason":"duplicate of tri-1"}' ;;
  *VERDICT:chris*) echo '{"route":"ask","question":"Which plan, A or B?"}' ;;
  *VERDICT:structured*) echo '{"route":"ask","question":"A or B?","options":[{"label":"A","line":"do a"},{"label":"B","line":"do b"}],"recommended":"B","why":["one","two"]}' ;;
  *VERDICT:build*) echo '{"route":"ask","question":"Ship it?","options":[{"label":"A","line":"ship"},{"label":"B","line":"wait"}],"recommended":"A","kind":"build"}' ;;
  *VERDICT:live*) echo '{"route":"live","note":"check the prod dashboard"}' ;;
  *VERDICT:flake*) echo '{"route":"flake","note":"a.test.ts > does x: timed out under load"}' ;;
  *VERDICT:fail*) exit 3 ;;
  *VERDICT:bad*) echo '{"route":"maybe"}' ;;
  *) echo 'no json here' ;;
esac
`;

// Each test gets its own list: the store keeps an item's file until something replaces it.
let lists = 0;
// A seeded item: `route` sorts it, `ask` gives it an Ask, `after` makes it wait, `goal` gives it a spec.
type Seed = { title: string; body?: string; ask?: boolean; after?: string[]; goal?: { title: string; body: string } };
function reset(items: Seed[]): void {
  repo.key = `tri${++lists}`;
  writeList(repo, "reset", (doc) => {
    for (const i of items) {
      const item = issues.add(doc, i.title, { request: i.body });
      if (i.ask) setAsk(item, { kind: "input", reason: "question", question: "Which plan, A or B?", options: [], why: [] });
      if (i.after) item.fm.after = i.after;
      if (i.goal) item.spec = i.goal.body;
    }
    return true;
  }, true);
}
const item = (id: number) => issues.find(readList(repo)!, id)!;
const run = (done: (r: string) => boolean = () => false) => triageOpen([repo], done);

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-triage-"));
  factoryHome = join(base, "factory");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
  writeFileSync(join(base, "fake"), FAKE);
  chmodSync(join(base, "fake"), 0o755);
  repo.path = base;
  Object.assign(process.env, gitEnv, {
    ALEPH_ISSUES: join(base, "items"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_TRIAGE_CMD: join(base, "fake"),
    FAKE_LOG: join(base, "calls"), ALEPH_LIVE_CAP: "10", ALEPH_FACTORY_DIR: factoryHome, ALEPH_DISPATCH: "off",
    // Locks live in $XDG_RUNTIME_DIR/aleph, shared by every process on the machine; keep this process's own.
    XDG_RUNTIME_DIR: join(base, "run"),
  });
});
afterAll(() => rmSync(base, { recursive: true, force: true }));
beforeEach(() => { delete process.env.ALEPH_TRIAGE_CAP; delete process.env.ALEPH_TRIAGE_TRIES; writeFileSync(join(base, "calls"), ""); });
const runOf = (id: number) => readdirSync(join(base, "jobs")).filter((d) => d.includes(`-triage-${repo.key}-`)).map((d) => readRun(join(base, "jobs", d))!).find((r) => r.name === `triage-${repo.key}-${id}`);
const calls = () => readFileSync(join(base, "calls"), "utf8").split("\n").filter(Boolean).length;

test("each of the routes leaves the item in its state", async () => {
  reset([
    { title: "a", body: "VERDICT:goal" }, { title: "b", body: "VERDICT:close" },
    { title: "c", body: "VERDICT:chris" }, { title: "d", body: "VERDICT:live" },
  ]);
  process.env.ALEPH_TRIAGE_CAP = "9";
  const t = await run();
  expect(t.skipped).toEqual([]);
  expect(t.triaged).toEqual({ build: 1, close: 1, ask: 2 });

  // The issue keeps its text and gains the spec.
  expect(item(1).request).toContain("VERDICT:goal");
  expect(item(1).request).not.toContain("## Oracle");
  expect(item(1).spec).toContain("## Oracle");
  expect(issues.status(item(1))).toBe("open");
  expect(item(1).spec).not.toContain("## Request");

  expect(issues.status(item(2))).toBe("done");
  expect(item(2).fm.closed_why).toBe("duplicate of tri-1");
  expect(item(2).notes.some((n) => n.includes("duplicate of tri-1"))).toBe(false);

  expect(askOf(item(3))).toMatchObject({ kind: "input", reason: "question", question: "Which plan, A or B?" });
  expect(item(3).notes.at(-1)).toContain("Which plan, A or B?");
  expect(issues.status(item(3))).toBe("open");

  expect(askOf(item(4))).toMatchObject({ kind: "input", reason: "host-check", question: "check the prod dashboard" });
  expect(item(4).notes.at(-1)).toContain("check the prod dashboard");
});

test("a triage run records its route and the issue it is on", async () => {
  reset([{ title: "a", body: "VERDICT:goal" }, { title: "b", body: "VERDICT:live" }, { title: "c", body: "VERDICT:flake" }, { title: "d", body: "VERDICT:close" }]);
  await run();
  const runs = Object.fromEntries(readdirSync(join(base, "jobs")).filter((d) => d.includes(`-triage-${repo.key}-`)).map((d) => readRun(join(base, "jobs", d))!).map((r) => [r.name, r]));
  expect(runs[`triage-${repo.key}-1`]).toMatchObject({ route: "build", on: `${repo.key}-1`, reason: "build" });
  expect(runs[`triage-${repo.key}-2`]).toMatchObject({ route: "ask", reason: "live" });
  expect(runs[`triage-${repo.key}-3`]!.route).toBe("close");
  expect(runs[`triage-${repo.key}-4`]!.route).toBe("close");
});

test("a triage run records its model and runs the command with it", async () => {
  reset([{ title: "a", body: "VERDICT:close" }]);
  await run();
  const dir = readdirSync(join(base, "jobs")).find((d) => d.includes(`-triage-${repo.key}-`))!;
  expect(readRun(join(base, "jobs", dir))).toMatchObject({ model: TRIAGE_MODEL });
  expect(readFileSync(join(base, "calls"), "utf8")).toContain(`--model ${TRIAGE_MODEL} --tools Read Grep Glob`);
});

test("the triage prompt limits the Goal to 3 sentences with no implementation design", () => {
  const p = prompt(repo, { id: 1, title: "t", request: "", spec: "", notes: [], fm: {} } as unknown as issues.Issue);
  expect(p).toContain("the behaviour in at most 3 sentences");
  expect(p).toContain("no implementation design");
  expect(p).toContain("no claim about code on main that you did not read");
});

test("a triage is a job in the ledger, of kind triage", async () => {
  reset([1, 2, 3, 4].map((n) => ({ title: `item ${n}`, body: "VERDICT:live" })));
  await run();
  const folders = readdirSync(join(base, "jobs")).filter((d) => d.includes(`-triage-${repo.key}-`));
  expect(folders.length).toBe(4);
  // The runs go one after another, but the folder order is not the item order.
  const first = folders.map((f) => readRun(join(base, "jobs", f))).find((r) => r?.name === `triage-${repo.key}-1`);
  expect(first).toMatchObject({ kind: "triage", repo: repo.key, condition: "done", name: `triage-${repo.key}-1`, on: `${repo.key}-1` });
});

test("an ask route with options is stored as an Ask next to the prose note; a malformed structure keeps the question", async () => {
  reset([{ title: "a", body: "VERDICT:structured" }]);
  await run();
  expect(askOf(item(1))).toEqual({ kind: "input", reason: "question", question: "A or B?", options: [{ label: "A", line: "do a" }, { label: "B", line: "do b" }], recommended: "B", why: ["one", "two"] });
  expect(item(1).fm.ask).toBe("input");
  expect(item(1).notes.at(-1)).toContain("A or B? Options: A: do a; B: do b. My recommendation is B.");
  const bad = parseRoute('{"route":"ask","question":"Q?","options":[{"label":"A","line":"x"}],"recommended":"A"}');
  expect(bad).toEqual({ route: "ask", ask: { kind: "input", reason: "question", question: "Q?", options: [], why: [] } });
});

test("an option's after is kept on the Ask", async () => {
  expect(parseRoute('{"route":"ask","question":"Q?","options":[{"label":"A","line":"x","after":"tri-3.1"},{"label":"B","line":"y"}],"recommended":"A"}')).toMatchObject({ ask: { options: [{ label: "A", line: "x", after: "tri-3.1" }, { label: "B", line: "y" }] } });
});

test("sorted issues are not triaged; an issue that waits is", async () => {
  reset([
    { title: "a", ask: true }, { title: "b", goal: { title: "b", body: "## Goal\nb" } }, { title: "c", goal: { title: "c", body: "## Goal\nc" } },
    { title: "parent of d", goal: { title: "d", body: "## Goal\nd" } }, { title: "e", after: ["tri-9"], body: "VERDICT:close" }, { title: "f", body: "VERDICT:chris" },
  ]);
  const t = await run();
  expect(calls()).toBe(2);
  expect(t.triaged).toEqual({ close: 1, ask: 1 });
  expect(askOf(item(6))).toMatchObject({ reason: "question" });
});

test("the cap of two triages the two oldest of five", async () => {
  reset([1, 2, 3, 4, 5].map((n) => ({ title: `item ${n}`, body: "VERDICT:live" })));
  process.env.ALEPH_TRIAGE_CAP = "2";
  const t = await run();
  expect(t.triaged).toEqual({ ask: 2 });
  expect([1, 2, 3, 4, 5].map((n) => item(n).fm.ask === "input")).toEqual([true, true, false, false, false]);
});

test("a malformed verdict leaves the item unchanged and is skipped", async () => {
  reset([{ title: "a", body: "VERDICT:bad" }, { title: "b", body: "nothing" }]);
  const before = [item(1), item(2)].map((i) => issues.renderItem(repo.key, i));
  const t = await run();
  expect(t.triaged).toEqual({});
  expect(t.skipped).toEqual([expect.stringContaining(`${repo.key}-1: triage gave a malformed verdict`), expect.stringContaining(`${repo.key}-2: triage gave a malformed verdict: no JSON`)]);
  expect([item(1), item(2)].map((i) => issues.renderItem(repo.key, i))).toEqual(before);
});

test("an item with no route twice gets an Ask triage-failed and is not triaged again", async () => {
  reset([{ title: "a", body: "nothing" }]);
  const before = issues.renderItem(repo.key, item(1));
  await run();
  expect(issues.renderItem(repo.key, item(1))).toBe(before);
  const t = await run();
  expect(askOf(item(1))).toMatchObject({ kind: "input", reason: "triage-failed" });
  expect(item(1).fm.ask).toBe("input");
  expect(item(1).fm.reason).toBe("triage-failed");
  expect(item(1).notes.at(-1)).toContain("no verdict in 2 runs");
  expect(t.skipped).toEqual([`${repo.key}-1: no verdict in 2 triages; asked Chris`]);
  const n = calls();
  await run();
  expect(calls()).toBe(n);
});

const factory = () => process.env.ALEPH_FACTORY_DIR!;
const grant = (reason: string, action: string) => {
  mkdirSync(factory(), { recursive: true });
  writeFileSync(join(factory(), "always.json"), JSON.stringify({ [reason]: { action, at: new Date().toISOString() } }));
};
const tickLog = () => readFileSync(join(factory(), "tick.log"), "utf8");

describe("standing permissions", () => {
  beforeEach(() => { process.env.ALEPH_FACTORY_DIR = join(base, `factory-${++lists}`); });
  afterAll(() => { process.env.ALEPH_FACTORY_DIR = factoryHome; });

  test("retry: no label, the count starts again, and a third triage runs the command", async () => {
    grant("triage-failed", "retry");
    reset([{ title: "a", body: "nothing" }]);
    await run();
    const t = await run();
    expect(item(1).fm.ask).toBeUndefined();
    expect(t.skipped).toEqual([`${repo.key}-1: no verdict in 2 triages; standing: triage again next tick`]);
    const n = calls();
    const t3 = await run();
    expect(calls()).toBe(n + 1);
    expect(t3.skipped[0]).toContain("malformed verdict");
    expect(tickLog()).toContain("always: triage-failed: retry");
  });

  test("close: the item is done with the note", async () => {
    grant("triage-failed", "close");
    reset([{ title: "a", body: "nothing" }]);
    await run();
    await run();
    expect(issues.status(item(1))).toBe("done");
    expect(item(1).notes.at(-1)).toEndWith("triage: no verdict in 2 runs; standing: closed");
    expect(tickLog()).toContain("always: triage-failed: close");
  });

  test("recommended: an ask with options leaves no Ask and a note naming the recommendation; a prose question is asked", async () => {
    grant("question", "recommended");
    reset([{ title: "a", body: "VERDICT:structured" }, { title: "b", body: "VERDICT:chris" }]);
    const t = await run();
    expect(t.triaged).toEqual({ ask: 2 });
    expect(runOf(1)!.route).toBe("ask");
    expect(item(1).fm.ask).toBeUndefined();
    expect(isSorted(readList(repo)!, item(1))).toBe(false);
    expect(item(1).notes.at(-1)).toEndWith("always: took the recommendation B: do b");
    expect(askOf(item(2))).toMatchObject({ reason: "question" });
    expect(tickLog()).toContain(`always: question: recommended on ${repo.key}-1`);
  });
});

test("a triage that exits non-zero counts toward the limit", async () => {
  reset([{ title: "a", body: "VERDICT:fail" }]);
  await run();
  expect(item(1).fm.ask).toBeUndefined();
  await run();
  expect(item(1).fm.ask).toBe("input");
  expect(item(1).notes.at(-1)).toContain("no verdict in 2 runs: failed: triage exited 3");
});

test("ALEPH_TRIAGE_TRIES=1 asks about the item after the first malformed run", async () => {
  process.env.ALEPH_TRIAGE_TRIES = "1";
  reset([{ title: "a", body: "nothing" }]);
  await run();
  expect(item(1).fm.reason).toBe("triage-failed");
  expect(item(1).notes.at(-1)).toContain("no verdict in 1 runs");
});

test("a blocked day cap or live cap starts no triage", async () => {
  reset([{ title: "a", body: "VERDICT:live" }]);
  process.env.ALEPH_DAY_CAP = "0";
  const t = await run().finally(() => { delete process.env.ALEPH_DAY_CAP; });
  expect(t.triaged).toEqual({});
  expect(t.skipped).toEqual(["triage: cap of 0 runs in 24 hours"]);
  expect(calls()).toBe(0);
});

test("parseRoute wants the field its route needs", () => {
  expect(parseRoute('{"route":"close","reason":" stale "}')).toEqual({ route: "close", reason: "stale" });
  expect(parseRoute('{"route":"build"}')).toBe("build without a spec");
  expect(parseRoute('{"route":"plan"}')).toBe("plan without a spec");
  expect(parseRoute('{"route":"build","spec":"## Goal\\nb","after":["aleph-265.1","aleph-3","soon"]}')).toEqual({ route: "build", spec: "## Goal\nb", after: ["aleph-265.1", "aleph-3"] });
  expect(parseRoute('{"route":"plan","spec":"## Request\\nr\\n## Goal\\nb"}')).toEqual({ route: "plan", spec: "## Goal\nb", after: [] });
  expect(parseRoute('{"verdict":"close","reason":"x"}')).toBe("unknown route undefined");
  expect(parseRoute("[]")).toBe("no JSON");
});

/** An earlier ended triage run of item 1, with the given fields. */
function earlierTriage(fields: Record<string, unknown>): void {
  const folder = join(base, "jobs", `${stamp()}-earlier-${Math.random().toString(36).slice(2)}-triage`);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "triage", job: folder.split("/").at(-1)!, name: "earlier", repo: repo.key, on: `${repo.key}-1`, condition: "done", phase: "triage", told: true, shown: true, started: new Date().toISOString(), made: Date.now(), ...fields });
}

test("a triage run with the cause no-answer and a free reason counts toward the Ask", async () => {
  reset([{ title: "a", body: "nothing" }]);
  earlierTriage({ cause: "no-answer", reason: "something else entirely" });
  await run();
  expect(item(1).fm.ask).toBe("input");
  expect(item(1).fm.reason).toBe("triage-failed");
});

// A triage run whose process died before its `end()`: `running`, with no pid or exit file.
function lostRun(name: string): string {
  const folder = join(base, "jobs", `${stamp()}-${name}-triage`);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "triage", job: folder.split("/").at(-1)!, name, repo: repo.key, on: `${repo.key}-1`, condition: "running", phase: "triage", told: true, shown: true, started: new Date().toISOString(), made: Date.now() });
  return folder;
}

test("a triage run whose process ended before a verdict is ended as failed by the next triage", async () => {
  reset([]);
  const folder = lostRun(`triage-${repo.key}-1`);
  await run();
  const r = readRun(folder)!;
  expect(r).toMatchObject({ condition: "done", reason: "failed: its process ended before a verdict" });
  expect(typeof r.ended).toBe("string");
});

test("a lost triage run whose item's lock is held is left running", async () => {
  reset([]);
  const folder = lostRun(`triage-${repo.key}-1`);
  const release = (await lock(`triage-${repo.key}-1`, 0))!;
  try {
    await run();
    expect(readRun(folder)?.condition).toBe("running");
  } finally {
    release();
  }
});

// Triage at once: `triageNow` is what `aleph triage <repo>-<n>` runs, after an add, an answer or a follow-up.
describe("triage at once", () => {
  beforeAll(() => { process.env.ALEPH_FACTORY_DIR = factoryHome; });
  test("a non-goal issue is triaged with no tick; a goal is not", async () => {
    reset([
      { title: "a", body: "VERDICT:close" },
      { title: "parent", body: "VERDICT:close", goal: { title: "g", body: "## Goal\ng" } },
    ]);
    const { triageNow } = await import("./factory.ts");
    expect(item(2).spec).toContain("## Goal");
    expect((await triageNow(repo, 1)).triaged).toEqual({ close: 1 });
    expect(issues.status(item(1))).toBe("done");
    // Item 2 is sorted by its spec: triageNow on it triages nothing.
    expect((await triageNow(repo, 2)).triaged).toEqual({});
    expect(calls()).toBe(1);
  });

  test("the prompt carries the notes, and a paused factory triages nothing", async () => {
    reset([{ title: "c", body: "VERDICT:chris" }]);
    const { triageNow, setPaused } = await import("./factory.ts");
    await triageNow(repo, 1);
    expect(item(1).fm.ask).toBe("input");
    // Chris's answer: the Ask goes, the note stays, the triage sees it.
    writeList(repo, "answer", (doc) => { const i = issues.find(doc, 1)!; issues.note(i, "Plan B, VERDICT:close"); clearAsk(i); return true; });
    setPaused(true);
    expect((await triageNow(repo, 1)).triaged).toEqual({});
    expect(calls()).toBe(1);
    setPaused(false);
    expect((await triageNow(repo, 1)).triaged).toEqual({ close: 1 });
    const prompts = readdirSync(join(base, "jobs")).filter((d) => d.includes(`-triage-${repo.key}-1-`)).map((d) => readFileSync(join(base, "jobs", d, "prompt.md"), "utf8"));
    expect(prompts.some((p) => p.includes("Plan B"))).toBe(true);
  });

  test("a failed probe triages nothing; the tick does after it passes", async () => {
    reset([{ title: "p", body: "VERDICT:close" }]);
    const f = await import("./factory.ts");
    saveProbe({ at: new Date().toISOString(), ok: false, failed: ["x"] });
    expect((await f.triageNow(repo, 1)).triaged).toEqual({});
    expect(calls()).toBe(0);
    saveProbe({ at: new Date().toISOString(), ok: true, failed: [] });
    expect((await run()).triaged).toEqual({ close: 1 });
  });
});

test("the prompt closes test-only worker follow-ups, and only those", () => {
  const p = prompt(repo, { id: 1, title: "t", request: "", spec: "", notes: [], fm: { source: "worker" } } as unknown as issues.Issue);
  // The rule: a close with this reason, for a worker issue whose ask is a test, a rerun or a screenshot.
  expect(p).toContain('return "close" with the reason "test-only follow-up"');
  expect(p).toContain("when the issue's source is `worker`");
  expect(p).toContain("a new or stronger test of behaviour that works today");
  expect(p).toContain("a rerun of a test or check in another environment");
  expect(p).toContain("a screenshot, or a measurement with no change behind it");
  // It does not cover a worker follow-up that names a defect, nor issues from other sources.
  expect(p).toContain("names a defect");
  expect(p).toContain("a gate hole is a defect");
  expect(p).toContain("Issues whose source is not `worker` are not covered by this rule.");
});

test("the prompt names the issue's source, so the test-only rule can tell a worker follow-up", () => {
  const worker = prompt(repo, { id: 7, title: "Add a test", request: "", spec: "", notes: [], fm: { source: "worker" } } as unknown as issues.Issue);
  const chris = prompt(repo, { id: 8, title: "Fix it", request: "", spec: "", notes: [], fm: { source: "chris" } } as unknown as issues.Issue);
  const bare = prompt(repo, { id: 9, title: "Old", request: "", spec: "", notes: [], fm: {} } as unknown as issues.Issue);
  expect(worker).toContain("\nSource: worker\n");
  expect(chris).toContain("\nSource: chris\n");
  expect(bare).toContain("\nSource: not recorded\n");
});

test("the prompt keeps how-to-build questions away from Chris and asks him in plain words", () => {
  const p = prompt(repo, { id: 1, title: "t", request: "", spec: "", notes: [], fm: {} } as unknown as issues.Issue);
  expect(p).toContain("Never ask Chris about how to build it");
  expect(p).toContain("no file paths, function names, line numbers or code");
  expect(p).toContain('"after": ["<optional <repo>-<n> or <repo>-<n>.<k>>"]');
});

test("the prompt lists the open issues of the repo, one line each, without the one under triage or the done and dropped ones", () => {
  reset([{ title: "Fix the bridge" }, { title: "Rerun  the shot" }, { title: "Under triage" }, { title: "Done one" }, { title: "Dropped one" }]);
  writeList(repo, "status", (doc) => {
    issues.setStatus(issues.find(doc, 4)!, "done");
    issues.setStatus(issues.find(doc, 5)!, "dropped");
    return true;
  });
  const p = prompt(repo, item(3));
  const lines = p.split("\n").filter((l) => l.startsWith(`${repo.key}-`));
  expect(lines).toEqual([`${repo.key}-1: Fix the bridge`, `${repo.key}-2: Rerun the shot`]);
  expect(p).not.toContain("Done one");
  expect(p).not.toContain("Dropped one");
  expect(p).toContain('return "close" with the reason "duplicate of <repo>-<n>"');
  expect(p).toContain('return "build" with "after"');
});

describe("a goal whose work is already on main", () => {
  // The fake reads the commit list in the prompt: a line naming the file the issue asks for gives "done", else "build".
  const SMART = `#!/bin/bash
prompt=$(cat)
echo "$PWD" >> "$FAKE_LOG"
file=$(echo "$prompt" | grep -m1 '^# Issue' | grep -o '[a-z]*\.ts')
sha=$(echo "$prompt" | sed -n '/^# Commits on main/,/^Reply/p' | grep -F "$file" | head -1 | cut -d' ' -f1)
if [ -n "$sha" ]; then echo "{\\"route\\":\\"done\\",\\"commit\\":\\"$sha\\",\\"reason\\":\\"widget.ts exists\\"}"
else echo '{"route":"build","spec":"## Goal\\nDo it.\\n## Edit surface\\nx.ts\\n## Oracle\\nbun test\\n## Time box\\n45 minutes"}'; fi
`;
  let fixture: string;
  let saved: string | undefined;
  beforeAll(() => {
    fixture = join(base, "fixture");
    mkdirSync(fixture);
    sh(fixture, "git", "init", "-q", "-b", "main");
    writeFileSync(join(fixture, "README"), "x\n");
    sh(fixture, "git", "add", "-A");
    sh(fixture, "git", "commit", "-q", "-m", "start");
    writeFileSync(join(fixture, "widget.ts"), "export const widget = 1;\n");
    sh(fixture, "git", "add", "-A");
    sh(fixture, "git", "commit", "-q", "-m", "Add widget.ts");
    writeFileSync(join(base, "smart"), SMART);
    chmodSync(join(base, "smart"), 0o755);
    saved = process.env.ALEPH_TRIAGE_CMD;
    process.env.ALEPH_TRIAGE_CMD = join(base, "smart");
    repo.path = fixture;
  });
  afterAll(() => { repo.path = base; process.env.ALEPH_TRIAGE_CMD = saved; });

  test("the prompt lists the commits on main since the item was created", () => {
    reset([{ title: "Add widget.ts" }]);
    const p = prompt(repo, item(1));
    expect(p).toContain("# Commits on main since");
    expect(p).toMatch(/^[0-9a-f]{7,} Add widget\.ts$/m);
    expect(p).toContain('"route": "done"');
  });

  test("triage closes it as done with the commit in the note, and starts no worker", async () => {
    reset([{ title: "Add widget.ts", body: "Create widget.ts exporting widget." }]);
    const t = await run();
    expect(t.skipped).toEqual([]);
    expect(t.triaged).toEqual({ done: 1 });
    expect(issues.status(item(1))).toBe("done");
    expect(item(1).spec).toBe("");
    const sha = Bun.spawnSync(["git", "rev-parse", "--short=12", "HEAD"], { cwd: fixture }).stdout.toString().trim();
    expect(item(1).notes.join("\n")).toContain(`triage: already on main in ${sha}`);
    expect(runOf(1)!.route).toBe("done");
  });

  test("a goal whose work is not on main still becomes a goal for a worker", async () => {
    reset([{ title: "Add gadget.ts", body: "Create gadget.ts exporting gadget." }]);
    const t = await run();
    expect(t.triaged).toEqual({ build: 1 });
    expect(issues.status(item(1))).toBe("open");
    expect(item(1).spec).toContain("## Oracle");
  });

  test("a done verdict naming a commit that is not on main is not applied", async () => {
    expect(parseRoute('{"route":"done","commit":"nothex","reason":"x"}')).toBe("done without a commit");
    expect(parseRoute('{"route":"done","commit":"abc1234","reason":"x"}')).toEqual({ route: "done", commit: "abc1234", reason: "x" });
    reset([{ title: "Add widget.ts" }]);
    process.env.ALEPH_TRIAGE_CMD = join(base, "bogus");
    writeFileSync(join(base, "bogus"), `#!/bin/bash\necho '{"route":"done","commit":"deadbeef1","reason":"x"}'\n`);
    chmodSync(join(base, "bogus"), 0o755);
    try {
      const t = await run();
      expect(t.triaged).toEqual({});
      expect(issues.status(item(1))).toBe("open");
    } finally { process.env.ALEPH_TRIAGE_CMD = join(base, "smart"); }
  });
});

describe("the issue keeps its text; the goal gets the four sections", () => {
  const LONG_TITLE = "Status: layout C, the metrics on the left and the four lanes in a rail on the right, with the detail pinned";
  const INPUT = "The status page is hard to scan.\n\n- put the metrics on the left\n- put the four lanes in a rail on the right";

  test("a long input keeps its title and ## Request; the goal has a short title", async () => {
    reset([{ title: LONG_TITLE, body: `## Request\n\n${INPUT}\n\nVERDICT:goal` }]);
    expect((await run()).triaged).toEqual({ build: 1 });
    const got = item(1);
    expect(got.title).toBe(LONG_TITLE);
    expect(got.request).toBe(`## Request\n\n${INPUT}\n\nVERDICT:goal`);
    expect(got.spec.match(/^## .*/gm)).toEqual(["## Goal", "## Edit surface", "## Oracle", "## Time box"]);
  });

  test("the prompt states the title and request rules", () => {
    const p = prompt(repo, item(1));
    expect(p).toContain("keeps its own title and text");
  });
});

describe("the flake route", () => {
  test("parseRoute reads a flake and refuses one without a note", () => {
    expect(parseRoute('{"route":"flake","note":"a.test.ts > t: timed out"}')).toEqual({ route: "flake", note: "a.test.ts > t: timed out" });
    expect(parseRoute('{"route":"flake","note":"  "}')).toBe("flake without a note");
    expect(parseRoute('{"route":"flake"}')).toBe("flake without a note");
  });

  test("the prompt lists the flake verdict", () => {
    expect(prompt(repo, { id: 1, title: "t", request: "", spec: "", notes: [], fm: {} } as unknown as issues.Issue)).toContain('"route": "flake"');
  });

  test("a flake is noted on the tracker and the issue closed", async () => {
    reset([{ title: "a test times out", body: "VERDICT:flake" }]);
    const t = await run();
    expect(t.skipped).toEqual([]);
    expect(t.triaged).toEqual({ close: 1 });
    expect(countsLine(t.triaged)).toBe("close 1");
    const list = readList(repo)!;
    const tracker = list.items.find((i) => areasOf(i).includes("flakes"))!;
    expect(tracker).toBeDefined();
    expect(tracker.notes.at(-1)).toContain(`triage of ${repo.key}-1: a.test.ts > does x: timed out under load`);
    expect(issues.status(item(1))).toBe("done");
    expect(item(1).notes.at(-1)).toContain(`triage: a flake, noted on ${repo.key}-${tracker.id}`);
    expect(list.items.some((i) => i.sub !== undefined)).toBe(false);
  });

  test("an open tracker is never triaged itself", async () => {
    reset([{ title: "a test times out", body: "VERDICT:flake" }]);
    await run();
    const before = calls();
    const t = await run();
    expect(t.triaged).toEqual({});
    expect(calls()).toBe(before);
    const tracker = readList(repo)!.items.find((i) => i.fm.tracker === "true")!;
    expect(isSorted(readList(repo)!, tracker)).toBe(true);
  });
});

// The CLI seam: `aleph triage <repo>-<n>` with the fake as ALEPH_TRIAGE_CMD.
describe("aleph triage", () => {
  const CLI = join(import.meta.dir, "..", "cli.ts");
  let home: string;
  beforeAll(() => {
    home = join(base, "cli-factory");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
  });
  const aleph = async (args: string[]) => {
    writeFileSync(join(base, "repos.json"), JSON.stringify({ [repo.key]: { path: base } }));
    const p = Bun.spawn(["bun", CLI, ...args], {
      cwd: base, stdout: "pipe", stderr: "pipe",
      env: { ...process.env, ALEPH_REPOS: join(base, "repos.json"), ALEPH_TRIAGE_CMD: join(base, "fake"), ALEPH_FACTORY_DIR: home, ALEPH_DISPATCH: "off" },
    });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { out, err, json: (() => { try { return JSON.parse(out); } catch { return null; } })() };
  };
  const triage = (id: number) => aleph(["triage", `${repo.key}-${id}`]);
  const runOf = (id: number) => readdirSync(join(base, "jobs")).filter((d) => d.includes(`-triage-${repo.key}-${id}-`)).map((d) => JSON.parse(readFileSync(join(base, "jobs", d, "state.json"), "utf8")))[0];

  test("a goal reply files goal .1, keeps the issue's text and starts no plan run", async () => {
    const text = "## Request\n\nMake the status page easier to scan.\n\nVERDICT:goal";
    reset([{ title: "The status page is hard to scan, a long title for an issue", body: text }]);
    const r = await triage(1);
    expect(r.json).toMatchObject({ triaged: { build: 1 }, skipped: [] });
    expect(item(1).spec).not.toContain("## Request");
    expect(item(1).title).toBe("The status page is hard to scan, a long title for an issue");
    expect(item(1).request).toBe(text);
    expect(item(1).spec).toContain("## Oracle");
    expect(runOf(1)).toMatchObject({ kind: "triage", route: "build", on: `${repo.key}-1` });
    expect(runOf(1).todo).toBeUndefined();
    expect(readdirSync(join(base, "jobs")).some((d) => readRun(join(base, "jobs", d))?.kind === "plan")).toBe(false);
  }, 30_000);
});

test("the triage loop and triageIssue skip a parked issue with no spec, which keeps its status and fields", async () => {
  reset([{ title: "parked one", body: "VERDICT:close" }, { title: "open one", body: "VERDICT:close" }]);
  writeList(repo, "park", (doc) => { issues.setStatus(issues.find(doc, 1)!, "parked"); return true; });
  const before = JSON.stringify(item(1));
  const t = await run();
  expect(t.triaged).toEqual({ close: 1 });
  expect(calls()).toBe(1);
  expect(issues.status(item(1))).toBe("parked");
  expect(JSON.stringify(item(1))).toBe(before);
  const one = await triageIssue(repo, 1, () => false);
  expect(one.triaged).toEqual({});
  expect(calls()).toBe(1);
  expect(JSON.stringify(item(1))).toBe(before);
});
