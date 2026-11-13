import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { serverArgs } from "./gpt-oss-start.ts";
import { judge } from "../../../hooks/lib/judge.ts";
import { writeLine } from "../roles/title.ts";
import { AGENT_SETTINGS, MODELS, modelArgv, modelEnv, onGpu, readModels, setModel, viaOf, viaOfRun } from "./models.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "models-")); process.env.ALEPH_FACTORY_DIR = dir; });
afterEach(() => { delete process.env.ALEPH_FACTORY_DIR; rmSync(dir, { recursive: true, force: true }); });

test("a missing file gives both worker tiers enabled on haiku and sonnet, and title and judge on Claude", () => {
  expect(readModels()).toEqual({
    "worker-low": { enabled: true, model: "haiku" },
    "worker-medium": { enabled: true, model: "sonnet" },
    reviewer: { enabled: true, model: "claude-opus-5-5" },
    intake: { enabled: true, model: "claude-opus-5-5" },
    director: { enabled: true, model: "claude-opus-5-5" },
    monitor: { enabled: true, model: "deepseek-v4.1-flash" },
    maintainer: { enabled: true, model: "sonnet" },
    title: { enabled: true, model: "haiku" },
    judge: { enabled: true, model: "haiku" },
  });
});

test("a tier set to a model it offers reads back; a model it does not offer, an unknown tier or a disable of a non-worker tier is an error text", () => {
  expect(setModel("worker-low", { model: "gpt-oss-20b" })).toBeNull();
  expect(setModel("worker-medium", { enabled: false })).toBeNull();
  const m = readModels();
  expect(m["worker-low"]).toEqual({ enabled: true, model: "gpt-oss-20b" });
  expect(m["worker-medium"]).toEqual({ enabled: false, model: "sonnet" });
  expect(setModel("worker-low", { model: "sonnet" })).toContain("offers");
  expect(setModel("nonexistent", { model: "haiku" })).toContain("unknown tier");
  expect(setModel("intake", { model: "nonexistent" })).toContain("offers");
  expect(setModel("reviewer", { enabled: false })).toContain("can be disabled");
  expect(setModel("merge", { model: "haiku" })).toContain("unknown tier");
  expect(readModels()).toEqual(m);
});

test("a merge run follows the worker tier of its model", () => {
  expect(setModel("worker-low", { model: "deepseek-v4.1-flash" })).toBeNull();
  expect(viaOfRun({ model: "haiku", merge: true }, readModels())).toBe("openrouter");
  expect(viaOfRun({ model: "sonnet", merge: true }, readModels())).toBe("claude");
});

test("a Claude model adds no env; gpt-oss-20b adds the local server and takes the GPU slot; an OpenRouter model adds OpenRouter, the key and an empty API key", () => {
  const keys = ["OPENROUTER_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_DEFAULT_HAIKU_MODEL"];
  const saved = keys.map((k) => process.env[k]);
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  try {
    process.env.ANTHROPIC_BASE_URL = "https://openrouter.ai/api";
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = "deepseek/deepseek-v4.1-flash";
    for (const name of ["haiku", "claude-opus-5-5"]) {
      const env = { ...process.env, ...modelEnv(name) };
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    }
    expect({ ...process.env, ...modelEnv("gpt-oss-20b") }.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:8012");
    expect(onGpu("haiku")).toBe(false);
    expect(modelEnv("gpt-oss-20b")).toMatchObject({ ANTHROPIC_BASE_URL: "http://127.0.0.1:8012", ANTHROPIC_AUTH_TOKEN: "local" });
    expect(onGpu("gpt-oss-20b")).toBe(true);
    expect(modelEnv("deepseek-v4.1-flash")).toMatchObject({ ANTHROPIC_BASE_URL: "https://openrouter.ai/api", ANTHROPIC_AUTH_TOKEN: "sk-or-test", ANTHROPIC_API_KEY: "", ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek/deepseek-v4.1-flash" });
    expect(onGpu("deepseek-v4.1-flash")).toBe(false);
    expect(viaOf("deepseek-v4.1-flash")).toBe("openrouter");
  } finally {
    keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
  }
});

test("the argv passes the model's id, and no --model when there is none", () => {
  expect(modelArgv("claude", "deepseek-v4.1-flash", ["--x"])).toEqual(["claude", "-p", "--strict-mcp-config", "--disable-slash-commands", "--settings", AGENT_SETTINGS, "--model", "deepseek/deepseek-v4.1-flash", "--x"]);
  expect(modelArgv("claude", "claude-opus-5-5", [])).toContain("claude-opus-5-5");
  expect(modelArgv("claude", undefined, ["--x"])).toEqual(["claude", "-p", "--strict-mcp-config", "--disable-slash-commands", "--settings", AGENT_SETTINGS, "--x"]);
  expect(modelArgv("claude", "opus", ["--x"], true)).toEqual(["claude", "-p", "--strict-mcp-config", "--model", "claude-opus-5-5", "--x"]);
});

test("an agent role leaves out Chris's CLAUDE.md, runs at high effort and says it is an agent", () => {
  const s = JSON.parse(AGENT_SETTINGS);
  expect(s.claudeMdExcludes).toContain(join(homedir(), ".claude", "CLAUDE.md"));
  expect(s.effortLevel).toBe("high");
  expect(s.env).toEqual({ ALEPH_AGENT: "1" });
});

test("every tier offers its Claude model first, then every model Claude does not serve", () => {
  expect(setModel("title", { model: "deepseek-v4.1-flash" })).toBeNull();
  expect(readModels().title.model).toBe("deepseek-v4.1-flash");
  const others = Object.keys(MODELS).filter((m) => viaOf(m) !== "claude");
  expect(others).toEqual(["gpt-oss-20b", "deepseek-v4.1-flash", "gpt-6-luna", "minimax-m3.1-flash", "step-3.5-flash", "mimo-v2.6-flash"]);
});

test("minimax-m3.1-flash carries the OpenRouter list price, with the input price as the cache write", () => {
  expect(MODELS["minimax-m3.1-flash"].price).toEqual({ input: 0.075, output: 0.3, cacheRead: 0.0075, cacheWrite: 0.075 });
});

test("the compact window fits the server's context and leaves a usable threshold", () => {
  const a = serverArgs("/h", null);
  const ctx = Number(a[a.indexOf("--ctx-size") + 1]);
  const local = modelEnv("gpt-oss-20b");
  const window = Number(local.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  const maxOut = Number(local.CLAUDE_CODE_MAX_OUTPUT_TOKENS ?? 32000);
  expect(window).toBeGreaterThan(0);
  expect(window).toBeLessThanOrEqual(ctx);
  expect(window - Math.min(maxOut, 20000) - 13000).toBeGreaterThanOrEqual(20000);
});

// Each slot that calls `claude -p` itself: its command's env var, the result its stand-in prints, and one call.
const SLOTS = [
  { slot: "judge", cmd: "ALEPH_JUDGE_CMD", result: JSON.stringify({ verdict: "pass", reason: "ok" }), call: () => judge("TURN: x", "x") },
  { slot: "title", cmd: "ALEPH_RULE_CMD", result: "A title", call: () => writeLine("Write a rule.", "a quote", 200) },
] as const;
for (const { slot, cmd, result, call } of SLOTS) {
  test(`a ${slot} slot set to local runs claude on gpt-oss-20b at the local base URL, and a claude slot on haiku`, async () => {
    // The GPU slot of a local call reads the live runs and a lock: both stay in the temp folder.
    const env = { [cmd]: join(dir, "record"), ALEPH_JUDGE: "haiku", ALEPH_JOBS_DIR: join(dir, "jobs"), XDG_RUNTIME_DIR: join(dir, "run") };
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    Object.assign(process.env, env);
    writeFileSync(join(dir, "record"), `#!/bin/sh\necho "$@" > ${join(dir, "args")}\nenv > ${join(dir, "env")}\nprintf '%s' ${JSON.stringify(JSON.stringify({ type: "result", is_error: false, result }))}\n`, { mode: 0o755 });
    try {
      expect(setModel(slot, { model: "gpt-oss-20b" })).toBeNull();
      await call();
      expect(readFileSync(join(dir, "args"), "utf8")).toContain("--model gpt-oss-20b");
      expect(readFileSync(join(dir, "env"), "utf8")).toContain("ANTHROPIC_BASE_URL=http://127.0.0.1:8012");
      expect(setModel(slot, { model: "haiku" })).toBeNull();
      await call();
      expect(readFileSync(join(dir, "args"), "utf8")).toContain("--model haiku");
      expect(readFileSync(join(dir, "env"), "utf8")).not.toContain("ANTHROPIC_BASE_URL");
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}
