import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activity, clearCache } from "./api/activity.ts";
import { withEnv } from "./test-server.ts";

let obsHits = 0;
/** While a test holds this promise unresolved, the fake Langfuse does not answer observations. */
let hold: Promise<void> = Promise.resolve();
let base: string, fake: ReturnType<typeof Bun.serve>;
let restore: () => void;

const real = new Date();
const now = new Date(real.getFullYear(), real.getMonth(), real.getDate(), 23, 0, 0);
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
      if (url.pathname === "/api/public/observations") obsHits++;
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
  test("counts tools and their errors, leaving skills to their own view", async () => {
    const a = await activity(7, null, now);
    expect(a.langfuse).toBe("ok");
    expect(a.tools.map(({ lastAt, ...c }) => c)).toEqual([{ name: "Bash", calls: 2, errors: 1 }, { name: "Edit", calls: 1, errors: 0 }, { name: "Read", calls: 1, errors: 0 }]);
    const last = a.tools[0]?.lastAt ?? "";
    expect(new Date(last).toISOString()).toBe(last);
    expect(Array.isArray(a.projects)).toBe(true);
  });

  test("hook runs with errors, and the verify-gate denials", async () => {
    const a = await activity(7, null, now);
    expect(a.hooks.map(({ lastAt, ...c }) => c)).toEqual([{ name: "verify-gate", calls: 2, errors: 0 }, { name: "vault-recall", calls: 1, errors: 1 }]);
    expect(a.denials.total).toBe(1);
    expect(a.denials.recent[0].reason).toBe("nothing was run");
  });

  test("?project keeps one project's traces and runs", async () => {
    const a = await activity(7, "fac", now);
    expect(a.tools.find((t) => t.name === "Edit")).toBeUndefined();
    const o = await activity(7, "other", now);
    expect(o.tools.map((t) => t.name)).toEqual(["Edit"]);
  });

  test("a second request within ALEPH_UI_CACHE_TTL does not reach Langfuse; after it, the old answer comes back at once and one reload runs", async () => {
    // Load cannot use up 300 s; the expiry below is forced by shortening the TTL, not by waiting.
    const restoreTtl = withEnv({ ALEPH_UI_CACHE_TTL: "300" });
    let release = () => {};
    clearCache();
    try {
      obsHits = 0;
      const a = await activity(7, null, now);
      const b = await activity(7, null, now);
      expect(obsHits).toBe(1);
      expect(b.cachedAt).toBe(a.cachedAt);
      expect(b.tools).toEqual(a.tools);
      process.env.ALEPH_UI_CACHE_TTL = "0.001";
      await Bun.sleep(20);
      // The fake Langfuse holds the reload, so both stale requests below come while it is in flight.
      hold = new Promise((r) => { release = r; });
      const c = await activity(7, null, now);
      expect(c.cachedAt).toBe(a.cachedAt);
      await activity(7, null, now);
      for (let i = 0; i < 800 && obsHits < 2; i++) await Bun.sleep(25);
      process.env.ALEPH_UI_CACHE_TTL = "300";
      release();
      let d = c;
      for (let i = 0; i < 800 && d.cachedAt === a.cachedAt; i++) { await Bun.sleep(25); d = await activity(7, null, now); }
      expect(obsHits).toBe(2);
      expect(d.cachedAt).not.toBe(a.cachedAt);
      await activity(7, "fac", now);
      expect(obsHits).toBe(3);
    } finally {
      release();
      hold = Promise.resolve();
      restoreTtl();
      clearCache();
    }
  });

  test("without Langfuse keys the ledger half still answers", async () => {
    const restoreKey = withEnv({ LANGFUSE_PUBLIC_KEY: "" });
    try {
      const a = await activity(7, null, now);
      expect(a.langfuse).toBe("off");
    } finally { restoreKey(); }
  });
});

describe("routes", () => {
});


