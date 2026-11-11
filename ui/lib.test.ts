import { setCodes } from "../lib/naming.ts";
import { afterEach, describe, expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import { renderHerald } from "./views/now.js";
import { withFactory } from "./test-now.ts";
// @ts-ignore lib.js is plain JS, shared with the page
import { clamp, moreFold, fold, linkButton, actButton, postJson, legendHtml, meter, repoIdLink, repoOf, badge, priorityBadge, statusRow, chart, chips, filterBar, seg, scope, wireScope, projectKeysOnce, idLink, pageHead, pager, sortHead, sectionHead, card, shortModel, when, chartTheme, clock, cmd, diffHtml, loadDiff, empty, error, esc, failMessage, loading, md, money, pct, wkText, mountView, recordState, restoreState, wireFolds, restoreFolds, span, dur, tone, searchBox, nextSort, limitOf, sortRows, keep, kept } from "./lib.js";
// @ts-ignore lib.js is plain JS, shared with the page
import * as lib from "./lib.js";

test("md renders a heading, a list, code and a link", () => {
  const h = md("# Title\n\nSome `code` here.\n\n- one\n- [two](https://example.com/a?b=1&c=2)\n\n1. first\n2. second\n\n```\nx < y\n```");
  expect(h).toContain("<h1>Title</h1>");
  expect(h).toContain("<p>Some <code>code</code> here.</p>");
  expect(h).toContain('<ul><li>one</li><li><a href="https://example.com/a?b=1&amp;c=2">two</a></li></ul>');
  expect(h).toContain("<ol><li>first</li><li>second</li></ol>");
  expect(h).toContain("<pre><code>x &lt; y</code></pre>");
});

test("md renders a pipe table with a head, a body and escaped cells", () => {
  const h = md("| Step | Who |\n|---|:--:|\n| one | `a<b` |");
  expect(h).toContain("<table><thead><tr><th>Step</th><th>Who</th></tr></thead>");
  expect(h).toContain("<tbody><tr><td>one</td><td><code>a&lt;b</code></td></tr></tbody>");
  expect(h).not.toContain("<p>");
});

test("md makes a table of a pipe line only when a delimiter row follows it", () => {
  expect(md("a | b\nc")).toBe("<p>a | b c</p>");
  expect(md("a | b\n--|--\nc | d")).toBe("<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>c</td><td>d</td></tr></tbody></table>");
});

test("mountView calls mount only when the view has one", () => {
  const calls: unknown[][] = [];
  expect(mountView({ mount: (...a: unknown[]) => calls.push(a) }, "root", 1)).toBe(true);
  expect(calls).toEqual([["root", 1]]);
  expect(mountView({}, "root", 1)).toBe(false);
});

test("mountView hands an async mount to the caller, and a failed mount rejects", async () => {
  const done = mountView({ mount: async () => {} }, "root", 1);
  expect(done).toBeInstanceOf(Promise);
  expect(await done).toBe(true);
  await expect(mountView({ mount: async () => { throw new Error("no chart"); } }, "root", 1)).rejects.toThrow("no chart");
});

test("chart on() attaches a handler that survives a re-theme", () => {
  const g = globalThis as any;
  const made: any[] = [];
  let retheme = () => {};
  const keep = { echarts: g.echarts, matchMedia: g.matchMedia, ResizeObserver: g.ResizeObserver, getComputedStyle: g.getComputedStyle, document: g.document };
  g.echarts = {
    registerTheme() {},
    init() {
      const c: any = { ons: [], getOption: () => ({}), setOption() {}, dispose() {}, resize() {} };
      c.on = (ev: string, fn: unknown) => c.ons.push([ev, fn]);
      made.push(c);
      return c;
    },
  };
  g.matchMedia = () => ({ addEventListener: (_: string, fn: () => void) => { retheme = fn; }, removeEventListener() {} });
  g.ResizeObserver = class { observe() {} disconnect() {} };
  g.getComputedStyle = () => ({ getPropertyValue: () => "" });
  g.document = { documentElement: {} };
  try {
    const fn = () => {};
    const c = chart({}, {});
    c.on("click", fn);
    expect(made[0].ons).toEqual([["click", fn]]);
    retheme();
    expect(made[1].ons).toEqual([["click", fn]]);
  } finally {
    Object.assign(g, keep);
  }
});

test("legendHtml() gives one item per entry", () => {
  const h = legendHtml([["One", "c-use"], ["Two"]]);
  expect(h.match(/<li>/g)).toHaveLength(2);
  expect(h).toContain('<i class="c-use"></i>One');
});

test("failMessage shows the reason from the body", () => {
  expect(failMessage("/api/sessions", 502, '{"error":"Langfuse is unreachable at http://x"}')).toBe("/api/sessions answered 502: Langfuse is unreachable at http://x");
  expect(failMessage("/api/sessions", 404, "not found")).toBe("/api/sessions answered 404: not found");
  expect(failMessage("/api/sessions", 500, "")).toBe("/api/sessions answered 500");
  expect(failMessage("/api/x", 500, "a".repeat(1000))).toBe(`/api/x answered 500: ${"a".repeat(300)}`);
});

// A small fake document: just enough of querySelector(All), open, hidden, value and innerHTML for record/restore.
function fakeRoot(html: string) {
  const mk = (tag: string, attrs: Record<string, string>, inner = "", extra: any = {}) => ({
    tag, attrs, innerHTML: inner, textContent: inner, hidden: "hidden" in attrs, open: "open" in attrs, value: attrs.value ?? "", name: attrs.name ?? "", type: attrs.type ?? "",
    getAttribute(n: string) { return n in attrs ? attrs[n] : null; }, remove() { this.removed = true; }, removed: false, ...extra,
  });
  const details: any[] = [];
  const panels: any[] = [];
  for (const m of html.matchAll(/<details([^>]*)><summary>(.*?)<\/summary>(.*?)<\/details>/g)) {
    const fields = [...m[3].matchAll(/<input name="(\w+)"/g)].map((f) => mk("input", { name: f[1] }));
    const d: any = mk("details", /open/.test(m[1]) ? { open: "" } : {}, m[3]);
    d.summary = { textContent: m[2] };
    d.dataset = { fold: /data-fold="([^"]*)"/.exec(m[1])?.[1] };
    d.querySelector = () => d.summary;
    d.querySelectorAll = () => fields;
    details.push(d);
  }
  for (const m of html.matchAll(/<div class="diff-panel" data-diff-for="(\w+)" hidden><\/div>/g)) panels.push(mk("div", { "data-diff-for": m[1], hidden: "" }));
  return {
    details, panels,
    querySelectorAll: (sel: string) => (sel === "details" ? details : sel.includes("diff-for") ? panels : []),
  };
}

const HTML = '<details><summary>Input</summary><input name="a"></details><details><summary>Input</summary><input name="b"></details><div class="diff-panel" data-diff-for="j1" hidden></div>';

test("recordState and restoreState bring back open details, a shown diff and typed text", () => {
  const before = fakeRoot(HTML);
  before.details[1].open = true;
  before.details[1].querySelectorAll()[0].value = "typed";
  before.panels[0].hidden = false;
  before.panels[0].innerHTML = "<pre>+x</pre>";
  const state = recordState(before);
  const after = fakeRoot(HTML);
  restoreState(after, state);
  expect(after.details[0].open).toBe(false);
  expect(after.details[1].open).toBe(true);
  expect(after.details[1].querySelectorAll()[0].value).toBe("typed");
  expect(after.panels[0].hidden).toBe(false);
  expect(after.panels[0].innerHTML).toBe("<pre>+x</pre>");
});

test("a Herald group open before a newer event for its subject is open after it, and no localStorage key is written", () => {
  const g = globalThis as any, writes: string[] = [];
  g.localStorage = { getItem: () => null, setItem: (k: string) => void writes.push(k) };
  const ev = (at: string, n: number) => ({ at, by: "gate", subject: "aleph-77", action: "done", on: [`aleph-77#${n}`] });
  const herald = (events: any[]) => renderHerald({ ...withFactory({}), now: "2026-11-09T12:00:00Z", asks: [], stuck: [], herald: { history: [], events, titles: {} } });
  const old = [ev("2026-11-10T10:00:00Z", 1), ev("2026-11-10T10:01:00Z", 2)];
  const before = fakeRoot(herald(old));
  before.details[0].open = true;
  const state = recordState(before);
  const after = fakeRoot(herald([...old, ev("2026-11-10T11:00:00Z", 3)]));
  expect(after.details[0].summary.textContent).not.toBe(before.details[0].summary.textContent);
  restoreState(after, state);
  expect(after.details[0].open).toBe(true);
  expect(writes).toEqual([]);
  delete g.localStorage;
});

test("restoreState ignores state for elements the new HTML no longer has", () => {
  const before = fakeRoot(HTML);
  before.details[0].open = true;
  before.panels[0].hidden = false;
  before.panels[0].innerHTML = "x";
  const state = recordState(before);
  const after = fakeRoot("<p>nothing</p>");
  expect(() => restoreState(after, state)).not.toThrow();
  expect(() => restoreState(after, null)).not.toThrow();
});

test("a fold keeps its open state through keep() and kept(), and a fold with no kept state shows its default", () => {
  const g = globalThis as any, store = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  try {
    let toggle: any;
    const root = (ds: any[]) => ({ querySelectorAll: (sel: string) => (sel === "details[data-keep]" ? ds : []), addEventListener: (t: string, f: any) => { if (t === "toggle") toggle = f; } });
    wireFolds(root([]));
    const opened = { dataset: { keep: "more:a1" }, open: true };
    toggle({ target: { closest: () => opened } });
    expect(store.get("aleph.more:a1")).toBe("true");
    const fresh = [{ dataset: { keep: "more:a1" }, open: false }, { dataset: { keep: "ask:a2" }, open: false }];
    restoreFolds(root(fresh));
    expect(fresh.map((f) => f.open)).toEqual([true, false]);
  } finally { delete g.localStorage; }
});

test("chips gives labels as chips, nothing for none", () => {
  expect(chips(["ui", "goal"])).toBe('<span class="chips"><span class="chip">ui</span><span class="chip">goal</span></span>');
  expect(chips([])).toBe("");
  expect(chips(undefined)).toBe("");
  expect(chips(["<b>"])).toContain("&lt;b&gt;");
});

test("repoIdLink shows the short id", () => {
  setCodes({ aleph: "a" });
  expect(repoOf("my-repo-5.1")).toBe("my-repo");
  expect(repoOf("wt")).toBe("");
  expect(repoIdLink("aleph-5", "#/x")).toBe('<a class="idl" href="#/x">a5</a>');
  expect(repoIdLink("wt", "#/x")).toBe('<a class="idl" href="#/x">wt</a>');
  setCodes({});
});

test("tone maps the feed's actions to the badge tones, and any other action to quiet", () => {
  expect(["reran", "escalated", "red", "filed", "answered"].map(tone)).toEqual(["run", "need", "stuck", "done", "done"]);
  expect(tone("no-such-action")).toBe("quiet");
});

test("idLink and pageHead", () => {
  expect(idLink("aleph-1", "#/jobs/aleph-1")).toBe('<a class="idl" href="#/jobs/aleph-1">aleph-1</a>');
  expect(idLink("x", "javascript:alert(1)")).toContain('href="#"');
  expect(idLink("x", "#/y", { title: "full" })).toBe('<a class="idl" title="full" href="#/y">x</a>');
  expect(priorityBadge("low")).not.toContain("dim");
  expect(pageHead("Jobs", { count: 12, aside: "<b>x</b>" })).toBe('<header class="ph"><h1>Jobs</h1><span class="count">12</span><div class="aside"><b>x</b></div></header>');
  expect(pageHead("Jobs")).toBe('<header class="ph"><h1>Jobs</h1></header>');
  expect(pageHead("T", { cls: "view-only", after: "<i></i>", aside: "a" })).toBe('<header class="ph"><h1 class="view-only">T</h1><i></i><div class="aside">a</div></header>');
  expect(pageHead("Jobs", { count: 0 })).toContain('<span class="count">0</span>');
  expect(pageHead("", { head: "shead", after: "<i></i>", aside: "a" })).toBe('<header class="ph shead"><i></i><div class="aside">a</div></header>');
});

test("statusRow puts the state, the priority, then the labels in a status row", () => {
  expect(statusRow(badge("running"), priorityBadge("high"), chips(["ui"]))).toBe(`<div class="status-row">${badge("running")}${priorityBadge("high")}${chips(["ui"])}</div>`);
});

test("when gives mm/dd hh:mm this year, YYYY-MM-DD another year, and '' for a bad date", () => {
  const now = new Date(2026, 10, 4);
  expect(when(new Date(2026, 9, 28, 14, 5), now)).toBe("10/28 14:05");
  expect(when(new Date(2025, 11, 3, 14, 5), now)).toBe("2025-12-03");
  expect(when("x")).toBe("");
});

test("wkText follows the pct rule, and the Values table of docs/design.md lists those examples", async () => {
  const got = [1.4, 0.4].map((p) => wkText({ pct: p }));
  expect(got).toEqual(["≈1% wk", "≈0.4% wk"]);
  const row = (await Bun.file(new URL("../docs/design.md", import.meta.url)).text()).split("\n").find((l) => l.startsWith("| Weekly share |"))!;
  expect(row.split("|")[2].trim().split(", ")).toEqual(got);
});

test("clock gives hh:mm, and '' when it gets no time", () => {
  expect([null, undefined, "", "x"].map(clock)).toEqual(["", "", "", ""]);
  expect(clock(new Date(2026, 9, 28, 14, 5))).toBe("14:05");
});

test("pct shows whole percents, one decimal under 1%, <0.1% under 0.05 and – for none", () => {
  expect([null, undefined, NaN].map(pct)).toEqual(["–", "–", "–"]);
  expect([0.02, 0.5, 30, 2.5].map(pct)).toEqual(["<0.1%", "0.5%", "30%", "3%"]);
});

test("meter draws one share or segments as a .meter with a role=img aria-label", () => {
  const one = meter(42.5, "42.5 of the cap");
  expect(one).toContain('class="meter"');
  expect(one).toContain('role="img" aria-label="42.5 of the cap"');
  expect(one).toContain('style="width:42.5%"');
  const many = meter([{ pct: 10, cls: "c-use" }, { pct: 0 }, { pct: 30, cls: "c-err" }], "a & b");
  expect([...many.matchAll(/width:([\d.]+)%/g)].map((m) => m[1])).toEqual(["10.0", "30.0"]);
  expect(many).toContain('aria-label="a &amp; b"');
  expect(meter(5)).toContain('aria-hidden="true"');
});

test("nextSort flips the current key and starts a new key by downFirst", () => {
  const down = new Set(["cost"]);
  expect(nextSort({ key: "a", dir: 1 }, "a", down)).toEqual({ key: "a", dir: -1 });
  expect(nextSort({ key: "a", dir: -1 }, "a", down)).toEqual({ key: "a", dir: 1 });
  expect(nextSort({ key: "a", dir: 1 }, "cost", down)).toEqual({ key: "cost", dir: -1 });
  expect(nextSort({ key: "a", dir: -1 }, "b", down)).toEqual({ key: "b", dir: 1 });
});

test("limitOf is the page size unless the limit is a larger number", () => {
  const q = (s: string) => new URLSearchParams(s);
  expect(limitOf(q(""), 50)).toBe(50);
  expect(limitOf(q("limit=x"), 50)).toBe(50);
  expect(limitOf(q("limit=20"), 50)).toBe(50);
  expect(limitOf(q("limit=120"), 50)).toBe(120);
});

test("sortRows sorts a copy, numbers by value, text in numeric mode, ties by tie", () => {
  const rows = [{ n: "10", v: 5, id: 2 }, { n: "2", v: 9, id: 1 }, { n: "2", v: 5, id: 0 }];
  const by = { n: (r: any) => r.n, v: (r: any) => r.v };
  const snap = JSON.stringify(rows);
  expect(sortRows(rows, by, { key: "n", dir: 1 }, (a: any, b: any) => a.id - b.id).map((r: any) => r.id)).toEqual([0, 1, 2]);
  expect(sortRows(rows, by, { key: "v", dir: 1 }, (a: any, b: any) => a.id - b.id).map((r: any) => r.id)).toEqual([0, 2, 1]);
  expect(sortRows(rows, by, { key: "v", dir: -1 }, (a: any, b: any) => a.id - b.id).map((r: any) => r.id)).toEqual([1, 0, 2]);
  expect(JSON.stringify(rows)).toBe(snap);
});

test("the legend of the Tests and the Live chart ends above the grid at 390 and 1440px", async () => {
  // @ts-ignore the vendored ECharts bundle has no types
  const echarts = (await import("./vendor/echarts.min.js")).default;
  // @ts-ignore issues.js is plain JS, shared with the page
  const { testsFrame } = await import("./views/issues.js");
  // @ts-ignore chart.js is plain JS, shared with the page
  const { option } = await import("./chart.js");
  const now = new Date("2026-11-04T12:00:00Z");
  const tests = Object.fromEntries(["aleph", "sidetone", "voiceover"].map((p) => [p, [{ at: "2026-11-04T10:00:00Z", ran: 100, rerunPassed: 1 }]]));
  const roles = ["Worker", "Judge", "Planner", "Reviewer", "Intake"];
  const live = {
    measure: { name: "Agents Live", unit: "count", agg: "max" }, over: { kind: "time", window: "week" }, by: { name: "Role", keys: roles.map((n) => ({ key: n, name: n })) },
    rows: [{ at: Date.parse("2026-11-04T10:00:00Z"), ...Object.fromEntries(roles.map((n, i) => [n, i + 1])) }, { at: Date.parse("2026-11-04T11:00:00Z"), ...Object.fromEntries(roles.map((n, i) => [n, i + 2])) }],
  };
  const charts = { tests: option(testsFrame(tests, "", "week", now), "lines", {}), live: option(live, "area", {}) };
  for (const [name, chartOption] of Object.entries(charts)) for (const width of [390, 1440]) {
    const ec = echarts.init(null, chartTheme({ ink: "#000", rule: "#ccc", sans: "sans" }), { renderer: "svg", ssr: true, width, height: 240 });
    ec.setOption(chartOption);
    const model = ec.getModel(), group = ec.getViewOfComponentModel(model.getComponent("legend")).group;
    const box = group.getBoundingRect().clone();
    box.applyTransform(group.getLocalTransform());
    const grid = model.getComponent("grid").coordinateSystem.getRect();
    ec.dispose();
    expect(box.y + box.height, `${name} at ${width}px`).toBeLessThanOrEqual(grid.y);
  }
});

test("seg draws a labelled group, and the scope bar names its window group", () => {
  const h = seg("Who", [{ label: "A", on: false, attrs: ' data-x="1"' }, { label: "B", on: true, attrs: "" }]);
  expect(h).toContain('<div class="seg" role="group" aria-label="Who">');
  expect(h.match(/aria-pressed="(true|false)"/g)).toEqual(['aria-pressed="false"', 'aria-pressed="true"']);
  const groups = scope(new URLSearchParams()).bar().match(/<div class="seg"[^>]*>/g)!;
  expect(groups.length).toBe(1);
  expect(groups[0]).toMatch(/aria-label="[^"]+"/);
  expect(scope(new URLSearchParams()).bar()).not.toContain('class="fl">Window');
});

test("the scope bar takes a window name, its choices and an extra control; a click on days stays out of aleph.window", () => {
  const days = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }];
  const h = scope(new URLSearchParams()).bar({ value: "7", name: "days", options: days, after: "<button>Pause</button>", label: (p: string) => `${p || "All"} (2)` });
  expect(h).toContain('data-name="days"');
  expect(h.match(/data-value="(7|30|90)"/g)).toHaveLength(3);
  expect(h).toContain('<option value="" selected>All (2)</option>');
  expect(h).toMatch(/<\/div><div class="fg"><button>Pause<\/button><\/div><\/div>$/);
  const g = globalThis as any, set: string[] = [];
  g.localStorage = { getItem: () => null, setItem: (k: string) => set.push(k) };
  g.location = { hash: "#/sessions" };
  try {
    let click: any;
    wireScope({ querySelector: () => ({ querySelector: () => null, addEventListener: (t: string, f: unknown) => { if (t === "click") click = f; } }) });
    click({ target: { closest: () => ({ dataset: { value: "30" }, parentElement: { dataset: { name: "days" } } }) } });
    expect(g.location.hash).toContain("days=30");
    expect(set).toEqual([]);
  } finally { delete g.localStorage; delete g.location; }
});

test("sectionHead takes an id and a level, and card passes both through", () => {
  expect(sectionHead("Done", { id: "done", count: 2 })).toBe('<div class="sh"><h2 id="h-done">Done</h2><span class="count">2</span></div>');
  expect(sectionHead("Sub", { level: 3 })).toBe('<div class="sh"><h3>Sub</h3></div>');
  expect(card("Done", "", { id: "done", level: 3 })).toContain('<div class="sh"><h3 id="h-done">Done</h3></div>');
});

describe("loadDiff", () => {
  const real = globalThis.fetch;
  afterEach(() => { globalThis.fetch = real; });
  const stub = (f: any) => { globalThis.fetch = f; };
  test("fills the element with diffHtml on a 200: + - @@ and +++ lines get their classes, and an empty diff says so", async () => {
    const t = "+++ b/f\n@@ -1 +1 @@\n-old\n+new";
    stub(async () => new Response(t));
    const el: any = {};
    expect(await loadDiff(el, "/x")).toBe(t);
    expect(el.innerHTML).toBe(diffHtml(t));
    expect(el.innerHTML).toContain('<span class="l d-meta">+++ b/f</span>');
    expect(el.innerHTML).toContain('<span class="l d-hunk">@@ -1 +1 @@</span>');
    expect(el.innerHTML).toContain('<span class="l d-del">-old</span>');
    expect(el.innerHTML).toContain('<span class="l d-add">+new</span>');
    stub(async () => new Response(""));
    expect(await loadDiff(el, "/x")).toBe("");
    expect(el.innerHTML).toBe(diffHtml(""));
    expect(el.innerHTML).toContain("No changes from the merge base.");
  });
  test("fills a .msg line on a 404 and on a thrown error", async () => {
    stub(async () => new Response("No diff was recorded", { status: 404 }));
    const el: any = {};
    expect(await loadDiff(el, "/x")).toBeNull();
    expect(el.innerHTML).toBe('<p class="msg">No diff was recorded</p>');
    stub(async () => { throw new Error("down"); });
    expect(await loadDiff(el, "/x")).toBeNull();
    expect(el.innerHTML).toBe('<p class="msg">The diff failed to load: down</p>');
  });
});

describe("projectKeysOnce", () => {
  const real = globalThis.fetch;
  afterEach(() => { globalThis.fetch = real; });
  // lib.js keeps the keys for the page's life: each test takes a copy of the module of its own.
  let copies = 0;
  const once = async () => (await import(`./lib.js?copy=${++copies}`)).projectKeysOnce as typeof projectKeysOnce;
  test("a non-ok response gives an empty list and does not throw, and the next call fetches again", async () => {
    const projectKeysOnce = await once();
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response("no", { status: 500 }); }) as any;
    expect(await projectKeysOnce()).toEqual([]);
    globalThis.fetch = (async () => { calls++; throw new Error("down"); }) as any;
    expect(await projectKeysOnce()).toEqual([]);
    expect(calls).toBe(2);
  });
  test("two calls give the same keys from one request", async () => {
    const projectKeysOnce = await once();
    const urls: string[] = [];
    globalThis.fetch = (async (u: string) => { urls.push(u); return Response.json({ aleph: "a", other: null }); }) as any;
    expect(await projectKeysOnce()).toEqual(["aleph", "other"]);
    expect(await projectKeysOnce()).toEqual(["aleph", "other"]);
    expect(urls).toEqual(["/api/projects"]);
  });
});

test("dur writes seconds, minutes, hours and days", () => {
  expect([43, 245, 3720, 187200, null].map(dur)).toEqual(["43s", "4m 05s", "1h 02m", "2d 04h", "–"]);
});

test("clamp() puts a button with aria-expanded after the clamped text, and moreFold() folds the rows after n", () => {
  expect(clamp("<b>x</b>")).toMatch(/^<div class="clamp"><b>x<\/b><\/div><button[^>]*type="button"[^>]*aria-expanded="false"[^>]*>Show more<\/button>$/);
  const row = (n: number) => `r${n}`;
  const h = moreFold([1, 2, 3, 4, 5], row, 3);
  expect(h.match(/<li>/g)?.length).toBe(5);
  expect(h).toContain("<ul class=\"tight\"><li>r1</li><li>r2</li><li>r3</li></ul><details><summary>2 more</summary><ul");
  expect(moreFold([1, 2, 3], row, 3)).not.toContain("<details");
});


test("postJson posts the JSON body with the UI header and throws the error text of a failed reply", async () => {
  const real = globalThis.fetch, seen: { url: unknown; init: any }[] = [];
  let reply = () => Response.json({ added: 7 });
  globalThis.fetch = (async (url: unknown, init: any) => { seen.push({ url, init }); return reply(); }) as any;
  try {
    expect(await postJson("/api/x", { a: 1 })).toEqual({ added: 7 });
    expect(seen[0].url).toBe("/api/x");
    expect(seen[0].init.method).toBe("POST");
    expect(seen[0].init.headers["X-Aleph-UI"]).toBe("1");
    expect(seen[0].init.body).toBe('{"a":1}');
    reply = () => Response.json({ error: "it cannot wait" }, { status: 422 });
    await expect(postJson("/api/x", {})).rejects.toThrow("it cannot wait");
    reply = () => new Response("no job named x", { status: 404 });
    await expect(postJson("/api/x", {})).rejects.toThrow("no job named x");
    reply = () => new Response("forbidden", { status: 403 });
    await expect(postJson("/api/x", {})).rejects.toThrow("forbidden");
    reply = () => new Response("Bad Gateway", { status: 502 });
    await expect(postJson("/api/x", {})).rejects.toThrow("Bad Gateway");
  } finally { globalThis.fetch = real; }
});

test("actButton makes an .act button with the data attributes and label, and primary when asked", () => {
  expect(actButton("Land <it>", { act: "land", name: "a&b" })).toBe('<button class="act" type="button" data-act="land" data-name="a&amp;b">Land &lt;it&gt;</button>');
  expect(actButton("Save", {}, { primary: true, type: "submit" })).toBe('<button class="act primary" type="submit">Save</button>');
});

test("codeText sets a backtick span as a code element and escapes an ampersand", () => {
  expect(lib.codeText("run `a & b` now")).toBe("run <code>a &amp; b</code> now");
});

test("localMs reads a bare date as local midnight, not UTC midnight", () => {
  const tz = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    expect(lib.localMs("2026-11-05")).toBe(new Date(2026, 10, 5).getTime());
  } finally {
    // Bun reads a new TZ when it is set, not when it is deleted: set UTC back first.
    process.env.TZ = tz ?? "UTC";
    if (tz === undefined) delete process.env.TZ;
  }
});

test("keep stores JSON under aleph.<key>, kept reads it back, and with no storage kept gives the fallback", () => {
  const g = globalThis as any, store = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  try {
    keep("factory/agents/live", { form: "lines", hidden: ["Worker"] });
    expect(store.get("aleph.factory/agents/live")).toBe('{"form":"lines","hidden":["Worker"]}');
    expect(kept("factory/agents/live", {})).toEqual({ form: "lines", hidden: ["Worker"] });
    expect(kept("nope", {})).toEqual({});
    store.set("aleph.bad", "not json");
    expect(kept("bad", 1)).toBe(1);
    delete g.localStorage;
    expect(kept("factory/agents/live", {})).toEqual({});
    expect(() => keep("x", 1)).not.toThrow();
  } finally { delete g.localStorage; }
});


test("fold() writes a details element with its class, keep key and open state", () => {
  expect(fold("<b>S</b>", "<p>B</p>")).toBe("<details><summary><b>S</b></summary><p>B</p></details>");
  expect(fold("Technical details", "x", { open: true, keep: "k1", cls: "more" })).toBe('<details class="more" data-keep="k1" open><summary>Technical details</summary>x</details>');
  expect(fold("S", "B", { head: "ask-head" })).toBe('<details><summary class="ask-head">S</summary>B</details>');
});

test("linkButton() is a link with the act class, its label and href escaped, and an unsafe href inert", () => {
  expect(linkButton("Q&A", "#/issues/1?x=1&y=2")).toBe('<a class="act" href="#/issues/1?x=1&amp;y=2">Q&amp;A</a>');
  expect(linkButton("x", "javascript:alert(1)")).toBe('<a class="act" href="#">x</a>');
});

test("arm() arms on the first click, lets the second through, and restores the text after the delay", async () => {
  const cls = new Set<string>(), btn: any = { textContent: "Drop", classList: { contains: (c: string) => cls.has(c), add: (c: string) => cls.add(c), remove: (c: string) => cls.delete(c) } };
  expect(lib.arm(btn, "Drop a1? Click again", 5)).toBe(true);
  expect([btn.textContent, cls.has("ask")]).toEqual(["Drop a1? Click again", true]);
  expect(lib.arm(btn, "x", 5)).toBe(false);
  const b2: any = { textContent: "Drop", classList: { contains: () => false, add() {}, remove() {} } };
  lib.arm(b2, "Sure?", 0);
  await new Promise((r) => setTimeout(r, 0));
  expect(b2.textContent).toBe("Drop");
});

test("tabs() opens one pane, setting() is a form only with a Save, statusLight() maps unknown to a muted dot", () => {
  const t = lib.tabs("T", [["a", "A"], ["b", "B"]], { a: "<p>1</p>", b: "<p>2</p>" }, "b");
  expect(t).toContain('data-tab="a"');
  expect(t).toContain('<section data-pane="a" hidden>');
  expect(t).toContain('<section data-pane="b">');
  expect(lib.setting("Every", "<input id=e>", { id: "e", save: "Save" })).toStartWith('<form class="srow"');
  expect(lib.setting("Model", "<select id=m></select>", { id: "m" })).toStartWith('<div class="srow"');
  expect(lib.statusLight("fine", "A: up")).toContain('class="event-dot fine"');
  expect(lib.statusLight("unknown", "A: –")).toContain('class="event-dot "');
});
