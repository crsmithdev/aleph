// Archived goal tests from jobs/lib/firefighter.reply.test.ts: `bun run accept` runs them, `bun run test` does not.
// The firefighter's reply and prompt: parseReply, the prompt's rules, and the flake action.
import { expect, test } from "bun:test";
import { parseReply, prompt } from "../../../jobs/lib/firefighter.ts";
import { key, useFirefighterFixture } from "../../../jobs/lib/firefighter.fixture.ts";

useFirefighterFixture();

test("parse keeps well-formed goal ids in after, ignores malformed ones, and refuses an edit-goal with neither body nor after", () => {
  expect(parseReply(JSON.stringify({ actions: [{ do: "drop", job: "x-1", reason: "r", after: ["Not A Ref", "ff-2"] }] }))).toEqual([{ do: "drop", job: "x-1", reason: "r", after: ["ff-2"] }]);
  expect(parseReply(JSON.stringify({ actions: [{ do: "drop", job: "x-1", reason: "r", after: ["ff-2.1"] }] }))).toEqual([{ do: "drop", job: "x-1", reason: "r", after: ["ff-2.1"] }]);
  expect(parseReply(JSON.stringify({ actions: [{ do: "edit-goal", repo: "ff", n: 1 }] }))).toEqual(["edit-goal without a repo, n, and a body or after"]);
});

test("the firefighter prompt limits the Goal of a spec it writes to 3 sentences with no implementation design", () => {
  const p = prompt([]);
  expect(p).toContain("is the behaviour in at most 3 sentences");
  expect(p).toContain("no implementation design");
  expect(p).toContain("no claim about code on main that you did not read");
});

test("the firefighter has no answer or land action: Asks are the director's", () => {
  expect(parseReply(JSON.stringify({ actions: [{ do: "answer", repo: "ff", n: 1, note: "x" }, { do: "land", job: "ff-1" }] }))).toEqual(['unknown action "answer"', 'unknown action "land"']);
  expect(prompt([])).toContain("Asks (runs and issues that wait for Chris) are the director's");
});

test("prompt names the flake action and offers add only with a red event", () => {
  const p = prompt([]);
  expect(p).toContain('{"do": "flake"');
  expect(p).not.toContain('{"do": "add"');
  expect(p).not.toContain("with add");
  expect(prompt([{ key: "ci:r:abc", kind: "red", repo: key, line: "r CI red" }])).toContain('{"do": "add"');
  expect(p).not.toContain("File every follow-up you find as an issue");
});

test("parseReply keeps a known fate on a drop and leaves an unknown one off", () => {
  const p = (fate: string) => parseReply(JSON.stringify({ actions: [{ do: "drop", job: "x-1", reason: "r", fate }] }));
  expect(p("duplicate")).toEqual([{ do: "drop", job: "x-1", reason: "r", fate: "duplicate" }]);
  expect(p("bogus")).toEqual([{ do: "drop", job: "x-1", reason: "r" }]);
});
