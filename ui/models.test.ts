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
  restoreEnv = withEnv({ ALEPH_FACTORY_DIR: base });
  // The local server's /health answers or not by the flag; every other fetch goes through.
  globalThis.fetch = ((url: any, init?: any) => String(url).endsWith("/health") ? Promise.resolve(new Response("", { status: healthy ? 200 : 503 })) : realFetch(url, init)) as typeof fetch;
  ({ at, stop } = await withServer());
});
afterAll(() => { globalThis.fetch = realFetch; stop(); restoreEnv(); rmSync(base, { recursive: true, force: true }); });

test("POST /api/models writes a valid slot and backend to models.json", async () => {
  healthy = true;
  const res = await post({ slot: "merge", backend: "local" });
  expect(res.status).toBe(200);
  expect(JSON.parse(readFileSync(file(), "utf8")).merge).toBe("local");
  expect(((await post({ slot: "merge", backend: "claude" }).then((r) => r.json())) as any).slots.merge).toBe("claude");
});

test("a missing header gives 403, a bad slot or backend 422, and local while /health is down is refused; models.json stays", async () => {
  healthy = true;
  writeFileSync(file(), '{"title":"claude"}');
  expect((await post({ slot: "title", backend: "local" }, {})).status).toBe(403);
  expect((await post({ slot: "intake", backend: "local" })).status).toBe(422);
  expect((await post({ slot: "title", backend: "gemini" })).status).toBe(422);
  healthy = false;
  expect((await post({ slot: "title", backend: "local" })).status).toBe(422);
  expect(readFileSync(file(), "utf8")).toBe('{"title":"claude"}');
  expect((await post({ slot: "title", backend: "claude" })).status).toBe(200);
});
