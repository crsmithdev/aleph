import { afterEach, describe, expect, test } from "bun:test";
// @ts-ignore lib.js is plain JS, shared with the page
import { chartBox, legendHtml, mountCharts, meter, localId, repoIdLink, repoOf, STATES, badge, priorityBadge, chart, chips, filterBar, seg, scopeBar, idLink, pageHead, pager, sortHead, sectionHead, card, shortModel, when, chartTheme, barsOption, rangeBarOption, stackedAreaOption, clock, cmd, diffHtml, loadDiff, empty, error, esc, failMessage, loading, md, money, pct, mountView, recordState, restoreState, span, tone, searchBox, nextSort, limitOf, sortRows } from "./lib.js";

test("md renders a heading, a list, code and a link", () => {
  const h = md("# Title\n\nSome `code` here.\n\n- one\n- [two](https://example.com/a?b=1&c=2)\n\n1. first\n2. second\n\n```\nx < y\n```");
  expect(h).toContain("<h1>Title</h1>");
  expect(h).toContain("<p>Some <code>code</code> here.</p>");
  expect(h).toContain('<ul><li>one</li><li><a href="https://example.com/a?b=1&amp;c=2">two</a></li></ul>');
  expect(h).toContain("<ol><li>first</li><li>second</li></ol>");
  expect(h).toContain("<pre><code>x &lt; y</code></pre>");
});

test("mountView calls mount only when the view has one", () => {
  const calls: unknown[][] = [];
  expect(mountView({ mount: (...a: unknown[]) => calls.push(a) }, "root", 1)).toBe(true);
  expect(calls).toEqual([["root", 1]]);
  expect(mountView({}, "root", 1)).toBe(false);
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

test("chartBox() gives a box a role and a label, mountCharts() draws the boxes with an option, and legendHtml() one item per entry", () => {
  expect(chartBox("a", 'Uses "x"', "perday")).toBe('<div class="chartbox perday" data-chart="a" role="img" aria-label="Uses &quot;x&quot;"></div>');
  const g = globalThis as any;
  const made: any[] = [];
  const keep = { echarts: g.echarts, matchMedia: g.matchMedia, ResizeObserver: g.ResizeObserver, getComputedStyle: g.getComputedStyle, document: g.document };
  g.echarts = {
    registerTheme() {},
    init(el: unknown) {
      const c: any = { el, getOption: () => ({}), setOption(o: unknown) { c.option = o; }, dispose() {}, resize() {} };
      made.push(c);
      return c;
    },
  };
  g.matchMedia = () => ({ addEventListener() {}, removeEventListener() {} });
  g.ResizeObserver = class { observe() {} disconnect() {} };
  g.getComputedStyle = () => ({ getPropertyValue: () => "" });
  g.document = { documentElement: {} };
  const boxes = ["a", "b"].map((k) => ({ dataset: { chart: k } }));
  try {
    const charts = mountCharts({ querySelectorAll: () => boxes }, { a: { x: 1 } });
    expect([...charts.keys()]).toEqual(["a"]);
    expect(made.map((c) => [c.el, c.option])).toEqual([[boxes[0], { x: 1 }]]);
  } finally {
    Object.assign(g, keep);
  }
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

test("chips gives labels as chips, nothing for none", () => {
  expect(chips(["ui", "goal"])).toBe('<span class="chips"><span class="chip">ui</span><span class="chip">goal</span></span>');
  expect(chips([])).toBe("");
  expect(chips(undefined)).toBe("");
  expect(chips(["<b>"])).toContain("&lt;b&gt;");
});

test("localId and repoIdLink show the short id and keep the project apart", () => {
  expect(localId("aleph-578.1", "aleph")).toBe("578.1");
  expect(localId("Waits on aleph-12 and sidetone-5, see aleph-tick", "aleph")).toBe("Waits on 12 and sidetone-5, see aleph-tick");
  expect(localId("triage-aleph-3", "aleph")).toBe("triage-aleph-3");
  expect(localId("aleph-3", "")).toBe("aleph-3");
  expect(repoOf("my-repo-5.1")).toBe("my-repo");
  expect(repoOf("wt")).toBe("");
  expect(repoIdLink("aleph-5", "#/x")).toBe('<span class="idp">aleph</span> <a class="idl" href="#/x">5</a>');
  expect(repoIdLink("triage-aleph-3", "#/x", "aleph")).toBe('<span class="idp">aleph</span> <a class="idl" href="#/x">triage-aleph-3</a>');
  expect(repoIdLink("wt", "#/x")).toBe('<a class="idl" href="#/x">wt</a>');
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
});

test("when gives mm/dd hh:mm this year, YYYY-MM-DD another year, and '' for a bad date", () => {
  const now = new Date(2026, 10, 4);
  expect(when(new Date(2026, 9, 28, 14, 5), now)).toBe("10/28 14:05");
  expect(when(new Date(2025, 11, 3, 14, 5), now)).toBe("2025-12-03");
  expect(when("x")).toBe("");
});

test("pct shows whole percents, one decimal under 1%, <0.1% under 0.05 and – for none", () => {
  expect([null, undefined, NaN].map(pct)).toEqual(["–", "–", "–"]);
  expect([0.02, 0.5, 30, 2.5].map(pct)).toEqual(["<0.1%", "0.5%", "30%", "3%"]);
});

test("bar value labels have no outline in the dark or the light theme", async () => {
  // @ts-ignore the vendored ECharts bundle has no types
  const echarts = (await import("./vendor/echarts.min.js")).default;
  const tokens = { surface: "#1b1b1f", rule: "#3a3a40", run: "#5b9bd5", done: "#60b060", need: "#e0a040", stuck: "#e05050", "chart-6": "#9070c0", "chart-7": "#40a0a0", sans: "sans" };
  const themes = {
    dark: { ...tokens, bg: "#111114", ink: "#e6e6e6" },
    light: { ...tokens, bg: "#ffffff", ink: "#111114" },
  };
  for (const [name, t] of Object.entries(themes)) {
    const ec = echarts.init(null, chartTheme(t), { renderer: "svg", ssr: true, width: 400, height: 300 });
    ec.setOption(barsOption(["a", "b"], [{ name: "n", data: [1, 2] }], { labels: true }));
    const svg: string = ec.renderToSVGString();
    ec.dispose();
    // Value labels sit centred over the bars; the axis labels are right-aligned, so they do not match.
    const values = svg.match(/<text[^>]*text-anchor="middle"[^>]*>[12]<\/text>/g) ?? [];
    expect(values.length, name).toBe(2);
    for (const el of values) expect(el.includes(' stroke="') && !el.includes('stroke-width="0"'), name).toBe(false);
  }
});

test("rangeBarOption colours the p90 tick from the muted token", () => {
  const color = rangeBarOption(["bug"], [1], [2], "d", { muted: "#123456" }).series.find((s: any) => s.name === "p90").itemStyle.color;
  expect(color).toBe("#123456");
  expect(color).not.toBe("#888");
});

test("bar value labels take the theme ink, not ECharts' #333, in the dark and the light theme", async () => {
  // @ts-ignore the vendored ECharts bundle has no types
  const echarts = (await import("./vendor/echarts.min.js")).default;
  const tokens = { surface: "#1b1b1f", rule: "#3a3a40", run: "#5b9bd5", done: "#60b060", need: "#e0a040", stuck: "#e05050", "chart-6": "#9070c0", "chart-7": "#40a0a0", sans: "sans" };
  const themes = {
    dark: { ...tokens, bg: "#111114", ink: "#e6e6e6" },
    light: { ...tokens, bg: "#ffffff", ink: "#111114" },
  };
  for (const [name, t] of Object.entries(themes)) {
    const ec = echarts.init(null, chartTheme(t), { renderer: "svg", ssr: true, width: 400, height: 300 });
    ec.setOption(barsOption(["a", "b"], [{ name: "n", data: [1, 2] }], { labels: true }));
    const svg: string = ec.renderToSVGString();
    ec.dispose();
    const values = svg.match(/<text[^>]*text-anchor="middle"[^>]*>[12]<\/text>/g) ?? [];
    expect(values.length, name).toBe(2);
    for (const el of values) expect(el.match(/fill="([^"]*)"/)?.[1], name).toBe(t.ink);
  }
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
  const { testsOption } = await import("./views/issues.js");
  const now = new Date("2026-11-04T12:00:00Z");
  const tests = Object.fromEntries(["aleph", "sidetone", "voiceover"].map((p) => [p, [{ at: "2026-11-04T10:00:00Z", ran: 100, rerunPassed: 1 }]]));
  const roles = ["Worker", "Judge", "Planner", "Reviewer", "Intake"].map((name) => ({ name, data: [1, 2] }));
  const charts = { tests: testsOption(tests, "", "week", now), live: stackedAreaOption(["a", "b"], roles) };
  for (const [name, option] of Object.entries(charts)) for (const width of [390, 1440]) {
    const ec = echarts.init(null, chartTheme({ ink: "#000", rule: "#ccc", sans: "sans" }), { renderer: "svg", ssr: true, width, height: 240 });
    ec.setOption(option);
    const model = ec.getModel(), group = ec.getViewOfComponentModel(model.getComponent("legend")).group;
    const box = group.getBoundingRect().clone();
    box.applyTransform(group.getLocalTransform());
    const grid = model.getComponent("grid").coordinateSystem.getRect();
    ec.dispose();
    expect(box.y + box.height, `${name} at ${width}px`).toBeLessThanOrEqual(grid.y);
  }
});

test("seg draws a labelled group, and scopeBar names its window group", () => {
  const h = seg("Who", [{ label: "A", on: false, attrs: ' data-x="1"' }, { label: "B", on: true, attrs: "" }]);
  expect(h).toContain('<div class="seg" role="group" aria-label="Who">');
  expect(h.match(/aria-pressed="(true|false)"/g)).toEqual(['aria-pressed="false"', 'aria-pressed="true"']);
  const groups = scopeBar("", "week").match(/<div class="seg"[^>]*>/g)!;
  expect(groups.length).toBe(1);
  expect(groups[0]).toMatch(/aria-label="[^"]+"/);
  expect(scopeBar("", "week")).not.toContain('class="fl">Window');
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
