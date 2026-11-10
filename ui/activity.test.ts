import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activity } from "./activity.ts";
import { closePass, openPass } from "../jobs/lib/infra/sources.ts";
import { withEnv } from "./test-server.ts";

let obsHits = 0;
/** Resolves at the next observations request that reaches the fake Langfuse. */
let nextHit = () => {};
/** Resolves when four observations requests are open at one time. */
let atFour: () => void = () => {};
/** While a test holds this promise unresolved, the fake Langfuse does not answer observations. */
let hold: Promise<void> = Promise.resolve();
/** Set by the test that counts how the pages pile up: page 1 answers at once, the rest wait on `hold`. */
let pileUp = false;
/** The rows of each observations page; its length is the page count the fake reports. */
let obsPages: any[][] = [];
/** The pages that answer 500 on their first request and their rows on the second. */
let failOnce = new Set<number>();
/** The pages that answer 500 at once on every request. */
let failAlways = new Set<number>();
/** The observations requests open at one time, and the most that were open together. */
let open = 0, peak = 0;
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
/** `n` pages of one tool call, one hook call and one denial each. */
const manyPages = (n: number) => Array.from({ length: n }, (_, i) => {
  const trace = `p${i + 1}`;
  return [tool(0, "Bash", trace), span(0, "vault-recall", trace), span(0, "verify-gate", trace, { verdict: "deny" }, "DEFAULT", "deny: nope")];
});

beforeAll(() => {
  obsPages = [observations];
  base = mkdtempSync(join(tmpdir(), "aleph-ui-act-"));
  fake = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (!req.headers.get("authorization")?.startsWith("Basic ")) return new Response("no", { status: 401 });
      if (url.pathname === "/api/public/observations") {
        const n = Number(url.searchParams.get("page") ?? "1");
        obsHits++; open++; peak = Math.max(peak, open); nextHit();
        if (open === 4) atFour();
        try {
          if (failAlways.has(n)) return new Response("boom", { status: 500 });
          if (!pileUp || n > 1) await hold;
          if (failOnce.delete(n)) return new Response("boom", { status: 500 });
          return Response.json({ data: obsPages[n - 1] ?? [], meta: { totalPages: obsPages.length } });
        } finally { open--; }
      }
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

  test("in a build pass a second read does not reach Langfuse; after a Langfuse change it does", async () => {
    obsHits = 0;
    try {
      openPass({ langfuse: 1 }, "activity.test");
      const a = await activity(7, null, now);
      const b = await activity(7, null, now);
      expect(obsHits).toBe(1);
      expect(b.cachedAt).toBe(a.cachedAt);
      openPass({ langfuse: 2 }, "activity.test");
      await activity(7, null, now);
      expect(obsHits).toBe(2);
    } finally { closePass(); }
  });

  test("a week longer than the 499 pages the fetch read before comes back whole, four requests at a time, with a page that failed once", async () => {
    obsPages = manyPages(520);
    failOnce = new Set([7]);
    obsHits = 0; open = 0; peak = 0; pileUp = true;
    let release = () => {}, four = () => {};
    const fourOpen = new Promise<void>((r) => { four = r; });
    hold = new Promise<void>((r) => { release = r; });
    atFour = four;
    try {
      const running = activity(7, null, now);
      // Every page waits on `hold`, so a fetch that opens more than four shows it here.
      await fourOpen;
      for (let i = 0; i < 100; i++) await new Promise((r) => setTimeout(r, 0));
      expect(peak).toBeLessThanOrEqual(4);
      release();
      const a = await running;
      expect(a.langfuse).toBe("ok");
      expect(a.partial).toBe(false);
      expect(a.tools.map((t) => [t.name, t.calls])).toEqual([["Bash", 520]]);
      expect(a.hooks.map((h) => [h.name, h.calls])).toEqual([["vault-recall", 520], ["verify-gate", 520]]);
      expect(a.denials.total).toBe(520);
      expect(peak).toBeLessThanOrEqual(4);
      expect(obsHits).toBe(521);
    } finally {
      release();
      hold = Promise.resolve();
      atFour = () => {};
      pileUp = false;
      obsPages = [observations];
      failOnce = new Set();
    }
  });

  test("a week past the pages the fetch reads comes back with the counts of part of it, and says so", async () => {
    obsPages = manyPages(2001);
    obsHits = 0;
    try {
      const a = await activity(7, null, now);
      expect(a.langfuse).toBe("ok");
      expect(a.partial).toBe(true);
      expect(a.tools.map((t) => [t.name, t.calls])).toEqual([["Bash", 2000]]);
    } finally {
      obsPages = [observations];
    }
  });

  test("a list past the cap answers a failed page only after every request has ended, and once read says partial", async () => {
    obsPages = manyPages(2001);
    failAlways = new Set([3]);
    pileUp = true;
    let release = () => {};
    hold = new Promise<void>((r) => { release = r; });
    try {
      let ended = false;
      const running = activity(7, null, now).then((a) => { ended = true; return a; });
      for (let i = 0; i < 100; i++) await new Promise((r) => setTimeout(r, 0));
      // Page 3 failed twice, but pages 2, 4 and 5 are still open on `hold`.
      expect(open).toBe(3);
      expect(ended).toBe(false);
      release();
      const failed = await running;
      expect(failed.langfuse).toBe("error");
      expect(open).toBe(0);
      failAlways = new Set();
      pileUp = false;
      const a = await activity(7, null, now);
      expect(a.langfuse).toBe("ok");
      expect(a.partial).toBe(true);
    } finally {
      release();
      hold = Promise.resolve();
      pileUp = false;
      failAlways = new Set();
      obsPages = [observations];
    }
  });
});


