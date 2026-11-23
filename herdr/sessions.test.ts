import { expect, test } from "bun:test";
import { pending, record, sort } from "./sessions.ts";

const ask = (id: string) => ({ type: "assistant", timestamp: "2026-11-23T10:00:00Z", message: { content: [{ type: "tool_use", id, name: "AskUserQuestion", input: { questions: [{ question: "Which store?", options: [{ label: "db" }, { label: "file" }] }] } }] } });
const result = (id: string) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "db" }] } });
const say = (text: string) => ({ type: "assistant", timestamp: "2026-11-23T10:00:00Z", message: { content: [{ type: "text", text }] } });

test("a last paragraph with a question line asks, and the last such line is the text", () => {
  const r = sort("Done.\n\nIs the name fine?\nShall I merge **it**?");
  expect(r.kind).toBe("asks");
  expect(r.text).toBe("Shall I merge it?");
  expect(r.opts.map((o) => o.send)).toEqual(["yes", "no"]);
});

test("a question ends with ? even after a closing backtick, bracket or star", () => {
  expect(sort("Use `a`? )**").kind).toBe("asks");
});

test("a last paragraph with two numbered lines is a choice, headed by the line before", () => {
  const r = sort("Pick one:\n1. keep\n2) drop");
  expect(r).toMatchObject({ kind: "choice", text: "Pick one:" });
  expect(r.opts).toEqual([{ label: "1", send: "1" }, { label: "2", send: "2" }]);
});

test("a choice without a line before its list takes the first numbered line", () => {
  expect(sort("Intro.\n\n1. keep\n2. drop").text).toBe("1. keep");
});

test("a numbered list followed by a closing sentence is plain", () => {
  expect(sort("1. keep\n2. drop\n\nTell me when it is done.")).toEqual({ kind: "plain", text: "Tell me when it is done.", opts: [] });
});

test("a ? inside code earlier in the answer does not count", () => {
  expect(sort("```ts\nconst a = b ?\n  c : d;\nx?\n```\n\nThe branch is merged.").kind).toBe("plain");
});

test("a text of more than 200 chars is cut with an ellipsis", () => {
  const t = sort("x".repeat(300)).text;
  expect([t.length, t.at(-1)]).toEqual([200, "…"]);
});

test("a pending AskUserQuestion gives its question and numbered options", () => {
  expect(pending([ask("a")] as any)).toEqual({ text: "Which store?", opts: [{ label: "db", key: "1" }, { label: "file", key: "2" }] });
});

test("an AskUserQuestion with a tool_result after it is not pending", () => {
  expect(pending([ask("a"), result("a")] as any)).toBeNull();
});

test("a blocked terminal ends its options with esc, and falls back to its status message", () => {
  const got = { status: { state: "blocked", msg: "Run rm?" }, labels: {} };
  expect(record("t1", got, [])).toMatchObject({ kind: "dialog", text: "Run rm?", opts: [{ label: "yes", key: "1" }, { label: "esc", key: "esc" }] });
  expect(record("t1", got, [ask("a")] as any).opts.map((o) => o.key)).toEqual(["1", "2", "esc"]);
});

test("a done terminal is sorted by its last answer, and without a transcript by its message", () => {
  const got = { status: { state: "done", msg: "m" }, labels: { "claude-resume.session": "s" } };
  expect(record("t1", got, [say("Shall I go on?")] as any)).toMatchObject({ kind: "asks", session: "s", at: Date.parse("2026-11-23T10:00:00Z") });
  expect(record("t1", got, [])).toMatchObject({ kind: "plain", text: "m", at: null });
});
