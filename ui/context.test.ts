import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call, parse, parseExact } from "./context.ts";
import { withEnv, withServer } from "./test-server.ts";

const req = (id: string, input: number, cacheRead: number, cacheWrite: number) => ({ type: "assistant", requestId: id, message: { usage: { input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite, output_tokens: 7 } } });
const result = { type: "user", message: { content: [{ type: "tool_result", content: "x" }] } };
const lines = [
  { attachment: { type: "instructions", files: [{ content: "i".repeat(200) }] } },
  { attachment: { type: "hook_additional_context", content: ["m".repeat(100)] } },
  { attachment: { type: "prompt_snapshot", systemPrompt: ["s".repeat(300)], tools: [{ name: "t", schema: { name: "t".repeat(60), input_schema: { type: "object" } } }] } },
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
  const r = parse(transcript).requests;
  expect(r.map((x) => x.fill)).toEqual([1002, 1503, 1804]);
  expect(r.map((x) => x.usage.output)).toEqual([7, 7, 7]);
  expect(r[0].parts.map((p) => p.name)).toEqual(["System prompt", "Tools · 1", "Instructions · 1 file", "Memory start context"]);
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

test("the Instructions part names one file in the singular and more in the plural", () => {
  const two = JSON.stringify({ attachment: { type: "instructions", files: [{ content: "j" }] } }) + "\n" + transcript;
  expect(parse(two).requests[0].parts[2].name).toBe("Instructions · 2 files");
  expect(parse(transcript).requests[0].parts[2].name).toBe("Instructions · 1 file");
});

test("after a compaction the summary is the fill minus request 1's, exact, and the message parts start again", () => {
  const compacted = [...lines, { type: "user", isCompactSummary: true, message: { content: "summary" } }, req("r4", 5, 1000, 200)];
  const r = parse(compacted.map((o) => JSON.stringify(o)).join("\n")).requests;
  expect(r[3].fill).toBe(1205);
  expect(r[3].parts.slice(4)).toEqual([{ name: "Compact summary", rec: "isCompactSummary", tokens: 203, how: "exact" }]);
});

test("a later attachment is its own part, weighed by its chars beside the other records of the gap", () => {
  // the attachment is 152 chars of JSON, the message 150 + 2 quotes
  const later = { attachment: { type: "instructions", files: [{ content: "a".repeat(104) }] } };
  const r = parse([...lines, { type: "user", message: { content: "u".repeat(150) } }, later, req("r4", 5, 1800, 500)].map((o) => JSON.stringify(o)).join("\n")).requests;
  expect(r[3].parts.slice(4)).toEqual([
    { name: "Your messages · 2", rec: "user", tokens: 296, how: "est" },
    { name: "Assistant turns · 3", rec: "assistant", tokens: 21, how: "exact" },
    { name: "Tool results · 1", rec: "tool_result", tokens: 494, how: "exact" },
    { name: "Recall offers · 1", rec: "hook UserPromptSubmit", tokens: 245, how: "est" },
    { name: "Attachments · 1", rec: "attachment", tokens: 247, how: "est" },
  ]);
  expect(r[3].parts.reduce((s, p) => s + p.tokens, 0)).toBe(r[3].fill);
});

test("a gap of one later attachment gives the assistant turn the output and the rest to the attachment, exact", () => {
  const hook = { attachment: { type: "hook_additional_context", hookName: "SessionStart", content: ["c".repeat(40)] } };
  const r = parse([...lines, hook, req("r4", 5, 1800, 100)].map((o) => JSON.stringify(o)).join("\n")).requests;
  expect(r[3].parts.slice(-2)).toEqual([
    { name: "Recall offers · 1", rec: "hook UserPromptSubmit", tokens: 245, how: "est" },
    { name: "Attachments · 1", rec: "attachment", tokens: 94, how: "exact" },
  ]);
  expect(r[3].parts.find((p) => p.rec === "assistant")!.tokens).toBe(21);
  expect(r[3].parts.reduce((s, p) => s + p.tokens, 0)).toBe(r[3].fill);
});

test("an image in a tool result weighs by its pixels, 4 chars per token, not by its base64 length", () => {
  // a 300 × 250 PNG header padded to 30 kB: 100 tokens by pixels, 400 chars
  const png = Buffer.alloc(30000);
  Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(png);
  png.writeUInt32BE(300, 16);
  png.writeUInt32BE(250, 20);
  const image = { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } };
  const toolResult = { type: "user", message: { content: [{ type: "tool_result", content: [image] }] } };
  const r = parse([req("r1", 2, 0, 1000), toolResult, { type: "user", message: { content: "u".repeat(398) } }, req("r2", 3, 1000, 600)].map((o) => JSON.stringify(o)).join("\n")).requests;
  // the tool result is 400 chars of image plus 114 of JSON around it; the message is 398 + 2 quotes
  expect(r[1].parts.slice(4).map((p) => [p.rec, p.tokens])).toEqual([["user", 260], ["assistant", 7], ["tool_result", 334]]);
  expect(r[1].parts.reduce((s, p) => s + p.tokens, 0)).toBe(r[1].fill);
});

// A PNG of 300 × 250: its header gives the size, the rest is padding that a split by base64 chars would count.
const png = (() => { const b = Buffer.alloc(40_000); Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(b); b.writeUInt32BE(300, 16); b.writeUInt32BE(250, 20); return b.toString("base64"); })();
const use = (id: string, name: string, input: object) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const res = (id: string, content: unknown) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content }] } });
const drill = [
  ...lines.slice(0, 5),
  use("u1", "Read", { file_path: "/a.png" }), use("u2", "Bash", { command: "ls" }),
  res("u1", [{ type: "image", source: { type: "base64", media_type: "image/png", data: png } }]), res("u2", "x".repeat(400)),
  req("r2", 3, 1000, 500),
  use("u3", "Grep", { pattern: "p" }), res("u3", "y"),
  req("r3", 4, 1500, 100),
  { type: "user", isCompactSummary: true, message: { content: "summary" } }, req("r4", 5, 1000, 200),
].map((o) => JSON.stringify(o)).join("\n");

test("each tool result is a call with its input, and parallel results split the tool result part by weight", () => {
  const s = parse(drill);
  // the image weighs its tokens (300 × 250 ÷ 750 = 100) × 4 = 400 chars plus its JSON, not its base64
  expect(s.calls).toEqual([
    { id: "u1", tool: "Read", input: "/a.png", n: 2, tokens: 267, how: "est" },
    { id: "u2", tool: "Bash", input: "ls", n: 2, tokens: 227, how: "est" },
    { id: "u3", tool: "Grep", input: "p", n: 3, tokens: 94, how: "exact" },
  ]);
  const part = s.requests[1].parts.find((p) => p.rec === "tool_result")!;
  expect(s.calls.filter((c) => c.n === 2).reduce((n, c) => n + c.tokens, 0)).toBe(part.tokens);
  expect(s.requests.map((r) => r.since)).toEqual([1, 1, 1, 4]);
});

test("the tools split the Tools part by chars and sum to it", () => {
  const two = transcript.replace('"tools":[', '"tools":[{"name":"b","schema":{"name":"b"}},');
  const s = parse(two);
  expect(s.tools.map((t) => t.name)).toEqual(["b", "t".repeat(60)]);
  expect(s.tools.reduce((n, t) => n + t.tokens, 0)).toBe(s.requests[0].parts[1].tokens);
});

test("call gives a call's input and its result as text, with an image as its tokens", () => {
  expect(call(drill, "u1")).toEqual({ tool: "Read", input: { file_path: "/a.png" }, text: "[image, about 100 tokens]" });
  expect(call(drill, "u2")!.text).toBe("x".repeat(400));
  expect(call(drill, "nope")).toBeNull();
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

test("GET /api/context/:id returns the window the context gate reads: the default, then the autoCompactWindow setting", async () => {
  const settings = join(base, "settings.json");
  const restore = withEnv({ ALEPH_CLAUDE_SETTINGS: settings });
  const env = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  try {
    expect((await at("/api/context/new").then((r) => r.json()) as any).window).toBe(1_000_000);
    writeFileSync(settings, JSON.stringify({ autoCompactWindow: 400_000 }));
    expect((await at("/api/context/new").then((r) => r.json()) as any).window).toBe(400_000);
  } finally {
    restore();
    if (env !== undefined) process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = env;
  }
});

test("GET /api/context/:id/calls/:call returns one call, and 404 for an unknown call or session", async () => {
  writeFileSync(join(base, "-p", "drill.jsonl"), drill);
  expect(await at("/api/context/drill/calls/u2").then((r) => r.json())).toEqual({ tool: "Bash", input: { command: "ls" }, text: "x".repeat(400) });
  expect(await Promise.all(["/api/context/drill/calls/nope", "/api/context/nope/calls/u2"].map(async (u) => (await at(u)).status))).toEqual([404, 404]);
});

test("GET /api/context/:id counts the fixed parts with count_tokens when the dotenv has the key", async () => {
  writeFileSync(join(base, "-p", "model.jsonl"), transcript.replaceAll('"usage"', '"model":"claude-test-1","usage"'));
  writeFileSync(join(base, "env"), "ANTHROPIC_API_KEY=sk-test\n");
  const restore = withEnv({ ALEPH_ENV_FILE: join(base, "env") });
  const real = globalThis.fetch, models: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (!String(url).includes("count_tokens")) return real(url, init);
    models.push(JSON.parse(init!.body as string).model);
    return Response.json({ input_tokens: 5 });
  }) as typeof fetch;
  try {
    const one: any = await at("/api/context/model").then((r) => r.json());
    expect(one.requests[0].parts.slice(0, 4).map((p: any) => [p.tokens, p.how])).toEqual(Array(4).fill([5, "exact"]));
    expect(models).toEqual(Array(4).fill("claude-test-1"));
  } finally { globalThis.fetch = real; restore(); }
});

describe("parseExact", () => {
  const withModel = transcript.replace('"usage"', '"model":"claude-test-1","usage"');
  const envFile = (text: string) => { const f = join(base, "env"); writeFileSync(f, text); return f; };
  // input_tokens by the text each body holds
  const tokens: [string, number][] = [["s".repeat(300), 11], ["t".repeat(60), 22], ["i".repeat(200), 33], ["m".repeat(100), 44]];
  const bodies: any[] = [];
  const fake = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    return Response.json({ input_tokens: tokens.find(([t]) => (init.body as string).includes(t))![1] });
  }) as unknown as typeof fetch;

  test("counts each fixed part with the session's model and marks it exact, without the key reaching process.env", async () => {
    const restore = withEnv({ ALEPH_ENV_FILE: envFile("ANTHROPIC_API_KEY=sk-test\n") });
    delete process.env.ANTHROPIC_API_KEY;
    const r = (await parseExact(withModel, fake)).requests;
    restore();
    expect(r[0].parts.slice(0, 4).map((p) => [p.tokens, p.how])).toEqual([[11, "exact"], [22, "exact"], [33, "exact"], [44, "exact"]]);
    expect(r[0].parts.slice(0, 5).reduce((s, p) => s + p.tokens, 0)).toBe(r[0].fill);
    expect(bodies.map((b) => b.model)).toEqual(Array(4).fill("claude-test-1"));
    expect(bodies.find((b) => b.tools).tools[0].input_schema).toEqual({ type: "object" });
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test("with no key it keeps chars ÷ 4 estimates and makes no call", async () => {
    const restore = withEnv({ ALEPH_ENV_FILE: envFile("OTHER=1\n") });
    let calls = 0;
    const r = (await parseExact(withModel, (async () => { calls++; return Response.json({}); }) as unknown as typeof fetch)).requests;
    restore();
    expect(calls).toBe(0);
    expect(r[0].parts.slice(0, 4)).toEqual(parse(transcript).requests[0].parts.slice(0, 4));
    expect(r[0].parts.every((p) => p.how === "est")).toBe(true);
  });

  test("when a call fails it keeps the estimates", async () => {
    const restore = withEnv({ ALEPH_ENV_FILE: envFile("ANTHROPIC_API_KEY=sk-test\n") });
    const r = (await parseExact(withModel, (async () => new Response("no", { status: 500 })) as unknown as typeof fetch)).requests;
    restore();
    expect(r[0].parts.slice(0, 4).every((p) => p.how === "est")).toBe(true);
  });
});
