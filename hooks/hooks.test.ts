import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attrs, traceIdFor, truncate, turnSpanIdFor, turnTraceIdFor } from "./lib/otlp.ts";
import { classifyEnvironment, loadDotenv } from "./lib/env.ts";
import { parseRating } from "./lib/rating.ts";
import { scanDiff, scanLine } from "./lib/scan.ts";

const HOOKS = import.meta.dir;

describe("otlp helpers", () => {
  test("trace id is a pure function of the session id", () => {
    expect(traceIdFor("abc")).toBe(traceIdFor("abc"));
    expect(traceIdFor("abc")).toMatch(/^[0-9a-f]{32}$/);
    expect(traceIdFor("abc")).not.toBe(traceIdFor("abd"));
  });
  test("truncate caps at 4 KB and marks the cut", () => {
    const long = "x".repeat(5000);
    expect(truncate(long)).toHaveLength(4096 + "…[+904 chars]".length);
    expect(truncate({ a: 1 })).toBe('{"a":1}');
  });
  test("attrs drops empty values and encodes arrays", () => {
    const out = attrs({ a: "x", b: undefined, c: "", d: ["t1", "t2"], e: 3 });
    expect(out.map((a) => a.key)).toEqual(["a", "d", "e"]);
    expect(out[1].value).toEqual({ arrayValue: { values: [{ stringValue: "t1" }, { stringValue: "t2" }] } });
    expect(out[2].value).toEqual({ intValue: "3" });
  });
});

describe("dotenv", () => {
  test("loads only LANGFUSE_* keys and never overrides the shell", () => {
    const file = join(mkdtempSync(join(tmpdir(), "aleph-env-")), ".env");
    writeFileSync(file, 'ANTHROPIC_API_KEY=sk-ant-x\nLANGFUSE_PUBLIC_KEY="pk-file"\nLANGFUSE_SECRET_KEY=sk-file\n# LANGFUSE_BASE_URL=commented\n');
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    process.env.LANGFUSE_SECRET_KEY = "sk-shell";
    loadDotenv(file);
    const env: NodeJS.ProcessEnv = process.env; // an alias: the deletes above narrowed process.env for the checker
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.LANGFUSE_PUBLIC_KEY).toBe("pk-file");
    expect(env.LANGFUSE_SECRET_KEY).toBe("sk-shell");
    rmSync(join(file, ".."), { recursive: true, force: true });
  });
});

describe("environment", () => {
  test("headless only when an ancestor is claude -p; ALEPH_ENV wins", () => {
    const interactive = [["/home/x/.local/bin/claude"], ["/bin/bash", "/home/x/dotfiles/bin/claude"], ["/bin/bash"]];
    const headless = [["bun", "test"], ["/bin/bash", "/home/x/dotfiles/bin/claude", "-p", "hello", "--model", "haiku"]];
    const lookalike = [["/usr/bin/grep", "-p", "claude"], ["/home/x/.local/bin/claude"]];
    expect(classifyEnvironment(interactive, undefined)).toBe("interactive");
    expect(classifyEnvironment(headless, undefined)).toBe("headless");
    expect(classifyEnvironment(lookalike, undefined)).toBe("interactive");
    expect(classifyEnvironment(headless, "test")).toBe("test");
  });
});

describe("obs hook", () => {
  const posted: any[] = [];
  let server: ReturnType<typeof Bun.serve>;
  let spool: string;
  const session = "11111111-2222-3333-4444-555555555555";

  beforeAll(() => {
    server = Bun.serve({ port: 0, fetch: async (req) => { posted.push({ url: new URL(req.url).pathname, headers: Object.fromEntries(req.headers), body: await req.json() }); return new Response("{}"); } });
    spool = mkdtempSync(join(tmpdir(), "aleph-spool-"));
  });
  afterAll(() => { server.stop(); rmSync(spool, { recursive: true, force: true }); });

  async function fire(payload: Record<string, unknown>) {
    const proc = Bun.spawn(["bun", join(HOOKS, "obs.ts")], {
      stdin: new TextEncoder().encode(JSON.stringify({ session_id: session, cwd: "/tmp/proj", ...payload })),
      env: { ...process.env, LANGFUSE_BASE_URL: `http://127.0.0.1:${server.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk", ALEPH_SPOOL: spool, ALEPH_ENV: "test" },
      stdout: "pipe", stderr: "pipe",
    });
    const code = await proc.exited;
    return { code, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() };
  }
  const lastSpans = () => posted.at(-1).body.resourceSpans[0].scopeSpans[0].spans;
  const attr = (span: any, key: string) => span.attributes.find((a: any) => a.key === key)?.value;

  test("SessionStart posts nothing and leaves the session's name and tags for its turns", async () => {
    const before = posted.length;
    const r = await fire({ hook_event_name: "SessionStart", source: "startup", permission_mode: "auto" });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(posted.length).toBe(before);
    expect(JSON.parse(readFileSync(join(spool, `session:${session}.json`), "utf8"))).toMatchObject({ name: "proj", cwd: "/tmp/proj", tags: ["source:startup", "mode:auto", "project:proj"] });
  });

  test("a prompt opens a turn trace whose root carries the prompt, name, tags and auth headers", async () => {
    await fire({ hook_event_name: "UserPromptSubmit", prompt_id: "p1", prompt: "hello" });
    const spans = lastSpans();
    expect(spans).toHaveLength(1);
    const turn = spans[0];
    expect(turn.name).toBe("turn");
    expect(turn.traceId).toBe(turnTraceIdFor("p1"));
    expect(turn.spanId).toBe(turnSpanIdFor("p1"));
    expect(turn.parentSpanId).toBeUndefined();
    expect(attr(turn, "langfuse.observation.input")).toEqual({ stringValue: "hello" });
    expect(attr(turn, "langfuse.trace.input")).toEqual({ stringValue: "hello" });
    expect(attr(turn, "langfuse.observation.output")).toBeUndefined();
    expect(attr(turn, "langfuse.session.id")).toEqual({ stringValue: session });
    expect(attr(turn, "langfuse.environment")).toEqual({ stringValue: "test" });
    expect(attr(turn, "langfuse.trace.name")).toEqual({ stringValue: "proj" });
    expect(attr(turn, "langfuse.trace.tags")).toEqual({ arrayValue: { values: [{ stringValue: "source:startup" }, { stringValue: "mode:auto" }, { stringValue: "project:proj" }] } });
    expect(attr(turn, "langfuse.trace.metadata.cwd")).toEqual({ stringValue: "/tmp/proj" });
    expect(posted.at(-1).url).toBe("/api/public/otel/v1/traces");
    expect(posted.at(-1).headers["x-langfuse-ingestion-version"]).toBe("4");
    expect(posted.at(-1).headers.authorization).toBe(`Basic ${Buffer.from("pk:sk").toString("base64")}`);
  });

  test("tools nest under the turn in its trace with real duration; Stop completes the same turn span", async () => {
    const pre = await fire({ hook_event_name: "PreToolUse", prompt_id: "p1", tool_name: "Bash", tool_use_id: "t1", tool_input: { command: "ls" } });
    expect(pre.code).toBe(0);
    const before = posted.length;
    await Bun.sleep(120);
    await fire({ hook_event_name: "PostToolUse", prompt_id: "p1", tool_name: "Bash", tool_use_id: "t1", tool_input: { command: "ls" }, tool_response: "a\nb" });
    expect(posted.length).toBe(before + 1);
    const tool = lastSpans()[0];
    expect(tool.name).toBe("Bash");
    expect(tool.traceId).toBe(turnTraceIdFor("p1"));
    expect(tool.parentSpanId).toBe(turnSpanIdFor("p1"));
    expect(attr(tool, "langfuse.observation.type")).toEqual({ stringValue: "tool" });
    expect(attr(tool, "langfuse.observation.output")).toEqual({ stringValue: "a\nb" });
    expect(attr(tool, "langfuse.environment")).toEqual({ stringValue: "test" });
    expect(attr(tool, "langfuse.trace.name")).toEqual({ stringValue: "proj" });
    const durationMs = Number(BigInt(tool.endTimeUnixNano) - BigInt(tool.startTimeUnixNano)) / 1e6;
    expect(durationMs).toBeGreaterThan(100);

    await fire({ hook_event_name: "PostToolUseFailure", prompt_id: "p1", tool_name: "Skill", tool_use_id: "t2", tool_input: { skill: "aleph:interview" }, tool_error: "boom" });
    const failed = lastSpans()[0];
    expect(failed.name).toBe("skill:aleph:interview");
    expect(failed.status).toEqual({ code: 2, message: "boom" });
    expect(attr(failed, "langfuse.observation.level")).toEqual({ stringValue: "ERROR" });

    await fire({ hook_event_name: "Stop", prompt_id: "p1", last_assistant_message: "done", cwd: "/tmp/proj/.worktrees/x" });
    const turn = lastSpans()[0];
    expect(turn.name).toBe("turn");
    expect(turn.traceId).toBe(turnTraceIdFor("p1"));
    expect(turn.spanId).toBe(turnSpanIdFor("p1"));
    expect(turn.parentSpanId).toBeUndefined();
    expect(attr(turn, "langfuse.observation.input")).toEqual({ stringValue: "hello" });
    expect(attr(turn, "langfuse.observation.output")).toEqual({ stringValue: "done" });
    expect(attr(turn, "langfuse.trace.output")).toEqual({ stringValue: "done" });
    expect(attr(turn, "langfuse.trace.name")).toEqual({ stringValue: "proj" }); // a worktree cwd does not rename the trace
    expect(BigInt(turn.endTimeUnixNano) - BigInt(turn.startTimeUnixNano)).toBeGreaterThan(BigInt(100_000_000));
  });

  test("StopFailure completes the turn as an error carrying the API message", async () => {
    await fire({ hook_event_name: "UserPromptSubmit", prompt_id: "p3", prompt: "write a story" });
    await fire({ hook_event_name: "StopFailure", prompt_id: "p3", error: "invalid_request", last_assistant_message: "API Error: safeguards flagged this message" });
    const turn = lastSpans()[0];
    expect(turn.name).toBe("turn");
    expect(turn.spanId).toBe(turnSpanIdFor("p3"));
    expect(turn.status).toEqual({ code: 2, message: "invalid_request: API Error: safeguards flagged this message" });
    expect(attr(turn, "langfuse.observation.level")).toEqual({ stringValue: "ERROR" });
    expect(attr(turn, "langfuse.observation.input")).toEqual({ stringValue: "write a story" });
    expect(attr(turn, "langfuse.observation.output")).toEqual({ stringValue: "API Error: safeguards flagged this message" });
  });

  test("subagent tools nest under the agent span, which nests under the turn, all in the turn's trace", async () => {
    await fire({ hook_event_name: "UserPromptSubmit", prompt_id: "p2", prompt: "delegate" });
    await fire({ hook_event_name: "SubagentStart", prompt_id: "p2", agent_id: "a1", agent_type: "Explore" });
    // a subagent's tool events may arrive without the prompt id; the agent handshake still knows the trace
    await fire({ hook_event_name: "PreToolUse", agent_id: "a1", agent_type: "Explore", tool_name: "Read", tool_use_id: "t3", tool_input: { file_path: "/x" } });
    await fire({ hook_event_name: "PostToolUse", agent_id: "a1", agent_type: "Explore", tool_name: "Read", tool_use_id: "t3", tool_input: { file_path: "/x" }, tool_response: "…" });
    const tool = lastSpans()[0];
    await fire({ hook_event_name: "SubagentStop", prompt_id: "p2", agent_id: "a1", agent_type: "Explore", last_assistant_message: "found it" });
    const agent = lastSpans()[0];
    expect(agent.name).toBe("Explore");
    expect(agent.traceId).toBe(turnTraceIdFor("p2"));
    expect(agent.parentSpanId).toBe(turnSpanIdFor("p2"));
    expect(tool.traceId).toBe(turnTraceIdFor("p2"));
    expect(tool.parentSpanId).toBe(agent.spanId);
  });

  test("other events inside a turn become metadata-only events; outside a turn, or without keys, nothing posts", async () => {
    await fire({ hook_event_name: "PreCompact", prompt_id: "p2", compact_reason: "auto", trigger: "auto" });
    const ev = lastSpans()[0];
    expect(ev.name).toBe("PreCompact");
    expect(ev.traceId).toBe(turnTraceIdFor("p2"));
    expect(ev.parentSpanId).toBe(turnSpanIdFor("p2"));
    expect(attr(ev, "langfuse.observation.metadata.compact_reason")).toEqual({ stringValue: "auto" });

    let before = posted.length;
    const outside = await fire({ hook_event_name: "SessionEnd", reason: "other" });
    expect(outside.code).toBe(0);
    expect(posted.length).toBe(before);

    before = posted.length;
    const proc = Bun.spawn(["bun", join(HOOKS, "obs.ts")], {
      stdin: new TextEncoder().encode(JSON.stringify({ session_id: session, hook_event_name: "Stop", prompt_id: "p1" })),
      env: { PATH: process.env.PATH, HOME: mkdtempSync(join(tmpdir(), "nohome-")), ALEPH_SPOOL: spool },
      stdout: "pipe",
    });
    expect(await proc.exited).toBe(0);
    expect(posted.length).toBe(before);
  });

  test("an N/10 prompt scores the previous turn's trace; other prompts score nothing", async () => {
    await fire({ hook_event_name: "UserPromptSubmit", prompt_id: "p5", prompt: "first" });
    let before = posted.length;
    await fire({ hook_event_name: "UserPromptSubmit", prompt_id: "p6", prompt: "8/10, the table was too wide" });
    const score = posted.slice(before).find((p) => p.url === "/api/public/scores");
    expect(score).toBeDefined();
    expect(score.body).toMatchObject({ traceId: turnTraceIdFor("p5"), name: "rating", value: 8, dataType: "NUMERIC", comment: "8/10, the table was too wide", environment: "test" });
    expect(score.headers.authorization).toBe(`Basic ${Buffer.from("pk:sk").toString("base64")}`);
    before = posted.length;
    await fire({ hook_event_name: "UserPromptSubmit", prompt_id: "p7", prompt: "now fix it" });
    expect(posted.slice(before).map((p) => p.url)).toEqual(["/api/public/otel/v1/traces"]);
  });
});

describe("rating", () => {
  test("N/10 anywhere in the prompt, not dates or other fractions", () => {
    expect(parseRating("8/10")).toBe(8);
    expect(parseRating("that was 10 / 10, thanks")).toBe(10);
    expect(parseRating("0/10. wrong file")).toBe(0);
    expect(parseRating("ship it on 9/10/2026")).toBeNull();
    expect(parseRating("3/100 done")).toBeNull();
    expect(parseRating("38/10")).toBeNull();
    expect(parseRating("looks good")).toBeNull();
  });
});

describe("git-guard", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "aleph-guard-"));
    const run = (cwd: string, ...args: string[]) => { const p = Bun.spawnSync(["git", ...args], { cwd, stdout: "ignore", stderr: "pipe" }); if (p.exitCode !== 0) throw new Error(p.stderr.toString()); };
    mkdirSync(join(root, "repo"));
    run(join(root, "repo"), "init", "-q", "-b", "main");
    run(join(root, "repo"), "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
    run(join(root, "repo"), "worktree", "add", "-q", join(root, "repo", ".worktrees", "x"), "-b", "feature/x");
    mkdirSync(join(root, "plain"));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  async function guard(filePath: string) {
    const proc = Bun.spawn(["bun", join(HOOKS, "git-guard.ts")], {
      stdin: new TextEncoder().encode(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: filePath } })),
      stdout: "pipe",
    });
    await proc.exited;
    return (await new Response(proc.stdout).text()).trim();
  }

  test("denies an edit on main", async () => {
    const out = JSON.parse(await guard(join(root, "repo", "new-dir", "a.ts")));
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("worktree add");
  });
  test("allows the same edit inside .worktrees", async () => {
    expect(await guard(join(root, "repo", ".worktrees", "x", "a.ts"))).toBe("");
  });
  test("allows edits outside any repo", async () => {
    expect(await guard(join(root, "plain", "a.ts"))).toBe("");
  });
});

describe("handshake prune", () => {
  test("drops stale files and keeps fresh ones", async () => {
    const { put, prune, peek } = await import("./lib/handshake.ts");
    const dir = mkdtempSync(join(tmpdir(), "aleph-prune-"));
    process.env.ALEPH_SPOOL = dir;
    put("tool:old", { start: 1 });
    put("tool:new", { start: 2 });
    const { utimesSync } = await import("node:fs");
    const old = new Date(Date.now() - 2 * 86_400_000);
    utimesSync(join(dir, "tool:old.json"), old, old);
    prune();
    expect(peek("tool:old")).toBeNull();
    expect(peek("tool:new")).toEqual({ start: 2 });
    delete process.env.ALEPH_SPOOL;
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("obs hook generations", () => {
  test("Stop emits one generation per requestId, parented to the turn, with usage", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aleph-gen-"));
    const transcript = join(dir, "t.jsonl");
    const usage = (input: number, output: number, read: number, create: number) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: create });
    const lines = [
      { type: "user", promptId: "pg", isSidechain: false, timestamp: "2026-09-03T10:00:00.000Z", message: { role: "user", content: "hi" } },
      { type: "assistant", isSidechain: false, requestId: "req_A", timestamp: "2026-09-03T10:00:02.000Z", message: { role: "assistant", model: "claude-fable-5-1", usage: usage(10, 20, 300, 40), content: [{ type: "thinking", thinking: "" }] } },
      { type: "assistant", isSidechain: false, requestId: "req_A", timestamp: "2026-09-03T10:00:02.500Z", message: { role: "assistant", model: "claude-fable-5-1", usage: usage(10, 20, 300, 40), content: [{ type: "tool_use", id: "t", name: "Bash", input: {} }] } },
      { type: "user", isSidechain: false, timestamp: "2026-09-03T10:00:03.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] } },
      { type: "assistant", isSidechain: false, requestId: "req_B", timestamp: "2026-09-03T10:00:05.000Z", message: { role: "assistant", model: "claude-fable-5-1", usage: usage(5, 7, 0, 0), content: [{ type: "text", text: "done" }] } },
    ];
    writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

    const posted: any[] = [];
    const server = Bun.serve({ port: 0, fetch: async (req) => { posted.push(await req.json()); return new Response("{}"); } });
    const spool = mkdtempSync(join(tmpdir(), "aleph-gen-spool-"));
    const proc = Bun.spawn(["bun", join(HOOKS, "obs.ts")], {
      stdin: new TextEncoder().encode(JSON.stringify({ session_id: "s-gen", cwd: "/tmp/proj", hook_event_name: "Stop", prompt_id: "pg", transcript_path: transcript, last_assistant_message: "done" })),
      env: { ...process.env, LANGFUSE_BASE_URL: `http://127.0.0.1:${server.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk", ALEPH_SPOOL: spool },
      stdout: "pipe", stderr: "pipe",
    });
    expect(await proc.exited).toBe(0);
    server.stop();
    const spans = posted[0].resourceSpans[0].scopeSpans[0].spans;
    const attr = (span: any, key: string) => span.attributes.find((a: any) => a.key === key)?.value?.stringValue;
    const turn = spans.find((s: any) => s.name === "turn");
    const gens = spans.filter((s: any) => attr(s, "langfuse.observation.type") === "generation");
    expect(gens).toHaveLength(2);
    for (const g of gens) {
      expect(g.parentSpanId).toBe(turn.spanId);
      expect(g.name).toBe("claude-fable-5-1");
      expect(attr(g, "langfuse.observation.model.name")).toBe("claude-fable-5-1");
    }
    expect(JSON.parse(attr(gens[0], "langfuse.observation.usage_details"))).toEqual({ input: 10, output: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 });
    expect(JSON.parse(attr(gens[1], "langfuse.observation.usage_details"))).toEqual({ input: 5, output: 7 });
    expect(attr(gens[0], "langfuse.observation.metadata.request_id")).toBe("req_A");
    // fable 5.1: 10 in @ $10/M, 20 out @ $50/M, 300 cache read @ $0.25/M, 40 cache write @ $12.5/M
    const cost = JSON.parse(attr(gens[0], "langfuse.observation.cost_details"));
    expect(cost.input).toBeCloseTo(0.0001, 10);
    expect(cost.output).toBeCloseTo(0.001, 10);
    expect(cost.cache_read_input_tokens).toBeCloseTo(0.000075, 10);
    expect(cost.cache_creation_input_tokens).toBeCloseTo(0.0005, 10);
    expect(cost.total).toBeCloseTo(0.001675, 10);
    // req_A ran from the user line (10:00:00) to its first block (10:00:02); req_B from the tool result (10:00:03) to 10:00:05
    expect(BigInt(gens[0].endTimeUnixNano) - BigInt(gens[0].startTimeUnixNano)).toBe(2_000_000_000n);
    expect(BigInt(gens[1].endTimeUnixNano) - BigInt(gens[1].startTimeUnixNano)).toBe(2_000_000_000n);
    rmSync(dir, { recursive: true, force: true }); rmSync(spool, { recursive: true, force: true });
  });
});

describe("pricing", () => {
  test("dated haiku id prices as haiku 4.5; unknown model has no cost", async () => {
    const { costDetails, priceFor } = await import("./lib/pricing.ts");
    expect(priceFor("claude-haiku-4-5-20251001")?.input).toBe(1);
    expect(costDetails("claude-haiku-4-5-20251001", { input: 1_000_000, output: 0 })?.total).toBeCloseTo(1, 10);
    expect(costDetails("gpt-x", { input: 1, output: 1 })).toBeNull();
  });
});

describe("obs hook waits for the transcript", () => {
  test("a final assistant entry written 300 ms after Stop is still counted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aleph-late-"));
    const transcript = join(dir, "t.jsonl");
    const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const first = [
      { type: "user", promptId: "pl", isSidechain: false, timestamp: "2026-09-03T10:00:00.000Z", message: { role: "user", content: "hi" } },
      { type: "assistant", isSidechain: false, requestId: "req_1", timestamp: "2026-09-03T10:00:01.000Z", message: { role: "assistant", model: "claude-haiku-4-5-20251001", usage, content: [{ type: "tool_use", id: "t", name: "Bash", input: {} }] } },
    ];
    writeFileSync(transcript, first.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const posted: any[] = [];
    const server = Bun.serve({ port: 0, fetch: async (req) => { posted.push(await req.json()); return new Response("{}"); } });
    const spool = mkdtempSync(join(tmpdir(), "aleph-late-spool-"));
    const proc = Bun.spawn(["bun", join(HOOKS, "obs.ts")], {
      stdin: new TextEncoder().encode(JSON.stringify({ session_id: "s-late", cwd: "/tmp/proj", hook_event_name: "Stop", prompt_id: "pl", transcript_path: transcript, last_assistant_message: "all done here" })),
      env: { ...process.env, LANGFUSE_BASE_URL: `http://127.0.0.1:${server.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk", ALEPH_SPOOL: spool },
      stdout: "pipe", stderr: "pipe",
    });
    await Bun.sleep(300);
    const { appendFileSync } = await import("node:fs");
    appendFileSync(transcript, JSON.stringify({ type: "assistant", isSidechain: false, requestId: "req_2", timestamp: "2026-09-03T10:00:03.000Z", message: { role: "assistant", model: "claude-haiku-4-5-20251001", usage, content: [{ type: "text", text: "all done here" }] } }) + "\n");
    expect(await proc.exited).toBe(0);
    server.stop();
    const spans = posted[0].resourceSpans[0].scopeSpans[0].spans;
    const gens = spans.filter((s: any) => s.attributes.some((a: any) => a.key === "langfuse.observation.type" && a.value.stringValue === "generation"));
    expect(gens.map((g: any) => g.attributes.find((a: any) => a.key === "langfuse.observation.metadata.request_id").value.stringValue)).toEqual(["req_1", "req_2"]);
    rmSync(dir, { recursive: true, force: true }); rmSync(spool, { recursive: true, force: true });
  });
});

describe("vault-context hook", () => {
  let vault: string;
  beforeAll(() => {
    vault = mkdtempSync(join(tmpdir(), "aleph-vaultctx-"));
    writeFileSync(join(vault, "Home.md"), "# Home\n\n- [[A Note]] — hook\n\nHealth: 1 notes, 0 dangling, 0 orphans, lint 2026-09-04\n");
    writeFileSync(join(vault, "MEMORY.md"), "# Memory\n\n- Chris, Pacific\n");
  });
  afterAll(() => rmSync(vault, { recursive: true, force: true }));
  async function start(dir: string) {
    const proc = Bun.spawn(["bun", join(HOOKS, "vault-context.ts")], {
      stdin: new TextEncoder().encode(JSON.stringify({ hook_event_name: "SessionStart", source: "startup" })),
      env: { ...process.env, ALEPH_VAULT: dir }, stdout: "pipe",
    });
    await proc.exited;
    return (await new Response(proc.stdout).text()).trim();
  }
  test("injects Home then MEMORY whole", async () => {
    const out = JSON.parse(await start(vault));
    const ctx: string = out.hookSpecificOutput.additionalContext;
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(ctx.indexOf("# Home")).toBeLessThan(ctx.indexOf("# Memory"));
    expect(ctx).toContain("- [[A Note]] — hook");
    expect(ctx).toContain("Health: 1 notes");
    expect(ctx).toContain("- Chris, Pacific");
  });
  test("no vault, no output", async () => {
    expect(await start(join(vault, "missing"))).toBe("");
  });
});

describe("git-guard vault clause", () => {
  let vault: string;
  beforeAll(() => {
    vault = mkdtempSync(join(tmpdir(), "aleph-guardvault-"));
    const run = (...args: string[]) => { const p = Bun.spawnSync(["git", "-C", vault, ...args], { stdout: "ignore", stderr: "pipe" }); if (p.exitCode !== 0) throw new Error(p.stderr.toString()); };
    run("init", "-q", "-b", "main");
    run("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
    writeFileSync(join(vault, "VAULT.md"), "# contract\n");
    mkdirSync(join(vault, "wiki", "gotchas"), { recursive: true });
  });
  afterAll(() => rmSync(vault, { recursive: true, force: true }));
  async function guard(filePath: string) {
    const proc = Bun.spawn(["bun", join(HOOKS, "git-guard.ts")], {
      stdin: new TextEncoder().encode(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: filePath } })),
      env: { ...process.env, ALEPH_VAULT: vault }, stdout: "pipe",
    });
    await proc.exited;
    return (await new Response(proc.stdout).text()).trim();
  }
  test("allows a note on main in the vault", async () => {
    expect(await guard(join(vault, "wiki", "gotchas", "A Note.md"))).toBe("");
    expect(await guard(join(vault, "Home.md"))).toBe("");
  });
  test("denies VAULT.md", async () => {
    const out = JSON.parse(await guard(join(vault, "VAULT.md")));
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("wiki/decisions/");
  });
});

describe("secret scan", () => {
  test("flags vendor keys, credential literals and debug leftovers; ignores placeholders and short values", () => {
    expect(scanLine("aws_key = AKIA" + "IOSFODNN7EXAMPLE")).toBe("AWS access key");
    expect(scanLine("ANTHROPIC_API_KEY=sk-ant-" + "api03-abcdefghijklmnopqrstuvwxyz0123")).toBe("Anthropic API key");
    expect(scanLine("LANGFUSE_SECRET_KEY=sk-lf-" + "12345678-1234-1234-1234-123456789abc")).toBe("Langfuse secret key");
    expect(scanLine("LANGFUSE_PUBLIC_KEY=pk-lf-12345678-1234-1234-1234-123456789abc")).toBeNull();
    expect(scanLine("token: ghp_" + "a".repeat(36))).toBe("GitHub token");
    expect(scanLine("-----BEGIN OPENSSH " + "PRIVATE KEY-----")).toBe("private key block");
    expect(scanLine('const password = "correct-horse' + '-battery-staple"')).toBe("credential assignment");
    expect(scanLine('LANGFUSE_SECRET_KEY: "sk"')).toBeNull();
    expect(scanLine('password: "<your-password-here>"')).toBeNull();
    expect(scanLine("password = os.environ['PASSWORD']")).toBeNull();
    expect(scanLine("  debugger;")).toBe("debugger statement");
    expect(scanLine("    break" + "point()")).toBe("breakpoint");
    expect(scanLine("import " + "pdb")).toBe("breakpoint");
    expect(scanLine("test." + "only('x', () => {})")).toBe("focused test");
    expect(scanLine("console.log(JSON.stringify(out))")).toBeNull();
  });
  test("diff findings carry the new file's line numbers", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts", "--- a/src/a.ts", "+++ b/src/a.ts",
      "@@ -1,2 +1,3 @@", " keep", "-old", "+fine", "+debugger",
      "@@ -10 +11,2 @@", "+const token = \"sk-ant-" + "api03-abcdefghijklmnopqrstuvwxyz0123\"", "+ok",
      "diff --git a/b.py b/b.py", "--- /dev/null", "+++ b/b.py", "@@ -0,0 +1 @@", "+import " + "pdb",
    ].join("\n");
    expect(scanDiff(diff)).toEqual([
      { file: "src/a.ts", line: 3, label: "debugger statement" },
      { file: "src/a.ts", line: 11, label: "Anthropic API key" },
      { file: "b.py", line: 1, label: "breakpoint" },
    ]);
  });

  describe("hook", () => {
    let repo: string;
    const run = (...args: string[]) => { const p = Bun.spawnSync(["git", "-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { stdout: "ignore", stderr: "pipe" }); if (p.exitCode !== 0) throw new Error(p.stderr.toString()); };
    beforeAll(() => {
      repo = mkdtempSync(join(tmpdir(), "aleph-scan-"));
      run("init", "-q", "-b", "main");
      run("commit", "-q", "--allow-empty", "-m", "init");
    });
    afterAll(() => rmSync(repo, { recursive: true, force: true }));
    async function scan(command: string, cwd = repo) {
      const proc = Bun.spawn(["bun", join(HOOKS, "secret-scan.ts")], {
        stdin: new TextEncoder().encode(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", cwd, tool_input: { command } })),
        env: { ...process.env }, stdout: "pipe",
      });
      await proc.exited;
      const out = (await new Response(proc.stdout).text()).trim();
      return out ? JSON.parse(out).hookSpecificOutput : null;
    }
    test("denies a commit whose staged diff holds a secret, naming file and line", async () => {
      writeFileSync(join(repo, "config.ts"), "export const region = 'us-east-1';\nexport const key = 'AKIA" + "IOSFODNN7EXAMPLE';\n");
      run("add", "config.ts");
      const out = await scan("git commit -m 'add config'");
      expect(out.permissionDecision).toBe("deny");
      expect(out.permissionDecisionReason).toContain("config.ts:2  AWS access key");
      expect(out.permissionDecisionReason).toContain("ALEPH_SKIP_SCAN=1");
      expect(await scan("ALEPH_SKIP_SCAN=1 git commit -m 'add config'")).toBeNull();
      expect(await scan("git log --oneline | grep commit")).toBeNull();
    });
    test("a clean staged diff passes; untracked secrets count only when the command adds them", async () => {
      writeFileSync(join(repo, "config.ts"), "export const region = 'us-east-1';\n");
      run("add", "config.ts");
      writeFileSync(join(repo, "notes.txt"), "slack: xoxb-" + "1234567890-abcdefghij\n");
      expect(await scan("git commit -m 'clean'")).toBeNull();
      expect((await scan("git add . && git commit -m 'all'")).permissionDecisionReason).toContain("notes.txt:1  Slack token");
      expect((await scan("git commit -am 'all'")).permissionDecisionReason).toContain("notes.txt:1  Slack token");
      expect((await scan(`cd ${repo} && git commit -am 'all'`, "/")).permissionDecisionReason).toContain("notes.txt:1");
    });
  });
});
