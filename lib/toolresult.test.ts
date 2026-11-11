import { expect, test } from "bun:test";
import { resultContent, resultEntries } from "./toolresult.ts";

test("content joins its parts' text with a newline; a string stays as it is", () => {
  expect(resultContent([{ text: "a" }, { text: "b" }])).toBe("a\nb");
  expect(resultContent("a\nb")).toBe("a\nb");
});

test("the map gives the user entry of each tool_use id", () => {
  const one = { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "x" }] } };
  const two = { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: "y" }] } };
  const asst = { type: "assistant", message: { content: [{ type: "tool_use", id: "t3" }] } };
  const map = resultEntries([one, asst, two]);
  expect(map.get("t1")).toBe(one);
  expect(map.get("t2")).toBe(two);
  expect(map.size).toBe(2);
});
