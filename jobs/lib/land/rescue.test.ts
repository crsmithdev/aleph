import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readList, writeList } from "../../../issues/lib/store.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { dispatchIssues } from "../transitions/factory.ts";
import { applyActions, pendingCases } from "../roles/director.ts";
import { readEvents } from "../../../lib/layout.ts";
import { git } from "../../../lib/git.ts";
import { loadRegistry, type Entry, type Repo, type Run } from "../records/ledger.ts";
import { askOf } from "../asks/ask.ts";
import { claimStep, conflictStep, duplicateStep, hasWork, infraStep, killedStep, rerunStep, rescueCase, type Stuck } from "./rescue.ts";
import { newIssue, mk, ask, fakes, setup, teardown } from "../transitions/factory.testkit.ts";

beforeEach(setup);
afterEach(teardown);

const run = (r: Partial<Run>): Run => ({ role: "build", job: "job.1", name: "issue.1", state: "failed", started: "2026-11-01T00:00:00Z", ...r } as Run);
const repo = { key: "fac", path: "/nowhere", main: "main" } as Repo;
/** A stuck run whose folder holds `files`. */
const stuck = (r: Partial<Run>, id = "r9", files: Record<string, string> = {}): Stuck => {
  const folder = mkdtempSync(join(tmpdir(), "rescue-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
  return { last: { id, folder, run: run(r) } as Entry, r: run(r), repo, name: "issue.1", issue: 1, reason: r.reason ?? "why" };
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
  // Chris edits the spec.
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
  writeList({ key: "fac" }, "edit", (doc) => { issues.find(doc, id)!.spec = "A clearer spec."; return true; });
  await dispatchIssues(f.start, undefined, rescue);
  expect(lines.slice(asked)).toEqual([`fac/issue.${id}: the spec was edited; the goal starts again`]);
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
  if (c.at === "lesson") throw new Error("not an item case");
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
  expect(ask(id)).toMatchObject({ reason: "rescue", recommended: "Rerun", options: [{ label: "Rerun" }, { label: "Another way" }] });
  expect(ask(id)!.why).toContain("Intake cannot split it again");
  expect(issues.find(readList(loadRegistry().fac)!, id)!.fm.plan).toBeUndefined();
});

test("rescue: already met: on main or done is a duplicate; a worker's claim is checked on main", () => {
  const r = run({ state: "failed", cause: "no-commit" });
  expect(rescueCase(r, true, "evidence")).toBe("duplicate");
  expect(rescueCase(r, false, "evidence")).toBe("claimed");
  expect(rescueCase(r, false, null)).toBe("no-commit");
  const s = stuck({ cause: "no-commit" });
  expect(duplicateStep(s, "abc1234")).toMatchObject({ action: "drop", done: true, fate: "met" });
  expect(duplicateStep(s, null)).toMatchObject({ action: "drop", done: false, fate: "met" });
  expect(claimStep(s, "foo.ts:3", null)).toMatchObject({ action: "drop", done: true, fate: "met" });
  const red = claimStep(s, "foo.ts:3", "tests fail");
  expect(red.rerun).toContain("but the checks do not pass on origin/main (tests fail)");
  expect(red.done).toBeUndefined();
});

test("rescue: the other safe cases, and none for the rest", () => {
  expect(rescueCase(run({ cause: "timeout" }), false, null)).toBe("timeout");
  expect(rescueCase(run({ role: "land", cause: "timeout" }), false, null)).toBeNull();
  expect(rescueCase(run({ cause: "infra" }), false, null)).toBe("infra");
  expect(rescueCase(run({ cause: "locked" }), false, null)).toBe("infra");
  expect(rescueCase(run({ role: "land", cause: "conflict" }), false, null)).toBe("land-conflict");
  expect(rescueCase(run({ role: "land", cause: "check" }), false, null)).toBe("land-checks");
  expect(rescueCase(run({ role: "land", cause: "check", conflicts: ["a"] }), false, null)).toBeNull();
  expect(rescueCase(run({ cause: "check" }), false, null)).toBeNull();
});

test("rescue: each step: a killed run, an infra failure, a land conflict, and a run with nothing to keep", () => {
  expect(killedStep(stuck({ role: "land" }), false).action).toBe("land again");
  expect(killedStep(stuck({ role: "build" }), true).action).toBe("recheck");
  expect(killedStep(stuck({ role: "build" }), false)).toMatchObject({ action: "drop" });
  expect(killedStep(stuck({ role: "build" }), false).rerun).toBeUndefined();
  expect(infraStep(stuck({ role: "land" }), false).action).toBe("land again");
  expect(infraStep(stuck({ role: "build" }), true).action).toBe("recheck");
  expect(infraStep(stuck({ role: "build", reason: "fetch failed" }), false).rerun).toBe("The last run failed before it made a branch: fetch failed.");
  expect(conflictStep(stuck({ role: "land", conflicts: ["a.ts"] }), "abc fix a").rerun).toContain("merge conflict in a.ts, last changed on main by abc fix a");
  expect(rerunStep(stuck({ cause: "no-commit" }, "r-nc", { "result.md": "line 1\nline 2\n" }), "no-commit").rerun).toBe("The last run made no commit. The last 20 lines of its result.md:\n\n```\nline 1\nline 2\n```");
  expect(rerunStep(stuck({ role: "land", cause: "check", reason: "tests" }, "r-none"), "land-checks").rerun).toContain("its checks log:\n\n```\n(empty)\n```");
});

test("hasWork: a branch whose only change is result.md is not work to rescue, as unit's branchFacts decides; one that changes code is", () => {
  const path = mkdtempSync(join(tmpdir(), "rescue-git-"));
  const g = (...a: string[]) => git(path, "-c", "user.name=t", "-c", "user.email=t@t", ...a);
  g("init", "-q", "-b", "main");
  g("commit", "-q", "--allow-empty", "-m", "base");
  const commit = (branch: string, file: string) => {
    g("checkout", "-q", "-b", branch, "main");
    writeFileSync(join(path, file), "x\n");
    g("add", file);
    g("commit", "-q", "-m", file);
  };
  commit("notes", "result.md");
  commit("code", "a.ts");
  const at = (branch: string) => hasWork({ r: run({ branch }), repo: { ...repo, path } });
  expect([at("notes"), at("code"), at("gone")]).toEqual([false, true, false]);
});
