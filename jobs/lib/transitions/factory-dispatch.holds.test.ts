// The hold record of an issue the dispatch skips: one per reason, for each reason the issue loop has.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { writeList } from "../../../lib/store.ts";
import * as issues from "../../../lib/todo.ts";
import * as store from "../../../lib/store.ts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { dispatchIssues } from "./dispatch.ts";
import { suiteStep } from "./baseline.ts";
import { holdBackend, readHolds } from "../gates/holds.ts";
import * as record from "../records/record.ts";
import { readEvents } from "../../../lib/layout.ts";
import { lock } from "../../../lib/locks.ts";
import { change, ctx, mk, newIssue, notes, setup, sh, teardown } from "./factory.testkit.ts";

beforeEach(setup);
afterEach(teardown);

test("an issue that a red main holds gets one hold record; the suite runs main's checks once for its commit", async () => {
  const id = newIssue();
  let checksRun = 0;
  const red = async () => { checksRun++; return { cause: "check" as const, checkName: "tests", reason: "tests failed" }; };
  await suiteStep(red);
  await suiteStep(red);
  expect(checksRun).toBe(1);
  const first = await dispatchIssues(async () => null, undefined, undefined);
  const second = await dispatchIssues(async () => null, undefined, undefined);
  for (const out of [first, second]) {
    expect(out.started).toEqual([]);
    expect(out.skipped).toEqual([expect.stringMatching(new RegExp(`^issue.${id}: main is red at [0-9a-f]{7}: tests$`))]);
  }
  const recs = readHolds([`issue.${id}`]);
  expect(recs).toHaveLength(1);
  expect(recs[0].kind).toBe("red");
  const held = readEvents().filter((e) => e.object === `issue.${id}` && e.action === "held");
  expect(held.map((e) => e.detail)).toEqual([expect.stringMatching(/^red: at [0-9a-f]{7}: tests$/)]);
});

test("a red main holds issues after main moves, until a suite run on the new commit is green", async () => {
  const id = newIssue();
  await suiteStep(async () => ({ cause: "check" as const, checkName: "tests", reason: "tests failed" }));
  sh(join(ctx.base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", "a fix");
  sh(join(ctx.base, "repo"), "git", "push", "-q", "origin", "main");
  const held = await dispatchIssues(async () => null, undefined, undefined);
  expect(held.skipped).toEqual([expect.stringMatching(/main is red at/)]);
  expect(await suiteStep(async () => null)).toEqual({ fac: "green" });
  const out = await dispatchIssues(async () => null, undefined, undefined);
  expect(out.started).toEqual([`issue.${id}`]);
});

test("an open issue whose work is on main closes as done, and no later dispatch lists it", async () => {
  const id = newIssue();
  sh(join(ctx.base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", `the work\n\nIssue: issue.${id}`);
  sh(join(ctx.base, "repo"), "git", "push", "-q", "origin", "main");
  const first = await dispatchIssues(async () => null, undefined, undefined);
  expect(first.skipped.filter((l) => l.startsWith(`issue.${id}:`))).toEqual([]);
  expect(store.readList({ key: "fac" })!.items.find((i) => i.id === id)!.fm.closed_as).toBe("done");
  expect(notes(id)).toMatch(/its work is on origin\/main: [0-9a-f]{7}$/m);
  const second = await dispatchIssues(async () => null, undefined, undefined);
  expect(second.skipped.filter((l) => l.startsWith(`issue.${id}:`))).toEqual([]);
});

test("a done issue whose trailer commit on main is reverted reopens, with one event on its key", async () => {
  const id = newIssue();
  writeList({ key: "fac" }, "close", (doc) => { issues.setStatus(issues.find(doc, id)!, "done"); return true; });
  const before = readEvents().length;
  const repo = join(ctx.base, "repo");
  writeFileSync(join(repo, "work.txt"), "the work\n");
  sh(repo, "git", "add", "work.txt");
  sh(repo, "git", "commit", "-q", "-m", `the work\n\nIssue: issue.${id}`);
  sh(repo, "git", "revert", "--no-edit", "HEAD");
  sh(repo, "git", "push", "-q", "origin", "main");
  await dispatchIssues(async () => null, undefined, undefined);
  expect(issues.status(store.readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("open");
  expect(readEvents().slice(before).filter((e) => e.object === `issue.${id}`).map((e) => e.action)).toEqual(["reopened"]);
});

test("a parent whose sub-issues are all done closes with a note that names them", async () => {
  const parent = newIssue();
  const child = writeList({ key: "fac" }, "split", (doc) => issues.add(doc, "the first sub-issue", { from: `issue.${parent}`, spec: "Do it." }).id, true)!.value;
  sh(join(ctx.base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", `the work\n\nIssue: issue.${child}`);
  sh(join(ctx.base, "repo"), "git", "push", "-q", "origin", "main");
  await dispatchIssues(async () => null, undefined, undefined);
  expect(notes(parent)).toMatch(new RegExp(`its sub-issues are done: fac-${child} \\([0-9a-f]{7}\\)$`, "m"));
});

test("a done parent whose lock another dispatch holds is skipped, and the dispatch goes on", async () => {
  const parent = newIssue();
  const child = writeList({ key: "fac" }, "split", (doc) => issues.add(doc, "the first sub-issue", { from: `issue.${parent}`, spec: "Do it." }).id, true)!.value;
  sh(join(ctx.base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", `the work\n\nIssue: issue.${child}`);
  sh(join(ctx.base, "repo"), "git", "push", "-q", "origin", "main");
  const release = (await lock(`issue-issue.${parent}`, 0))!;
  try {
    const out = await dispatchIssues(async () => null, undefined, undefined);
    expect(out.skipped).toContain(`issue.${parent}: another dispatch holds it`);
  } finally {
    release();
  }
  expect(readEvents()).toContainEqual(expect.objectContaining({ subject: "rule", object: `issue.${parent}`, action: "skipped", detail: "another dispatch holds it" }));
});

test("a main that no suite run has checked, or whose checks gave no verdict, does not hold an issue", async () => {
  const id = newIssue();
  expect(await suiteStep(async () => ({ cause: "infra" as const, reason: "no runner" }))).toEqual({ fac: "main is unchecked: no runner" });
  const out = await dispatchIssues(async () => null, undefined, undefined);
  expect(out.started).toEqual([`issue.${id}`]);
});

describe("each skip in the issue loop gets one hold record", () => {
  test("an issue parked after the first read", async () => {
    const id = newIssue();
    const name = `issue.${id}`;
    // Park it between the read under the lock and the last read before the start.
    const real = store.buildableIssue;
    const spy = spyOn(store, "buildableIssue").mockImplementation((place, ref) => {
      const item = real(place, ref);
      writeList({ key: "fac" }, "park", (doc) => { issues.setStatus(issues.find(doc, ref)!, "parked"); return true; });
      return item;
    });
    try {
      const out = await dispatchIssues(async () => null, undefined, undefined);
      expect(out.skipped).toEqual([`${name}: the item is parked`]);
    } finally {
      spy.mockRestore();
    }
    expect(readHolds([name])).toMatchObject([{ kind: "parked", event: { action: "parked" } }]);
  });

});

describe("the done checker's copy of the store was read before an issue existed", () => {
  /** The read number `at` returns `old`, the done checker's; the other reads see the store. */
  const staleOnce = (old: ReturnType<typeof store.readList>, at: number) => {
    const real = store.readList;
    let n = 0;
    return spyOn(store, "readList").mockImplementation((place) => (n++ === at ? old : real(place)));
  };

  test("an issue the list names as open, with no commit on main, stays open with no note", async () => {
    newIssue();
    const old = store.readList({ key: "fac" });
    const id = newIssue();
    const spy = staleOnce(old, 1);
    try {
      await dispatchIssues(async () => null, undefined, undefined);
    } finally {
      spy.mockRestore();
    }
    expect(issues.status(store.readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("open");
    expect(notes(id)).not.toMatch(/its work is on origin/);
  });

  test("a parent whose only parts are new open issues is not closed", async () => {
    const parent = newIssue();
    const old = store.readList({ key: "fac" });
    writeList({ key: "fac" }, "split", (doc) => {
      const p = issues.find(doc, parent)!;
      issues.add(doc, "part", { spec: "Do it.", from: `issue.${p.id}` });
      return true;
    });
    const spy = staleOnce(old, 0);
    try {
      await dispatchIssues(async () => null, undefined, undefined);
    } finally {
      spy.mockRestore();
    }
    expect(notes(parent)).not.toMatch(/its sub-issues are done/);
  });
});

test("a sub-issue waits on its parent's after, and starts once those refs are done", async () => {
  const x = newIssue();
  const parent = writeList({ key: "fac" }, "add", (doc) => issues.add(doc, "the parent", { spec: "Do it.", after: [`issue.${x}`] }).id, true)!.value;
  const child = writeList({ key: "fac" }, "split", (doc) => issues.add(doc, "the child", { from: `issue.${parent}`, spec: "Do it." }).id, true)!.value;
  const held = await dispatchIssues(async () => null, undefined, undefined);
  expect(held.started).not.toContain(`issue.${child}`);
  expect(held.skipped).toContain(`issue.${child}: after issue.${x}`);
  change(x, (i) => { i.fm.closed_as = "done"; });
  const out = await dispatchIssues(async () => null, undefined, undefined);
  expect(out.started).toContain(`issue.${child}`);
});

test("a held backend skips an issue with no run with no hold event and no issue state, and the second dispatch routes it no more", async () => {
  await holdBackend("claude", "API Error: 402 This request would exceed your available credits");
  const id = newIssue();
  const name = `issue.${id}`;
  let routed = 0;
  const server = Bun.serve({ port: 0, fetch: () => { routed++; return Response.json({ answers: { size: { type: "choice", choice: "large", probabilities: { large: 1 } } } }); } });
  const saved = { url: process.env.ALEPH_JEV_URL, key: process.env.OPENROUTER_API_KEY };
  Object.assign(process.env, { ALEPH_JEV_URL: `http://127.0.0.1:${server.port}/`, OPENROUTER_API_KEY: "k-test" });
  try {
    const before = readEvents().length;
    for (let i = 0; i < 2; i++) expect((await dispatchIssues(async () => null)).skipped).toEqual([`${name}: waits for Claude: API Error: 402 This request would exceed your available credits`]);
    expect(routed).toBe(1);
    expect(readEvents().slice(before).filter((e) => e.object === name && e.subject === "gate")).toEqual([]);
    expect(record.read(name)).toBeNull();
  } finally {
    server.stop(true);
    if (saved.url === undefined) delete process.env.ALEPH_JEV_URL; else process.env.ALEPH_JEV_URL = saved.url;
    if (saved.key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = saved.key;
  }
});

test("the loop guard logs its Ask as one question event with its facts, no looping event and no held event, and the next dispatch sets no second Ask", async () => {
  const id = newIssue();
  const name = `issue.${id}`;
  for (let i = 0; i < 3; i++) mk(`fac-${id}`, "build", "dropped", { reason: "run X ended with no commit: dropped", noCommit: true, started: `2026-10-0${i + 1}T00:00:00.000Z` });
  const before = readEvents().length;
  await dispatchIssues(async () => null, undefined, undefined);
  await dispatchIssues(async () => null, undefined, undefined);
  const mine = readEvents().slice(before).filter((e) => e.object === name && e.subject === "gate");
  expect(mine.map((e) => [e.action, e.detail])).toEqual([["question", "no-commit: 3 / 3 jobs with no commit"]]);
});
