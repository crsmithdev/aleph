// Acceptance with the hidden scenarios of a goal: the follow-up issue, the reviewer's set-asides, and a follow-up that fails.
import { expect, test } from "bun:test";
import { note, readList, writeHidden, writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import type { ScenarioCheck } from "./acceptance.ts";
import { readRecord, resultLine } from "./status.ts";
import { acceptanceStep } from "./factory.ts";
import { askOf } from "./ask.ts";
import { closeAgain, doneGoal, item, land, notes, runner, useAcceptanceFixture } from "./acceptance.fixture.ts";

useAcceptanceFixture();

const SCN = "1. the secret widget turns purple\n2. the hidden gizmo hums\n";
const seal = (id: number) => writeHidden({ key: "fac" }, `fac-${id}`, { "scenarios.md": SCN });
let checks = 0;
const scn = (output: string): ScenarioCheck => async () => { checks++; return { output }; };
const oneFail = scn("CHECK: pass scenario 1: ok\nCHECK: fail scenario 2: the gizmo makes no sound");
const all = () => readList({ key: "fac" })!.items;

test("a failed scenario files one follow-up with its text and observation; the goal stays done and is not checked again", async () => {
  checks = 0;
  const id = doneGoal("It works.");
  seal(id);
  const lines = await acceptanceStep(runner(0), undefined, oneFail);
  expect(issues.status(item(id))).toBe("done");
  expect(askOf(item(id))).toBeNull();
  const f = all().find((i) => i.fm.kind === "acceptance")!;
  expect(lines[0]).toContain(`filed the follow-up fac-${f.id}`);
  expect(issues.titleProblem(f.title)).toBeNull();
  expect(f.spec).toBe("");
  expect(f.request).toContain(`fac-${id} (thing)`);
  expect(f.request).toContain("2. the hidden gizmo hums");
  expect(f.request).toContain("Observed: the gizmo makes no sound");
  expect(f.request).not.toContain("widget");
  expect(notes(id)).toContain(`acceptance: fail at`);
  expect(notes(id)).toContain(`follow-up fac-${f.id}`);
  expect(readRecord("fac", id)).toMatchObject({ result: "fail", fails: 1, followup: `fac-${f.id}` });
  expect(resultLine("fac", id)).toBe(`acceptance: fail: scenario 2; follow-up fac-${f.id}`);
  // A later land and close: the record is final, so nothing runs and nothing more is filed.
  land(id);
  closeAgain(id);
  expect(await acceptanceStep(runner(0), undefined, oneFail)).toEqual([]);
  expect(checks).toBe(1);
  expect(all().filter((i) => i.fm.kind === "acceptance")).toHaveLength(1);
});

test("a scenario the reviewer set aside does not fail", async () => {
  const id = doneGoal("It works.");
  seal(id);
  note({ key: "fac" }, id, "sealed checks: the reviewer set aside: scenario 2 – it asks for more than the goal");
  const lines = await acceptanceStep(runner(0), undefined, oneFail);
  expect(lines[0]).toContain("acceptance passed");
  expect(lines[0]).toContain("scenario 2 set aside by the reviewer");
  expect(readRecord("fac", id)?.result).toBe("pass");
  expect(all().filter((i) => i.fm.kind === "acceptance")).toHaveLength(0);
});

test("a follow-up that fails acceptance opens again with an Ask that holds both failures, and files nothing", async () => {
  const id = doneGoal("It works.");
  seal(id);
  await acceptanceStep(runner(0), undefined, oneFail);
  const fid = all().find((i) => i.fm.kind === "acceptance")!.id;
  writeList({ key: "fac" }, "spec", (doc) => { issues.find(doc, fid)!.spec = "## Goal\nx\n## Edit surface\na.ts\n## Oracle\n`bun run bad`\n## Time box\n40 minutes"; return true; });
  land(fid);
  closeAgain(fid);
  const before = all().length;
  const lines = await acceptanceStep(runner(3, "boom"), undefined, oneFail);
  expect(lines.join("\n")).toContain(`fac-${fid}: acceptance failed at`);
  expect(lines.join("\n")).toContain("on a follow-up; asks Chris");
  expect(all().length).toBe(before);
  expect(issues.status(item(fid))).toBe("open");
  const ask = askOf(item(fid))!;
  expect(ask).toMatchObject({ kind: "input", reason: "acceptance-failed" });
  expect(ask.why.join("\n")).toContain("`bun run bad` exited 3");
  expect(ask.why.join("\n")).toContain("the gizmo makes no sound");
  expect(readRecord("fac", fid)).toMatchObject({ result: "fail", fails: 1 });
  expect(readRecord("fac", fid)?.followup).toBeUndefined();
});
