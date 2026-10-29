import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as todos from "../../todo/lib/todo.ts";
import { labels as storeLabels, readList, writeList } from "../../todo/lib/store.ts";
import { readDecision } from "./decision.ts";
import { parseVerdict, prompt, triageOpen } from "./triage.ts";
import { lock, readRun, stamp, writeRun, type Repo } from "./ledger.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base: string;
const repo = { key: "tri", path: "" } as Repo;

function sh(cwd: string, ...args: string[]): void {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}

// The fake triage command: the verdict is named by a `VERDICT:<word>` line in the issue's body.
const FAKE = `#!/bin/bash
prompt=$(cat)
echo "$PWD" >> "$FAKE_LOG"
case $prompt in
  *VERDICT:goal*) echo '{"verdict":"goal","body":"## Goal\\nDo it.\\n## Edit surface\\nx.ts\\n## Oracle\\nbun test\\n## Time box\\n45 minutes"}' ;;
  *VERDICT:close*) echo 'Looked at it. {"verdict":"close","reason":"duplicate of tri-1"}' ;;
  *VERDICT:chris*) echo '{"verdict":"chris","question":"Which plan, A or B?"}' ;;
  *VERDICT:structured*) echo '{"verdict":"chris","question":"A or B?","options":[{"label":"A","line":"do a"},{"label":"B","line":"do b"}],"recommended":"B","why":["one","two"]}' ;;
  *VERDICT:live*) echo '{"verdict":"live","note":"check the prod dashboard"}' ;;
  *VERDICT:fail*) exit 3 ;;
  *VERDICT:bad*) echo '{"verdict":"maybe"}' ;;
  *) echo 'no json here' ;;
esac
`;

// Each test gets its own list: the store keeps an item's file until something replaces it.
let lists = 0;
function reset(items: { title: string; body?: string; labels?: string[]; waitingOn?: string }[]): void {
  repo.key = `tri${++lists}`;
  writeList(repo, "reset", (doc) => {
    for (const i of items) todos.add(doc, i.title, { body: i.body, labels: i.labels, waitingOn: i.waitingOn });
    return true;
  }, true);
}
const item = (id: number) => todos.find(readList(repo)!, id)!;
const labels = (id: number) => storeLabels(item(id));
const run = (done: (r: string) => boolean = () => false) => triageOpen([repo], done);

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-triage-"));
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
  writeFileSync(join(base, "fake"), FAKE);
  chmodSync(join(base, "fake"), 0o755);
  repo.path = base;
  Object.assign(process.env, gitEnv, {
    ALEPH_ITEMS: join(base, "items"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_TRIAGE_CMD: join(base, "fake"),
    FAKE_LOG: join(base, "calls"), ALEPH_LIVE_CAP: "10",
    // Locks live in $XDG_RUNTIME_DIR/aleph, shared by every process on the machine; keep this process's own.
    XDG_RUNTIME_DIR: join(base, "run"),
  });
});
afterAll(() => rmSync(base, { recursive: true, force: true }));
beforeEach(() => { delete process.env.ALEPH_TRIAGE_CAP; delete process.env.ALEPH_TRIAGE_TRIES; writeFileSync(join(base, "calls"), ""); });
const calls = () => readFileSync(join(base, "calls"), "utf8").split("\n").filter(Boolean).length;

test("each of the four verdicts leaves the item in its state", async () => {
  reset([
    { title: "a", body: "VERDICT:goal" }, { title: "b", body: "VERDICT:close" },
    { title: "c", body: "VERDICT:chris" }, { title: "d", body: "VERDICT:live" },
  ]);
  process.env.ALEPH_TRIAGE_CAP = "9";
  const t = await run();
  expect(t.skipped).toEqual([]);
  expect(t.triaged).toEqual({ goal: 1, close: 1, chris: 1, live: 1 });

  expect(labels(1)).toContain("goal");
  expect(item(1).body).toContain("## Oracle");
  expect(item(1).body).not.toContain("VERDICT");
  expect(todos.status(item(1))).toBe("open");

  expect(todos.status(item(2))).toBe("done");
  expect(item(2).notes.at(-1)).toContain("duplicate of tri-1");

  expect(labels(3)).toContain("needs-chris");
  expect(item(3).notes.at(-1)).toContain("Which plan, A or B?");
  expect(todos.status(item(3))).toBe("open");

  expect(labels(4)).toEqual(expect.arrayContaining(["live-check", "triaged"]));
  expect(item(4).notes.at(-1)).toContain("check the prod dashboard");
});

test("the prompt says the factory runs the checks, and names no aleph check command", () => {
  const p = prompt(repo, { id: 1, title: "t", body: "", notes: [], fm: {} } as unknown as todos.Item);
  expect(p).toContain("The factory runs this repo's checks itself");
  expect(p).toContain("There is no `aleph check` command");
  expect(p).not.toMatch(/aleph check\s+\S/);
  expect(p).toContain("`bun run test`");
  expect(p).not.toContain("such as `bun test`");
});

test("a triage is a job in the ledger, of kind triage", async () => {
  reset([1, 2, 3, 4].map((n) => ({ title: `item ${n}`, body: "VERDICT:live" })));
  await run();
  const folders = readdirSync(join(base, "jobs")).filter((d) => d.includes(`-triage-${repo.key}-`));
  expect(folders.length).toBe(4);
  // The runs go one after another, but the folder order is not the item order.
  const first = folders.map((f) => readRun(join(base, "jobs", f))).find((r) => r?.name === `triage-${repo.key}-1`);
  expect(first).toMatchObject({ kind: "triage", repo: repo.key, state: "done", name: `triage-${repo.key}-1`, todo: 1 });
});

test("a chris verdict with options is stored as fields next to the prose note; a malformed structure keeps the question", async () => {
  reset([{ title: "a", body: "VERDICT:structured" }]);
  await run();
  expect(readDecision(item(1))).toEqual({ question: "A or B?", options: [{ label: "A", line: "do a" }, { label: "B", line: "do b" }], recommended: "B", why: ["one", "two"] });
  expect(item(1).notes.at(-1)).toContain("A or B? Options: A: do a; B: do b. My recommendation is B.");
  const bad = parseVerdict('{"verdict":"chris","question":"Q?","options":[{"label":"A","line":"x"}],"recommended":"A"}');
  expect(bad).toEqual({ verdict: "chris", question: "Q?" });
});

test("items labelled needs-chris, triaged, proposal or goal, or waiting on an open item, are not triaged", async () => {
  reset([
    { title: "a", labels: ["needs-chris"] }, { title: "b", labels: ["triaged"] }, { title: "c", labels: ["proposal"] },
    { title: "d", labels: ["goal"] }, { title: "e", waitingOn: "tri-9" }, { title: "f", body: "VERDICT:chris" },
  ]);
  const t = await run();
  expect(calls()).toBe(1);
  expect(t.triaged).toEqual({ chris: 1 });
  expect(labels(6)).toContain("needs-chris");
  // Once what it waits on is done, it is triaged.
  const again = await run((ref) => ref === "tri-9");
  expect(again.triaged).toEqual({});
  expect(calls()).toBe(2);
});

test("the cap of two triages the two oldest of five", async () => {
  reset([1, 2, 3, 4, 5].map((n) => ({ title: `item ${n}`, body: "VERDICT:live" })));
  process.env.ALEPH_TRIAGE_CAP = "2";
  const t = await run();
  expect(t.triaged).toEqual({ live: 2 });
  expect([1, 2, 3, 4, 5].map((n) => labels(n).includes("live-check"))).toEqual([true, true, false, false, false]);
});

test("the default cap is five", async () => {
  reset([1, 2, 3, 4, 5, 6, 7].map((n) => ({ title: `item ${n}`, body: "VERDICT:live" })));
  expect((await run()).triaged).toEqual({ live: 5 });
});

test("a malformed verdict leaves the item unchanged and is skipped", async () => {
  reset([{ title: "a", body: "VERDICT:bad" }, { title: "b", body: "nothing" }]);
  const before = [item(1), item(2)].map((i) => todos.renderItem(repo.key, i));
  const t = await run();
  expect(t.triaged).toEqual({});
  expect(t.skipped).toEqual([expect.stringContaining(`${repo.key}-1: triage gave a malformed verdict`), expect.stringContaining(`${repo.key}-2: triage gave a malformed verdict: no JSON`)]);
  expect([item(1), item(2)].map((i) => todos.renderItem(repo.key, i))).toEqual(before);
});

test("an item with no verdict twice is labelled needs-chris and not triaged again", async () => {
  reset([{ title: "a", body: "nothing" }]);
  const before = todos.renderItem(repo.key, item(1));
  await run();
  expect(todos.renderItem(repo.key, item(1))).toBe(before);
  const t = await run();
  expect(labels(1)).toContain("needs-chris");
  expect(item(1).notes.at(-1)).toContain("no verdict in 2 runs");
  expect(t.skipped).toEqual([`${repo.key}-1: no verdict in 2 triages; labelled needs-chris`]);
  const n = calls();
  await run();
  expect(calls()).toBe(n);
});

test("a triage that exits non-zero counts toward the limit", async () => {
  reset([{ title: "a", body: "VERDICT:fail" }]);
  await run();
  expect(labels(1) ?? []).not.toContain("needs-chris");
  await run();
  expect(labels(1)).toContain("needs-chris");
  expect(item(1).notes.at(-1)).toContain("no verdict in 2 runs: failed: triage exited 3");
});

test("ALEPH_TRIAGE_TRIES=1 labels the item after the first malformed run", async () => {
  process.env.ALEPH_TRIAGE_TRIES = "1";
  reset([{ title: "a", body: "nothing" }]);
  await run();
  expect(labels(1)).toContain("needs-chris");
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

test("parseVerdict wants the field its verdict needs", () => {
  expect(parseVerdict('{"verdict":"close","reason":" stale "}')).toEqual({ verdict: "close", reason: "stale" });
  expect(parseVerdict('{"verdict":"goal"}')).toBe("goal without a body");
  expect(parseVerdict('{"verdict":"goal","body":"b","waiting_on":"aleph-265"}')).toEqual({ verdict: "goal", body: "b", waitingOn: "aleph-265" });
  expect(parseVerdict('{"verdict":"goal","body":"b","waiting_on":"soon"}')).toEqual({ verdict: "goal", body: "b" });
  expect(parseVerdict("[]")).toBe("no JSON");
});

// A triage run whose process died before its `end()`: `running`, with no pid or exit file.
function lostRun(name: string): string {
  const folder = join(base, "jobs", `${stamp()}-${name}-triage`);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "triage", job: folder.split("/").at(-1)!, name, repo: repo.key, todo: 1, state: "running", phase: "triage", told: true, shown: true, started: new Date().toISOString(), made: Date.now() });
  return folder;
}

test("a triage run whose process ended before a verdict is ended as failed by the next triage", async () => {
  reset([]);
  const folder = lostRun(`triage-${repo.key}-1`);
  await run();
  const r = readRun(folder)!;
  expect(r).toMatchObject({ state: "done", reason: "failed: its process ended before a verdict" });
  expect(typeof r.ended).toBe("string");
});

test("a lost triage run whose item's lock is held is left running", async () => {
  reset([]);
  const folder = lostRun(`triage-${repo.key}-1`);
  const release = (await lock(`triage-${repo.key}-1`, 0))!;
  try {
    await run();
    expect(readRun(folder)?.state).toBe("running");
  } finally {
    release();
  }
});

// Triage at once: `triageNow` is what `aleph triage <repo>-<n>` runs, after an add, an answer or a follow-up.
describe("triage at once", () => {
  beforeAll(() => { process.env.ALEPH_FACTORY_DIR = join(base, "factory"); });
  test("a non-goal issue is triaged with no tick; a goal is not", async () => {
    reset([{ title: "a", body: "VERDICT:close" }, { title: "g", body: "VERDICT:close", labels: ["goal"] }]);
    const { triageNow } = await import("./factory.ts");
    expect((await triageNow(repo, 1)).triaged).toEqual({ close: 1 });
    expect(todos.status(item(1))).toBe("done");
    expect((await triageNow(repo, 2)).triaged).toEqual({});
    expect(calls()).toBe(1);
  });

  test("the prompt carries the notes, and a paused factory triages nothing", async () => {
    reset([{ title: "c", body: "VERDICT:chris" }]);
    const { triageNow, setPaused } = await import("./factory.ts");
    await triageNow(repo, 1);
    expect(labels(1)).toContain("needs-chris");
    // Chris's answer: the label goes, the note stays, the triage sees it.
    writeList(repo, "answer", (doc) => { const i = todos.find(doc, 1)!; todos.note(i, "Plan B, VERDICT:close"); todos.edit(i, { labels: [] }); return true; });
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
    f.saveProbe({ at: new Date().toISOString(), ok: false, failed: ["x"] });
    expect((await f.triageNow(repo, 1)).triaged).toEqual({});
    expect(calls()).toBe(0);
    f.saveProbe({ at: new Date().toISOString(), ok: true, failed: [] });
    expect((await run()).triaged).toEqual({ close: 1 });
  });
});

test("the prompt keeps how-to-build questions away from Chris and asks him in plain words", () => {
  const p = prompt(repo, { id: 1, title: "t", body: "", notes: [], fm: {} } as unknown as todos.Item);
  expect(p).toContain("Never ask Chris about how to build it");
  expect(p).toContain("no file paths, function names, line numbers or code");
  expect(p).toContain('"waiting_on": "<optional <repo>-<n>>"');
});
