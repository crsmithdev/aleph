import { expect, test } from "bun:test";
// @ts-ignore lib.js is plain JS, shared with the page
import { chartTheme, clock, cmd, empty, error, esc, md, money, mountView, span } from "./lib.js";

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
  expect(money(0.25)).toBe("$0.2500");
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
