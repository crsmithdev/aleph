// A land and its batch: one check call and one push for the batch, a member that fails or conflicts taken out, and the room the land asks for.
import { expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { land } from "./landing.ts";
import * as issues from "../../todo/lib/todo.ts";
import * as store from "../../todo/lib/store.ts";
import { both, dir, given, job, landLog, mainFiles, ports, pushes, queued, remote, repo, sh, useLandingFixture } from "./landing.fixture.ts";

useLandingFixture();

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

test("a batch of three: one check call, one push, three commits, each with its own Job and Issue trailers", async () => {
  const [a, b, c] = [job("t1", [["t1.txt", "1\n"]], { on: "demo-11" }), queued(job("t2", [["t2.txt", "2\n"]], { on: "demo-12" })), queued(job("t3", [["t3.txt", "3\n"]], { on: "demo-13" }))];
  const p = ports();
  const r = await land(a, repo, p);
  expect(r).toMatchObject({ code: 0, outcome: { condition: "landed" } });
  expect(p.calls).toEqual([["t1", "t2", "t3"]]);
  expect(pushes()).toBe(1);
  expect(given(b).verdict.condition).toBe("landed");
  expect(given(c).checks).toEqual([{ name: "fake", ok: true, seconds: 0 }]);
  for (const e of [a, b, c]) expect(remote("log", "-1", "--format=%s", `--grep=^Job: ${e.run.job}$`, "main")).toBe(`add ${e.run.name}.txt`);
  expect(remote("log", "-1", "--format=%H", `--grep=^Job: ${b.run.job}$`, "main")).toBe(given(b).verdict.commit);
  for (const [e, n] of [[a, 11], [b, 12], [c, 13]] as const) expect(remote("log", "-1", "--format=%b", `--grep=^Job: ${e.run.job}$`, "main")).toContain(`Issue: demo-${n}\n`);
  expect(remote("rev-list", "--count", "main")).toBe("4");
  expect(landLog(a)).toContain("batch of 3");
  expect(existsSync(join(repo.path, "t3.txt"))).toBe(true);
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

// flaky: tests/flaky.md#batch-member-failed
test.skip("a member that failed in attempt 1 does not take the leader out when main moves twice", async () => {
  const names = ["tla", "tlbad", "tlr"];
  const [lead, bad, ...rest] = names.map((n, i) => { const e = job(n, [[`${n}.txt`, "x\n"]]); return i ? queued(e) : e; });
  const r = await land(lead, repo, ports({ bad: both(`${names[0]}.txt`, `${names[1]}.txt`), races: 2, raceOn: (n) => n[0] === names[0] && !n.includes(names[1]) }));
  expect(r.outcome.condition).toBe("landed");
  expect(given(bad).verdict.condition).toBe("failed");
  for (const e of rest) expect(given(e).verdict.condition).toBe("landed");
  expect(landLog(lead).split("main moved; merging again").length - 1).toBe(2);
  expect(mainFiles()).toContain(`${names[0]}.txt`);
  expect(mainFiles()).not.toContain(`${names[1]}.txt`);
});

test("a batch whose checks give no verdict does not split: each run fails as infra and nothing is pushed", async () => {
  const [a, b] = [job("n1", [["n1.txt", "1\n"]]), queued(job("n2", [["n2.txt", "2\n"]]))];
  const p = ports({ stop: { cause: "infra", checkName: "tests", reason: "no verdict: check tests timed out", timedOut: true } });
  const r = await land(a, repo, p);
  expect(r.outcome).toEqual({ condition: "failed", cause: "infra", checkName: "tests", reason: "no verdict: check tests timed out" });
  expect(given(b).verdict).toEqual(r.outcome);
  expect(p.calls).toEqual([["n1", "n2"]]);
  expect(pushes()).toBe(0);
});
