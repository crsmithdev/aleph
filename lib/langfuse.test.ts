import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { http } from "./langfuse.ts";

/** The rows of each page; its length is the page count the fake reports. */
let pages: any[][] = [];
/** The pages that answer 500 on their first request and their rows on the second. */
let failOnce = new Set<number>();
/** The pages that answer 500 at once on every request. */
let failAlways = new Set<number>();
/** While a test holds this promise unresolved, pages after the first do not answer. */
let hold: Promise<void> = Promise.resolve();
/** The requests open at one time, the most that were open together, and each request's path and query. */
let open = 0, peak = 0, asked: URL[] = [];
let fake: ReturnType<typeof Bun.serve>;

const lf = () => http({ baseUrl: `http://127.0.0.1:${fake.port}`, publicKey: "pk", secretKey: "sk" });
const rows = (n: number) => Array.from({ length: n }, (_, i) => [{ id: `r${i + 1}` }]);
const ticks = async () => { for (let i = 0; i < 100; i++) await new Promise((r) => setTimeout(r, 0)); };

beforeAll(() => {
  fake = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.headers.get("authorization") !== `Basic ${btoa("pk:sk")}`) return new Response("no", { status: 401 });
      if (url.pathname.startsWith("/api/public/sessions/")) return new Response("{}", { status: url.pathname.endsWith("/s1") ? 200 : 404 });
      if (url.pathname.startsWith("/api/public/traces/")) {
        const id = url.pathname.split("/").at(-1);
        return id === "t1" ? Response.json({ id }) : new Response("no", { status: id === "t2" ? 404 : 500 });
      }
      const n = Number(url.searchParams.get("page"));
      asked.push(url); open++; peak = Math.max(peak, open);
      try {
        if (failAlways.has(n)) return new Response("boom", { status: 500 });
        if (n > 1) await hold;
        if (failOnce.delete(n)) return new Response("boom", { status: 500 });
        return Response.json({ data: pages[n - 1] ?? [], meta: { totalPages: pages.length } });
      } finally { open--; }
    },
  });
});
afterAll(() => fake.stop(true));
beforeEach(() => { pages = rows(1); failOnce = new Set(); failAlways = new Set(); hold = Promise.resolve(); open = 0; peak = 0; asked = []; });

test("a read asks Langfuse's list with its query, and a session is known when Langfuse answers it", async () => {
  const from = new Date("2026-11-01T00:00:00Z"), to = new Date("2026-11-02T00:00:00Z");
  await lf().traces({ from, to, core: true });
  await lf().observations({ from, trace: "t1", type: "TOOL" });
  expect(asked.map((u) => [u.pathname, Object.fromEntries(u.searchParams)])).toEqual([
    ["/api/public/traces", { fromTimestamp: from.toISOString(), toTimestamp: to.toISOString(), fields: "core", limit: "100", page: "1" }],
    ["/api/public/observations", { fromStartTime: from.toISOString(), traceId: "t1", type: "TOOL", limit: "100", page: "1" }],
  ]);
  expect([await lf().session("s1"), await lf().session("s2")]).toEqual([true, false]);
});

test("a list of 520 pages comes back whole, four requests at a time, with a page that failed once", async () => {
  pages = rows(520);
  failOnce = new Set([7]);
  let release = () => {};
  hold = new Promise<void>((r) => { release = r; });
  const running = lf().observations({});
  await ticks();
  expect(peak).toBe(4);
  release();
  const got = await running;
  expect([got.rows.length, got.partial, got.pages, peak, asked.length]).toEqual([520, false, 520, 4, 521]);
});

test("a list past the cap reads 2,000 pages and says partial", async () => {
  pages = rows(2001);
  const got = await lf().observations({});
  expect([got.rows.length, got.partial, got.pages]).toEqual([2000, true, 2000]);
});

test("a page that fails twice throws only after every open request has ended", async () => {
  pages = rows(10);
  failAlways = new Set([3]);
  let release = () => {}, ended = false;
  hold = new Promise<void>((r) => { release = r; });
  const running = lf().traces({}).finally(() => { ended = true; });
  await ticks();
  // Page 3 failed twice, but pages 2, 4 and 5 are still open on `hold`.
  expect([open, ended]).toEqual([3, false]);
  release();
  await expect(running).rejects.toThrow("500 on /api/public/traces");
  expect(open).toBe(0);
});

test("a trace comes back whole, null when Langfuse does not have it, and an error throws", async () => {
  expect([await lf().trace("t1"), await lf().trace("t2")]).toEqual([{ id: "t1" }, null]);
  await expect(lf().trace("t3")).rejects.toThrow("500 on /api/public/traces/t3");
});
