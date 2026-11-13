import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer } from "./test-server.ts";

let base: string, stop: () => void, restoreEnv: () => void, at: (path: string, init?: RequestInit) => Promise<Response>;
const realFetch = globalThis.fetch;
let healthy = true;
const file = () => join(base, "models.json");
const post = (b: unknown, headers: Record<string, string> = { "X-Aleph-UI": "1" }) => at("/api/models", { method: "POST", headers, body: JSON.stringify(b) });

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-models-"));
  restoreEnv = withEnv({ ALEPH_FACTORY_DIR: base, OPENROUTER_API_KEY: "k-test" });
  // The local server's /health answers or not by the flag, OpenRouter's /v1/key gives a fixed spend; every other fetch goes through.
  globalThis.fetch = ((url: any, init?: any) => String(url).endsWith("/health") ? Promise.resolve(new Response("", { status: healthy ? 200 : 503 }))
    : String(url).endsWith("/v1/key") ? Promise.resolve(Response.json({ data: { usage_daily: 1.5, usage_weekly: 17.5, usage_monthly: 18 } }))
    : realFetch(url, init)) as typeof fetch;
  ({ at, stop } = await withServer());
});
afterAll(() => { globalThis.fetch = realFetch; stop(); restoreEnv(); rmSync(base, { recursive: true, force: true }); });

test("GET /api/models answers each tier with enabled and model plus the local state", async () => {
  healthy = true;
  rmSync(file(), { force: true });
  const b: any = await at("/api/models").then((r) => r.json());
  expect(b.local).toBe("up");
  expect(Object.keys(b.tiers)).toEqual(["worker-low", "worker-medium", "merge", "reviewer", "intake", "director", "monitor", "maintainer", "title", "judge"]);
  expect(b.tiers["worker-medium"]).toEqual({ enabled: true, model: "sonnet" });
  expect(b.spend).toEqual({ day: 1.5, week: 17.5, month: 18 });
});

test("POST /api/models writes a tier's model or enable to models.json", async () => {
  healthy = true;
  const res = await post({ tier: "merge", model: "gpt-oss-20b" });
  expect(res.status).toBe(200);
  expect(JSON.parse(readFileSync(file(), "utf8")).merge).toEqual({ enabled: true, model: "gpt-oss-20b" });
  expect(((await post({ tier: "merge", model: "haiku" }).then((r) => r.json())) as any).tiers.merge.model).toBe("haiku");
  expect(((await post({ tier: "worker-low", enabled: false }).then((r) => r.json())) as any).tiers["worker-low"]).toEqual({ enabled: false, model: "haiku" });
});

test("a missing header gives 403; a bad tier, a model the tier does not offer, and gpt-oss-20b while /health is down give 422; models.json stays", async () => {
  healthy = true;
  const kept = '{"title":{"enabled":true,"model":"haiku"}}';
  writeFileSync(file(), kept);
  expect((await post({ tier: "title", model: "gpt-oss-20b" }, {})).status).toBe(403);
  expect((await post({ tier: "nonexistent", model: "haiku" })).status).toBe(422);
  expect((await post({ tier: "intake", model: "nonexistent" })).status).toBe(422);
  expect((await post({ tier: "worker-low", model: "sonnet" })).status).toBe(422);
  expect((await post({ tier: "title", enabled: false })).status).toBe(422);
  healthy = false;
  expect((await post({ tier: "title", model: "gpt-oss-20b" })).status).toBe(422);
  expect(readFileSync(file(), "utf8")).toBe(kept);
  expect((await post({ tier: "title", model: "haiku" })).status).toBe(200);
});
