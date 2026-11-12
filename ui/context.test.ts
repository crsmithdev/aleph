import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "./context.ts";
import { withEnv, withServer } from "./test-server.ts";

const req = (id: string, input: number, cacheRead: number, cacheWrite: number) => ({ type: "assistant", requestId: id, message: { usage: { input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite, output_tokens: 7 } } });
const result = { type: "user", message: { content: [{ type: "tool_result", content: "x" }] } };
const lines = [
  { attachment: { type: "instructions", files: [{ content: "i".repeat(200) }] } },
  { attachment: { type: "hook_additional_context", content: ["m".repeat(100)] } },
  { attachment: { type: "prompt_snapshot", systemPrompt: ["s".repeat(300)], tools: [{ name: "t".repeat(60) }] } },
  { type: "user", message: { content: "hi" } },
  req("r1", 2, 0, 1000),
  // a second content block of request 1 carries the same usage and must not count twice
  req("r1", 2, 0, 1000),
  result,
  req("r2", 3, 1000, 500),
  { type: "user", message: { content: "next" } },
  { attachment: { type: "hook_additional_context", hookName: "UserPromptSubmit", content: ["r".repeat(30)] } },
  req("r3", 4, 1500, 300),
];
const transcript = lines.map((o) => JSON.stringify(o)).join("\n");

test("parse gives each request's fill, each message as the usage difference, and fixed parts that sum to request 1", () => {
  const r = parse(transcript);
  expect(r.map((x) => x.fill)).toEqual([1002, 1503, 1804]);
  expect(r.map((x) => x.usage.output)).toEqual([7, 7, 7]);
  expect(r[0].parts.map((p) => p.name)).toEqual(["System prompt", "Tools · 1", "Instructions · 1 files", "Memory start context"]);
  expect(r[0].parts.reduce((s, p) => s + p.tokens, 0)).toBe(1002);
  expect(r[0].parts.every((p) => p.how === "est")).toBe(true);
  // each later request holds the fixed parts, then the message parts so far: the output of the request before as an
  // assistant turn, the rest of the difference to the records between, split by chars (an estimate) when they are two kinds
  expect(r[1].parts.slice(4)).toEqual([
    { name: "Assistant turns · 1", rec: "assistant", tokens: 7, how: "exact" },
    { name: "Tool results · 1", rec: "tool_result", tokens: 494, how: "exact" },
  ]);
  expect(r[2].parts.slice(0, 4)).toEqual(r[0].parts);
  expect(r[2].parts.slice(4)).toEqual([
    { name: "Your messages · 1", rec: "user", tokens: 49, how: "est" },
    { name: "Assistant turns · 2", rec: "assistant", tokens: 14, how: "exact" },
    { name: "Tool results · 1", rec: "tool_result", tokens: 494, how: "exact" },
    { name: "Recall offers · 1", rec: "hook UserPromptSubmit", tokens: 245, how: "est" },
  ]);
  expect(r.map((x) => x.parts.reduce((s, p) => s + p.tokens, 0))).toEqual([1002, 1503, 1804]);
});

test("after a compaction the summary is the fill minus request 1's, exact, and the message parts start again", () => {
  const compacted = [...lines, { type: "user", isCompactSummary: true, message: { content: "summary" } }, req("r4", 5, 1000, 200)];
  const r = parse(compacted.map((o) => JSON.stringify(o)).join("\n"));
  expect(r[3].fill).toBe(1205);
  expect(r[3].parts.slice(4)).toEqual([{ name: "Compact summary", rec: "isCompactSummary", tokens: 203, how: "exact" }]);
});

let base: string, stop: () => void, restoreEnv: () => void, at: (path: string) => Promise<Response>;
beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-context-"));
  restoreEnv = withEnv({ ALEPH_CLAUDE_PROJECTS: base });
  mkdirSync(join(base, "-p"));
  writeFileSync(join(base, "-p", "old.jsonl"), JSON.stringify(req("a", 1, 0, 10)));
  writeFileSync(join(base, "-p", "new.jsonl"), transcript);
  utimesSync(join(base, "-p", "old.jsonl"), 1000, 1000);
  utimesSync(join(base, "-p", "new.jsonl"), 2000, 2000);
  ({ at, stop } = await withServer());
});
afterAll(() => { stop(); restoreEnv(); rmSync(base, { recursive: true, force: true }); });

test("GET /api/context lists the newer session first and /api/context/:id returns its requests in order", async () => {
  const list: any = await at("/api/context").then((r) => r.json());
  expect(list.sessions.map((s: any) => [s.id, s.project])).toEqual([["new", "-p"], ["old", "-p"]]);
  const one: any = await at("/api/context/new").then((r) => r.json());
  expect(one.requests.map((x: any) => [x.n, x.fill])).toEqual([[1, 1002], [2, 1503], [3, 1804]]);
  expect((await at("/api/context/nope")).status).toBe(404);
});
