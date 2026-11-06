import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serverArgs } from "./gpt-oss-start.ts";
import { MODELS, modelArgv, modelEnv, onGpu, readModels, setModel, viaOf } from "./models.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "models-")); process.env.ALEPH_FACTORY_DIR = dir; });
afterEach(() => { delete process.env.ALEPH_FACTORY_DIR; rmSync(dir, { recursive: true, force: true }); });

test("a missing file gives both worker tiers enabled on haiku and sonnet, and merge, title and judge on Claude", () => {
  expect(readModels()).toEqual({
    "worker-low": { enabled: true, model: "haiku" },
    "worker-medium": { enabled: true, model: "sonnet" },
    merge: { enabled: true, model: "haiku" },
    reviewer: { enabled: true, model: "claude-opus-5-5" },
    intake: { enabled: true, model: "claude-opus-5-5" },
    director: { enabled: true, model: "claude-opus-5-5" },
    monitor: { enabled: true, model: "deepseek-v4.1-flash" },
    title: { enabled: true, model: "haiku" },
    judge: { enabled: true, model: "haiku" },
  });
});

test("an old-shape file reads in the new shape and is written back in it", () => {
  writeFileSync(join(dir, "models.json"), JSON.stringify({ "worker.haiku": "local", merge: "local" }));
  const m = readModels();
  expect(m["worker-low"]).toEqual({ enabled: true, model: "gpt-oss-20b" });
  expect(m.merge).toEqual({ enabled: true, model: "gpt-oss-20b" });
  expect(m["worker-medium"]).toEqual({ enabled: true, model: "sonnet" });
  expect(JSON.parse(readFileSync(join(dir, "models.json"), "utf8"))).toEqual(m);
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
  expect(setModel("merge", { enabled: false })).toContain("can be disabled");
  expect(readModels()).toEqual(m);
});

test("a Claude model adds no env; gpt-oss-20b adds the local server and takes the GPU slot; an OpenRouter model adds OpenRouter, the key and an empty API key", () => {
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
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
  }
});

test("the argv passes the model's id, and no --model when there is none", () => {
  expect(modelArgv("claude", "deepseek-v4.1-flash", ["--x"])).toEqual(["claude", "-p", "--strict-mcp-config", "--disable-slash-commands", "--model", "deepseek/deepseek-v4.1-flash", "--x"]);
  expect(modelArgv("claude", "claude-opus-5-5", [])).toContain("claude-opus-5-5");
  expect(modelArgv("claude", undefined, ["--x"])).toEqual(["claude", "-p", "--strict-mcp-config", "--disable-slash-commands", "--x"]);
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
