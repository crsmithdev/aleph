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
/** The count in the head of panel `title`. */
const head = (html: string, title: string) => html.match(new RegExp(`<span>${title}</span><span class="dp-aside">([^<]*)`))?.[1];
/** The holds over two days: the last a day later. */
const twoDays = holds.map((h, i) => (i === 3 ? { ...h, t: "2026-11-19T10:00:00Z" } : h));
/** The session ids of the holds log's rows. */
const logIds = (q: string) => [...renderHooks(data, new URLSearchParams(q)).split('id="holds"')[1].matchAll(/#\/sessions\/(\w+)/g)].map((m) => m[1]);

describe("the Hooks page", () => {
  test("sits under Claude after Memory and draws its KPIs, folds and holds log", () => {
    expect(view).toMatchObject({ path: "/hooks", group: "claude", icon: "plug" });
    expect(view.order).toBeGreaterThan(memory.order);
    const html = renderHooks(data, new URLSearchParams());
    for (const k of ["Holds", "Caught", "False", "No Effect", "Errors"]) expect(html).toContain(`<span class="dp-k">${k}</span>`);
    for (const t of ["Holds by Hook", "Errors by Cause", "Hooks", "Holds"]) expect(html).toContain(`<summary><span>${t}</span>`);
    expect(html).toContain('href="#/hooks/Stop/one%20way"');
    expect(html).toContain("Stub or stable entry");
    expect(logIds("")).toEqual(["aaaaaaaa1", "bbbbbbbb2", "cccccccc3", "dddddddd4"]);
  });

  test("the page head leaves the count of hooks to the Hooks panel", () => {
    const html = renderHooks(data, new URLSearchParams());
    const head = html.match(/<header class="ph">.*?<\/header>/)![0];
    expect(head).not.toContain('<span class="count">');
    expect(head).toContain('<div class="aside">Last 7 days</div>');
    expect(html).toContain(`<summary><span>Hooks</span><span class="dp-aside">${data.hooks.length}</span></summary>`);
  });

  test("each filter of the holds log leaves only its rows", () => {
    expect(logIds("who=workers")).toEqual(["bbbbbbbb2", "cccccccc3"]);
    expect(logIds("who=interactive")).toEqual(["aaaaaaaa1", "dddddddd4"]);
    expect(logIds("hook=verify%20gate")).toEqual(["cccccccc3", "dddddddd4"]);
    expect(logIds("kind=boundary")).toEqual(["bbbbbbbb2"]);
    expect(logIds("out=no%20effect")).toEqual(["bbbbbbbb2", "cccccccc3"]);
  });

  test("the heads of Holds by Hook, Holds by Day and Errors by Cause count their own items", () => {
    const html = renderHooks({ ...data, holds: twoDays }, new URLSearchParams());
    expect([head(html, "Holds by Hook"), head(html, "Holds by Day"), head(html, "Errors by Cause")]).toEqual(["1", "2", "1"]);
  });

  test("a hook's Holds by Day head counts the days and Holds by Kind its rows", () => {
    const kind = (k: string) => ({ kind: k, holds: 1, interactive: 1, workers: 0, outcomes: { caught: 1 } });
    const html = renderHook({ event: "Stop", name: "one way", matcher: "", file: "x.ts", mode: "", timeout: 10, holds: twoDays, byKind: ["new-copy", "boundary", "judged"].map(kind), errors: [] }, new URLSearchParams());
    expect([head(html, "Holds by Day"), head(html, "Holds by Kind")]).toEqual(["2", "3"]);
  });

  test("a hook with no holds and no errors shows the empty state", () => {
    const html = renderHook({ event: "Stop", name: "context gate", matcher: "", file: "hooks/context-gate.ts", mode: "", timeout: 10, holds: [], byKind: [], errors: [] }, new URLSearchParams());
    expect(html.split(empty()).length - 1).toBe(2);
  });

  test("a hook's page head shows its name with no count, its event in the crumb and facts", () => {
    const html = renderHook({ event: "Stop", name: "one way", matcher: "", file: "hooks/one-way.ts", mode: "", timeout: 10, holds: [], byKind: [], errors: [] }, new URLSearchParams());
    expect(html).toContain('<header class="ph"><h1>one way</h1></header>');
    expect(html).toContain("<span>Stop</span> / <span>one way</span></nav>");
    expect(html).toContain("<dt>Event</dt><dd>Stop</dd>");
  });
});
