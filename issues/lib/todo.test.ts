import { expect, test } from "bun:test";
import * as issues from "./todo.ts";
import { addPart } from "./parts.fixture.ts";

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
  const doc = issues.blank("r", "project.1");
  // Items from before the rule: the store holds titles that add now refuses.
  const item = (title: string, fm: Record<string, unknown>) => { const i = issues.add(doc, "Placeholder"); i.title = title; delete i.fm.kind; Object.assign(i.fm, fm); return i; };
  const lane = item("Fix the lane height", { kind: "task", areas: ["ui"] });
  const long = item("a".repeat(61), { kind: "task" });
  const dot = item("Fix it.", { kind: "task", parked: "true" });
  const closed = item("Check foo: bar", { kind: "task", closed_as: "done" });
  const noKind = item("Fix the flaky gate", { areas: ["flakes", "tests"] });
  item("Fix red main", { areas: ["red-main", "check"] });
  const goal = item("Old goal", { kind: "goal", areas: ["deps"] });
  const bug = item("Fix the bug", { areas: ["bug"] });
  item("Teach the gate", { kind: "proposal", areas: ["proposal"] });
  const acceptance = item("Accept the lane", { kind: "acceptance", areas: ["flakes"] });
  const proposal = item("Plan the gate", { kind: "proposal", areas: ["bug"] });
  const part = addPart(doc, bug, { title: "[Bug] Find the cause", spec: "x" });
  part.title = "[Bug] Find the cause: first";
  delete part.fm.kind;
  const found = (i: issues.Issue) => issues.lint(doc).filter((f) => f.id === issues.refOf(i)).map((f) => f.problem);
  expect(found(lane)).toEqual([]);
  expect(found(long)[0]).toContain("61 characters");
  expect(found(dot)[0]).toContain("period");
  expect(found(closed)).toEqual([]);
  expect(found(noKind)).toEqual(["kind is missing"]);
  expect(found(goal)[0]).toContain('unknown kind "goal"');
  expect(found(acceptance)[0]).toContain('unknown kind "acceptance"');
  expect(found(part)).toEqual(["kind is missing"]);

  issues.fix(doc);
  expect(doc.items.map((i): unknown[] => [i.fm.kind, i.fm.areas])).toEqual([
    ["task", ["ui"]], ["task", []], ["task", []], ["task", []],
    ["flake", ["tests"]], ["bug", ["red-main"]], ["task", []], ["bug", []], ["task", []], ["task", []], ["task", []], ["bug", []],
  ]);
  expect([acceptance, proposal].map((i) => i.fm.kind)).toEqual(["task", "task"]);
  expect(issues.lint(doc).filter((f) => f.fixable)).toEqual([]);
});

// Breaks if lint stops checking refs the way it checks after.
test("lint flags a refs entry that is not issue.<n>, and passes one that is", () => {
  const doc = issues.blank("r", "project.1");
  const good = issues.add(doc, "Good refs"), bad = issues.add(doc, "Bad refs");
  good.fm.refs = ["issue.3"];
  bad.fm.refs = ["issue.3", "a-7"];
  const found = (i: issues.Issue) => issues.lint(doc).filter((f) => f.id === issues.refOf(i)).map((f) => f.problem);
  expect(found(good)).toEqual([]);
  expect(found(bad)).toEqual(["refs: issue.3, a-7 is not issue.<n>"]);
});

test("add and addPart store the filing time, and setStatus stores the closing time and a reopen removes it", () => {
  const doc = issues.blank("r");
  const a = issues.add(doc, "Do a thing", { now: new Date(2026, 10, 4, 14, 5) });
  expect(a.fm).toMatchObject({ created: new Date(2026, 10, 4, 14, 5).toISOString() });
  const p = addPart(doc, a, { title: "[C] part", spec: "x", now: new Date(2026, 10, 4, 14, 5) });
  expect(p.fm).toMatchObject({ created: new Date(2026, 10, 4, 14, 5).toISOString() });
  issues.setStatus(a, "done", new Date(2026, 10, 4, 15, 30), "shipped");
  expect(a.fm).toMatchObject({ closed_as: "done", closed_at: new Date(2026, 10, 4, 15, 30).toISOString(), closed_why: "shipped" });
  issues.setStatus(a, "open");
  expect(Object.keys(a.fm).filter((k) => k.startsWith("closed"))).toEqual([]);
});

test("edit leaves labels unset and lint reports no retired labels finding", () => {
  const doc = issues.blank("r");
  const item = issues.add(doc, "Fix the lane");
  issues.edit(item, { title: "Fix the lane height", priority: "high", areas: ["ui"], labels: ["ui"] } as any);
  expect(item.fm.labels).toBeUndefined();
  expect(issues.lint(doc).filter((f) => f.problem.includes("labels is retired"))).toEqual([]);
});

test("localRefs shows each id of the repo as its shown key, with the code or I, and leaves other text", () => {
  expect(issues.localRefs("aleph", "after aleph-12, koans-3", "a")).toBe("after a-00012, koans-3");
  expect(issues.localRefs("koans", "koans-3 waits for koans-12")).toBe("I-00003 waits for I-00012");
});

test("edit takes the title it already has, even a bad one, and still refuses another bad title", () => {
  const doc = issues.blank("r");
  const item = issues.add(doc, "Fix the lane");
  item.title = "Check foo: bar";
  issues.edit(item, { title: "Check foo: bar", priority: "high" });
  expect(item.fm.priority).toBe("high");
  expect(() => issues.edit(item, { title: "Check baz: bar" })).toThrow("': ' prefix");
});

test("add, note and setStatus write one date set in ISO UTC, and lint passes it", () => {
  const doc = issues.blank("r", "project.1");
  const now = new Date(Date.UTC(2026, 10, 4, 15, 30, 5));
  const item = issues.add(doc, "A", { now });
  const line = issues.note(item, "x", now);
  issues.setStatus(item, "done", now);
  expect([item.fm.created, item.fm.closed_at]).toEqual(Array(2).fill("2026-11-04T15:30:05.000Z"));
  expect(line).toBe("- 2026-11-04T15:30:05.000Z: x");
  for (const k of ["id", "was", "created_time", "updated_time", "closed_time", "updated"]) expect(item.fm[k]).toBeUndefined();
  expect(issues.lint(doc)).toEqual([]);
});

test("fix drops the id, was and updated fields and renames the old time fields", () => {
  const doc = issues.blank("r", "project.1");
  const item = issues.add(doc, "A");
  const at = "2026-11-04T15:30:00.000Z";
  delete item.fm.created;
  Object.assign(item.fm, { id: "r-2", was: "old-2", created_time: at, updated_time: at, closed_as: "done", closed_time: at });
  expect(issues.lint(doc).filter((f) => !f.fixable)).toEqual([]);
  issues.fix(doc);
  expect(item.fm).toMatchObject({ created: at, closed_at: at });
  for (const k of ["id", "was", "created_time", "updated_time", "closed_time"]) expect(item.fm[k]).toBeUndefined();
  expect(issues.lint(doc)).toEqual([]);
});

test("lint reports an item without created or with a non-ISO time, and a project it lacks", () => {
  const doc = issues.blank("r", "project.1");
  const item = issues.add(doc, "A");
  delete item.fm.created;
  expect(issues.lint(doc).map((f) => f.problem)).toContain("created is missing");
  item.fm.created = "soon";
  expect(issues.lint(doc).find((f) => f.problem.startsWith("created"))).toMatchObject({ problem: 'created "soon" is not an ISO UTC time', fixable: false });
  item.fm.created = "2026-11-04T15:30:00.000Z";
  delete item.fm.project;
  expect(issues.lint(doc).find((f) => f.problem === "project is missing")?.fixable).toBe(true);
});

test("created and closed read the stored times, and updated is the latest of them and the last note", () => {
  const now = new Date("2026-11-04T15:30:00.000Z");
  const item = issues.add(issues.blank("r"), "Fix the lane", { now });
  expect([issues.created(item), issues.updated(item), issues.closed(item)]).toEqual([now.toISOString(), now.toISOString(), undefined]);
  issues.note(item, "later", new Date("2026-11-05T00:00:00.000Z"));
  expect(issues.updated(item)).toBe("2026-11-05T00:00:00.000Z");
  issues.setStatus(item, "done", new Date("2026-11-06T00:00:00.000Z"));
  expect(issues.closed(item)).toBe("2026-11-06T00:00:00.000Z");
  issues.setStatus(item, "open");
  expect(issues.closed(item)).toBeUndefined();
  expect(issues.created(issues.parseItem(3, "---\ntitle: None\n---\n"))).toBeUndefined();
});

test("kindOf reads task for none, and sinceOf reads since or undefined", () => {
  const item = issues.parseItem(1, "---\ntitle: Bare\n---\n");
  expect([issues.kindOf(item), issues.sinceOf(item)]).toEqual(["task", undefined]);
  item.fm.kind = "bug";
  item.fm.since = "abc1234";
  expect([issues.kindOf(item), issues.sinceOf(item)]).toEqual(["bug", "abc1234"]);
});

test("an issue renders with the headings and parses back to the same issue", () => {
  const doc = issues.blank("r", "project.2");
  const item = issues.add(doc, "Fix: the lane".replace(": ", " "), { request: "Make it wider.\n\n# Spec\nnot a heading", spec: "## Goal\nWide.\n\n## Edit surface\n- a.ts\n\n## Oracle\n- it is wide", source: "worker", after: ["issue.3"], from: "issue.1" });
  issues.note(item, "a remark: with a colon", new Date("2026-11-04T15:30:05.000Z"));
  const text = issues.renderItem(item);
  expect(text.split("\n").filter((l) => l.startsWith("# "))).toEqual(["# Request", "# Spec", "# Notes"]);
  expect(text.startsWith("---\nproject: project.2\ntitle: Fix the lane\nkind: task\npriority: medium\nsource: worker\ncreated: ")).toBe(true);
  expect(text).not.toMatch(/^(id|was|updated)/m);
  expect(issues.parseItem(item.id, text)).toEqual(item);
  expect(issues.renderItem(issues.parseItem(item.id, text))).toBe(text);
  expect(issues.parentRef(item)).toBe("1");
});

test("a child is an issue with from: its parent and no number of its own under the parent", () => {
  const doc = issues.blank("r", "project.1");
  const parent = issues.add(doc, "Lay out the page");
  const child = addPart(doc, parent, { title: "[Page] Put the metrics left", spec: "x" });
  expect(child.id).not.toBe(parent.id);
  expect(issues.parentRef(child)).toBe(String(parent.id));
  expect(issues.parentRef(parent)).toBeUndefined();
  expect(issues.find(doc, `issue.${child.id}`)).toBe(child);
});

test("a number comes from the counter above the floor and the issues of the list, and a number is never reused", () => {
  const doc = issues.blank("r", "project.1");
  doc.floor = 5000;
  const a = issues.add(doc, "A");
  expect(a.id).toBeGreaterThan(5000);
  doc.items.pop();
  doc.floor = 0;
  const b = issues.add(doc, "B");
  expect(b.id).toBe(a.id + 1);
});
