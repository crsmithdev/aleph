// The firefighter's reply and prompt: parseReply, the prompt's rules, and the flake action.
import { expect, test } from "bun:test";
import { areasOf, readList } from "../../todo/lib/store.ts";
import { applyActions, parseReply } from "./firefighter.ts";
import { fresh, key, log, ports, reply, useFirefighterFixture } from "./firefighter.fixture.ts";

useFirefighterFixture();

test("parseReply reads each action, and names a malformed one", () => {
  expect(parseReply('Here: {"actions":[{"do":"tell","text":"hi"},{"do":"land"}]}')).toEqual([{ do: "tell", text: "hi" }, "land without a job"]);
  expect(parseReply("nothing")).toBe("no JSON object with an actions list");
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
  const tracker = items.find((i) => i.fm.kind === "flake")!;
  expect(areasOf(tracker)).toEqual([]);
  expect(tracker.notes.filter((x) => x.includes("firefighter: ")).length).toBe(2);
  expect(tracker.notes.join("\n")).toContain("firefighter: a.test.ts > t: timed out");
  expect(f.applied.length).toBe(2);
  expect(log()).toContain(`firefighter: did flake ${key}: a.test.ts > t: timed out`);
});

test("parseReply reads a plan child's n as the string <n>.<k>, so 1102.10 stays apart from 1102.1", () => {
  const one = (n: unknown) => parseReply(JSON.stringify({ actions: [{ do: "edit-goal", repo: "r", n, body: "b" }] }));
  expect(one("1102.3")).toEqual([{ do: "edit-goal", repo: "r", n: "1102.3", body: "b" }]);
  expect(one("1102.10")).toEqual([{ do: "edit-goal", repo: "r", n: "1102.10", body: "b" }]);
  expect(one(7)).toEqual([{ do: "edit-goal", repo: "r", n: 7, body: "b" }]);
  expect(one("1102.x")).toEqual(["edit-goal without a repo, n, and a body or after"]);
});

test("the prompt's action lines tell the model to quote a plan child's number", async () => {
  expect(await Bun.file(new URL("./firefighter.ts", import.meta.url)).text()).toContain('"n": <n> or "<n>.<k>"');
});
