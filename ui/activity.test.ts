import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activity, clearCache, routes } from "./api/activity.ts";
// @ts-ignore activity.js is plain JS, shared with the page
import { renderActivity, view } from "./views/activity.js";

let obsHits = 0;
let base: string, fake: ReturnType<typeof Bun.serve>;
const saved: Record<string, string | undefined> = {};

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
    fetch(req) {
      const url = new URL(req.url);
      if (!req.headers.get("authorization")?.startsWith("Basic ")) return new Response("no", { status: 401 });
      if (url.pathname === "/api/public/observations") obsHits++;
      if (url.pathname === "/api/public/observations") return Response.json({ data: observations, meta: { totalPages: 1 } });
      if (url.pathname === "/api/public/traces") return Response.json({ data: traces, meta: { totalPages: 1 } });
      return new Response("not found", { status: 404 });
    },
  });
  for (const [k, v] of Object.entries({
    LANGFUSE_BASE_URL: `http://127.0.0.1:${fake.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk",
  })) { saved[k] = process.env[k]; process.env[k] = v; }
});

afterAll(() => {
  fake.stop(true);
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(base, { recursive: true, force: true });
});

describe("activity", () => {
  test("counts tools and their errors, leaving skills to their own view", async () => {
    const a = await activity(7, null, now);
    expect(a.langfuse).toBe("ok");
    expect(a.tools).toEqual([{ name: "Bash", calls: 2, errors: 1 }, { name: "Edit", calls: 1, errors: 0 }, { name: "Read", calls: 1, errors: 0 }]);
  });

  test("hook runs with errors, and the verify-gate denials", async () => {
    const a = await activity(7, null, now);
    expect(a.hooks).toEqual([{ name: "verify-gate", calls: 2, errors: 0 }, { name: "vault-recall", calls: 1, errors: 1 }]);
    expect(a.denials.total).toBe(1);
    expect(a.denials.recent[0].reason).toBe("nothing was run");
  });

  test("?project keeps one project's traces and runs", async () => {
    const a = await activity(7, "fac", now);
    expect(a.tools.find((t) => t.name === "Edit")).toBeUndefined();
    const o = await activity(7, "other", now);
    expect(o.tools.map((t) => t.name)).toEqual(["Edit"]);
  });

  test("a second request within ALEPH_UI_CACHE_TTL does not reach Langfuse; after it, one does", async () => {
    const saveTtl = process.env.ALEPH_UI_CACHE_TTL;
    process.env.ALEPH_UI_CACHE_TTL = "0.3";
    clearCache();
    try {
      obsHits = 0;
      const a = await activity(7, null, now);
      const b = await activity(7, null, now);
      expect(obsHits).toBe(1);
      expect(b.cachedAt).toBe(a.cachedAt);
      expect(b.tools).toEqual(a.tools);
      await Bun.sleep(400);
      const c = await activity(7, null, now);
      expect(obsHits).toBe(2);
      expect(c.cachedAt).not.toBe(a.cachedAt);
      await activity(7, "fac", now);
      expect(obsHits).toBe(3);
    } finally {
      if (saveTtl === undefined) delete process.env.ALEPH_UI_CACHE_TTL; else process.env.ALEPH_UI_CACHE_TTL = saveTtl;
      clearCache();
    }
  });

  test("without Langfuse keys the ledger half still answers", async () => {
    const k = process.env.LANGFUSE_PUBLIC_KEY;
    process.env.LANGFUSE_PUBLIC_KEY = "";
    try {
      const a = await activity(7, null, now);
      expect(a.langfuse).toBe("off");
    } finally { process.env.LANGFUSE_PUBLIC_KEY = k; }
  });
});

describe("routes and view", () => {
  test("the routes take days and project", async () => {
    const a: any = await (await routes["GET /api/activity"](new Request("http://x/api/activity"), {}, new URL("http://x/api/activity?days=3&project=fac"))).json();
    expect(a.days).toHaveLength(3);
    expect(routes["GET /api/summary"]).toBeUndefined();
  });

  test("the view is titled Tools and renders tools, hooks and denials only", async () => {
    const a = await activity(7, null, now);
    const html = renderActivity(a);
    expect(view.title).toBe("Tools");
    expect(view.group).toBe("activity");
    for (const t of ["Tools", "Hooks", "Verify-gate denials", "Bash", "verify-gate", "nothing was run"]) expect(html).toContain(t);
    for (const t of ["Last 30 days", "Cost per day", "Cost per model", "Factory runs per day"]) expect(html).not.toContain(t);
  });

  test("a view with no Langfuse says so, and text is escaped", () => {
    const a = { days: ["2026-10-27"], langfuse: "off", tools: [], hooks: [], denials: { total: 0, recent: [] } };
    expect(renderActivity(a)).toContain("Langfuse is not configured");
    const b = { ...a, langfuse: "ok", tools: [{ name: "<b>", calls: 1, errors: 0 }] };
    expect(renderActivity(b)).toContain("&lt;b&gt;");
  });
});
