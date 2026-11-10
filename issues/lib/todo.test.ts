import { expect, test } from "bun:test";
import * as issues from "./todo.ts";
import { addPart } from "./parts.fixture.ts";
import { setCodes } from "../../lib/naming.ts";

test("titleProblem passes a part title with its group and refuses length, a final period and a prefix", () => {
  expect(issues.titleProblem("[Status layout] Put the metrics on the left", { part: true })).toBeNull();
  expect(issues.titleProblem("Fix the lane height")).toBeNull();
  expect(issues.titleProblem("[G] " + "a".repeat(57), { part: true })).toContain("60");
  expect(issues.titleProblem("[G] Fix it.", { part: true })).toContain("period");
  expect(issues.titleProblem("a".repeat(60))).toBeNull();
  expect(issues.titleProblem("Check foo: bar")).not.toBeNull();
  expect(issues.titleProblem("Fix it.")).not.toBeNull();
  expect(issues.titleProblem("[Group] Do the thing: now", { part: true })).toBeNull();
  expect(issues.titleProblem("Do the thing: now", { part: true })).toContain("': ' prefix");
  expect(issues.titleProblem("[Group] Do the thing: now")).toContain("': ' prefix");
});

test("add and edit refuse a bad title, and addPart refuses one over 60 with its group", () => {
  const doc = issues.blank("r");
  for (const bad of ["a".repeat(61), "Fix it.", "Check foo: bar"]) {
    expect(() => issues.add(doc, bad)).toThrow();
    expect(() => issues.edit(issues.add(doc, "Fix the lane"), { title: bad })).toThrow();
  }
  const parent = issues.add(doc, "Lay out the status page");
  expect(addPart(doc, parent, { title: "[Status layout] Put the metrics on the left", spec: "x" }).title).toBe("[Status layout] Put the metrics on the left");
  expect(() => addPart(doc, parent, { title: `[Status layout] ${"a".repeat(45)}`, spec: "x" })).toThrow("60");
});

test("add stores kind task by default, refuses an unknown kind, and addPart copies the parent's kind", () => {
  const doc = issues.blank("r");
  expect(issues.add(doc, "A").fm.kind).toBe("task");
  expect(() => issues.add(doc, "B", { kind: "epic" })).toThrow(issues.KINDS.join(", "));
  const bug = issues.add(doc, "C", { kind: "bug" });
  expect(addPart(doc, bug, { title: "[C] part", spec: "x" }).fm.kind).toBe("bug");
});

test("lint names the bad title of an open or parked item and a missing or unknown kind; fix moves kind areas into kind", () => {
  const doc = issues.blank("r");
  // Items from before the rule: the store holds titles that add now refuses.
  const item = (title: string, fm: Record<string, unknown>) => { const i = issues.add(doc, "Placeholder"); i.title = title; delete i.fm.kind; Object.assign(i.fm, fm); return i; };
  item("Fix the lane height", { kind: "task", areas: ["ui"] });
  item("a".repeat(61), { kind: "task" });
  item("Fix it.", { kind: "task", parked: "true" });
  item("Check foo: bar", { kind: "task", closed_as: "done" });
  item("Fix the flaky gate", { areas: ["flakes", "tests"] });
  item("Fix red main", { areas: ["red-main", "check"] });
  item("Old goal", { kind: "goal", areas: ["deps"] });
  const bug = item("Fix the bug", { areas: ["bug"] });
  const part = addPart(doc, bug, { title: "[Bug] Find the cause", spec: "x" });
  part.title = "[Bug] Find the cause: first";
  delete part.fm.kind;
  const found = (id: string) => issues.lint(doc).filter((f) => f.id === id).map((f) => f.problem);
  expect(found("1")).toEqual([]);
  expect(found("2")[0]).toContain("61 characters");
  expect(found("3")[0]).toContain("period");
  expect(found("4")).toEqual([]);
  expect(found("5")).toEqual(["kind is missing"]);
  expect(found("7")[0]).toContain('unknown kind "goal"');
  expect(found("8.1")).toEqual(["kind is missing"]);

  issues.fix(doc);
  expect(doc.items.map((i): unknown[] => [issues.refOf(i), i.fm.kind, i.fm.areas])).toEqual([
    ["1", "task", ["ui"]], ["2", "task", []], ["3", "task", []], ["4", "task", []],
    ["5", "flake", ["tests"]], ["6", "bug", ["red-main"]], ["7", "task", []], ["8", "bug", []], ["8.1", "bug", undefined],
  ]);
  expect(issues.lint(doc).filter((f) => f.fixable)).toEqual([]);
});

test("add and addPart store the filing time, and setStatus stores the closing time and a reopen removes it", () => {
  const doc: issues.Doc = { items: [] } as any;
  const a = issues.add(doc, "Do a thing", { now: new Date(2026, 10, 4, 14, 5) });
  expect(a.fm).toMatchObject({ created_time: new Date(2026, 10, 4, 14, 5).toISOString() });
  const p = addPart(doc, a, { title: "[C] part", spec: "x", now: new Date(2026, 10, 4, 14, 5) });
  expect(p.fm).toMatchObject({ created_time: new Date(2026, 10, 4, 14, 5).toISOString() });
  issues.setStatus(a, "done", new Date(2026, 10, 4, 15, 30));
  expect(a.fm).toMatchObject({ closed_time: new Date(2026, 10, 4, 15, 30).toISOString() });
  issues.setStatus(a, "open");
  expect(a.fm.closed_time).toBeUndefined();
});

test("edit leaves labels unset and lint reports no retired labels finding", () => {
  const doc = issues.blank("r");
  const item = issues.add(doc, "Fix the lane");
  issues.edit(item, { title: "Fix the lane height", priority: "high", areas: ["ui"], labels: ["ui"] } as any);
  expect(item.fm.labels).toBeUndefined();
  expect(issues.lint(doc).filter((f) => f.problem.includes("labels is retired"))).toEqual([]);
});

test("localRefs shows each id as its short id and keeps the id of a project with no code", () => {
  setCodes({ aleph: "a" });
  expect(issues.localRefs("aleph", "after aleph-12, koans-3")).toBe("after a12, koans-3");
  setCodes({});
});

test("edit takes the title it already has, even a bad one, and still refuses another bad title", () => {
  const doc = issues.blank("r");
  const item = issues.add(doc, "Fix the lane");
  item.title = "Check foo: bar";
  issues.edit(item, { title: "Check foo: bar", priority: "high" });
  expect(item.fm.priority).toBe("high");
  expect(() => issues.edit(item, { title: "Check baz: bar" })).toThrow("': ' prefix");
});

test("add, note and setStatus write ISO UTC times and no date-only fields, and lint passes them", () => {
  const doc = issues.blank("r");
  const now = new Date(Date.UTC(2026, 10, 4, 15, 30, 5));
  const item = issues.add(doc, "A", { now });
  const line = issues.note(item, "x", now);
  issues.setStatus(item, "done", now);
  expect([item.fm.created_time, item.fm.updated_time, item.fm.closed_time]).toEqual(Array(3).fill("2026-11-04T15:30:05.000Z"));
  expect(line).toBe("- 2026-11-04T15:30:05.000Z: x");
  for (const k of ["created", "updated", "closed_at"]) expect(item.fm[k]).toBeUndefined();
  expect(issues.lint(doc)).toEqual([]);
});

test("fix converts local times and note stamps to ISO UTC and drops the date-only fields", () => {
  const doc = issues.blank("r");
  const item = issues.add(doc, "A");
  Object.assign(item.fm, { created: "2026-11-04", created_time: "2026-11-04 15:30", updated: "2026-11-04", closed_at: "2026-11-04" });
  delete item.fm.updated_time;
  item.notes = ["- 2026-11-04 16:00: x"];
  expect(issues.lint(doc).length).toBeGreaterThan(0);
  issues.fix(doc);
  const at = (h: number, m: number) => new Date(2026, 10, 4, h, m).toISOString();
  expect(item.fm.created_time).toBe(at(15, 30));
  expect(item.fm.updated_time).toBe(at(0, 0));
  expect(item.fm.closed_time).toBe(at(0, 0));
  expect(item.notes).toEqual([`- ${at(16, 0)}: x`]);
  for (const k of ["created", "updated", "closed_at"]) expect(item.fm[k]).toBeUndefined();
  expect(issues.lint(doc)).toEqual([]);
});

test("lint reports an item without created_time or with a non-ISO time", () => {
  const doc = issues.blank("r");
  const item = issues.add(doc, "A");
  delete item.fm.created_time;
  expect(issues.lint(doc).map((f) => f.problem)).toContain("created_time is missing");
  item.fm.created_time = "2026-11-04 15:30";
  expect(issues.lint(doc).find((f) => f.problem.startsWith("created_time"))?.fixable).toBe(true);
  item.fm.created_time = "soon";
  expect(issues.lint(doc).find((f) => f.problem.startsWith("created_time"))).toMatchObject({ problem: 'created_time "soon" is not an ISO UTC time', fixable: false });
  item.notes.push("- 2026-11-04 16:00: x");
  expect(issues.lint(doc).map((f) => f.problem)).toContain("a note stamp is not an ISO UTC time");
});

test("created, updated and closed read ISO UTC, convert old local times and fall back to the old date fields", () => {
  const now = new Date("2026-11-04T15:30:00.000Z");
  const item = issues.add(issues.blank("r"), "Fix the lane", { now });
  expect([issues.created(item), issues.updated(item), issues.closed(item)]).toEqual([now.toISOString(), now.toISOString(), undefined]);
  issues.setStatus(item, "done", now);
  expect(issues.closed(item)).toBe(now.toISOString());
  const old = issues.parseItem("---\nid: r-2\ntitle: Old\ncreated: 2026-11-01\nupdated_time: 2026-11-02 09:07\nclosed_as: done\nclosed_at: 2026-11-03\n---\n");
  expect(issues.created(old)).toBe(new Date(2026, 10, 1).toISOString());
  expect(issues.updated(old)).toBe(new Date(2026, 10, 2, 9, 7).toISOString());
  expect(issues.closed(old)).toBe(new Date(2026, 10, 3).toISOString());
  issues.setStatus(old, "open");
  expect(issues.closed(old)).toBeUndefined();
  expect(issues.created(issues.parseItem("---\nid: r-3\ntitle: None\n---\n"))).toBeUndefined();
});

test("kindOf reads task for none, and sinceOf reads since or undefined", () => {
  const item = issues.parseItem("---\nid: r-1\ntitle: Bare\n---\n");
  expect([issues.kindOf(item), issues.sinceOf(item)]).toEqual(["task", undefined]);
  item.fm.kind = "bug";
  item.fm.since = "abc1234";
  expect([issues.kindOf(item), issues.sinceOf(item)]).toEqual(["bug", "abc1234"]);
});
