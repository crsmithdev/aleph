import { describe, expect, test } from "bun:test";
// @ts-ignore plain JS, shared with the page
import { view, renderHook, renderHooks } from "./hooks.js";
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
    expect(html).toMatch(/<tr class="rowlink"><td>Stop<\/td><td class="wide"><a href="#\/hooks\/Stop\/one%20way">one way<\/a><\/td>/);
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

  test("the heads of Holds by Hook, Holds by Day and Errors by Cause count their own items", () => {
    const html = renderHooks({ ...data, holds: twoDays }, new URLSearchParams());
    expect([head(html, "Holds by Hook"), head(html, "Holds by Day"), head(html, "Errors by Cause")]).toEqual(["1", "2", "1"]);
  });

  test("the errors table puts Fix before the numbers, Last at the end, and a count above 0 in the bad tone", () => {
    const table = renderHooks(data, new URLSearchParams()).split('aria-label="Errors by Cause"')[1].split("</table>")[0];
    expect([...table.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1])).toEqual(["Cause", "Hooks", "Event", "Fix", "Errors", "Sessions", "Last"]);
    expect(table).toContain('<th class="num">Errors</th><th class="num">Sessions</th>');
    expect(table).toMatch(/<td>Stub or stable entry<\/td><td class="num bad">53<\/td><td class="num">10<\/td><td class="time">/);
  });

  test("a hook's Holds by Day head counts the days and Holds by Kind its rows", () => {
    const kind = (k: string) => ({ kind: k, holds: 1, interactive: 1, workers: 0, outcomes: { caught: 1 } });
    const html = renderHook({ event: "Stop", name: "one way", matcher: "", file: "x.ts", mode: "", timeout: 10, holds: twoDays, byKind: ["new-copy", "boundary", "judged"].map(kind), errors: [] }, new URLSearchParams());
    expect([head(html, "Holds by Day"), head(html, "Holds by Kind")]).toEqual(["2", "3"]);
    for (const c of ['class="page dp-page"', "dp-kpis", "<details"]) expect(html).toContain(c);
  });

  test("the list page with no holds keeps the Holds by Day card, empty", () => {
    const html = renderHooks({ ...data, holds: [], byHook: [], errors: [] }, new URLSearchParams());
    const card = html.split('aria-label="Holds by Day"')[1]?.split("</section>")[0];
    expect(card).toContain(empty());
  });

  test("a hook with no holds and no errors shows the empty state", () => {
    const html = renderHook({ event: "Stop", name: "context gate", matcher: "", file: "hooks/context-gate.ts", mode: "", timeout: 10, holds: [], byKind: [], errors: [] }, new URLSearchParams());
    expect(html.split(empty()).length - 1).toBe(2);
  });

  test("a hook's page head shows its name with no count, its event in the crumb and facts", () => {
    const html = renderHook({ event: "Stop", name: "one way", matcher: "", file: "hooks/one-way.ts", mode: "", timeout: 10, holds: [], byKind: [], errors: [] }, new URLSearchParams());
    expect(html).toContain('<header class="ph"><h1>one way</h1><div class="aside">');
    expect(html).not.toContain('<span class="count">');
    expect(html).toContain("<span>Stop</span> / <span>one way</span></nav>");
    expect(html).toContain("<dt>Event</dt><dd>Stop</dd>");
  });
});
