import { describe, expect, test } from "bun:test";
// @ts-ignore plain JS, shared with the page
import { view, holdsFrame, renderHook, renderHooks } from "./hooks.js";
// @ts-ignore plain JS, shared with the page
import { setRows } from "./lib/attention.js";
// @ts-ignore plain JS, shared with the page
import { view as memory } from "./memory.js";
// @ts-ignore plain JS, shared with the page
import { empty } from "./lib/html.js";

const hold = (sid: string, hook: string, kind: string, who: string, out: string) =>
  ({ t: "2026-11-18T10:00:00Z", sid, hook, event: "Stop", kind, who, out, why: `why ${sid}` });
const holds = [
  hold("aaaaaaaa1", "one way", "new-copy", "interactive", "caught"),
  hold("bbbbbbbb2", "one way", "boundary", "worker", "no effect"),
  hold("cccccccc3", "verify gate", "judged", "headless", "no effect"),
  hold("dddddddd4", "verify gate", "judged", "interactive", "false"),
];
const data = {
  days: 7, holds,
  byHook: [{ hook: "one way", event: "Stop", kind: "new-copy", holds: 1, interactive: 1, workers: 0, outcomes: { caught: 1 } }],
  errors: [{ cause: "Moved hook file", fix: "Stub or stable entry", n: 53, sessions: 10, pairs: [{ hook: "vault", event: "SessionStart" }], last: "2026-11-19T09:13:00Z" }],
  hooks: [{ event: "Stop", name: "one way", matcher: "", file: "skills/refit-code/hook.ts", command: "bun skills/refit-code/hook.ts", mode: "", timeout: 30, workers: "skips", holds: 2, changed: null }],
};
/** A hook page's Command and Workers, which these tests do not vary. */
const HOOK = { command: "bun x.ts", workers: "skips" };
/** The count in the head of card or panel `title`. */
const head = (html: string, title: string) => html.match(new RegExp(`(?:<h2[^>]*>${title}</h2><span class="count">|<span>${title}</span><span class="dp-aside">)([^<]*)`))?.[1];
/** The holds over two days: the last a day later. */
const twoDays = holds.map((h, i) => (i === 3 ? { ...h, t: "2026-11-19T10:00:00Z" } : h));
/** One hook's page on `holds`, with its holds log filtered by the query `q`. */
const one = (xs: any[], q = "") => renderHook({ ...HOOK, source: [], event: "Stop", name: "one way", matcher: "", file: "x.ts", mode: "", timeout: 10, holds: xs, byKind: data.byHook, errors: data.errors }, new URLSearchParams(q));
/** The session ids of the holds log's rows on one hook's page. */
const logIds = (q: string) => [...one(holds, q).split('id="holds"')[1].matchAll(/#\/sessions\/(\w+)/g)].map((m) => m[1]);
/** The page on the view `v`, and the key of each row of its list. */
const page = (v: string, d: any = data) => renderHooks(d, new URLSearchParams(v ? `view=${v}` : ""));
const keys = (html: string) => [...html.matchAll(/<li class="lrow"[^>]* data-key="([^"]+)"/g)].map((m) => m[1]);
/** The heads of the groups of a list: title, count. */
const groups = (html: string) => [...html.matchAll(/<li class="lhead"[^>]*><span class="gt"><h3 class="sub-head">([^<]*)<\/h3><span class="count">([^<]*)</g)].map((m) => [m[1], m[2]]);

describe("the Hooks page", () => {
  test("sits under Claude after Memory, with the tabs List, Holds and Errors, each with the scope bar", () => {
    expect(view).toMatchObject({ path: "/hooks", group: "claude", icon: "plug" });
    expect(view.order).toBeGreaterThan(memory.order);
    for (const v of ["", "holds", "errors"]) {
      const html = page(v, { ...data, calls: null });
      expect([...html.matchAll(/data-view="(\w+)"/g)].map((m) => m[1])).toEqual(["list", "holds", "errors"]);
      expect(html.split("</header>")[0]).toMatch(/<select name="project"[^]*role="group" aria-label="Window"/);
    }
    expect(page("holds")).toMatch(/data-view="holds"[^>]*aria-pressed="true"/);
    for (const c of ["tile sc", "dp-page", 'class="card"']) expect(page("")).not.toContain(c);
  });

  test("List has a row per hook: those that hold first by holds, then an event with several hooks, then Other where each row names its event", () => {
    const more = { ...data.hooks[0], name: "vault", holds: 0, event: "SessionStart" }, hooks = [
      { ...data.hooks[0], name: "few", holds: 1 }, data.hooks[0], more, { ...more, name: "vault 2" }, { ...more, name: "solo", event: "PreCompact" },
    ];
    const html = page("", { ...data, hooks });
    expect(groups(html)).toEqual([["Hold", "2"], ["SessionStart", "2"], ["Other", "1"]]);
    expect(keys(html)).toEqual(["Stop/one way", "Stop/few", "SessionStart/vault", "SessionStart/vault 2", "PreCompact/solo"]);
    const row = (name: string) => html.split(`data-key="${name}"`)[1].split("</li>")[0];
    expect(row("PreCompact/solo")).toContain('<span class="chip">PreCompact</span>');
    expect(row("SessionStart/vault")).not.toContain('<span class="chip">SessionStart</span>');
    expect(html).toContain('<p class="factline"><span><b class="num">4</b> holds</span>');
  });

  test("a row draws its outcomes as one bar with the numbers in its tooltip, the holds and the error causes; a hook with none has no bar", () => {
    const html = page("");
    const row = html.split('data-key="Stop/one way"')[1].split("</li>")[0];
    expect(row).toMatch(/<span class="c"><span class="rowbar"><span class="meter"[^>]*title="caught 1, no effect 1"/);
    expect(row).toContain('<span class="c">2</span>');
    expect(row).not.toContain("cause");
    const bare = page("", { ...data, holds: [], hooks: [{ ...data.hooks[0], holds: 0 }] }).split('data-key="Stop/one way"')[1].split("</li>")[0];
    expect(bare).not.toContain("rowbar");
  });

  test("a hook's inspector has its facts, an empty Matcher or Mode as miss(), its outcomes, newest holds and error causes", () => {
    const hook = { ...data.hooks[0], name: "vault", event: "SessionStart", matcher: "Bash", mode: "async", changed: { t: "2026-11-19T12:00:00Z", hash: "d90a0602bbbb", subject: "only own files" } };
    const err = { ...data.errors[0], pairs: [{ hook: "vault", event: "SessionStart" }] };
    const html = page("", { ...data, hooks: [data.hooks[0], hook], errors: [err] });
    const tpl = (key: string) => html.split(`<template data-inspect="${key}">`)[1].split("</template>")[0];
    expect(tpl("Stop/one way")).toContain('<dt>Matcher</dt><dd><span title="all">');
    expect(tpl("Stop/one way")).toContain('<dt>Mode</dt><dd><span title="sync">');
    expect(tpl("Stop/one way")).toContain("why aaaaaaaa1");
    expect(tpl("Stop/one way")).toContain("<h3 class=\"sub-head\">Outcomes</h3>");
    expect(tpl("SessionStart/vault")).toContain("<dt>Matcher</dt><dd><code>Bash</code></dd>");
    expect(tpl("SessionStart/vault")).toContain('<dt>Changed</dt><dd>Nov 19 <span class="idp" title="only own files">d90a0602</span></dd>');
    expect(tpl("SessionStart/vault")).toContain("Moved hook file");
    expect(tpl("Stop/one way")).toContain('href="#/hooks/Stop/one%20way"');
  });

  test("the Workers filter keeps a hook by whether workers run it", () => {
    const html = page("", { ...data, hooks: [data.hooks[0], { ...data.hooks[0], name: "vault", workers: "runs" }] });
    expect(html.split('data-key="Stop/one way"')[1].split("</li>")[0]).toContain("skips workers");
    expect(html.split('data-key="Stop/vault"')[1].split("</li>")[0]).not.toContain("workers</span>");
  });

  test("the list with no hooks, and Holds and Errors with none, draw empty()", () => {
    expect(page("", { ...data, hooks: [], holds: [] })).not.toContain('class="lrow"');
    for (const v of ["holds", "errors"]) expect(page(v, { ...data, holds: [], errors: [], calls: null })).not.toContain('class="lrow"');
  });

  test("Holds has a group per hook, a row naming a kind only when it is not the hook's usual one, and the Outcome with Workers", () => {
    const html = page("holds", { ...data, holds: [...holds, hold("eeeeeeee5", "one way", "new-copy", "interactive", "held up")] });
    expect(groups(html)).toEqual([["one way", "3"], ["verify gate", "2"]]);
    const row = (sid: string) => html.split(`/${sid}"`)[1].split("</li>")[0];
    expect(row("bbbbbbbb2")).toContain('<span class="chip">boundary</span>');
    expect(row("aaaaaaaa1")).not.toContain("chip");
    expect(row("bbbbbbbb2")).toContain('<span class="c"><span class="chip">worker</span></span><span class="c"><span class="badge parked">no effect</span></span>');
    expect(html).toContain('<p class="factline"><span><b class="num">5</b> holds</span>');
  });

  test("Holds lists the newest 50 of a hook and says so, and the Hooks and Verify-Gate Denials cards follow it", () => {
    const many = Array.from({ length: 60 }, (_, i) => hold(`s${i}`, "one way", "judged", "interactive", "caught"));
    const html = page("holds", { ...data, holds: many, calls: { langfuse: "ok", hooks: [{ name: "verify-gate", calls: 1234, errors: 2, lastAt: "2026-11-19T10:00:00Z" }], denials: { total: 3, recent: [{ at: "2026-11-19T10:00:00Z", reason: "nothing ran" }] } } });
    expect(keys(html).length).toBe(50);
    expect(html).toContain('<li class="lmore">50 of 60</li>');
    const cards = html.split('<div class="pair">')[1];
    expect(cards).toContain('aria-label="Hooks"');
    expect(cards).toContain("<td class=\"num\">1,234</td>");
    expect(cards).toContain('aria-label="Verify-gate denials"');
    expect(cards).toContain("nothing ran");
    expect(html.indexOf('class="browse"')).toBeLessThan(html.indexOf('class="pair"'));
  });

  test("the Hooks and Verify-Gate Denials cards say Loading before the Langfuse read ends, and Langfuse off or its error after", () => {
    const cards = (calls: any) => page("holds", { ...data, calls }).split('<div class="pair">')[1];
    expect(cards(null).match(/No data|Loading/g)).toEqual(["Loading", "Loading"]);
    expect(cards({ langfuse: "off", hooks: [], denials: { total: 0, recent: [] } })).toContain("Langfuse off");
    expect(cards({ langfuse: "error", error: "down", hooks: [], denials: { total: 0, recent: [] } })).toContain("down");
    expect(cards({ langfuse: "ok", hooks: [], denials: { total: 0, recent: [] } })).toContain(empty());
  });

  test("an error cause marks a hook only on the events it hit", () => {
    const vault = { ...data.hooks[0], name: "vault", holds: 0 };
    const html = page("", { ...data, hooks: [vault, { ...vault, event: "SessionStart" }], errors: [{ ...data.errors[0], pairs: [{ hook: "vault", event: "SessionStart" }] }] });
    expect(html.split('data-key="Stop/vault"')[1].split("</li>")[0]).not.toContain("cause");
    expect(html.split('data-key="SessionStart/vault"')[1].split("</li>")[0]).toContain("1 cause");
    const errors = page("errors", { ...data, hooks: [vault, { ...vault, event: "SessionStart" }], errors: [{ ...data.errors[0], pairs: [{ hook: "vault", event: "SessionStart" }] }] });
    expect(errors).toContain('<dt>Events</dt><dd>SessionStart</dd>');
  });

  test("Errors has a group per cause with its hooks, the Fix, sessions and last time under it, and a hook that hooks.json lacks marked", () => {
    const html = page("errors");
    expect(groups(html)).toEqual([["Moved hook file", "53"]]);
    expect(html).toMatch(/<li class="lmore">Fix: Stub or stable entry · 10 sessions · last [^<]+<\/li>/);
    expect(html).toContain('<span class="badge need">not in hooks.json</span>');
    expect(html).toContain("<b class=\"num\">53</b> errors");
    const own = page("errors", { ...data, errors: [{ ...data.errors[0], pairs: [{ hook: "one way", event: "Stop" }], fix: "" }] });
    expect(own).not.toContain("not in hooks.json");
    expect(own).toContain("No fix");
    expect(own).toContain('href="#/hooks/Stop/one%20way"');
  });

  test("each filter of a hook's holds log leaves only its rows", () => {
    expect(logIds("who=workers")).toEqual(["bbbbbbbb2", "cccccccc3"]);
    expect(logIds("who=interactive")).toEqual(["aaaaaaaa1", "dddddddd4"]);
    expect(logIds("kind=boundary")).toEqual(["bbbbbbbb2"]);
    expect(logIds("out=no%20effect")).toEqual(["bbbbbbbb2", "cccccccc3"]);
  });

  test("a hook's page writes an outcome as a state in lower case, and in Title Case in the legend and a column header; the list legend is Title Case", () => {
    const xs = [holds[1], hold("eeeeeeee5", "one way", "boundary", "interactive", "held up")];
    const byKind = [{ kind: "boundary", holds: 2, interactive: 1, workers: 1, outcomes: { "no effect": 1, "held up": 1 } }];
    const hookPage = renderHook({ ...HOOK, source: [], event: "Stop", name: "one way", matcher: "", file: "x.ts", mode: "", timeout: 30, holds: xs, byKind, errors: [] }, new URLSearchParams());
    for (const html of [page(""), hookPage]) for (const [label, cls] of [["No Effect", "o-dead"], ["Held Up", "o-held"]]) expect(html).toContain(`<li><i class="${cls}"></i>${label}</li>`);
    for (const [s, tone] of [["no effect", "parked"], ["held up", "quiet"]]) expect(hookPage).toContain(`<span class="badge ${tone}">${s}</span>`);
    for (const h of ["Held Up", "No Reply", "No Effect"]) expect(hookPage).toContain(`<th class="num">${h}</th>`);
    expect(hookPage).toContain('<span class="dp-k">No Effect</span>');
    expect(hookPage).not.toMatch(/No effect|Held up/);
  });

  test("the outcome legend sits in the body of Holds by Kind, above the table, and the aside says Guide only; the list has its legend and note over the rows", () => {
    const [top, body] = (([sec, end]) => [sec.slice(0, sec.indexOf(end)), sec.slice(sec.indexOf(end))])([one(holds).split("<span>Holds by Kind</span>")[1].split("</details>")[0], "</summary>"]);
    expect(top).toMatch(/<span class="dp-aside">[^]*<p class="note">Guide only<\/p>/);
    expect(top).not.toContain('class="legend"');
    expect(body.split("<table")[0]).toMatch(/<ul class="legend">[^]*Held Up[^]*No Effect/);
    expect(page("").split('class="browse"')[0]).toMatch(/<ul class="legend">[^]*Held Up[^]*No Effect[^]*<p class="note">Guide only<\/p>/);
  });

  test("Holds by Day is a chart panel on a hook's page under its own key, not a bar list, and the list has no chart", () => {
    const html = renderHook({ ...HOOK, source: [], event: "Stop", name: "verify gate", matcher: "", file: "x.ts", mode: "", timeout: 10, holds: twoDays, byKind: [], errors: [] }, new URLSearchParams());
    expect(html.match(/<aleph-chart key="([^"]+)"><section class="card" aria-label="Holds by Day">/)?.[1]).toBe("hooks/Stop/verify gate");
    expect(html).not.toContain('class="bars"');
    for (const v of ["", "holds", "errors"]) expect(page(v, { ...data, holds: twoDays })).not.toContain("aleph-chart");
  });

  test("the Holds by Day frame has one row per day of the window, a day with no holds a row of 0", () => {
    const gap = holds.map((h, i) => ({ ...h, t: i === 3 ? "2026-11-19T10:00:00Z" : "2026-11-17T10:00:00Z" }));
    expect(holdsFrame(gap, "week", Date.parse("2026-11-19T10:00:00Z")).rows.map((r: { holds: number }) => r.holds)).toEqual([0, 0, 0, 0, 0, 3, 0, 1]);
  });

  test("a hook's Holds by Kind head counts its rows", () => {
    const kind = (k: string) => ({ kind: k, holds: 1, interactive: 1, workers: 0, outcomes: { caught: 1 } });
    const html = renderHook({ ...HOOK, source: [], event: "Stop", name: "one way", matcher: "", file: "x.ts", mode: "", timeout: 10, holds: twoDays, byKind: ["new-copy", "boundary", "judged"].map(kind), errors: [] }, new URLSearchParams());
    expect(head(html, "Holds by Kind")).toBe("3");
    for (const c of ['class="page dp-page"', "dp-kpis", "<details"]) expect(html).toContain(c);
  });

  test("Holds by Kind's kind filters the log; Show sits in the last td.acts", () => {
    /** The cells of the first body row of the panel `title`. */
    const tds = (html: string, title: string) => html.split(`>${title}<`)[1].split("<tbody>")[1].split("</tr>")[0].match(/<td[^>]*>.*?<\/td>/g)!;
    expect(tds(one(holds), "Holds by Kind")[0]).toBe('<td><button type="button" class="link" data-kind="new-copy">new copy</button></td>');
    expect(tds(one(holds), "Holds by Kind").at(-1)).toBe('<td class="acts"><button class="act small" type="button" data-kind="new-copy">Show</button></td>');
  });

  test("a hook's errors table puts Fix before the numbers, Last at the end and a count above 0 in the bad tone; an empty Fix shows miss()", () => {
    const html = renderHook({ ...HOOK, source: [], event: "Stop", name: "one way", matcher: "", file: "x.ts", mode: "", timeout: 10, holds: [], byKind: [], errors: [...data.errors, { ...data.errors[0], cause: "Other", fix: "" }] }, new URLSearchParams());
    const table = html.split("<span>Errors</span>")[1].split("</table>")[0];
    expect([...table.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1])).toEqual(["Cause", "Hooks", "Event", "Fix", "Errors", "Sessions", "Last"]);
    expect(table).toMatch(/<td>Stub or stable entry<\/td><td class="num bad">53<\/td><td class="num">10<\/td><td class="time">/);
    expect(table).toMatch(/<td><span title="no known fix">–<\/span><\/td>/);
  });

  test("a hook with no holds and no errors draws neither panel", () => {
    const html = renderHook({ ...HOOK, source: [], event: "Stop", name: "context gate", matcher: "", file: "hooks/context-gate.ts", mode: "", timeout: 10, holds: [], byKind: [], errors: [] }, new URLSearchParams());
    expect(html).not.toContain(empty());
    expect(html).not.toContain('id="holds"');
    expect(html).not.toContain("<summary><span>Errors</span>");
  });

  test("a hook draws its Holds panel with holds and its Errors panel only with errors", () => {
    const hook = { ...HOOK, source: [], event: "Stop", name: "one way", matcher: "", file: "x.ts", mode: "", timeout: 10, holds, byKind: [] };
    for (const [errors, shown] of [[data.errors, true], [[], false]] as const) {
      const html = renderHook({ ...hook, errors }, new URLSearchParams());
      expect(html).toContain('id="holds"');
      expect(html.includes("<summary><span>Errors</span>")).toBe(shown);
    }
  });

  test("a hook's page head shows its name with no count, its event in the crumb, and its six facts, an empty Matcher or Mode as miss()", () => {
    const html = renderHook({ ...HOOK, source: [], event: "Stop", name: "one way", matcher: "", file: "hooks/one-way.ts", mode: "", timeout: 10, holds: [], byKind: [], errors: [] }, new URLSearchParams());
    expect(html).toContain('<header class="ph"><h1>one way</h1><div class="aside">');
    expect(html).not.toContain('<span class="count">');
    expect(html).toContain("<span>Stop</span> / <span>one way</span></nav>");
    expect([...html.matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1])).toEqual(["Event", "Matcher", "Command", "Mode", "Timeout", "Workers"]);
    expect(html).toContain("<dt>Event</dt><dd>Stop</dd>");
    expect(html).toContain('<dt>Command</dt><dd><code>bun x.ts</code></dd>');
    expect(html).toContain('<dt>Workers</dt><dd><span class="badge quiet">skips</span></dd>');
    for (const t of ['<dt>Matcher</dt><dd><span title="matches all">', '<dt>Mode</dt><dd><span title="sync by default">']) expect(html).toContain(t);
    const set = renderHook({ ...HOOK, source: [], event: "Stop", name: "one way", matcher: "Bash", file: "hooks/one-way.ts", mode: "async", timeout: 10, holds: [], byKind: [], errors: [] }, new URLSearchParams());
    for (const t of ["<dt>Matcher</dt><dd><code>Bash</code></dd>", "<dt>Mode</dt><dd>async</dd>"]) expect(set).toContain(t);
  });

  test("a hook's Source panel comes last with one fold per file; a hook with no files shows The whole CLI", () => {
    const source = [{ file: "hooks/a.ts", text: "a\nb" }, { file: "lib/b.ts", text: "c" }];
    const html = renderHook({ ...HOOK, source, event: "Stop", name: "one way", matcher: "", file: "hooks/a.ts", mode: "", timeout: 10, holds, byKind: data.byHook, errors: data.errors }, new URLSearchParams());
    const panel = html.split("<span>Source</span>")[1];
    expect([...panel.matchAll(/<details><summary><code>([^<]+)<\/code> <span class="quiet">(\d+) lines<\/span><\/summary><div class="md"><pre>/g)].map((m) => [m[1], m[2]])).toEqual([["hooks/a.ts", "2"], ["lib/b.ts", "1"]]);
    expect(panel).toContain("<pre>c</pre>");
    expect(panel).not.toContain("dp-panel");
    const cli = renderHook({ ...HOOK, source: [], event: "SessionStart", name: "factory report", matcher: "", file: "cli/cli.ts", mode: "", timeout: 20, holds: [], byKind: [], errors: [] }, new URLSearchParams());
    expect(cli.split("<span>Source</span>")[1]).toContain(empty("The whole CLI"));
  });

  test("a hook's Timeout fact shows its timeout through dur()", () => {
    const html = renderHook({ ...HOOK, source: [], event: "Stop", name: "one way", matcher: "", file: "hooks/one-way.ts", mode: "", timeout: 90, holds: [], byKind: [], errors: [] }, new URLSearchParams());
    const fact = html.split("<dt>Timeout</dt>")[1].split("</dd>")[0];
    expect(fact).toContain("1m 30s");
    expect(fact).not.toContain(" s");
  });
});
