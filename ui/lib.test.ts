import { expect, test } from "bun:test";
// @ts-ignore lib.js is plain JS, shared with the page
import { chart, chartTheme, clock, cmd, diffHtml, empty, error, esc, failMessage, loading, md, money, mountView, recordState, restoreState, span } from "./lib.js";

test("esc escapes markup", () => {
  expect(esc("<script>alert('x')</script>")).toBe("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
  expect(esc(null)).toBe("");
});

test("md escapes <script> everywhere", () => {
  for (const src of ["<script>alert(1)</script>", "# <script>x</script>", "- <script>x</script>", "```\n<script>x</script>\n```", "[<script>](http://x)", "`<script>`"]) {
    const h = md(src);
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
  }
});

test("md renders a heading, a list, code and a link", () => {
  const h = md("# Title\n\nSome `code` here.\n\n- one\n- [two](https://example.com/a?b=1&c=2)\n\n1. first\n2. second\n\n```\nx < y\n```");
  expect(h).toContain("<h1>Title</h1>");
  expect(h).toContain("<p>Some <code>code</code> here.</p>");
  expect(h).toContain('<ul><li>one</li><li><a href="https://example.com/a?b=1&amp;c=2">two</a></li></ul>');
  expect(h).toContain("<ol><li>first</li><li>second</li></ol>");
  expect(h).toContain("<pre><code>x &lt; y</code></pre>");
});

test("md drops javascript: links and quotes in hrefs", () => {
  expect(md("[x](javascript:alert(1))")).not.toContain("javascript:");
  expect(md('[x](http://a/"onmouseover=1)')).not.toContain('"onmouseover');
});

test("formats and states", () => {
  expect(money(0.25)).toBe("$0.25");
  expect(money(1.5)).toBe("$1.50");
  expect(money(1.0276)).toBe("$1.03");
  expect(money(0.004)).toBe("<$0.01");
  expect(money(0)).toBe("$0.00");
  expect(money(undefined)).toBe("$0.00");
  expect(span("2026-10-27T10:00:00Z", "2026-10-27T12:05:00Z")).toBe("2 h 5 min");
  expect(clock("nope")).toBe("");
  expect(empty("Nothing here.", "Try <code>x</code>.")).toContain('<p class="hint">Try <code>x</code>.</p>');
  expect(error("<b>down</b>")).toContain("&lt;b&gt;down");
  expect(cmd("aleph land a-1", { primary: true })).toContain('data-cmd="aleph land a-1"');
});

test("chartTheme holds the token colours in the order given", () => {
  const t = { bg: "#111", surface: "#222", ink: "#eee", rule: "#444", run: "#1", done: "#2", need: "#3", stuck: "#4", sans: "X" };
  const th = chartTheme(t);
  expect(th.color).toEqual(["#1", "#2", "#3", "#4", "#C792EA", "#89DDFF"]);
  expect(th.textStyle.color).toBe("#eee");
  expect(th.valueAxis.splitLine.lineStyle.color).toBe("#444");
  expect(th.tooltip.backgroundColor).toBe("#222");
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

test("failMessage shows the reason from the body", () => {
  expect(failMessage("/api/sessions", 502, '{"error":"Langfuse is unreachable at http://x"}')).toBe("/api/sessions answered 502: Langfuse is unreachable at http://x");
  expect(failMessage("/api/sessions", 404, "not found")).toBe("/api/sessions answered 404: not found");
  expect(failMessage("/api/sessions", 500, "")).toBe("/api/sessions answered 500");
  expect(failMessage("/api/x", 500, "a".repeat(1000))).toBe(`/api/x answered 500: ${"a".repeat(300)}`);
});

test("the shell reports failures with failMessage", async () => {
  const { readFileSync } = await import("node:fs");
  expect(readFileSync(new URL("./index.html", import.meta.url), "utf8")).toContain("failMessage(");
});

test("diffHtml marks added, removed and hunk lines; an empty diff says so", () => {
  const h = diffHtml("@@ -1 +1 @@\n-a\n+b");
  expect(h).toContain('d-hunk">@@');
  expect(h).toContain('d-del">-a');
  expect(h).toContain('d-add">+b');
  expect(diffHtml("  \n")).toContain("No changes from the merge base.");
});

test("loading shows a status line with the title escaped", () => {
  const h = loading("Now");
  expect(h).toContain("Loading Now…");
  expect(h).toContain('role="status"');
  expect(loading("<b>")).toContain("Loading &lt;b&gt;…");
  expect(loading("<b>")).not.toContain("<b>");
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
