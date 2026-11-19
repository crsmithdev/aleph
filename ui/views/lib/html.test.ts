import { setCodes } from "../../../lib/naming.ts";
import { afterEach, describe, expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import { renderHerald } from "../now.js";
import { heraldOf, row, withFactory } from "../../now.testkit.ts";
// @ts-ignore the module is plain JS, shared with the page
import { scope } from "./address.js";
// @ts-ignore the module is plain JS, shared with the page
import { plural } from "./format.js";
// @ts-ignore the module is plain JS, shared with the page
import { clamp, moreFold, fold, linkButton, actButton, legendHtml, meter, repoIdLink, badge, priorityBadge, statusRow, chips, seg, idLink, pageHead, pager, sectionHead, card, diffHtml, loadDiff, empty, error, loading, md, mountView, recordState, restoreState, wireFolds, restoreFolds, tone, wireTabs, wireEdit, nextSort, pageOf, pageRows, sortOf, sortRows } from "./html.js";
// @ts-ignore the module is plain JS, shared with the page
import * as lib from "./html.js";

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

test("legendHtml() gives one item per entry", () => {
  const h = legendHtml([["One", "c-use"], ["Two"]]);
  expect(h.match(/<li>/g)).toHaveLength(2);
  expect(h).toContain('<i class="c-use"></i>One');
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
  const ev = (at: string, n: number) => (row({ at, by: "gate", subject: "aleph-77", action: "done", on: [`aleph-77#${n}`] }));
  const herald = (events: any[]) => renderHerald({ ...withFactory({}), now: "2026-11-09T12:00:00Z", asks: [], errored: [], herald: heraldOf(events) });
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
  expect(chips(["ui", "deps"])).toBe('<span class="chips"><span class="chip" title="ui">ui</span><span class="chip" title="deps">deps</span></span>');
  expect(chips([])).toBe("");
  expect(chips(undefined)).toBe("");
  expect(chips(["<b>"])).toContain("&lt;b&gt;");
});

test("repoIdLink shows the short id", () => {
  setCodes({ aleph: "a" });
  expect(repoIdLink("aleph-5", "#/x")).toBe('<a class="idl" href="#/x">a5</a>');
  expect(repoIdLink("wt", "#/x")).toBe('<a class="idl" href="#/x">wt</a>');
  setCodes({});
});

test("tone maps the feed's actions to the badge tones, and any other action to quiet", () => {
  expect(["reran", "escalated", "red", "filed", "answered"].map(tone)).toEqual(["run", "need", "error", "done", "done"]);
  expect(tone("no-such-action")).toBe("quiet");
});

test("miss, plural, meta and shaLink", () => {
  expect(lib.miss("no run")).toBe('<span title="no run">–</span>');
  expect(plural(1, "run", "runs")).toBe("1 run");
  expect(plural(2, "run", "runs")).toBe("2 runs");
  expect(plural(2, "child", "children")).toBe("2 children");
  expect(plural(0, "run")).toBe("0 runs");
  expect(lib.meta(["a", "", "b"]).match(/<span>/g)).toHaveLength(2);
  expect(lib.meta(["a", "", "b"])).toStartWith('<p class="meta">');
  const hash = "0123456789abcdef";
  expect(lib.shaLink(hash, "https://x/c/1")).toBe('<a class="idl" title="0123456789abcdef" href="https://x/c/1">0123456</a>');
  expect(lib.shaLink(hash)).toBe('<span class="idp" title="0123456789abcdef">0123456</span>');
  expect(idLink("a1")).toBe('<span class="idp">a1</span>');
  expect(idLink("a1", "")).toBe('<span class="idp">a1</span>');
  expect(repoIdLink("aleph-1", undefined)).toContain('<span class="idp"');
});

test("cell, row, note, subHead, list and group", () => {
  expect(lib.cell("x", { wide: true })).toBe('<td class="wide" title="x">x</td>');
  expect(lib.cell(5, { num: true })).toBe('<td class="num">5</td>');
  expect(lib.cell("a<b", { title: "why" })).toBe('<td title="why">a&lt;b</td>');
  expect(lib.cell("p")).toBe("<td>p</td>");
  expect(lib.row([lib.cell("a"), lib.cell(1, { num: true })])).toBe('<tr><td>a</td><td class="num">1</td></tr>');
  expect(lib.note("a<b")).toBe('<p class="note">a&lt;b</p>');
  expect(lib.subHead("Steps")).toBe('<h3 class="sub-head">Steps</h3>');
  expect(lib.list("<p>x</p>")).toBe('<div class="list"><p>x</p></div>');
  expect(lib.group("g&1", "<p>x</p>")).toBe('<div class="grp" id="g&amp;1"><p>x</p></div>');
});

test("actButton kinds, card lede and error detail", () => {
  expect(actButton("Drop", {}, { kind: "danger" })).toBe('<button class="act danger" type="button">Drop</button>');
  expect(actButton("Go", {}, { kind: "small", primary: true })).toContain('class="act primary small"');
  const c = card("T", "<p>b</p>", { lede: "One line." });
  expect(c).toContain('</div><p class="lede">One line.</p><p>b</p>');
  expect(card("T", "b")).not.toContain("lede");
  const e = error("Could not load X.", { detail: "answered 500: <boom>" });
  expect(e).toContain("Technical details");
  expect(e).toMatch(/<details[^>]*><summary>Technical details<\/summary><pre>answered 500: &lt;boom&gt;<\/pre><\/details>/);
  expect(e).not.toContain("hint");
  expect(error("Could not load X.")).not.toContain("<details");
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

test("sortOf reads a known sort key and dir from a query or an object, else gives the fallback", () => {
  const by = { cost: 1 }, none = { key: "x", dir: -1 };
  expect(sortOf(new URLSearchParams("sort=cost&dir=asc"), by, none)).toEqual({ key: "cost", dir: 1 });
  expect(sortOf({ sort: "cost" }, by, none)).toEqual({ key: "cost", dir: -1 });
  for (const q of ["", "sort=bogus&dir=asc", "sort=toString"]) expect(sortOf(new URLSearchParams(q), by, none)).toBe(none);
});

test("pageOf is 1 unless the page is a larger whole number", () => {
  const q = (s: string) => new URLSearchParams(s);
  expect(pageOf(q(""))).toBe(1);
  expect(pageOf(q("page=x"))).toBe(1);
  expect(pageOf(q("page=0"))).toBe(1);
  expect(pageOf(q("page=3"))).toBe(3);
  expect(pageOf({ page: "2" })).toBe(2);
});

test("pageRows gives one page of rows, and a page past the end is the last page", () => {
  const rows = Array.from({ length: 120 }, (_, i) => i);
  expect(pageRows(rows, 1)).toEqual(rows.slice(0, 50));
  expect(pageRows(rows, 2)).toEqual(rows.slice(50, 100));
  expect(pageRows(rows, 3)).toEqual(rows.slice(100));
  expect(pageRows(rows, 9)).toEqual(rows.slice(100));
});

test("pager: Next and Previous go one page each way, and the range names the rows shown", () => {
  const first = pager(1, 120), mid = pager(2, 120), last = pager(3, 120);
  expect(first).toContain('data-page="2">Next 50<');
  expect(first).not.toContain("Previous");
  expect(first).toContain("1–50 of 120");
  expect(mid).toContain('data-page="1">Previous 50<');
  expect(mid).toContain('data-page="3">Next 20<');
  expect(mid).toContain("51–100 of 120");
  expect(last).not.toContain("Next");
  expect(last).toContain("101–120 of 120");
  expect(pager(9, 120)).toBe(last);
  expect(pager(1, 12)).toBe('<div class="pager"><span class="of">12 of 12</span></div>');
  expect(pager(2, 51)).toContain("51 of 51");
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

test("seg draws a labelled group, and the scope bar names its window group", () => {
  const h = seg("Who", [{ label: "A", on: false, attrs: ' data-x="1"' }, { label: "B", on: true, attrs: "" }]);
  expect(h).toContain('<div class="seg" role="group" aria-label="Who">');
  expect(h.match(/aria-pressed="(true|false)"/g)).toEqual(['aria-pressed="false"', 'aria-pressed="true"']);
  const groups = scope(new URLSearchParams()).bar().match(/<div class="seg"[^>]*>/g)!;
  expect(groups.length).toBe(1);
  expect(groups[0]).toMatch(/aria-label="[^"]+"/);
  expect(scope(new URLSearchParams()).bar()).not.toContain('class="fl">Window');
});

test("wiring a root again adds no click listener, so a click runs a tab or an edit once", () => {
  const fns: any[] = [], root: any = { addEventListener: (_: string, f: any) => fns.push(f) };
  const seen: string[] = [], toggled: unknown[] = [];
  wireTabs(root, (id: string) => seen.push(id));
  wireTabs(root, (id: string) => seen.push(id));
  wireEdit(root);
  wireEdit(root);
  const sec = { dataset: { pane: "a" }, hidden: false };
  const box: any = { querySelectorAll: (s: string) => (s.startsWith("button") ? [] : [sec]), classList: { toggle: (...a: unknown[]) => toggled.push(a) } };
  const tab = { dataset: { tab: "a" }, closest: () => box }, ed = { dataset: { editor: "start" }, closest: () => box };
  for (const f of fns) { f({ target: { closest: (s: string) => (s.includes("data-tab") ? tab : null) } }); f({ target: { closest: (s: string) => (s.includes("data-editor") ? ed : null) } }); }
  expect(seen).toEqual(["a"]);
  expect(toggled).toEqual([["editing", true]]);
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
    expect(el.innerHTML).toContain("No changes");
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

test("clamp() puts a button with aria-expanded after the clamped text, and moreFold() folds the rows after n", () => {
  expect(clamp("<b>x</b>")).toMatch(/^<div class="clamp"><b>x<\/b><\/div><button[^>]*type="button"[^>]*aria-expanded="false"[^>]*>Show more<\/button>$/);
  const row = (n: number) => `r${n}`;
  const h = moreFold([1, 2, 3, 4, 5], row, 3);
  expect(h.match(/<li>/g)?.length).toBe(5);
  expect(h).toContain("<ul class=\"tight\"><li>r1</li><li>r2</li><li>r3</li></ul><details><summary>2 more</summary><ul");
  expect(moreFold([1, 2, 3], row, 3)).not.toContain("<details");
});

test("actButton makes an .act button with the data attributes and label, and primary when asked", () => {
  expect(actButton("Land <it>", { act: "land", name: "a&b" })).toBe('<button class="act" type="button" data-act="land" data-name="a&amp;b">Land &lt;it&gt;</button>');
  expect(actButton("Save", {}, { primary: true, type: "submit" })).toBe('<button class="act primary" type="submit">Save</button>');
});

test("codeText sets a backtick span as a code element and escapes an ampersand", () => {
  expect(lib.codeText("run `a & b` now")).toBe("run <code>a &amp; b</code> now");
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

test("toc() links each entry to its section in place, indents a sub entry, and escapes a label", () => {
  const t = lib.toc([["s-a", "A & B"], ["s-b", "B", true]], "<p>body</p>");
  expect(t).toContain('<li><a href="#s-a">A &amp; B</a></li>');
  expect(t).toContain('<li class="sub"><a href="#s-b">B</a></li>');
  expect(t).toEndWith('<div class="toc-body"><p>body</p></div></div>');
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

test("loadingLine, loading() and a loading statCard draw the one spinner; a card with a value draws none", () => {
  const spin = '<i class="spin" aria-hidden="true"></i>';
  expect(lib.loadingLine("jobs")).toBe(`<p class="quiet" role="status">${spin}Loading jobs…</p>`);
  expect(loading("Jobs")).toContain(`${spin}Loading Jobs…`);
  const c = lib.statCard({ k: "Asks", loading: true, trend: "<span class=\"tr\">x</span>" });
  expect(c).toContain(`<span class="r1"><span class="k">Asks</span><i class="spin" role="status" aria-label="Loading"></i></span><b>&nbsp;</b>`);
  const f = lib.statCard({ k: "Asks", v: "3", failed: "Could not load <x>." });
  expect(f).toContain(`<i class="spin bad" role="img" aria-label="Could not load &lt;x&gt;." title="Could not load &lt;x&gt;.">!</i></span><b>3</b>`);
  expect(lib.statCard({ k: "Asks", v: "3" })).not.toContain("spin");
  // An empty state is not a loading state.
  expect(empty()).not.toContain("spin");
});

test("statCard title puts a definition in the tooltip, after the value", () => {
  expect(lib.statCard({ k: "Working", v: "3", title: "handoffs" })).toContain('title="Working 3, handoffs"');
  expect(lib.statCard({ k: "Working", v: "3" })).toContain('title="Working 3"');
});

test("setting stack puts the label over the control at any width", () => {
  expect(lib.setting("Core line", "<input>")).toContain('<div class="srow">');
  expect(lib.setting("Core line", "<input>", { stack: true, save: "Save" })).toContain('<form class="srow stack">');
});
