import { describe, expect, test } from "bun:test";
// @ts-ignore plain JS, shared with the page
import { view, holdsFrame, renderHook, renderHooks } from "./hooks.js";
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
  byHook: [{ hook: "one way", kind: "new-copy", holds: 1, interactive: 1, workers: 0, outcomes: { caught: 1 } }],
  errors: [{ cause: "Moved hook file", fix: "Stub or stable entry", n: 53, sessions: 10, hooks: ["vault"], events: ["SessionStart"], last: "2026-11-19T09:13:00Z" }],
  hooks: [{ event: "Stop", name: "one way", matcher: "", file: "skills/refit-code/hook.ts", mode: "", timeout: 30, holds: 2 }],
};
/** The count in the head of card or panel `title`. */
const head = (html: string, title: string) => html.match(new RegExp(`(?:<h2>${title}</h2><span class="count">|<span>${title}</span><span class="dp-aside">)([^<]*)`))?.[1];
/** The holds over two days: the last a day later. */
const twoDays = holds.map((h, i) => (i === 3 ? { ...h, t: "2026-11-19T10:00:00Z" } : h));
/** The session ids of the holds log's rows. */
const logIds = (q: string) => [...renderHooks(data, new URLSearchParams(q)).split('id="holds"')[1].matchAll(/#\/sessions\/(\w+)/g)].map((m) => m[1]);

describe("the Hooks page", () => {
  test("sits under Claude after Memory and draws its metric cards, cards and holds log", () => {
    expect(view).toMatchObject({ path: "/hooks", group: "claude", icon: "plug" });
    expect(view.order).toBeGreaterThan(memory.order);
    const html = renderHooks(data, new URLSearchParams());
    for (const k of ["Holds", "Caught", "False", "No Effect", "Errors"]) expect(html).toMatch(new RegExp(`<div class="tile sc"[^>]*><span class="r1"><span class="k">${k}</span>`));
    for (const t of ["Holds by Hook", "Errors by Cause", "Hooks", "Holds"]) expect(html).toMatch(new RegExp(`<section class="card"[^>]* aria-label="${t}"><div class="sh"><h2[^>]*>${t}</h2>`));
    for (const c of ["dp-page", "dp-kpi", "dp-fold"]) expect(html).not.toContain(c);
    expect(html).toContain('href="#/hooks/Stop/one%20way"');
    expect(html).toMatch(/<tr class="rowlink"><td>Stop<\/td><td class="wide" title="one way"><a href="#\/hooks\/Stop\/one%20way">one way<\/a><\/td>/);
    expect(html).toContain("Stub or stable entry");
    expect(logIds("")).toEqual(["aaaaaaaa1", "bbbbbbbb2", "cccccccc3", "dddddddd4"]);
  });

  test("the head holds the scope bar, the Project select then the Window group, and no day count", () => {
    const ph = renderHooks(data, new URLSearchParams("window=day")).split("<section")[0];
    expect(ph).toMatch(/<select name="project"[^]*role="group" aria-label="Window" data-name="window"[^]*data-value="day" aria-pressed="true"/);
    expect(ph).not.toContain("Last 7 days");
  });

  test("the page head leaves the count of hooks to the Hooks panel", () => {
    const html = renderHooks(data, new URLSearchParams());
    const ph = html.match(/<header class="ph">.*?<\/header>/)![0];
    expect(ph).not.toContain('<span class="count">');
    expect(ph).toContain('<div class="aside">');
    expect(ph).not.toContain("Last 7 days");
    expect(head(html, "Hooks")).toBe(String(data.hooks.length));
  });

  test("each filter of the holds log leaves only its rows", () => {
    expect(logIds("who=workers")).toEqual(["bbbbbbbb2", "cccccccc3"]);
    expect(logIds("who=interactive")).toEqual(["aaaaaaaa1", "dddddddd4"]);
    expect(logIds("hook=verify%20gate")).toEqual(["cccccccc3", "dddddddd4"]);
    expect(logIds("kind=boundary")).toEqual(["bbbbbbbb2"]);
    expect(logIds("out=no%20effect")).toEqual(["bbbbbbbb2", "cccccccc3"]);
  });

  test("writes an outcome as a state in lower case, and in Title Case as a KPI or a column header", () => {
    const xs = [holds[1], hold("eeeeeeee5", "one way", "boundary", "interactive", "held up")];
    const byKind = [{ kind: "boundary", holds: 2, interactive: 1, workers: 1, outcomes: { "no effect": 1, "held up": 1 } }];
    const one = renderHook({ event: "Stop", name: "one way", matcher: "", file: "x.ts", mode: "", timeout: 30, holds: xs, byKind, errors: [] }, new URLSearchParams());
    for (const html of [renderHooks({ ...data, holds: xs }, new URLSearchParams()), one]) {
      for (const [s, cls, tone] of [["no effect", "o-dead", "parked"], ["held up", "o-held", "quiet"]]) {
        expect(html).toContain(`<li><i class="${cls}"></i>${s}</li>`);
        expect(html).toContain(`<span class="badge ${tone}">${s}</span>`);
      }
      for (const h of ["Held Up", "No Reply", "No Effect"]) expect(html).toContain(`<th class="num">${h}</th>`);
      expect(html).not.toMatch(/No effect|Held up/);
    }
    expect(one).toContain('<span class="dp-k">No Effect</span>');
  });

  test("the heads of Holds by Hook and Errors by Cause count their own items; an empty Holds by Hook has no legend", () => {
    const html = renderHooks({ ...data, holds: twoDays }, new URLSearchParams());
    expect([head(html, "Holds by Hook"), head(html, "Errors by Cause")]).toEqual(["1", "1"]);
    const none = renderHooks({ ...data, byHook: [] }, new URLSearchParams());
    expect(head(none, "Holds by Hook")).toBe("0");
    expect(none.split('aria-label="Holds by Hook"')[1].split("</section>")[0]).not.toContain('class="legend"');
  });

  test("the outcome legend sits in the aside of Holds by Hook and Holds by Kind, not above the table", () => {
    const one = renderHook({ event: "Stop", name: "one way", matcher: "", file: "x.ts", mode: "", timeout: 10, holds, byKind: data.byHook, errors: [] }, new URLSearchParams());
    /** The head and the body of a section, split at `end`, the close of its head. */
    const split = (sec: string, end: string) => [sec.slice(0, sec.indexOf(end)), sec.slice(sec.indexOf(end))];
    const parts = [
      split(renderHooks(data, new URLSearchParams()).split('aria-label="Holds by Hook"')[1].split("</section>")[0], "</div>"),
      split(one.split("<span>Holds by Kind</span>")[1].split("</details>")[0], "</summary>"),
    ];
    for (const [top, body] of parts) {
      expect(top).toMatch(/<span class="(dp-)?aside">[^]*<ul class="legend">/);
      expect(body.split("<table")[0]).not.toContain('class="legend"');
    }
  });

  test("Holds by Day is a chart panel under its own key on each page, not a bar list", () => {
    const one = renderHook({ event: "Stop", name: "verify gate", matcher: "", file: "x.ts", mode: "", timeout: 10, holds: twoDays, byKind: [], errors: [] }, new URLSearchParams());
    const list = renderHooks({ ...data, holds: twoDays }, new URLSearchParams());
    const keys = [list, one].map((html) => html.match(/<aleph-chart key="([^"]+)"><section class="card" aria-label="Holds by Day">/)?.[1]);
    expect(keys).toEqual(["hooks/day", "hooks/Stop/verify gate"]);
    for (const html of [list, one]) expect(html).not.toContain('class="bars"');
  });

  test("the Holds by Day frame has one row per day of the window, a day with no holds a row of 0", () => {
    const gap = holds.map((h, i) => ({ ...h, t: i === 3 ? "2026-11-19T10:00:00Z" : "2026-11-17T10:00:00Z" }));
    expect(holdsFrame(gap, "week", Date.parse("2026-11-19T10:00:00Z")).rows.map((r: { holds: number }) => r.holds)).toEqual([0, 0, 0, 0, 0, 3, 0, 1]);
  });

  test("the errors table puts Fix before the numbers, Last at the end, and a count above 0 in the bad tone", () => {
    const table = renderHooks(data, new URLSearchParams()).split('aria-label="Errors by Cause"')[1].split("</table>")[0];
    expect([...table.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1])).toEqual(["Cause", "Hooks", "Event", "Fix", "Errors", "Sessions", "Last"]);
    expect(table).toContain('<th class="num">Errors</th><th class="num">Sessions</th>');
    expect(table).toMatch(/<td>Stub or stable entry<\/td><td class="num bad">53<\/td><td class="num">10<\/td><td class="time">/);
  });

  test("an empty Fix, Matcher or Mode shows miss() with its reason, a set one its text", () => {
    const set = { ...data.hooks[0], matcher: "Bash", mode: "async" };
    const html = renderHooks({ ...data, errors: [...data.errors, { ...data.errors[0], cause: "Other", fix: "" }], hooks: [...data.hooks, set] }, new URLSearchParams());
    /** The cell `col` of each body row of the card `title`. */
    const cells = (title: string, col: number) => html.split(`aria-label="${title}"`)[1].split("</table>")[0].split("<tbody>")[1].split("</tr>").slice(0, -1)
      .map((r: string) => r.match(/<td[^>]*>.*?<\/td>/g)![col]);
    const [fixed, unfixed] = cells("Errors by Cause", 3), [bare, matched] = cells("Hooks", 2), [sync, async] = cells("Hooks", 4);
    for (const td of [unfixed, bare, sync]) expect(td).toMatch(/^<td[^>]*><span title="[^"]+">–<\/span><\/td>$/);
    expect(bare).toContain('title="matches all"');
    expect([fixed, matched, async].map((td) => td.replace(/<[^>]+>/g, ""))).toEqual(["Stub or stable entry", "Bash", "async"]);
  });

  test("each integer cell shows through count(): a zero outcome 0, thousands with a comma", () => {
    const html = renderHooks({ ...data, errors: [{ ...data.errors[0], n: 1234 }], hooks: [{ ...data.hooks[0], holds: 0 }] }, new URLSearchParams());
    /** The cells of the first body row of the card `title`. */
    const tds = (title: string) => html.split(`aria-label="${title}"`)[1].split("<tbody>")[1].split("</tr>")[0].match(/<td[^>]*>.*?<\/td>/g)!;
    expect(tds("Holds by Hook").slice(6, 12)).toEqual(["1", "0", "0", "0", "0", "0"].map((n) => `<td class="num">${n}</td>`));
    expect(tds("Errors by Cause")[4]).toBe('<td class="num bad">1,234</td>');
    expect(tds("Hooks")[6]).toBe('<td class="num">0</td>');
  });

  test("a hook's Holds by Kind head counts its rows", () => {
    const kind = (k: string) => ({ kind: k, holds: 1, interactive: 1, workers: 0, outcomes: { caught: 1 } });
    const html = renderHook({ event: "Stop", name: "one way", matcher: "", file: "x.ts", mode: "", timeout: 10, holds: twoDays, byKind: ["new-copy", "boundary", "judged"].map(kind), errors: [] }, new URLSearchParams());
    expect(head(html, "Holds by Kind")).toBe("3");
    for (const c of ['class="page dp-page"', "dp-kpis", "<details"]) expect(html).toContain(c);
  });

  test("Holds by Hook shows the hook as text and its Show button in the last td.acts; Holds by Kind's Show has no hook", () => {
    /** The cells of the first body row of the card or panel `title`. */
    const tds = (html: string, title: string) => html.split(`>${title}<`)[1].split("<tbody>")[1].split("</tr>")[0].match(/<td[^>]*>.*?<\/td>/g)!;
    const byHook = tds(renderHooks(data, new URLSearchParams()), "Holds by Hook");
    expect(byHook.slice(0, -1).filter((td) => td.includes("<button"))).toEqual([]);
    expect(byHook[0]).toBe("<td>one way</td>");
    expect(byHook.at(-1)).toBe('<td class="acts"><button class="act small" type="button" data-kind="new-copy" data-hook="one way">Show</button></td>');
    const one = renderHook({ event: "Stop", name: "one way", matcher: "", file: "x.ts", mode: "", timeout: 10, holds, byKind: data.byHook, errors: [] }, new URLSearchParams());
    expect(tds(one, "Holds by Kind").at(-1)).toBe('<td class="acts"><button class="act small" type="button" data-kind="new-copy">Show</button></td>');
  });

  test("the list page with no holds and no errors keeps each card, empty", () => {
    const html = renderHooks({ ...data, holds: [], byHook: [], errors: [] }, new URLSearchParams());
    for (const t of ["Holds by Hook", "Holds by Day", "Errors by Cause", "Holds"]) expect(html.split(`aria-label="${t}"`)[1]?.split("</section>")[0]).toContain(empty());
  });

  test("the Hooks panel with no hooks shows empty() and no table", () => {
    const panel = renderHooks({ ...data, hooks: [] }, new URLSearchParams()).split('aria-label="Hooks"')[1].split("</section>")[0];
    expect(panel).toContain(empty());
    expect(panel).not.toContain("<table");
  });

  test("a hook with no holds and no errors draws neither panel", () => {
    const html = renderHook({ event: "Stop", name: "context gate", matcher: "", file: "hooks/context-gate.ts", mode: "", timeout: 10, holds: [], byKind: [], errors: [] }, new URLSearchParams());
    expect(html).not.toContain(empty());
    expect(html).not.toContain('id="holds"');
    expect(html).not.toContain("<summary><span>Errors</span>");
  });

  test("a hook draws its Holds panel with holds and its Errors panel only with errors", () => {
    const hook = { event: "Stop", name: "one way", matcher: "", file: "x.ts", mode: "", timeout: 10, holds, byKind: [] };
    for (const [errors, shown] of [[data.errors, true], [[], false]] as const) {
      const html = renderHook({ ...hook, errors }, new URLSearchParams());
      expect(html).toContain('id="holds"');
      expect(html.includes("<summary><span>Errors</span>")).toBe(shown);
    }
  });

  test("a hook's page head shows its name with no count, its event in the crumb and facts", () => {
    const html = renderHook({ event: "Stop", name: "one way", matcher: "", file: "hooks/one-way.ts", mode: "", timeout: 10, holds: [], byKind: [], errors: [] }, new URLSearchParams());
    expect(html).toContain('<header class="ph"><h1>one way</h1><div class="aside">');
    expect(html).not.toContain('<span class="count">');
    expect(html).toContain("<span>Stop</span> / <span>one way</span></nav>");
    expect(html).toContain("<dt>Event</dt><dd>Stop</dd>");
    for (const t of ["<dt>Matcher</dt>", "<dt>Mode</dt>"]) expect(html).not.toContain(t);
    const set = renderHook({ event: "Stop", name: "one way", matcher: "Bash", file: "hooks/one-way.ts", mode: "async", timeout: 10, holds: [], byKind: [], errors: [] }, new URLSearchParams());
    for (const t of ["<dt>Matcher</dt><dd><code>Bash</code></dd>", "<dt>Mode</dt><dd>async</dd>"]) expect(set).toContain(t);
  });

  test("the Hooks panel shows each timeout through dur() under the head Timeout", () => {
    const panel = renderHooks(data, new URLSearchParams()).split('aria-label="Hooks"')[1].split("</section>")[0];
    expect(panel).toContain('<td class="num">30s</td>');
    expect(panel).toContain(">Timeout<");
    expect(panel).not.toContain("Timeout s");
  });

  test("a hook's Timeout fact shows its timeout through dur()", () => {
    const html = renderHook({ event: "Stop", name: "one way", matcher: "", file: "hooks/one-way.ts", mode: "", timeout: 90, holds: [], byKind: [], errors: [] }, new URLSearchParams());
    const fact = html.split("<dt>Timeout</dt>")[1].split("</dd>")[0];
    expect(fact).toContain("1m 30s");
    expect(fact).not.toContain(" s");
  });
});
