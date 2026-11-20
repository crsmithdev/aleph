import { afterAll, beforeAll, expect, test } from "bun:test";
import { conn, getJson, putJson } from "../lib/db.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer } from "./server.testkit.ts";

let base: string, stop: () => void, restoreEnv: () => void, at: (path: string, init?: RequestInit) => Promise<Response>;
const realFetch = globalThis.fetch;
let healthy = true;
const post = (b: unknown, headers: Record<string, string> = { "X-Aleph-UI": "1" }) => at("/api/models", { method: "POST", headers, body: JSON.stringify(b) });

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-models-"));
  restoreEnv = withEnv({ ALEPH_FACTORY_DIR: base, ALEPH_DB: join(base, "aleph.db"), OPENROUTER_API_KEY: "k-test" });
  // The local server's /health answers or not by the flag, OpenRouter's /v1/key gives a fixed spend; every other fetch goes through.
  globalThis.fetch = ((url: any, init?: any) => String(url).endsWith("/health") ? Promise.resolve(new Response("", { status: healthy ? 200 : 503 }))
    : String(url).endsWith("/v1/key") ? Promise.resolve(Response.json({ data: { usage_daily: 1.5, usage_weekly: 17.5, usage_monthly: 18 } }))
    : realFetch(url, init)) as typeof fetch;
  ({ at, stop } = await withServer());
});
afterAll(() => { globalThis.fetch = realFetch; stop(); restoreEnv(); rmSync(base, { recursive: true, force: true }); });

test("GET /api/models answers each size and role model under models with enabled and model plus the local state", async () => {
  healthy = true;
  conn().run("DELETE FROM settings WHERE key = 'models'");
  const b: any = await at("/api/models").then((r) => r.json());
  expect(b.local).toBe("up");
  expect(Object.keys(b.models)).toEqual(["small", "medium", "large", "review", "intake", "director", "monitor", "housekeeper", "maintainer", "judge", "investigator"]);
  expect(b.models.medium).toEqual({ enabled: true, model: "sonnet" });
  expect(b).not.toHaveProperty("tiers");
  expect(b.spend).toEqual({ day: 1.5, week: 17.5, month: 18 });
});

test("POST /api/models writes an entry's model or enable to the models setting", async () => {
  healthy = true;
  expect(((await post({ name: "review", model: "haiku" }).then((r) => r.json())) as any).models.review.model).toBe("haiku");
  const res = await post({ name: "review", model: "gpt-oss-20b" });
  expect(res.status).toBe(200);
  expect(getJson<any>("settings", "models", {}).review).toEqual({ enabled: true, model: "gpt-oss-20b" });
  expect(((await post({ name: "review", model: "haiku" }).then((r) => r.json())) as any).models.review.model).toBe("haiku");
  expect(((await post({ name: "small", enabled: false }).then((r) => r.json())) as any).models.small).toEqual({ enabled: false, model: "haiku" });
});

test("a missing header gives 403; a bad name, a model the entry does not offer, and gpt-oss-20b while /health is down give 422; the models setting stays", async () => {
  healthy = true;
  const kept = { judge: { enabled: true, model: "haiku" } };
  putJson("settings", "models", kept);
  expect((await post({ name: "nonexistent", model: "haiku" })).status).toBe(422);
  expect((await post({ name: "merge", model: "haiku" })).status).toBe(422);
  expect((await post({ name: "intake", model: "nonexistent" })).status).toBe(422);
  expect((await post({ name: "small", model: "sonnet" })).status).toBe(422);
  expect((await post({ name: "judge", enabled: false })).status).toBe(422);
  healthy = false;
  expect((await post({ name: "judge", model: "gpt-oss-20b" })).status).toBe(422);
  expect(getJson("settings", "models", {})).toEqual(kept);
  expect((await post({ name: "judge", model: "haiku" })).status).toBe(200);
});
