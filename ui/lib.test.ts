import { expect, test } from "bun:test";
// @ts-ignore lib.js is plain JS, shared with the page
import { STATES, badge, chart, chips, filterBar, idLink, pageHead, pager, sortHead, sectionHead, numCell, nameLink, shortModel, when, chartTheme, clock, clock12, cmd, diffHtml, empty, error, esc, failMessage, loading, md, money, mountView, recordState, restoreState, span, tone } from "./lib.js";

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
  expect(clock12("nope")).toBe("");
  expect(clock12(new Date(2026, 9, 28, 2, 24).toISOString())).toBe("2:24 am");
  expect(clock12(new Date(2026, 9, 28, 0, 5).toISOString())).toBe("12:05 am");
  expect(clock12(new Date(2026, 9, 28, 12, 0).toISOString())).toBe("12:00 pm");
  expect(clock12(new Date(2026, 9, 28, 15, 7).toISOString())).toBe("3:07 pm");
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

test("mountView passes the route query as the third argument", () => {
  const calls: unknown[][] = [];
  const q = new URLSearchParams("a=1");
  mountView({ mount: (...a: unknown[]) => calls.push(a) }, "root", 1, q);
  expect(calls).toEqual([["root", 1, q]]);
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

test("tone maps every job state to one badge tone", () => {
  expect(STATES.map(tone)).toEqual(["run", "done", "need", "stuck", "stuck", "done", "done", "quiet"]);
  expect(tone("held")).toBe("quiet");
});

test("when gives month, day and time this year, the date for another year, on one line", () => {
  const now = new Date(2026, 9, 28, 12, 0);
  expect(when(new Date(2026, 9, 28, 8, 45).toISOString(), now)).toBe("Oct 28 08:45");
  expect(when(new Date(2026, 0, 3, 23, 5).toISOString(), now)).toBe("Jan 03 23:05");
  expect(when(new Date(2025, 11, 3, 9, 0).toISOString(), now)).toBe("2025-12-03");
  expect(when("nope", now)).toBe("");
  expect(when(null, now)).toBe("");
  expect(when(new Date().toISOString())).not.toContain("\n");
});

test("badge tones a state with the state-tone map", () => {
  expect(badge("running")).toBe('<span class="badge run">running</span>');
  expect(badge("needs-you")).toBe('<span class="badge need">needs-you</span>');
  expect(badge("failed")).toBe('<span class="badge stuck">failed</span>');
  expect(badge("landed")).toBe('<span class="badge done">landed</span>');
  expect(badge("<odd>")).toBe('<span class="badge quiet">&lt;odd&gt;</span>');
});

test("chips gives labels as chips, the goal label as factory, nothing for none", () => {
  expect(chips(["ui", "goal"])).toBe('<span class="chips"><span class="chip">ui</span><span class="chip">factory</span></span>');
  expect(chips([])).toBe("");
  expect(chips(undefined)).toBe("");
  expect(chips(["<b>"])).toContain("&lt;b&gt;");
});

test("idLink and pageHead", () => {
  expect(idLink("aleph-1", "#/jobs/aleph-1")).toBe('<a class="idl" href="#/jobs/aleph-1">aleph-1</a>');
  expect(idLink("x", "javascript:alert(1)")).toContain('href="#"');
  expect(pageHead("Jobs", { count: 12, aside: "<b>x</b>" })).toBe('<header class="ph"><h1>Jobs</h1><span class="count">12</span><div class="aside"><b>x</b></div></header>');
  expect(pageHead("Jobs")).toBe('<header class="ph"><h1>Jobs</h1></header>');
  expect(pageHead("Jobs", { count: 0 })).toContain('<span class="count">0</span>');
});

test("filterBar gives a segmented control for six options or fewer, a select for more, and a search input", () => {
  const h = filterBar([
    { label: "State", name: "state", options: ["all", "running", { value: "done", label: "Done" }], value: "running" },
    { label: "Project", name: "project", options: ["a", "b", "c", "d", "e", "f", "g"], value: "c" },
    { label: "Search", name: "q", search: true, value: "x<" },
  ]);
  expect(h.startsWith('<div class="fbar">')).toBe(true);
  expect(h).toContain('<div class="fg"><span class="k">State</span><div class="seg" role="group" aria-label="State" data-name="state">');
  expect(h).toContain('<button type="button" data-value="all" aria-pressed="false">all</button>');
  expect(h).toContain('<button type="button" data-value="running" aria-pressed="true">running</button>');
  expect(h).toContain('<button type="button" data-value="done" aria-pressed="false">Done</button>');
  expect(h).toContain('<span class="k">Project</span><select name="project" aria-label="Project">');
  expect(h).toContain('<option value="c" selected>c</option>');
  expect(h.match(/<option/g)!.length).toBe(7);
  expect(h).toContain('<input type="search" name="q" value="x&lt;" placeholder="Search" aria-label="Search">');
  // Six options stay segmented; the first is pressed when no value is given.
  const six = filterBar([{ name: "k", options: ["1", "2", "3", "4", "5", "6"] }]);
  expect(six).toContain('class="seg"');
  expect(six).not.toContain("<select");
  expect(six).toContain('data-value="1" aria-pressed="true"');
  expect(six).not.toContain('class="k"');
});

test("pager shows how many of the total, and the next step while rows are left", () => {
  expect(pager(50, 345)).toBe('<div class="pager"><button type="button" data-more="50">Show 50 more</button><span class="of">50 of 345</span></div>');
  expect(pager(300, 345)).toContain("Show 45 more");
  expect(pager(345, 345)).toBe('<div class="pager"><span class="of">345 of 345</span></div>');
  expect(pager(50, 20)).toContain("20 of 20");
});

test("sortHead marks the sorted column with the arrow", () => {
  expect(sortHead("Cost", "cost", { key: "cost", dir: -1 }, { num: true })).toBe('<th class="num" aria-sort="descending"><button type="button" data-sort="cost">Cost<span class="arr" aria-hidden="true">▼</span></button></th>');
  expect(sortHead("Name", "name", { key: "cost", dir: 1 })).toBe('<th><button type="button" data-sort="name">Name<span class="arr" aria-hidden="true"></span></button></th>');
});

test("shortModel gives one short name for a model", () => {
  expect([shortModel("claude-opus-5-5"), shortModel("sonnet"), shortModel("claude-haiku-5-5"), shortModel(undefined)]).toEqual(["opus", "sonnet", "haiku", ""]);
});

test("sectionHead, numCell and nameLink", () => {
  expect(sectionHead("Hooks", { count: 3 })).toBe('<div class="sh"><h2>Hooks</h2><span class="count">3</span></div>');
  expect(sectionHead("A<", { aside: "<i>x</i>" })).toBe('<div class="sh"><h2>A&lt;</h2><span class="aside"><i>x</i></span></div>');
  expect(numCell(0)).toBe('<td class="num">0</td>');
  expect(numCell(2)).toBe('<td class="num bad">2</td>');
  expect(numCell(0, { bad: true })).toBe('<td class="num bad">0</td>');
  const l = nameLink("<b>", "#/x");
  expect(l).toContain('class="nml"');
  expect(l).toContain("&lt;b&gt;");
  expect(l).not.toContain("<b>");
});
