import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { putJson } from "../../../lib/db.ts";
import { close, readList, writeList } from "../../../lib/store.ts";
import * as issues from "../../../lib/issue-file.ts";
import { dispatchIssues } from "../transitions/dispatch.ts";
import { applyActions, pendingCases } from "../roles/director.ts";
import { readEvents } from "../../../lib/layout.ts";
import { loadRegistry, type Run } from "../records/ledger.ts";
import { askOf } from "../asks/ask.ts";
import type { MainState } from "../gates/tables.ts";
import type { Fate } from "../records/outcome.ts";
import { rescueErrors } from "./rescue.ts";
import { ctx, newIssue, mk, ask, fakes, notes, setup, sh, teardown } from "../transitions/factory.testkit.ts";

beforeEach(setup);
afterEach(teardown);

/** One rescue of the failed runs in the ledger, with fake actions and main in `main`: the calls, and each drop's reason and fate by issue key. */
async function rescue(main: MainState = { state: "green" }) {
  const f = fakes();
  const drops: Record<string, { reason: string; fate?: Fate }> = {};
  await rescueErrors({ ...f.rescue, drop: (name, reason, fate) => { drops[name] = { reason, fate }; return f.rescue.drop(name, reason, fate); } }, f.land, async () => main);
  return { calls: f.calls, drops };
}
/** The rerun note the rescue left for issue `id`. */
const rerun = (id: number) => readEvents().findLast((e) => e.action === "reran" && e.object === `issue.${id}`)?.detail;
/** Issue `id`'s status in the store. */
const statusOf = (id: number) => issues.status(issues.find(readList(loadRegistry().fac)!, id)!);
/** A failed land of a new job of issue `id`, after its passed build. */
const land = (id: number, r: Partial<Run>) => mk(`fac-${id}`, "land", "failed", { ...r, job: mk(`fac-${id}`, "build", "passed", { land: true }).job });
// A run that a host restart killed: `running`, started before this boot, its process gone.
const BEFORE_BOOT = "2020-01-01T00:00:00.000Z";
const killed = (id: number, role: Run["role"], r: Partial<Run> = {}) => mk(`fac-${id}`, role, "running", { started: BEFORE_BOOT, made: Date.parse(BEFORE_BOOT), ...r }, { pid: "999999999" });
/** Commits `file` on a new branch `branch` of the factory repo, off main. */
const branch = (name: string, file: string) => {
  const path = join(ctx.base, "repo");
  sh(path, "git", "checkout", "-q", "-b", name, "main");
  writeFileSync(join(path, file), "x\n");
  sh(path, "git", "add", file);
  sh(path, "git", "commit", "-q", "-m", file);
  sh(path, "git", "checkout", "-q", "main");
};

test("a run with a question waits for a spec edit: the Ask says so, and an edit drops the run, clears the Ask and starts the issue", async () => {
  const id = newIssue();
  mk(`fac-${id}`, "build", "failed", { cause: "no-commit", reason: "no commit", question: "which wins?" }, { "result.md": "Stopped." });
  const f = fakes();
  await dispatchIssues(f.start, undefined, f.rescue);
  const a = askOf(`issue.${id}`)!;
  expect(a.reason).toBe("question");
  expect(a.recommended).toBeUndefined();
  expect(a.question).toContain("waits for a spec edit");
  // Nothing changed: the next dispatch starts nothing.
  await dispatchIssues(f.start, undefined, f.rescue);
  expect(f.calls).toEqual([]);
  expect(f.specs).toEqual([]);
  // The user edits the spec.
  writeList({ key: "fac" }, "edit", (doc) => { issues.find(doc, id)!.spec = "A clearer spec."; return true; });
  await dispatchIssues(f.start, undefined, f.rescue);
  expect(f.calls).toContain(`drop issue.${id}`);
  expect(ask(id)).toBeNull();
  expect(f.specs.length).toBe(1);
});

test("a spec edit tells Chris through the rescue's Tell, not the network", async () => {
  const id = newIssue();
  mk(`fac-${id}`, "build", "failed", { cause: "no-commit", reason: "no commit", question: "which wins?" }, { "result.md": "Stopped." });
  const lines: string[] = [];
  const f = fakes();
  const rescue = { ...f.rescue, tell: { send: async (line: string) => { lines.push(line); return true; } } };
  await dispatchIssues(f.start, undefined, rescue);
  const asked = lines.length;
  expect(lines.some((l) => l.includes("asks the user: "))).toBe(true);
  writeList({ key: "fac" }, "edit", (doc) => { issues.find(doc, id)!.spec = "A clearer spec."; return true; });
  await dispatchIssues(f.start, undefined, rescue);
  expect(lines.slice(asked)).toEqual([`fac/issue.${id}: the spec was edited; the issue starts again`]);
});

test("a rescue that throws gives a failed event whose note holds the failure", async () => {
  const id = newIssue();
  mk(`fac-${id}`, "build", "failed", { cause: "no-commit", reason: "no commit", question: "which wins?" }, { "result.md": "Stopped." });
  const f = fakes();
  await dispatchIssues(f.start, undefined, f.rescue);
  writeList({ key: "fac" }, "edit", (doc) => { issues.find(doc, id)!.spec = "A clearer spec."; return true; });
  await dispatchIssues(f.start, undefined, { ...f.rescue, drop: async () => { throw new Error("drop broke"); } });
  const e = readEvents().find((x) => x.action === "failed" && x.detail?.includes("drop broke"));
  expect(e?.subject).toBe("gate");
  expect(e?.detail).toContain("drop broke");
  expect(readEvents().some((x) => x.subject === "firefighter")).toBe(false);
});

test("a run the API refused for credit waits: the rescue starts no rerun, recheck or drop, and writes no Ask", async () => {
  const id = newIssue();
  mk(`fac-${id}`, "build", "failed", { cause: "credit", reason: "API Error: 402 This request would exceed your available credits", ended: "2026-06-01T11:58:00.000Z" });
  const f = fakes();
  setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
  try { await dispatchIssues(f.start, undefined, f.rescue); } finally { setSystemTime(); }
  expect(f.calls).toEqual([]);
  expect(ask(id)).toBeNull();
});

test("a run the API refused for credit that ended long ago is started again by the dispatch", async () => {
  const id = newIssue();
  mk(`fac-${id}`, "build", "failed", { cause: "credit", reason: "API Error: 402", ended: "2026-01-01T00:00:00.000Z" });
  const f = fakes();
  await dispatchIssues(f.start, undefined, f.rescue);
  expect(f.calls).toEqual([`start issue.${id}`]);
});

test("a spec question run, then the director's answer: the answer is refused, and the job keeps its Ask and starts nothing", async () => {
  const id = newIssue();
  mk(`fac-${id}`, "build", "failed", { cause: "no-commit", reason: "no commit", question: "which wins?" }, { "result.md": "Stopped." });
  const f = fakes();
  // The real rescue path sets the plain question Ask and writes asked-spec.
  await dispatchIssues(f.start, undefined, f.rescue);
  expect(ask(id)?.options).toEqual([]);
  const c = pendingCases([loadRegistry().fac]).find((x) => x.on === `issue.${id}`)!;
  const r = await applyActions(c, [{ do: "answer", note: "the grep wins" }], { land: async () => null, drop: f.rescue.drop, after: () => {} });
  // The run waits for a spec edit: the director's answer is refused, and the next dispatch keeps the Ask and starts nothing.
  expect(r.refused).toEqual([`answer: the grep wins: the run issue.${id} asked about the spec and waits for a spec edit; use edit, or drop it`]);
  await dispatchIssues(f.start, undefined, f.rescue);
  expect(ask(id)).toMatchObject({ reason: "question", options: [] });
  expect(f.specs).toEqual([]);
});

test("a time box that runs out on a child filed with from: asks Chris and sets no plan, as intake skips a child", async () => {
  const parent = newIssue();
  const id = writeList({ key: "fac" }, "add a child", (doc) => issues.add(doc, "[ship] the child", { spec: "Do the part.", from: `issue.${parent}` }).id, true)!.value;
  mk(`fac-${id}`, "build", "failed", { cause: "timeout", reason: "time box" });
  const f = fakes();
  await dispatchIssues(f.start, undefined, f.rescue);
  expect(f.calls).toEqual([]);
  expect(ask(id)).toMatchObject({ reason: "rescue", recommended: "Rerun", options: [{ label: "Rerun", line: "Drop the failed run and start the issue again as it is" }, { label: "Another way" }] });
  expect(ask(id)!.why).toContain("Intake cannot split it again");
  expect(issues.find(readList(loadRegistry().fac)!, id)!.fm.plan).toBeUndefined();
});

test("rescue: already met: on main or done is a duplicate; a worker's claim is checked on main", async () => {
  const done = newIssue(), green = newIssue();
  close(loadRegistry().fac, done, "done by hand");
  mk(`fac-${done}`, "build", "failed", { cause: "no-commit", reason: "no commit" });
  mk(`fac-${green}`, "build", "failed", { cause: "no-commit", reason: "no commit", alreadyMet: "foo.ts:3" });
  const ok = await rescue();
  expect(ok.drops[`issue.${done}`]).toMatchObject({ fate: "met", reason: expect.stringContaining("the item is already done: dropped as a duplicate") });
  expect(ok.drops[`issue.${green}`]).toMatchObject({ fate: "met", reason: expect.stringContaining("the checks pass on origin/main: dropped, and the item is done") });
  expect(statusOf(green)).toBe("done");
  const red = newIssue();
  mk(`fac-${red}`, "build", "failed", { cause: "no-commit", reason: "no commit", alreadyMet: "foo.ts:3" });
  const no = await rescue({ state: "red", line: "tests fail" });
  expect(no.drops[`issue.${red}`].fate).toBeUndefined();
  expect(rerun(red)).toContain("but the checks do not pass on origin/main (tests fail)");
  expect(rerun(red)).toContain("Make the change the issue asks for.");
  expect(notes(red)).toContain("dropped, and the issue reruns once");
  expect(statusOf(red)).toBe("open");
});

test("rescue: the other safe cases, and none for the rest", async () => {
  const timeout = newIssue(), landTimeout = newIssue(), locked = newIssue(), check = newIssue(), bounced = newIssue();
  mk(`fac-${timeout}`, "build", "failed", { cause: "timeout", reason: "time box" });
  land(landTimeout, { cause: "timeout", reason: "time box" });
  mk(`fac-${locked}`, "build", "failed", { cause: "locked", reason: "job lock busy" });
  mk(`fac-${check}`, "build", "failed", { cause: "check", reason: "tests" });
  land(bounced, { cause: "check", reason: "tests", conflicts: ["a"] });
  const r = await rescue();
  expect(r.drops[`issue.${timeout}`].reason).toContain("the issue goes to intake to split");
  expect(r.drops[`issue.${locked}`].reason).toContain("failed for infrastructure (job lock busy)");
  for (const id of [landTimeout, check, bounced]) expect(ask(id)!.why).toContain("No safe default covers this case");
  expect(Object.keys(r.drops).sort()).toEqual([`issue.${locked}`, `issue.${timeout}`].sort());
});

test("rescue: each step: a killed run, an infra failure, a land conflict, and a run with nothing to keep", async () => {
  const [killedLand, killedBuild, infraLand, infraBranch, infraNone, conflict, noCommit, landChecks] = Array.from({ length: 8 }, () => newIssue());
  killed(killedLand, "land", { job: mk(`fac-${killedLand}`, "build", "passed", { started: BEFORE_BOOT }).job });
  killed(killedBuild, "build");
  land(infraLand, { cause: "infra", reason: "fetch failed" });
  branch("infra", "b.ts");
  mk(`fac-${infraBranch}`, "build", "failed", { cause: "infra", reason: "fetch failed", branch: "infra" });
  mk(`fac-${infraNone}`, "build", "failed", { cause: "infra", reason: "fetch failed" });
  const path = join(ctx.base, "repo");
  writeFileSync(join(path, "a.ts"), "a\n");
  sh(path, "git", "add", "a.ts");
  sh(path, "git", "commit", "-q", "-m", "fix a");
  sh(path, "git", "push", "-q", "origin", "main");
  const sha = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: path }).stdout.toString().trim();
  land(conflict, { cause: "conflict", reason: "merge conflict", conflicts: ["a.ts"] });
  mk(`fac-${noCommit}`, "build", "failed", { cause: "no-commit", reason: "no commit" }, { "result.md": "line 1\nline 2\n" });
  land(landChecks, { cause: "check", reason: "tests" });
  const r = await rescue();
  expect(r.calls).toContain(`land issue.${killedLand}`);
  expect(r.drops[`issue.${killedBuild}`].reason).toContain("a host restart killed build run");
  expect(rerun(killedBuild)).toBeUndefined();
  expect(r.calls).toContain(`land issue.${infraLand}`);
  expect(r.calls).toContain(`recheck issue.${infraBranch}`);
  expect(rerun(infraNone)).toBe("The last run failed before it made a branch: fetch failed.");
  expect(rerun(conflict)).toContain(`merge conflict in a.ts, last changed on main by ${sha} fix a`);
  expect(rerun(conflict)).toContain("Another issue landed on the same lines first");
  expect(notes(conflict)).toContain("the issue reruns once from current main");
  expect(r.drops[`issue.${killedBuild}`].reason).toContain("Run the issue again from the start.");
  expect(rerun(noCommit)).toBe("The last run made no commit. The last 20 lines of its result.md:\n\n```\nline 1\nline 2\n```");
  expect(rerun(landChecks)).toContain("its checks log:\n\n```\n(empty)\n```");
});

test("a check failure whose tests all fail on main is held while main is red, rechecked once at green, then asks", async () => {
  const [held, own] = [newIssue(), newIssue()];
  const failed = (onMain?: true): Partial<Run> => ({ cause: "check", checkName: "tests", reason: "tests failed", checks: [{ name: "tests", ok: false, seconds: 1, tests: { ran: 1, passed: 0, failed: 1, skipped: 0, failures: [{ file: "a.test.ts", name: "a", message: "", ...(onMain && { onMain }) }] } }] });
  const { job } = mk(`fac-${held}`, "build", "failed", failed(true));
  mk(`fac-${own}`, "build", "failed", failed());
  const red = await rescue({ state: "red", line: "tests fail" });
  expect(red.calls).toEqual([]);
  expect(ask(held)).toBeNull();
  expect((await rescue()).calls).toEqual([`recheck issue.${held}`]);
  expect(ask(held)).toBeNull();
  expect(ask(own)!.why).toContain("No safe default covers this case");
  mk(`fac-${held}`, "recheck", "failed", { job, ...failed(true) });
  expect((await rescue()).calls).toEqual([]);
  expect(ask(held)!.question).toContain("hit the same case again");
});

test("hasWork: a branch whose only change is result.md is not work to rescue, as unit's branchFacts decides; one that changes code is", async () => {
  const [notes, code, gone] = [newIssue(), newIssue(), newIssue()];
  branch("notes", "result.md");
  branch("code", "a.ts");
  killed(notes, "build", { branch: "notes" });
  killed(code, "build", { branch: "code" });
  killed(gone, "build", { branch: "gone" });
  const r = await rescue();
  expect([notes, code, gone].map((id) => r.calls.find((c) => c.endsWith(`issue.${id}`)))).toEqual([`drop issue.${notes}`, `recheck issue.${code}`, `drop issue.${gone}`]);
});

test("a standing rescue whose drop fails logs the failure and falls through to an Ask, with no always note", async () => {
  putJson("settings", "always", { rescue: { action: "recommended", at: "2026-11-04T12:00:00.000Z" } });
  const id = newIssue();
  mk(`fac-${id}`, "build", "failed", { reason: "tests failed after 2 fix rounds" });
  const f = fakes();
  await dispatchIssues(f.start, undefined, { ...f.rescue, drop: async () => "no such job" });
  expect(readEvents()).toContainEqual(expect.objectContaining({ subject: "gate", object: `issue.${id}`, action: "failed", detail: "always Rerun failed (no such job)" }));
  expect(ask(id)).toMatchObject({ reason: "rescue" });
  expect(notes(id)).not.toContain("always: Rerun");
});
