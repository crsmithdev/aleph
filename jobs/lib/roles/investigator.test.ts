// The investigator: one read-only run on an issue or a job, its reply checked by code and kept in result.json, and the
// fate Chris gives each recommended issue.
import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lock } from "../../../lib/locks.ts";
import { newsLine } from "../records/ledger.ts";
import { allRuns } from "../records/record.ts";
import { setModel } from "../routing/models.ts";
import { caseOf, findingOf, investigate, investigations, lockOf, setFate } from "./investigator.ts";
import { base, fresh, replyWith, run, useDirectorFixture } from "./director.testkit.ts";

useDirectorFixture();
beforeAll(() => { process.env.ALEPH_INVESTIGATOR_CMD = join(base, "fake"); });

const prompt = () => readFileSync(join(base, "prompt.md"), "utf8");
const runs = () => allRuns().filter((e) => e.run.role === "investigator");
const finding = (o: object) => ({ title: "Retry a held merge round as a merge round", kind: "bug", spec: "Start a merge round.", evidence: ["rescue.ts:248"], impact: 4, risk: 3, effort: 2, existing: null, ...o });
const REPLY = {
  summary: "The land conflicted, and the retry was a recheck.",
  timeline: [{ at: "2026-11-01T11:00:00Z", what: "Land fails", evidence: "job.2/log.txt:8" }],
  causes: [
    { claim: "A recheck cannot fix a conflict.", evidence: ["jobs/lib/land/rescue.ts:248"], confidence: "measured" },
    { claim: "Nobody saw it.", evidence: [], confidence: "inferred" },
  ],
  issues: [
    finding({}),
    finding({ title: "Fix the hold." }),
    finding({ title: "Lift a credit hold on moved issues", existing: "issue.2" }),
    finding({ title: "Order issues filed together", existing: "issue.99" }),
    finding({ title: "Say why a run waits", evidence: [] }),
  ],
};

test("an issue's investigation reads its runs and events, and keeps only the cited causes and the well-titled issues", async () => {
  fresh([{ title: "Refuse a core write" }, { title: "Lift the hold" }]);
  const folder = run({ name: "issue.1", target: "issue.1", state: "failed", reason: "merge conflict" }, { "log.txt": "x" });
  replyWith(REPLY);
  expect(setModel("investigator", { model: "sonnet" })).toBeNull();
  const out = await investigate("issue.1");
  expect(out!.reason).toBe("investigated issue.1: 1 cause, 3 issues");
  expect(prompt()).toContain("You investigate issue.1: Refuse a core write.");
  expect(prompt()).toContain(`${folder}: log.txt`);
  const [inv] = investigations("issue.1");
  expect(inv.result!.causes.map((c) => c.claim)).toEqual(["A recheck cannot fix a conflict."]);
  // The bad title and the issue with no evidence are dropped; an `existing` that names no issue becomes null.
  expect(inv.result!.issues.map((i) => [i.title, i.existing])).toEqual([
    ["Retry a held merge round as a merge round", null], ["Lift a credit hold on moved issues", "issue.2"], ["Order issues filed together", null],
  ]);
  const [e] = runs();
  expect([e.run.state, e.run.model, e.run.told, e.run.name]).toEqual(["done", "sonnet", false, "issue.1"]);
  expect(newsLine(e)).toBe(`${e.id} investigated issue.1: 1 cause, 3 issues`);
});

test("a run's fate on a recommended issue goes on its result.json", async () => {
  fresh([{ title: "Refuse a core write" }]);
  replyWith(REPLY);
  const { run: id } = (await investigate("issue.1"))!;
  setFate(id, 0, "filed issue.7");
  expect(findingOf(id, 0)).toMatchObject({ subject: "issue.1", finding: { fate: "filed issue.7" } });
  expect(findingOf(id, 5)).toBeUndefined();
});

test("a job's later run names the job, an unknown subject has no case, and a live run on the subject blocks another", async () => {
  fresh([{ title: "Refuse a core write" }]);
  run({ name: "issue.1", target: "issue.1", state: "returned" });
  const first = allRuns()[0].id;
  run({ name: "issue.1", target: "issue.1", state: "failed", prev: first });
  const later = allRuns().find((e) => e.id !== first)!.id;
  expect(caseOf(later)?.subject).toBe(first);
  expect(caseOf("issue.99")).toBeNull();
  expect(caseOf("job.999")).toBeNull();
  const release = (await lock(lockOf("issue.1"), 0))!;
  try { expect(await investigate("issue.1")).toBeNull(); } finally { release(); }
  expect(runs()).toEqual([]);
});

test("a run with no reply ends with the failure as its reason and writes no result", async () => {
  fresh([{ title: "Refuse a core write" }]);
  replyWith("not json");
  const out = await investigate("issue.1");
  expect(out!.reason).toStartWith("failed: ");
  const [inv] = investigations("issue.1");
  expect([inv.state, inv.result]).toEqual(["done", undefined]);
});

test("an off investigator opens no run and says so", async () => {
  fresh([{ title: "Refuse a core write" }]);
  setModel("investigator", { enabled: false });
  await expect(investigate("issue.1")).rejects.toThrow("the investigator is off");
  expect(runs()).toHaveLength(0);
});
