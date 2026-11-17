import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { serverArgs } from "./gpt-oss-start.ts";
import { judge } from "../roles/judge.ts";
import { writeLine } from "../roles/title.ts";
import { MODELS } from "../../../lib/models.ts";
import { putJson } from "../../../lib/db.ts";
import { allRuns } from "../records/ledger.ts";
import { gpuSlot } from "../gates/gpu.ts";
import { AGENT_SETTINGS, modelArgv, modelEnv, onGpu, readModels, setModel, viaOf, viaOfRun } from "./models.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "models-")); process.env.ALEPH_FACTORY_DIR = dir; });
afterEach(() => { delete process.env.ALEPH_FACTORY_DIR; rmSync(dir, { recursive: true, force: true }); });

test("no setting gives small, medium and large on haiku, sonnet and Opus, and each role model on its default, each enabled", () => {
  expect(readModels()).toEqual({
    small: { enabled: true, model: "haiku" },
    medium: { enabled: true, model: "sonnet" },
    large: { enabled: true, model: "claude-opus-5-5" },
    review: { enabled: true, model: "claude-opus-5-5" },
    intake: { enabled: true, model: "claude-opus-5-5" },
    director: { enabled: true, model: "claude-opus-5-5" },
    monitor: { enabled: true, model: "deepseek-v4.1-flash" },
    lens: { enabled: true, model: "claude-opus-5-5" },
    housekeeper: { enabled: true, model: "claude-opus-5-5" },
    maintainer: { enabled: true, model: "sonnet" },
    title: { enabled: true, model: "haiku" },
    judge: { enabled: true, model: "haiku" },
  });
});

test("an entry set to a model it offers reads back; a model it does not offer, an unknown or old name, or a disable of a role model is an error text", () => {
  expect(setModel("small", { model: "gpt-oss-20b" })).toBeNull();
  expect(setModel("medium", { enabled: false })).toBeNull();
  const m = readModels();
  expect(m.small).toEqual({ enabled: true, model: "gpt-oss-20b" });
  expect(m.medium).toEqual({ enabled: false, model: "sonnet" });
  expect(setModel("housekeeper", { model: "sonnet" })).toBeNull();
  expect(m.housekeeper).toEqual({ enabled: true, model: "claude-opus-5-5" });
  expect(readModels().housekeeper.model).toBe("sonnet");
  expect(setModel("lens", { enabled: false })).toContain("can be disabled");
  expect(setModel("small", { model: "sonnet" })).toContain("offers");
  expect(setModel("nonexistent", { model: "haiku" })).toContain("unknown");
  expect(setModel("worker-low", { model: "haiku" })).toContain("unknown");
  expect(setModel("intake", { model: "nonexistent" })).toContain("offers");
  expect(setModel("review", { enabled: false })).toContain("can be disabled");
  expect(setModel("merge", { model: "haiku" })).toContain("unknown");
  expect(readModels()).toEqual({ ...m, housekeeper: { enabled: true, model: "sonnet" } });
});

test("any one size can be disabled, and a disable of the last enabled size is an error text that changes nothing", () => {
  expect(setModel("large", { enabled: false })).toBeNull();
  expect(readModels().large.enabled).toBe(false);
  expect(setModel("large", { enabled: true })).toBeNull();
  expect(setModel("small", { enabled: false })).toBeNull();
  expect(setModel("medium", { enabled: false })).toBeNull();
  expect(setModel("large", { enabled: false })).toContain("one size stays on");
  expect(readModels().large.enabled).toBe(true);
});

test("a models setting stored under the old names reads back under small, medium and review", () => {
  putJson("settings", "models", { "worker-low": { enabled: false, model: "gpt-oss-20b" }, "worker-medium": { enabled: false, model: "sonnet" }, reviewer: { model: "sonnet" } });
  const m = readModels();
  expect(m.small).toEqual({ enabled: false, model: "gpt-oss-20b" });
  expect(m.medium).toEqual({ enabled: false, model: "sonnet" });
  expect(m.review).toEqual({ enabled: true, model: "sonnet" });
});

test("a merge run follows the size of its model, and an opus run follows large", () => {
  expect(setModel("small", { model: "deepseek-v4.1-flash" })).toBeNull();
  expect(viaOfRun({ model: "haiku", merge: true }, readModels())).toBe("openrouter");
  expect(viaOfRun({ model: "sonnet", merge: true }, readModels())).toBe("claude");
  expect(viaOfRun({ model: "opus" }, readModels())).toBe("claude");
  expect(setModel("large", { model: "gpt-oss-20b" })).toBeNull();
  expect(viaOfRun({ model: "opus" }, readModels())).toBe("local");
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

test("every entry offers its Claude model first, then every model Claude does not serve", () => {
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

test("a judge call keeps one run of the judge with its model and its end, out of the report", async () => {
  const cmd = join(dir, "fake");
  writeFileSync(cmd, `#!/bin/sh\nprintf '%s' ${JSON.stringify(JSON.stringify({ type: "result", is_error: false, result: JSON.stringify({ verdict: "pass", reason: "ok" }), total_cost_usd: 0.01 }))}\n`, { mode: 0o755 });
  const saved = process.env.ALEPH_JUDGE_CMD, before = new Set(allRuns().map((e) => e.id));
  process.env.ALEPH_JUDGE_CMD = cmd;
  try {
    expect(setModel("judge", { model: "deepseek-v4.1-flash" })).toBeNull();
    await judge("TURN: x", "x");
  } finally {
    if (saved === undefined) delete process.env.ALEPH_JUDGE_CMD; else process.env.ALEPH_JUDGE_CMD = saved;
  }
  const runs = allRuns().filter((e) => !before.has(e.id)).map((e) => e.run);
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ role: "judge", model: "deepseek-v4.1-flash", state: "done", shown: true });
  expect(runs[0].ended).toBeTruthy();
});

test("a title call on the local model whose GPU slot stays taken keeps its run on haiku, the model it ran on", async () => {
  const env = { ALEPH_RULE_CMD: join(dir, "fake"), ALEPH_JOBS_DIR: join(dir, "jobs"), XDG_RUNTIME_DIR: join(dir, "run") };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  writeFileSync(env.ALEPH_RULE_CMD, `#!/bin/sh\nprintf '%s' '{"type":"result","is_error":false,"result":"A title"}'\n`, { mode: 0o755 });
  const T0 = Date.parse("2026-11-04T00:00:00Z"), before = new Set(allRuns().map((e) => e.id));
  setSystemTime(T0);
  const release = (await gpuSlot(0))!;
  try {
    expect(setModel("title", { model: "gpt-oss-20b" })).toBeNull();
    const line = writeLine("Write a rule.", "a quote", 200);
    setSystemTime(T0 + 31_000); // the 30 s box ends while the slot stays taken
    expect(await line).toBe("A title");
  } finally {
    release();
    setSystemTime();
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  expect(allRuns().filter((e) => !before.has(e.id)).map((e) => e.run.model)).toEqual(["haiku"]);
});
