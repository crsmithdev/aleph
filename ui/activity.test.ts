import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activity, clearCache } from "./activity.ts";
import { withEnv } from "./test-server.ts";

let obsHits = 0;
/** Resolves at the next observations request that reaches the fake Langfuse. */
let nextHit = () => {};
/** While a test holds this promise unresolved, the fake Langfuse does not answer observations. */
let hold: Promise<void> = Promise.resolve();
let base: string, fake: ReturnType<typeof Bun.serve>;
let restore: () => void;

const now = new Date(2026, 10, 4, 23, 0, 0);
const at = (daysAgo: number, hour = 10) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour).toISOString();
const gen = (day: number, model: string, cost: number, trace: string) => ({ id: `g${Math.random()}`, traceId: trace, type: "GENERATION", name: model, model, startTime: at(day), calculatedTotalCost: cost });
const tool = (day: number, name: string, trace: string, level = "DEFAULT") => ({ id: `t${Math.random()}`, traceId: trace, type: "TOOL", name, level, startTime: at(day), metadata: { tool: name } });
const span = (day: number, name: string, trace: string, metadata: object = {}, level = "DEFAULT", output = "") => ({ id: `s${Math.random()}`, traceId: trace, type: "SPAN", name, level, startTime: at(day), metadata, output });
const observations = [
  gen(0, "claude-opus-5-5", 0.25, "ta"), gen(0, "claude-haiku-5-5", 0.05, "tb"), gen(1, "claude-opus-5-5", 0.5, "ta"),
  tool(0, "Bash", "ta"), tool(0, "Bash", "ta", "ERROR"), tool(1, "Read", "ta"), tool(0, "Edit", "tb"), tool(0, "skill:goal", "ta"),
  span(0, "verify-gate", "ta", { verdict: "deny" }, "DEFAULT", "deny: nothing was run"),
  span(0, "verify-gate", "tb", { verdict: "pass" }),
  span(1, "vault-recall", "ta", {}, "ERROR"),
];
const traces = [{ id: "ta", name: "fac", metadata: { cwd: "/x/fac" } }, { id: "tb", name: "other", metadata: { cwd: "/x/other" } }];

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-act-"));
  fake = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (!req.headers.get("authorization")?.startsWith("Basic ")) return new Response("no", { status: 401 });
      if (url.pathname === "/api/public/observations") { obsHits++; nextHit(); }
      if (url.pathname === "/api/public/observations") await hold;
      if (url.pathname === "/api/public/observations") return Response.json({ data: observations, meta: { totalPages: 1 } });
      if (url.pathname === "/api/public/traces") return Response.json({ data: traces, meta: { totalPages: 1 } });
      return new Response("not found", { status: 404 });
    },
  });
  restore = withEnv({
    LANGFUSE_BASE_URL: `http://127.0.0.1:${fake.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk",
  });
});

afterAll(() => {
  fake.stop(true);
  restore();
  rmSync(base, { recursive: true, force: true });
});

describe("activity", () => {

  test("a second request within ALEPH_UI_CACHE_TTL does not reach Langfuse; after it, the old answer comes back at once and one reload runs", async () => {
    // The clock is the test's: only setSystemTime moves it past the TTL, so load cannot.
    const restoreTtl = withEnv({ ALEPH_UI_CACHE_TTL: "300" });
    let release = () => {};
    clearCache();
    try {
      const t0 = now.getTime();
      setSystemTime(t0);
      obsHits = 0;
      const a = await activity(7, null, now);
      const b = await activity(7, null, now);
      expect(obsHits).toBe(1);
      expect(b.cachedAt).toBe(a.cachedAt);
      expect(b.tools).toEqual(a.tools);
      setSystemTime(new Date(t0 + 301_000));
      // The fake Langfuse holds the reload, so both stale requests below come while it is in flight.
      hold = new Promise((r) => { release = r; });
      const reloading = new Promise<void>((r) => { nextHit = r; });
      const c = await activity(7, null, now);
      expect(c.cachedAt).toBe(a.cachedAt);
      await activity(7, null, now);
      await reloading;
      release();
      // The reload ends a few tasks after the fake answers; each turn yields one task and reads again.
      let d = c;
      while ((d = await activity(7, null, now)).cachedAt === a.cachedAt) await new Promise((r) => setTimeout(r, 0));
      expect(obsHits).toBe(2);
      expect(d.cachedAt).toBe(new Date(t0 + 301_000).toISOString());
      await activity(7, "fac", now);
      expect(obsHits).toBe(3);
    } finally {
      setSystemTime();
      release();
      hold = Promise.resolve();
      restoreTtl();
      clearCache();
    }
  });
});


