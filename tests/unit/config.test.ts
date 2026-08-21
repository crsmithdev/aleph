import { test, expect, describe } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/core/config.ts";
import { ConfigError } from "../../src/core/errors.ts";

function dir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "cfg-"));
  for (const [name, body] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body);
  }
  return root;
}

describe("config", () => {
  test("defaults fill in and the committed config parses", () => {
    const { config } = loadConfig({ file: "config/aleph.toml", host: "no-such-host", env: {} });
    expect(config.meter.reserve.window_5h).toBe(0.30);
    expect(config.lanes.backlog?.enabled).toBe(false);
    expect(config.routing.tiers.T0?.enabled).toBe(false);
  });

  test("a per-host overlay wins and its source is recorded", () => {
    const root = dir({
      "aleph.toml": `[daemon]\ndata_dir = "./a"\n`,
      "hosts/box.toml": `[daemon]\ndata_dir = "./b"\n`,
    });
    const loaded = loadConfig({ file: join(root, "aleph.toml"), host: "box", env: {} });
    expect(loaded.config.daemon.data_dir).toBe("./b");
    expect(loaded.sources["daemon.data_dir"]).toBe(join(root, "hosts/box.toml"));
  });

  test("ALEPH_ env overrides win over both, and are typed", () => {
    const root = dir({ "aleph.toml": `[sessions]\narchive_days = 7\n` });
    const loaded = loadConfig({ file: join(root, "aleph.toml"), host: "none", env: { ALEPH_SESSIONS__ARCHIVE_DAYS: "3" } });
    expect(loaded.config.sessions.archive_days).toBe(3);
    expect(loaded.sources["sessions.archive_days"]).toBe("env");
  });

  test("an unresolved ${VAR} is a boot failure, never an empty string", () => {
    const root = dir({ "aleph.toml": `[telegram]\nbot_token = "\${NOPE_TOKEN}"\n` });
    expect(() => loadConfig({ file: join(root, "aleph.toml"), host: "none", env: {} })).toThrow(ConfigError);
    const ok = loadConfig({ file: join(root, "aleph.toml"), host: "none", env: { NOPE_TOKEN: "t" } });
    expect(ok.config.telegram.bot_token).toBe("t");
  });

  test("a bad type fails with the path to the offending key", () => {
    const root = dir({ "aleph.toml": `[sessions]\narchive_days = "soon"\n` });
    try {
      loadConfig({ file: join(root, "aleph.toml"), host: "none", env: {} });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).path).toBe("sessions.archive_days");
    }
  });

  test("the config hash does not depend on secret VALUES", () => {
    const root = dir({ "aleph.toml": `[telegram]\nbot_token = "\${T}"\n` });
    const a = loadConfig({ file: join(root, "aleph.toml"), host: "none", env: { T: "one" } });
    const b = loadConfig({ file: join(root, "aleph.toml"), host: "none", env: { T: "two" } });
    expect(a.hash).toBe(b.hash);
  });

  test("the documented example config is valid once its env is present", () => {
    const loaded = loadConfig({
      file: "config/aleph.example.toml", host: "none",
      env: { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c", TELEGRAM_OWNER_ID: "o", LANGFUSE_PROJECT_ID: "p", LANGFUSE_OTLP_AUTH: "Basic x" },
    });
    expect(loaded.config.telegram.enabled).toBe(true);
    expect(loaded.config.obs.otlp_headers.Authorization).toBe("Basic x");
  });
});

describe("lane defaults", () => {
  test("backlog is OFF even when a config omits the section entirely", async () => {
    const { laneConfig } = await import("../../src/core/config.ts");
    const root = dir({ "aleph.toml": `runner = "echo"\n` });
    const { config } = loadConfig({ file: join(root, "aleph.toml"), host: "none", env: {} });
    expect(laneConfig(config, "backlog").enabled).toBe(false);
    expect(laneConfig(config, "research").enabled).toBe(true);
    expect(laneConfig(config, "interactive").enabled).toBe(true);
  });
});
