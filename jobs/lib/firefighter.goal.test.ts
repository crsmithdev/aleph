// The firefighter's edit of a goal: its after, its spec, and the spec-check Ask it may answer at most MAX_SPEC_EDITS times.
import { expect, test } from "bun:test";
import { applyActions, parseReply, snapshot, type Action } from "./firefighter.ts";
import * as issues from "../../todo/lib/todo.ts";
import { readList, writeList } from "../../todo/lib/store.ts";
import { alwaysFile, asked, dropped, FIREFIGHTER, fresh, item, key, plain, ports, run, useFirefighterFixture } from "./firefighter.fixture.ts";

useFirefighterFixture();

test("an after naming no goal is refused", async () => {
  fresh([{ title: "goal", goal: true }]);
  const r = await applyActions([{ do: "edit-goal", repo: key, n: 1, after: [`${key}-9.1`] }], ports());
  expect(r.refused).toEqual([expect.stringContaining("names no issue")]);
});

test("a handed spec-check Ask is an event with handed set, and the firefighter's edit-goal clears it and stores the spec", async () => {
  fresh([{ title: "goal", body: "Ship the thing.\n", goal: true, ask: { ...plain(), reason: "spec-check" } }]);
  alwaysFile({ "spec-check": FIREFIGHTER });
  expect(snapshot().find((x) => x.kind === "ask")).toMatchObject({ reason: "spec-check", handed: true });
  const r = await applyActions([{ do: "edit-goal", repo: key, n: 1, body: "## Goal\nShip.\n## Edit surface\na.ts\n## Oracle\nIt ships.\n" }], ports());
  expect(r.refused).toEqual([]);
  expect(item(1).spec).toContain("## Oracle");
  expect(asked(1)).toBeFalsy();
});

/** The actions of a model reply, as the firefighter parses it: a refused one fails the test. */
const reply = (actions: object[]): Action[] => (parseReply(JSON.stringify({ actions })) as (Action | string)[]).map((a) => { if (typeof a === "string") throw new Error(a); return a; });

/** An open issue 1 with an open plan child 1.<sub>, written as the store does. */
function withChild(sub: number): void {
  fresh([{ title: "parent" }]);
  writeList({ key }, "child", (doc) => {
    const c = { ...issues.add(doc, "child", { spec: "Ship the child." }), id: 1, sub };
    doc.items = doc.items.filter((i) => i !== c).concat(c);
    return true;
  }, true);
}

test("a note and an edit-goal on an open plan child apply to the child, and a whole n still applies", async () => {
  withChild(3);
  const r = await applyActions(reply([
    { do: "note", repo: key, n: "1.3", text: "hello child" },
    { do: "edit-goal", repo: key, n: "1.3", body: "## Goal\nNew child goal.\n" },
    { do: "note", repo: key, n: 1, text: "hello whole" },
  ]), ports());
  expect(r.refused).toEqual([]);
  expect(r.applied.length).toBe(3);
  const doc = readList({ key })!;
  const child = doc.items.find((i) => i.id === 1 && i.sub === 3)!;
  expect(child.notes.join("\n")).toContain("firefighter: hello child");
  expect(child.spec).toContain("New child goal.");
  const whole = doc.items.find((i) => i.id === 1 && i.sub === undefined)!;
  expect(whole.notes.join("\n")).toContain("firefighter: hello whole");
  expect(whole.notes.join("\n")).not.toContain("hello child");
});

test("a close on a plan child drops the open job whose issueOf is 1.3", async () => {
  withChild(3);
  const name = `${key}-1.3`;
  run({ name, condition: "stuck", reason: "no commit", on: `${key}-1.3` }, {}, 2);
  const r = await applyActions(reply([{ do: "close", repo: key, n: "1.3", note: "met" }]), ports());
  expect(r.refused).toEqual([]);
  expect(dropped.map((d) => d.name)).toEqual([name]);
  const child = readList({ key })!.items.find((i) => i.id === 1 && i.sub === 3)!;
  expect(issues.status(child)).toBe("done");
});
