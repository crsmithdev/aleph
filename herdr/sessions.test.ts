import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { found, pending, record, scan, sort } from "./sessions.ts";

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

test("a last line that says go, or follows Next action: with a verb for the person, asks", () => {
  expect(sort("Done.\n\nNext action: say go for step 6.")).toEqual({ kind: "asks", text: "Next action: say go for step 6.", opts: [{ label: "go", send: "go" }] });
  expect(sort("Done.\n\nSay go when ready.").opts).toEqual([{ label: "go", send: "go" }]);
  expect(sort("Done.\n\n**Next action:** tell me what you saw.")).toMatchObject({ kind: "asks", opts: [] });
  expect(sort("Done.\n\nNext action: pick 1, 2 or 3.")).toMatchObject({ kind: "asks", opts: [] });
});

test("a Next action: line that names no act for the person, and a plain summary, stay plain", () => {
  expect(sort("Done.\n\nNext action: none.").kind).toBe("plain");
  expect(sort("Done.\n\nNext action: I will run the suite.").kind).toBe("plain");
  expect(sort("The branch is merged and the tests pass.").kind).toBe("plain");
  expect(sort("Say go when ready.\n\nThe branch is merged.").kind).toBe("plain");
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

test("a blocked terminal ends its options with esc, and, with no question options, falls back to its status message and esc alone", () => {
  const got = { status: { state: "blocked", msg: "Run rm?" }, labels: {} };
  expect(record("t1", got, [])).toMatchObject({ kind: "dialog", text: "Run rm?", opts: [{ label: "esc", key: "esc" }] });
  expect(record("t1", got, [ask("a")] as any).opts.map((o) => o.key)).toEqual(["1", "2", "esc"]);
});

test("a done terminal is sorted by its last answer, and without a transcript by its message", () => {
  const got = { status: { state: "done", msg: "m" }, labels: { "claude-resume.session": "s" } };
  expect(record("t1", got, [say("Shall I go on?")] as any)).toMatchObject({ kind: "asks", session: "s", at: Date.parse("2026-11-23T10:00:00Z") });
  expect(record("t1", got, [])).toMatchObject({ kind: "plain", text: "m", at: null });
});

test("a terminal started by another carries its parent's address, and others carry null", () => {
  const got = { status: { state: "done", msg: "ok" }, labels: {} };
  expect(record("t3y", { ...got, parent: "t3g" }, [])).toMatchObject({ address: "t3y", parent: "t3g", kind: "plain", text: "ok" });
  expect(record("t3g", { ...got, parent: null }, []).parent).toBeNull();
});

const use = (id: string, name: string, input: object) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const out = (id: string, content: unknown) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content }] } });
const file = (...lines: object[]) => {
  const f = join(mkdtempSync(join(tmpdir(), "sessions-")), "s.jsonl");
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n"));
  return f;
};
const obj = (n: number, title: string) => JSON.stringify({ repo: "aleph", added: n, title, commit: "abc" }, null, 2);

test("an aleph issue add result with two objects gives two issues, and a failed add gives none", () => {
  const s = scan(file(
    use("a", "Bash", { command: "aleph issue add --title x && aleph issue add --title y" }),
    out("a", `${obj(1, "First {braced}")}\n${obj(2, "Second")}`),
    use("b", "Bash", { command: "aleph issue add --title z" }),
    out("b", "error: no repo named zz"),
    use("c", "Bash", { command: "ls" }),
    out("c", obj(9, "not an add")),
  ));
  expect(s.added).toEqual([{ repo: "aleph", n: 1, title: "First {braced}" }, { repo: "aleph", n: 2, title: "Second" }]);
});

test("a shelf put by the MCP tool or the CLI gives its item id", () => {
  const s = scan(file(
    use("a", "mcp__shelf__put", { title: "Mock", path: "/x" }),
    out("a", [{ type: "text", text: '{"id":"20261121-212835-e5bq","url":"/shelf/i/20261121-212835-e5bq/"}' }]),
    use("b", "Bash", { command: "shelf put /x --title y" }),
    out("b", "ok\n20261121-194453-v4ql http://127.0.0.1:3020/shelf/i/20261121-194453-v4ql/"),
    use("c", "Bash", { command: "shelf put /x" }),
    out("c", "error: no such file"),
  ));
  expect(s.puts).toEqual([{ id: "20261121-212835-e5bq", title: "Mock" }, { id: "20261121-194453-v4ql" }]);
});

test("found takes shelf titles from the server, else the put input, else the id, and an issue stage from the lookup", () => {
  const scanned = { added: [{ repo: "aleph", n: 1, title: "T" }, { repo: "aleph", n: 2, title: "U" }], puts: [{ id: "20261121-212835-e5bq", title: "Mock" }, { id: "20261121-194453-v4ql" }] };
  const r = found(scanned, new Map([["aleph-1", "done"]]), new Map([["20261121-212835-e5bq", { title: "Served", pending: 2 }]]));
  expect(r.issues.map((i) => [i.title, i.stage, i.url])).toEqual([["T", "done", "http://aleph.home/#/issues/aleph/1"], ["U", "unknown", "http://aleph.home/#/issues/aleph/2"]]);
  expect(r.shelf).toEqual([
    { id: "20261121-212835-e5bq", title: "Served", pending: 2, url: "http://aleph.home/shelf/i/20261121-212835-e5bq/" },
    { id: "20261121-194453-v4ql", title: "20261121-194453-v4ql", pending: 0, url: "http://aleph.home/shelf/i/20261121-194453-v4ql/" },
  ]);
});
