// Archived goal tests from ui/lib.test.ts: `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
// @ts-ignore lib.js is plain JS, shared with the page
import { localId, repoIdLink, repoOf, STATES, badge, priorityBadge, chart, chips, filterBar, idLink, pageHead, pager, sortHead, sectionHead, shortModel, when, chartTheme, clock, cmd, diffHtml, empty, error, esc, failMessage, loading, md, money, mountView, recordState, restoreState, span, tone, searchBox } from "../../ui/lib.js";

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
  expect(span("2026-10-27T10:00:00Z", "2026-10-27T12:05:00Z")).toBe("2h 05m");
  expect(clock("nope")).toBe("");
  expect(empty("Nothing here.", "Try <code>x</code>.")).toContain('<p class="hint">Try <code>x</code>.</p>');
  expect(error("<b>down</b>")).toContain("&lt;b&gt;down");
  expect(cmd("aleph land a-1", { primary: true })).toContain('data-cmd="aleph land a-1"');
});

test("mountView passes the route query as the third argument", () => {
  const calls: unknown[][] = [];
  const q = new URLSearchParams("a=1");
  mountView({ mount: (...a: unknown[]) => calls.push(a) }, "root", 1, q);
  expect(calls).toEqual([["root", 1, q]]);
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
  expect(badge("awaiting")).toBe('<span class="badge need">awaiting</span>');
  expect(badge("failed")).toBe('<span class="badge stuck">failed</span>');
  expect(badge("landed")).toBe('<span class="badge done">landed</span>');
  expect(badge("<odd>")).toBe('<span class="badge quiet">&lt;odd&gt;</span>');
});

test("filterBar gives a segmented control for six options or fewer, a select for more, and a search input", () => {
  const h = filterBar([
    { label: "State", name: "state", options: ["all", "running", { value: "done", label: "Done" }], value: "running" },
    { label: "Project", name: "project", data: true, options: ["a", "b", "c", "d", "e", "f", "g"], value: "c" },
  ]);
  expect(h.startsWith('<div class="fbar">')).toBe(true);
  expect(h).toContain('<div class="fg"><span class="fl">State</span><div class="seg" role="group" aria-label="State" data-name="state">');
  expect(h).toContain('<button type="button" data-value="all" aria-pressed="false">all</button>');
  expect(h).toContain('<button type="button" data-value="running" aria-pressed="true">running</button>');
  expect(h).toContain('<button type="button" data-value="done" aria-pressed="false">Done</button>');
  expect(h).toContain('<span class="fl">Project</span><select name="project" aria-label="Project">');
  expect(h).toContain('<option value="c" selected>c</option>');
  expect(h.match(/<option/g)!.length).toBe(7);
  expect(searchBox("s", "x<", "Search")).toContain('<input type="search" name="q" data-ui="s" value="x&lt;" placeholder="Search" aria-label="Search">');
  // A fixed set is segmented however long; the first is pressed when no value is given.
  const six = filterBar([{ name: "k", options: ["1", "2", "3", "4", "5", "6", "7"] }]);
  expect(six).toContain('class="seg"');
  expect(six).not.toContain("<select");
  expect(six).toContain('data-value="1" aria-pressed="true"');
  expect(six).not.toContain('class="fl"');
});

test("pager shows how many of the total, and the next step while rows are left", () => {
  expect(pager(50, 345)).toBe('<div class="pager"><button type="button" class="act" data-more="50">Show 50 more</button><span class="of">50 of 345</span></div>');
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

test("sectionHead", () => {
  expect(sectionHead("Hooks", { count: 3 })).toBe('<div class="sh"><h2>Hooks</h2><span class="count">3</span></div>');
  expect(sectionHead("A<", { aside: "<i>x</i>" })).toBe('<div class="sh"><h2>A&lt;</h2><span class="aside"><i>x</i></span></div>');
});

test("priorityBadge shows the priority, toned apart; missing reads medium", () => {
  expect(priorityBadge("critical")).toContain("critical");
  expect(priorityBadge("critical")).not.toBe(priorityBadge("medium").replace("medium", "critical"));
  expect(priorityBadge("high")).toContain("need");
  expect(priorityBadge("low")).toContain("dim");
  expect(priorityBadge(undefined)).toBe(priorityBadge("medium"));
  expect(priorityBadge("bogus")).toContain(">medium<");
});
