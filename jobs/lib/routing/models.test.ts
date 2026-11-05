import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serverArgs } from "./gpt-oss-start.ts";
import { LOCAL, LOCAL_ENV, readModels, setModel } from "./models.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "models-")); process.env.ALEPH_FACTORY_DIR = dir; });
afterEach(() => { delete process.env.ALEPH_FACTORY_DIR; rmSync(dir, { recursive: true, force: true }); });

test("a missing file gives both worker tiers enabled on haiku and sonnet, and merge, title and judge on Claude", () => {
  expect(readModels()).toEqual({
    "worker-low": { enabled: true, model: "haiku" },
    "worker-medium": { enabled: true, model: "sonnet" },
    merge: { enabled: true, model: "haiku" },
    title: { enabled: true, model: "haiku" },
    judge: { enabled: true, model: "haiku" },
  });
});

test("an old-shape file reads in the new shape and is written back in it", () => {
  writeFileSync(join(dir, "models.json"), JSON.stringify({ "worker.haiku": "local", merge: "local" }));
  const m = readModels();
  expect(m["worker-low"]).toEqual({ enabled: true, model: LOCAL.model });
  expect(m.merge).toEqual({ enabled: true, model: LOCAL.model });
  expect(m["worker-medium"]).toEqual({ enabled: true, model: "sonnet" });
  expect(JSON.parse(readFileSync(join(dir, "models.json"), "utf8"))).toEqual(m);
});

test("a tier set to a model it offers reads back; a model it does not offer, an unknown tier or a disable of a non-worker tier is an error text", () => {
  expect(setModel("worker-low", { model: LOCAL.model })).toBeNull();
  expect(setModel("worker-medium", { enabled: false })).toBeNull();
  const m = readModels();
  expect(m["worker-low"]).toEqual({ enabled: true, model: LOCAL.model });
  expect(m["worker-medium"]).toEqual({ enabled: false, model: "sonnet" });
  expect(setModel("worker-low", { model: "sonnet" })).toContain("offers");
  expect(setModel("intake", { model: "haiku" })).toContain("unknown tier");
  expect(setModel("merge", { enabled: false })).toContain("can be disabled");
  expect(readModels()).toEqual(m);
});

test("the local entry names gpt-oss-20b and the base URL", () => {
  expect(LOCAL.model).toBe("gpt-oss-20b");
  expect(LOCAL.baseUrl).toBe("http://127.0.0.1:8012");
});

test("the compact window fits the server's context and leaves a usable threshold", () => {
  const a = serverArgs("/h", null);
  const ctx = Number(a[a.indexOf("--ctx-size") + 1]);
  const window = Number(LOCAL_ENV.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  const maxOut = Number(LOCAL_ENV.CLAUDE_CODE_MAX_OUTPUT_TOKENS ?? 32000);
  expect(window).toBeGreaterThan(0);
  expect(window).toBeLessThanOrEqual(ctx);
  expect(window - Math.min(maxOut, 20000) - 13000).toBeGreaterThanOrEqual(20000);
});
