import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { find, pairs, resultContent } from "./transcripts.ts";

let base: string, saved: string | undefined;
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-transcripts-"));
  saved = process.env.ALEPH_CLAUDE_PROJECTS;
  process.env.ALEPH_CLAUDE_PROJECTS = base;
  mkdirSync(join(base, "-a"));
  mkdirSync(join(base, "-b"));
  writeFileSync(join(base, "-b", "s1.jsonl"), "");
});
afterAll(() => {
  if (saved === undefined) delete process.env.ALEPH_CLAUDE_PROJECTS;
  else process.env.ALEPH_CLAUDE_PROJECTS = saved;
  rmSync(base, { recursive: true, force: true });
});

test("find gives the file of a session in whichever project folder holds it, and nothing for an unknown id", () => {
  expect(find("s1")).toBe(join(base, "-b", "s1.jsonl"));
  expect(find("s2")).toBeUndefined();
});

test("find gives nothing when the projects folder is missing", () => {
  process.env.ALEPH_CLAUDE_PROJECTS = join(base, "none");
  expect(find("s1")).toBeUndefined();
  process.env.ALEPH_CLAUDE_PROJECTS = base;
});

test("pairs joins each tool call to its result by id, whichever block is missing", () => {
  const use = (id: string) => ({ type: "tool_use", id, name: "Read" }), res = (id: string) => ({ type: "tool_result", tool_use_id: id, content: id });
  const asked = { message: { content: [use("a"), use("b")] } }, answered = { message: { content: [res("b"), res("c")] } };
  const got = pairs([asked, answered, { message: { content: "text" } }, { type: "system" }]);
  expect([...got.keys()]).toEqual(["a", "b", "c"]);
  expect(got.get("a")).toEqual({ use: use("a"), useEntry: asked });
  expect(got.get("b")).toEqual({ use: use("b"), result: res("b"), useEntry: asked, resultEntry: answered });
  expect(got.get("c")).toEqual({ result: res("c"), resultEntry: answered });
});

test("a result's content joins its parts' text with a newline; a string stays as it is", () => {
  expect(resultContent([{ text: "a" }, { text: "b" }])).toBe("a\nb");
  expect(resultContent("a\nb")).toBe("a\nb");
});
