// The firefighter's reply and prompt: parseReply, the prompt's rules, and the flake action.
import { expect, test } from "bun:test";
import { areasOf, readList } from "../../todo/lib/store.ts";
import { applyActions, parseReply, prompt } from "./firefighter.ts";
import { fresh, key, log, ports, reply, useFirefighterFixture } from "./firefighter.fixture.ts";

useFirefighterFixture();

test("parseReply reads each action, and names a malformed one", () => {
  expect(parseReply('Here: {"actions":[{"do":"tell","text":"hi"},{"do":"land"}]}')).toEqual([{ do: "tell", text: "hi" }, "land without a job"]);
  expect(parseReply("nothing")).toBe("no JSON object with an actions list");
});

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

test("answer keeps after in parse, and leaves it out when absent", () => {
  const a = { do: "answer" as const, repo: "ff", n: 1, note: "x" };
  expect(parseReply(JSON.stringify({ actions: [{ ...a, after: ["ff-2.1"] }] }))).toEqual([{ ...a, after: ["ff-2.1"] }]);
  expect(parseReply(JSON.stringify({ actions: [a] }))).toEqual([a]);
});

test("parseReply reads a flake action and refuses one with no text", () => {
  expect(parseReply('{"actions":[{"do":"flake","repo":"r","text":"a.test.ts > t: slow"},{"do":"flake","repo":"r"}]}')).toEqual([{ do: "flake", repo: "r", text: "a.test.ts > t: slow" }, "flake without a repo and text"]);
});

test("a flake action notes the repo's flake tracker, makes it when missing, files no other item, and logs it", async () => {
  fresh([{ title: "other" }]);
  reply([{ do: "flake", repo: key, text: "a.test.ts > t: timed out" }, { do: "flake", repo: key, text: "b.test.ts > u: slow" }]);
  const f = await applyActions([{ do: "flake", repo: key, text: "a.test.ts > t: timed out" }, { do: "flake", repo: key, text: "b.test.ts > u: slow" }], ports());
  const items = readList({ key })!.items;
  expect(items.length).toBe(2);
  const tracker = items.find((i) => areasOf(i).includes("flakes"))!;
  expect(tracker.notes.filter((x) => x.includes("firefighter: ")).length).toBe(2);
  expect(tracker.notes.join("\n")).toContain("firefighter: a.test.ts > t: timed out");
  expect(f.applied.length).toBe(2);
  expect(log()).toContain(`firefighter: did flake ${key}: a.test.ts > t: timed out`);
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
