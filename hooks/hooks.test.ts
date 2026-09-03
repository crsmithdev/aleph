import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attrs, traceIdFor, truncate } from "./lib/otlp.ts";

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
