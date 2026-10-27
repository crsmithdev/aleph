import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as todos from "../../todo/lib/todo.ts";
import { readList, writeList } from "../../todo/lib/store.ts";
import { parseVerdict, triageOpen } from "./triage.ts";
import { readRun, type Repo } from "./ledger.ts";

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
  *VERDICT:live*) echo '{"verdict":"live","note":"check the prod dashboard"}' ;;
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
const labels = (id: number) => item(id).fm.labels as string[];
const run = (blocked: () => string | null = () => null, done: (r: string) => boolean = () => false) => triageOpen([repo], done, blocked);

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
  });
});
afterAll(() => rmSync(base, { recursive: true, force: true }));
beforeEach(() => { delete process.env.ALEPH_TRIAGE_CAP; writeFileSync(join(base, "calls"), ""); });
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

test("a triage is a job in the ledger, of kind triage", async () => {
  const folders = readdirSync(join(base, "jobs")).filter((d) => d.endsWith("-triage") && d.includes("-triage-tri1-"));
  expect(folders.length).toBe(4);
  expect(readRun(join(base, "jobs", folders[0]))).toMatchObject({ kind: "triage", repo: "tri1", state: "done", name: "triage-tri1-1", todo: 1 });
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
  const again = await run(() => null, (ref) => ref === "tri-9");
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

test("a blocked day cap or live cap starts no triage", async () => {
  reset([{ title: "a", body: "VERDICT:live" }]);
  const t = await run(() => "cap of 0 runs in 24 hours");
  expect(t.triaged).toEqual({});
  expect(t.skipped).toEqual(["triage: cap of 0 runs in 24 hours"]);
  expect(calls()).toBe(0);
});

test("parseVerdict wants the field its verdict needs", () => {
  expect(parseVerdict('{"verdict":"close","reason":" stale "}')).toEqual({ verdict: "close", reason: "stale" });
  expect(parseVerdict('{"verdict":"goal"}')).toBe("goal without a body");
  expect(parseVerdict("[]")).toBe("no JSON");
});
