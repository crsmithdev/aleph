/**
 * LIVE. Spends real plan usage. Opt in with ALEPH_LIVE=1.
 *
 * These exist because CI cannot prove the SDK auth path works, and "the echo
 * runner passed" is not evidence that the real one does.
 */
import { test, expect, describe, afterEach } from "bun:test";
import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts";
import { startDaemon, type RunningDaemon } from "../helpers/daemon-process.ts";
import { SdkRunner, sanitizedEnv } from "../../src/sessions/sdk-runner.ts";

const LIVE = process.env.ALEPH_LIVE === "1";
const describeLive = LIVE ? describe : describe.skip;

let ws: Workspace | null = null;
let daemon: RunningDaemon | null = null;

afterEach(async () => {
  if (daemon) { await daemon.stop(); daemon = null; }
  if (ws) { ws.cleanup(); ws = null; }
});

describe("env hygiene (safe without ALEPH_LIVE)", () => {
  test("inherited CLAUDE_CODE_* identity is stripped; auth vars are kept", () => {
    const env = sanitizedEnv({
      CLAUDE_CODE_SESSION_ID: "parent", CLAUDE_EFFORT: "high", CLAUDECODE: "1",
      ANTHROPIC_BASE_URL: "https://api", ANTHROPIC_API_KEY: "k", PATH: "/bin",
    });
    expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
    expect(env.CLAUDE_EFFORT).toBeUndefined();
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api");
    expect(env.ANTHROPIC_API_KEY).toBe("k");
    expect(env.PATH).toBe("/bin");
  });
});

describeLive("live Agent SDK", () => {
  test("a real turn returns text, a session id and usage", async () => {
    const runner = new SdkRunner();
    const result = await runner.run({ prompt: "Reply with exactly one word: pong", model: "claude-haiku-4-5-20251001" });
    expect(result.text.toLowerCase()).toContain("pong");
    expect(result.sdk_session_id).toMatch(/[0-9a-f-]{36}/);
    expect(result.usage.output_tokens).toBeGreaterThan(0);
  }, 180_000);

  test("resume carries context across turns", async () => {
    const runner = new SdkRunner();
    const first = await runner.run({ prompt: "My favourite number is 41. Reply with just: ok", model: "claude-haiku-4-5-20251001" });
    const second = await runner.run({
      prompt: "What is my favourite number plus one? Reply with just the number.",
      model: "claude-haiku-4-5-20251001", resume: first.sdk_session_id,
    });
    expect(second.text).toContain("42");
  }, 300_000);

  test("through the daemon: two turns on one topic, second answers from the first", async () => {
    ws = makeWorkspace();
    // switch the workspace to the real runner and a real model
    const cfg = readFileSync(ws.configFile, "utf8")
      .replace('runner = "echo"', 'runner = "sdk"')
      .replace('T2 = { model = "test-sonnet" }', 'T2 = { model = "claude-haiku-4-5-20251001" }')
      .replace("window_5h = 1000", "window_5h = 4000000")
      .replace("weekly = 100000", "weekly = 40000000");
    writeFileSync(ws.configFile, cfg);

    daemon = await startDaemon(ws.configFile, ws.socket);
    await daemon.send("Remember: the spine ships 36 event kinds. Reply with just: noted", "live-memory");
    const reply = await daemon.send("How many event kinds ship with the spine? Reply with just the number.", "live-memory");
    expect(reply).toContain("36");

    const sessions = await daemon.call("sessions");
    expect(sessions.length).toBe(1);
    expect(sessions[0].turn_count).toBe(2);

    const dir = ws.eventsDir;
    const events = readdirSync(dir).flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
    const resumed = events.find((e) => e.kind === "session.resumed");
    expect(resumed).toBeDefined();
    const usage = events.filter((e) => e.kind === "meter.usage_recorded");
    expect(usage.every((e) => e.payload.source === "sdk")).toBe(true);
    expect(usage.some((e) => e.payload.output_tokens > 0)).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    expect(existsSync(join(ws.vaultDir, "log", `${today}.md`))).toBe(true);
  }, 600_000);
});
