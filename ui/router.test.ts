import { expect, test } from "bun:test";
// @ts-ignore router.js is plain JS, shared with the page
import { loader, keysOf, markOf } from "./router.js";
// @ts-ignore lib.js is plain JS, shared with the page
import { markLine } from "./lib.js";

/** A stream the test sends messages on. */
class FakeStream {
  static CLOSED = 2;
  static last: FakeStream;
  readyState = 1;
  on: Record<string, (m: { data: string }) => void> = {};
  onerror = () => {};
  onopen = () => {};
  constructor(public url: string) { FakeStream.last = this; }
  addEventListener(type: string, f: (m: { data: string }) => void) { this.on[type] = f; }
  close() { this.readyState = 2; }
  send(type: string, data: unknown) { this.on[type]({ data: JSON.stringify(data) }); }
}

/** A loader on a fake page: each fetch waits until the test answers it with `answer(i, body, keys)`. */
function page() {
  const asked: { url: string; done: (r: Response) => void }[] = [], drawn: unknown[] = [], firsts: boolean[] = [];
  let focused = false;
  const env = {
    fetch: (url: string) => new Promise<Response>((done) => asked.push({ url, done })),
    EventSource: FakeStream,
    hidden: () => false,
    focused: () => focused,
    armed: () => false,
    ok: () => {},
    fail: () => {},
    draw: async (_route: unknown, data: unknown, first: boolean) => { drawn.push(data); firsts.push(first); },
    event: () => {},
  };
  const answer = (i: number, body: unknown, keys = "") =>
    asked[i].done(new Response(JSON.stringify(body), { headers: keys ? { "x-aleph-keys": keys } : {} }));
  const route = { view: { title: "Status", api: "/api/factory", live: true }, params: {}, query: new URLSearchParams() };
  return { router: loader(env), asked, drawn, firsts, answer, route, focus: (on: boolean) => { focused = on; } };
}

test("an older answer never draws over a newer one", async () => {
  const p = page();
  const first = p.router.show(p.route), again = p.router.reload();
  expect(p.asked.length).toBe(2);
  p.answer(1, { n: "new" });
  await again;
  p.answer(0, { n: "old" });
  await first;
  expect(p.drawn).toEqual([{ n: "new" }]);
});

test("a change of keys the view did not read sends no request", async () => {
  const p = page();
  const shown = p.router.show(p.route);
  p.answer(0, { n: 1 }, "factory:aleph flow:week:aleph");
  await shown;
  expect(p.router.keys).toEqual(["factory:aleph", "flow:week:aleph"]);
  FakeStream.last.send("change", { keys: ["sessions:7"] });
  expect(p.asked.length).toBe(1);
  FakeStream.last.send("change", { keys: ["sessions:7", "flow:week:aleph"] });
  expect(p.asked.length).toBe(2);
});

test("a view whose loads named no key does not reload on a change", async () => {
  const p = page();
  const shown = p.router.show(p.route);
  p.answer(0, { n: 1 });
  await shown;
  FakeStream.last.send("change", { keys: ["factory"] });
  expect(p.asked.length).toBe(1);
});

test("a view's own GET adds its keys, and a new route forgets them", async () => {
  const p = page();
  const shown = p.router.show(p.route);
  p.answer(0, {}, "factory");
  await shown;
  const got = p.router.get("/api/flow");
  p.answer(1, {}, "flow:day");
  await got;
  expect(p.router.keys).toEqual(["factory", "flow:day"]);
  p.router.show({ ...p.route });
  expect(p.router.keys).toEqual([]);
});

test("a view's own GET in a slot: an older answer, or one that comes after the route changed, is null", async () => {
  const p = page();
  const shown = p.router.show(p.route);
  p.answer(0, {});
  await shown;
  const old = p.router.get("/api/memory/search?q=b", "search"), now = p.router.get("/api/memory/search?q=bu", "search");
  p.answer(2, { q: "bu" }, "/api/memory/search?q=bu");
  expect(await (await now).json()).toEqual({ q: "bu" });
  p.answer(1, { q: "b" }, "/api/memory/search?q=b");
  expect(await old).toBeNull();
  expect(p.router.keys).toEqual(["/api/memory/search?q=bu"]);
  const left = p.router.get("/api/memory/notes/N", "note");
  const moved = p.router.show({ ...p.route });
  p.answer(3, { title: "N" });
  expect(await left).toBeNull();
  p.answer(4, {});
  await moved;
});

test("a change while an input has focus reloads after the focus ends", async () => {
  const p = page();
  const shown = p.router.show(p.route);
  p.answer(0, { n: 1 }, "factory");
  await shown;
  p.focus(true);
  FakeStream.last.send("change", { keys: ["factory"] });
  p.router.blur();
  expect(p.asked.length).toBe(1);
  p.focus(false);
  const later = p.router.blur();
  expect(p.asked.length).toBe(2);
  p.answer(1, { n: 2 }, "factory");
  await later;
  expect(p.drawn).toEqual([{ n: 1 }, { n: 2 }]);
});

test("a reload during a reload makes one more, not two", async () => {
  const p = page();
  const shown = p.router.show(p.route);
  p.answer(0, {}, "factory");
  await shown;
  const one = p.router.reload();
  p.router.reload();
  p.router.reload();
  expect(p.asked.length).toBe(2);
  p.answer(1, {}, "factory");
  await one;
  expect(p.asked.length).toBe(3);
});

test("keysOf splits the header, and markOf takes only an error with its time", () => {
  expect(keysOf(new Response("", { headers: { "x-aleph-keys": "a  b" } }))).toEqual(["a", "b"]);
  expect(keysOf(new Response(""))).toEqual([]);
  expect(markOf({ error: "boom", since: "2026-11-09T10:00:00Z", rows: [] })).toEqual({ error: "boom", since: "2026-11-09T10:00:00Z" });
  expect(markOf({ error: "boom" })).toBeNull();
  expect(markOf(null)).toBeNull();
});

test("markLine says how old the data is and why", () => {
  expect(markLine("Status", { error: "worker died", since: "2026-11-09T10:00:00Z" }, Date.parse("2026-11-09T10:05:30Z"))).toBe("Status is 5m 30s old: worker died");
});

test("a view with two URLs reads both, joins them with its combine, and reloads on a key of either", async () => {
  const p = page();
  const route = { ...p.route, view: { ...p.route.view, api: () => ["/api/factory", "/api/automation"], combine: ([s, a]: any[]) => ({ ...s, asks: a.asks }) } };
  const shown = p.router.show(route);
  await Promise.resolve();
  expect(p.asked.map((a) => a.url)).toEqual(["/api/factory", "/api/automation"]);
  p.answer(1, { asks: [1] }, "automation:week");
  p.answer(0, { n: 1 }, "factory");
  await shown;
  expect(p.drawn).toEqual([{ n: 1, asks: [1] }]);
  FakeStream.last.send("change", { keys: ["automation:week"] });
  await Promise.resolve();
  expect(p.asked.length).toBe(4);
});

/** A route whose view loads `/api/flow` in its `more` after its own data. */
const withMore = (p: ReturnType<typeof page>) => ({ ...p.route, view: { ...p.route.view, more: async (d: any) => ({ ...d, flow: await (await p.router.get("/api/flow")).json() }) } });

test("a view with more draws its data at once, then with what more adds, keeping the reader's state; a reload draws once", async () => {
  const p = page(), route = withMore(p);
  const shown = p.router.show(route);
  p.answer(0, { n: 1 });
  await new Promise((ok) => setTimeout(ok));
  expect(p.drawn).toEqual([{ n: 1 }]);
  p.answer(1, { w: 1 });
  await shown;
  // The second draw is not a first one: the page records and restores the open folds, the focus and the typed text.
  expect([p.drawn, p.firsts]).toEqual([[{ n: 1 }, { n: 1, flow: { w: 1 } }], [true, false]]);
  const again = p.router.reload();
  p.answer(2, { n: 2 });
  await new Promise((ok) => setTimeout(ok));
  expect(p.drawn.length).toBe(2);
  p.answer(3, { w: 2 });
  await again;
  expect(p.drawn.at(-1)).toEqual({ n: 2, flow: { w: 2 } });
  expect(p.drawn.length).toBe(3);
});

test("a more that ends after the route changed does not draw", async () => {
  const p = page(), route = withMore(p);
  const shown = p.router.show(route);
  p.answer(0, { n: 1 });
  await new Promise((ok) => setTimeout(ok));
  const next = p.router.show({ ...p.route });
  p.answer(1, { w: 1 });
  p.answer(2, { n: 2 });
  await Promise.all([shown, next]);
  expect(p.drawn).toEqual([{ n: 1 }, { n: 2 }]);
});

test("redraw draws the shown data again for the new query, and with fresh loads it again first", async () => {
  const p = page();
  const shown = p.router.show(p.route);
  p.answer(0, { n: 1 });
  await shown;
  const q = new URLSearchParams("tile=x");
  await p.router.redraw(q);
  expect([p.drawn, p.firsts, p.router.shown.query.get("tile"), p.asked.length]).toEqual([[{ n: 1 }, { n: 1 }], [true, false], "x", 1]);
  const fresh = p.router.redraw(q, true);
  p.answer(1, { n: 2 });
  await fresh;
  expect([p.drawn.at(-1), p.firsts.at(-1)]).toEqual([{ n: 2 }, false]);
});
