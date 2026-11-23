import { beforeEach, expect, test } from "bun:test";
// @ts-ignore the module is plain JS, shared with the page
import { attention, factsLine, figureBand, pageViews, viewOf, viewTabs } from "./page.js";
// @ts-ignore the module is plain JS, shared with the page
import { setRows, worst } from "./attention.js";

beforeEach(() => setRows({}));

const views = [{ id: "list", label: "List", draw: () => "<p>list</p>" }, { id: "flow", label: "Flow", scope: true, draw: () => "<p>flow</p>" }];
const page = (view: string) => pageViews({ title: "Issues", path: "/issues", query: new URLSearchParams(view ? `view=${view}` : ""), views });

test("the view is the query's view when the page has it, else the first", () => {
  expect(viewOf(new URLSearchParams("view=flow"), ["list", "flow"])).toBe("flow");
  expect(viewOf(new URLSearchParams("view=nope"), ["list", "flow"])).toBe("list");
  expect(viewOf(new URLSearchParams(), ["list", "flow"])).toBe("list");
});

test("a page of views draws the current view only, its tab pressed, with the first view as the default", () => {
  const h = page("flow");
  expect(h).toContain("<p>flow</p>");
  expect(h).not.toContain("<p>list</p>");
  expect(h).toContain('data-default="list"');
  expect(h).toContain('<button type="button" data-view="flow" aria-pressed="true">Flow</button>');
  expect(h).toContain('<button type="button" data-view="list" aria-pressed="false">List</button>');
  expect(page("")).toContain("<p>list</p>");
});

test("the scope control shows on a view with `scope` only", () => {
  expect(page("flow")).toContain('name="project"');
  expect(page("list")).not.toContain('name="project"');
});

test("a page of one view has no tabs", () => {
  expect(pageViews({ title: "Jobs", path: "/jobs", query: new URLSearchParams(), views: [views[0]] })).not.toContain("data-view");
  expect(viewTabs(views, "list")).toContain("data-view");
});

test("a page draws its attention rows from the held answer, by its route", () => {
  expect(page("")).not.toContain("arow");
  setRows({ "/issues": [{ tone: "error", text: "A <b> failed", act: { label: "Open", href: "#/issues" } }, { tone: "need", text: "Waits" }] });
  const h = page("");
  expect(h).toContain('<div class="arow error" role="alert"><span class="event-dot error"');
  expect(h).toContain("A &lt;b&gt; failed");
  expect(h).toContain('<div class="arow need" role="status"><span class="event-dot warning"');
  expect(h).toContain('<a class="act" href="#/issues">Open</a>');
  expect(attention([])).toBe("");
});

test("the dot of a page takes the worst tone of its rows", () => {
  expect(worst([])).toBe("");
  expect(worst([{ tone: "need" }])).toBe("need");
  expect(worst([{ tone: "need" }, { tone: "error" }])).toBe("error");
});

test("setRows says whether the rows changed", () => {
  expect(setRows({ "/a": [] })).toBe(true);
  expect(setRows({ "/a": [] })).toBe(false);
});

test("a facts line holds at most 4 figures, and a figure band at most 4", () => {
  expect(factsLine([["3", "running"], ["$4.10", "today"]])).toBe('<p class="factline"><span><b class="num">3</b> running</span> <span><b class="num">$4.10</b> today</span></p>');
  const five = [["1", "a"], ["2", "b"], ["3", "c"], ["4", "d"], ["5", "e"]];
  expect(() => factsLine(five)).toThrow("at most 4");
  expect(() => figureBand(five.map(([v, k]) => ({ k, v, cmp: "x" })))).toThrow("at most 4");
});

test("a figure carries its comparison, toned by its trend", () => {
  const h = figureBand([{ k: "Cost", v: "$41", cmp: "$38 last week", trend: "warn", title: "Spend" }, { k: "p50", v: "6m", cmp: "5m last week" }]);
  expect(h).toContain('<div class="fig" title="Spend"><span class="k">Cost</span><b class="num">$41</b><span class="cmp warn">$38 last week</span></div>');
  expect(h).toContain('<span class="cmp">5m last week</span>');
});
