import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attrs, traceIdFor, truncate } from "./lib/otlp.ts";
import { loadDotenv } from "./lib/env.ts";

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
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(process.env.LANGFUSE_PUBLIC_KEY).toBe("pk-file");
    expect(process.env.LANGFUSE_SECRET_KEY).toBe("sk-shell");
    rmSync(join(file, ".."), { recursive: true, force: true });
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
      env: { ...process.env, LANGFUSE_BASE_URL: `http://127.0.0.1:${server.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk", ALEPH_SPOOL: spool },
      stdout: "pipe", stderr: "pipe",
    });
    const code = await proc.exited;
    return { code, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() };
  }
  const lastSpans = () => posted.at(-1).body.resourceSpans[0].scopeSpans[0].spans;
  const attr = (span: any, key: string) => span.attributes.find((a: any) => a.key === key)?.value;

  test("SessionStart posts a root span with trace attributes and auth headers", async () => {
    const r = await fire({ hook_event_name: "SessionStart", source: "startup", permission_mode: "auto" });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    const spans = lastSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].traceId).toBe(traceIdFor(session));
    expect(spans[0].name).toBe("session");
    expect(attr(spans[0], "langfuse.session.id")).toEqual({ stringValue: session });
    expect(attr(spans[0], "langfuse.trace.name")).toEqual({ stringValue: "proj" });
    expect(attr(spans[0], "langfuse.trace.tags")).toEqual({ arrayValue: { values: [{ stringValue: "source:startup" }, { stringValue: "mode:auto" }] } });
    expect(posted.at(-1).url).toBe("/api/public/otel/v1/traces");
    expect(posted.at(-1).headers["x-langfuse-ingestion-version"]).toBe("4");
    expect(posted.at(-1).headers.authorization).toBe(`Basic ${Buffer.from("pk:sk").toString("base64")}`);
  });

  test("prompt → tool → stop nest under one turn span with real tool duration", async () => {
    await fire({ hook_event_name: "UserPromptSubmit", prompt_id: "p1", prompt: "hello" });
    const prompt = lastSpans()[0];
    expect(prompt.name).toBe("prompt");
    const turnId = prompt.parentSpanId;
    expect(turnId).toMatch(/^[0-9a-f]{16}$/);

    const pre = await fire({ hook_event_name: "PreToolUse", prompt_id: "p1", tool_name: "Bash", tool_use_id: "t1", tool_input: { command: "ls" } });
    expect(pre.code).toBe(0);
    const before = posted.length;
    await Bun.sleep(120);
    await fire({ hook_event_name: "PostToolUse", prompt_id: "p1", tool_name: "Bash", tool_use_id: "t1", tool_input: { command: "ls" }, tool_response: "a\nb" });
    expect(posted.length).toBe(before + 1);
    const tool = lastSpans()[0];
    expect(tool.name).toBe("Bash");
    expect(tool.parentSpanId).toBe(turnId);
    expect(attr(tool, "langfuse.observation.type")).toEqual({ stringValue: "tool" });
    expect(attr(tool, "langfuse.observation.output")).toEqual({ stringValue: "a\nb" });
    const durationMs = Number(BigInt(tool.endTimeUnixNano) - BigInt(tool.startTimeUnixNano)) / 1e6;
    expect(durationMs).toBeGreaterThan(100);

    await fire({ hook_event_name: "PostToolUseFailure", prompt_id: "p1", tool_name: "Skill", tool_use_id: "t2", tool_input: { skill: "aleph:interview" }, tool_error: "boom" });
    const failed = lastSpans()[0];
    expect(failed.name).toBe("skill:aleph:interview");
    expect(failed.status).toEqual({ code: 2, message: "boom" });
    expect(attr(failed, "langfuse.observation.level")).toEqual({ stringValue: "ERROR" });

    await fire({ hook_event_name: "Stop", prompt_id: "p1", last_assistant_message: "done" });
    const turn = lastSpans()[0];
    expect(turn.name).toBe("turn");
    expect(turn.spanId).toBe(turnId);
    expect(turn.parentSpanId).toBeUndefined();
    expect(attr(turn, "langfuse.observation.output")).toEqual({ stringValue: "done" });
  });

  test("subagent tools nest under the agent span, which nests under the turn", async () => {
    await fire({ hook_event_name: "UserPromptSubmit", prompt_id: "p2", prompt: "delegate" });
    const turnId = lastSpans()[0].parentSpanId;
    await fire({ hook_event_name: "SubagentStart", prompt_id: "p2", agent_id: "a1", agent_type: "Explore" });
    await fire({ hook_event_name: "PreToolUse", prompt_id: "p2", agent_id: "a1", agent_type: "Explore", tool_name: "Read", tool_use_id: "t3", tool_input: { file_path: "/x" } });
    await fire({ hook_event_name: "PostToolUse", prompt_id: "p2", agent_id: "a1", agent_type: "Explore", tool_name: "Read", tool_use_id: "t3", tool_input: { file_path: "/x" }, tool_response: "…" });
    const tool = lastSpans()[0];
    await fire({ hook_event_name: "SubagentStop", prompt_id: "p2", agent_id: "a1", agent_type: "Explore", last_assistant_message: "found it" });
    const agent = lastSpans()[0];
    expect(agent.name).toBe("Explore");
    expect(agent.parentSpanId).toBe(turnId);
    expect(tool.parentSpanId).toBe(agent.spanId);
  });

  test("unknown events become metadata-only events; missing keys exit silently", async () => {
    await fire({ hook_event_name: "PreCompact", compact_reason: "auto", trigger: "auto" });
    const ev = lastSpans()[0];
    expect(ev.name).toBe("PreCompact");
    expect(attr(ev, "langfuse.observation.metadata.compact_reason")).toEqual({ stringValue: "auto" });

    const before = posted.length;
    const proc = Bun.spawn(["bun", join(HOOKS, "obs.ts")], {
      stdin: new TextEncoder().encode(JSON.stringify({ session_id: session, hook_event_name: "Stop" })),
      env: { PATH: process.env.PATH, HOME: mkdtempSync(join(tmpdir(), "nohome-")), ALEPH_SPOOL: spool },
      stdout: "pipe",
    });
    expect(await proc.exited).toBe(0);
    expect(posted.length).toBe(before);
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
