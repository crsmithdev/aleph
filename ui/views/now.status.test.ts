import { expect, test } from "bun:test";
import { setCodes } from "../../lib/naming.ts";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./now.js";
import { attend } from "../asks.ts";
import { held, job, state } from "../fixtures/status-state.ts";
import { asksOf, heraldOf, issue, row, withAttn, withFactory } from "../now.testkit.ts";
// @ts-ignore lib.js is plain JS, shared with the page
import { pageHead } from "./lib/html.js";
import { labelOf, verdict } from "../../lib/status-words.ts";

const calmState = { ...withFactory({}), asks: [], errored: [] };

const said = (o: object, top: object = {}) => view.renderLede({ ...calmState, ...top, factory: { ...calmState.factory, ...o } }).replace(/<[^>]*>/g, "");

const alert = (text: string, key?: string) => ({ text, kind: "alert", key });
const warn = (text: string) => ({ text, kind: "warn" });

const ciRed = alert("health: aleph CI on main has failed 2 runs in a row since 2026-11-01 10:00 UTC (abc1234): https://x", "red-ci");

const mainRed = alert("health: aleph main is red at abc1234: tsc", "red-main");

test("with nothing wrong the status sentence is the fine sentence", () => {
  expect(said({})).toBe("Everything is fine.");
  expect(view.renderLede(calmState)).toContain('class="say fine"');
});

test("a failed flow load is an alert, not the fine sentence", () => {
  const html = view.renderLede({ ...calmState, flow: { error: "Could not load Flow (500)." } });
  expect(html).toContain('class="say error"');
  expect(html).not.toContain("Everything is fine");
});

test("each error line says its alert, in red", () => {
  const cases: [object, string][] = [
    [{ health: [ciRed] }, "GitHub CI is broken"],
    [{ health: [mainRed] }, "the build is failing on main"],
    [{ health: [alert("health: 2 passed runs did not land in 15 minutes", "lands-stalled")] }, "lands are stalled"],
    [{ health: [alert("health: the land run of aleph-5 is live for over 30 minutes", "lands-stalled")] }, "lands are stalled"],
    [{ health: [alert("health: 2 issues can start, but no run started in 15 minutes", "queue-stalled")] }, "queued jobs are not starting"],
    [{ health: [alert("health: 1 new issue did not move to jobs in 15 minutes", "issues-stalled")] }, "new issues are not becoming jobs"],
    [{ health: [alert("health: something new broke.")] }, "something new broke"],
  ];
  for (const [o, text] of cases) {
    expect(said(o)).toBe(`Alert: ${text[0].toUpperCase()}${text.slice(1)}.`);
    expect(view.renderLede({ ...calmState, factory: { ...calmState.factory, ...o } })).toContain('class="say error"');
  }
});

test("the page and the status sentence show a health line's issue id in its short form", () => {
  setCodes({ aleph: "a" });
  try {
    const page = view.view.render(withFactory({ health: [alert("health: the land run of aleph-5 is live for over 30 minutes", "lands-stalled")] }));
    expect(page).not.toContain("aleph-5");
    expect(said({ health: [warn("health: koans main is red at def5678: aleph-6 is the cause")] })).toBe("Everything is fine; koans main is red at def5678: a6 is the cause.");
  } finally {
    setCodes({});
  }
});

test("errored and failed jobs are one alert that links to their cards", () => {
  const errored = [job({ name: "aleph-1", state: "failed" }), job({ name: "aleph-2", state: "failed" })];
  const h = view.renderLede({ ...calmState, errored });
  expect(h).toBe('<span class="say error">Alert: <a href="#jobs-error">Jobs are unhealthy</a>.</span>');
});

test("a red main or CI of a repo other than aleph is a warning, not an alert", () => {
  const koans = warn("health: koans main is red at def5678: lint");
  const koansCi = warn("health: koans CI on main has failed 1 run in a row since 2026-11-01 10:00 UTC (def5678): https://x");
  expect(said({ health: [koans] })).toBe("Everything is fine; koans main is red at def5678: lint.");
  expect(view.renderLede({ ...calmState, factory: { ...calmState.factory, health: [koans] } })).toContain('class="say warning"');
  expect(said({ health: [koansCi] })).toStartWith("Everything is fine; koans CI on main has failed");
  expect(said({ health: [mainRed, koans] })).toBe("Alert: The build is failing on main; koans main is red at def5678: lint.");
});

test("a red-main alert is ranked by its key, not by its text", () => {
  expect(said({ health: [alert("health: tsc failed at abc1234", "red-main")] })).toBe("Alert: The build is failing on main.");
});

test("the sentence says at most three parts, the most serious first", () => {
  const errored = [job({ name: "aleph-1", state: "failed" })];
  expect(said({ health: [alert("health: something new broke."), mainRed, ciRed] }, { errored })).toBe("Alert: GitHub CI is broken; the build is failing on main; jobs are unhealthy.");
});

test("what asks for you leads the status sentence, in the warning colour", () => {
  const asks = (n: number) => ({ asks: Array.from({ length: n }, () => ({})) });
  const raw = (top: object, o: object = {}) => view.renderLede({ ...calmState, ...top, factory: { ...calmState.factory, ...o } });
  expect(raw(asks(1))).toBe('<span class="say warning"><a href="#awaiting">Attention is needed</a>.</span>');
  expect(raw(asks(1))).not.toMatch(/\byour?\b/i);
  expect(raw(asks(2))).toBe(raw(asks(1)));
  expect(raw({}, { runsToday: 12 })).toBe('<span class="say fine">Everything is fine.</span>');
  expect(raw(asks(1), { health: [mainRed] })).toContain('say error">Alert: <a href="#awaiting">The build is failing on main</a>; <a href="#awaiting">attention is needed</a>.');
});

test("a paused factory does not say everything is fine", () => {
  expect(said({ paused: true })).toBe("The factory is paused.");
  expect(view.renderLede({ ...calmState, factory: { ...calmState.factory, paused: true } })).toContain('class="say warning"');
  expect(said({ paused: true, runsToday: 12 })).toBe("The factory is paused.");
  expect(said({ paused: true, health: [mainRed] })).toBe("Alert: The build is failing on main; the factory is paused.");
});

const weekAt = (seven_day: number) => ({ usage: { now: { seven_day } } });

test("an alert keeps its red sentence and holds the weekly usage part; three alerts cut it", () => {
  expect(said({ health: [mainRed] }, weekAt(90))).toBe("Alert: The build is failing on main; weekly usage is at 90%.");
  expect(view.renderLede({ ...calmState, ...weekAt(90), factory: { ...calmState.factory, health: [mainRed] } })).toContain('class="say error"');
  const three = { health: [ciRed, mainRed, alert("health: something new broke.")] };
  expect(said(three, weekAt(90))).toBe("Alert: GitHub CI is broken; the build is failing on main; something new broke.");
});

test("a full suite over its budget is a warning part, not an alert and not a card", () => {
  const slow = warn("health: aleph full suite took 135 s; the budget is 120 s");
  expect(said({ health: [slow] })).toBe("Everything is fine; aleph full suite took 135 s; the budget is 120 s.");
  expect(view.renderLede({ ...calmState, factory: { ...calmState.factory, health: [slow] } })).toContain('class="say warning"');
  expect(said({ health: [mainRed, slow] })).toBe("Alert: The build is failing on main; aleph full suite took 135 s; the budget is 120 s.");
  // The one error card is the fixture's failed job: the warning adds none.
  expect(view.view.render(withFactory({ health: [slow] })).match(/data-kind="error"/g)).toHaveLength(1);
});

test("the page has no banner and the status line holds the alert", () => {
  const page = view.view.render(withFactory({ health: [mainRed] }));
  expect(page).not.toContain('class="banner"');
  expect(page).toMatch(/<header class="ph shead">[^]*The build is failing on main/);
});

test("the page has one head, built by pageHead: the time, the status sentence, then the window control with Pause; outOfDate redraws its sentence", () => {
  let page = view.view.render(state, {}, new URLSearchParams());
  expect(page.match(/<header class="ph/g)?.length).toBe(1);
  const head = page.match(/<header class="ph[^]*?<\/header>/)![0];
  expect(head.indexOf('class="asof"')).toBeLessThan(head.indexOf('class="say'));
  expect(head.indexOf('class="say')).toBeLessThan(head.indexOf('data-act="pause"'));
  expect(head).not.toContain("<h1");
  const bar = head.match(/<div class="aside">([^]*)<\/div><\/header>/)![1];
  expect(head).toBe(pageHead("", { head: "shead", after: head.match(/<span class="asof">[^]*?<\/span>/)![0] + view.renderLede(state), aside: bar }));
  // A root that holds the page: the selector finds the sentence in the head, and setting its outerHTML rewrites the page.
  const say = view.renderLede(state);
  const root = { querySelector: (q: string) => (q === ".shead .say" && /<header class="ph shead">/.test(page) ? { set outerHTML(h: string) { page = page.replace(say, h); } } : null) };
  view.view.outOfDate(root, true);
  expect(view.renderLede(state, true)).not.toBe(say);
  expect(page.match(/<header class="ph[^]*?<\/header>/)![0]).toContain(view.renderLede(state, true));
  view.view.outOfDate(root, false);
});

test("the Status view has no timed reload: a change, an event or an action draws it again", () => {
  expect(view.view.refresh).toBeUndefined();
});

test("the status line says attention is needed when the Issues section has an item", () => {
  const calm = { ...state, asks: [], errored: [], issues: [], factory: { ...state.factory, health: [], paused: false } };
  for (const o of [{ asks: asksOf([], [{ ...issue(7), question: "q", ask: { reason: "question", question: "q", options: [], why: [], situation: "Escalated." } }]) }]) {
    const h = view.renderLede({ ...calm, ...o });
    expect(h).toMatch(/attention is needed/i);
    expect(h).not.toContain("Awaiting");
  }
});

test("a held run asks for your attention once the director escalates it, and not while the director holds it", () => {
  const calm = { ...state, errored: [], factory: { ...state.factory, health: [] } };
  const withDirector = attend({ runs: [held], issues: [] }).items;
  expect(view.renderLede({ ...calm, asks: withDirector })).not.toMatch(/attention is needed/i);
  const asks = attend({ runs: [{ ...held, ask: { ...held.ask, situation: "It changes hooks/lib/digest.ts." } }], issues: [] }).items;
  const h = view.renderLede({ ...calm, asks });
  expect(h).toMatch(/attention is needed/i);
  expect(h).toContain('class="say warning"');
});

test("the status sentence wraps instead of clipping: .shead .say has no ellipsis or hidden overflow, and wraps", async () => {
  const html = await Bun.file(new URL("../app.css", import.meta.url)).text();
  const say = [...html.matchAll(/\.shead \.say[^{}]*\{([^}]*)\}/g)].map((m) => m[1]).join("\n");
  expect(say).not.toContain("text-overflow: ellipsis");
  expect(say).not.toContain("overflow: hidden");
  expect(say).toContain("white-space: normal");
});

const OOD = "Alert: This status is out of date.";

const strip = (h: string) => h.replace(/<[^>]*>/g, "");

test("the out-of-date part comes first and survives MAX_SAID", () => {
  const s = { ...calmState, health: { ...(calmState as any).health }, asks: [{}, {}], errored: [{}] };
  const base = said({}, { errored: [{}], asks: [{}, {}] });
  const h = strip(view.renderLede(s, true));
  expect(h.startsWith(OOD.slice(0, -1) + "; ")).toBe(true);
  expect(h.split("; ").length).toBe(base.split("; ").length + 1);
});

test("a dead factory tick says the alert, in red", () => {
  const dead = "Alert: The factory tick has stopped.";
  for (const o of [{ nextTick: null }, { nextTick: "2026-10-27T16:54:59Z" }]) {
    expect(said(o)).toBe(dead);
    expect(view.renderLede({ ...calmState, factory: { ...calmState.factory, ...o } })).toContain('class="say error"');
  }
  const fine = "Everything is fine.";
  for (const o of [{ nextTick: "2026-10-27T17:12:00Z" }, { nextTick: "2026-10-27T16:56:00Z" }, { nextTick: null, tickInProgress: true }, { nextTick: "2026-10-27T16:00:00Z", tickInProgress: true }]) expect(said(o)).toBe(fine);
  expect(said({ paused: true, nextTick: null })).toBe("Alert: The factory tick has stopped; the factory is paused.");
});

test("the status-line links point at anchors in the rendered Alerts section", () => {
  const errored = [job({ name: "aleph-1", state: "failed" })];
  const lede = view.renderLede({ ...calmState, errored, asks: [{}] });
  const alerts = withAttn({ ...calmState, errored, asks: [{ id: "a1", at: "2026-11-01T00:00:00Z", text: "x" }] });
  const ids = [...lede.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  expect(ids).toContain("jobs-error");
  for (const id of ids) expect(alerts).toContain(`id="${id}"`);
});

test("one mapping gives each status sentence its Herald label, on the page too", () => {
  expect(labelOf("warning", "The factory is paused")).toBe("Wait");
  expect(labelOf("warning", verdict({ ...calmState, asks: asksOf([], [{ ...issue(7), question: "q", ask: { reason: "question", question: "q", options: [], why: [], situation: "Escalated." } }]) }).text)).toBe("Ask");
  expect(labelOf("alert", "Alert: The build is failing on main")).toBe("Alert");
  expect(labelOf("fine", "Everything is fine")).toBe("Fine");
  expect(verdict({ ...calmState, factory: { ...calmState.factory, paused: true } }).label).toBe("Wait");
});

const at = (m: number) => `2026-10-27T17:${String(m).padStart(2, "0")}:00Z`;
/** The state at minute `m` with a live tick, so its own status is the fine one or the paused one, and the Herald rows of `events`. */
const at_ = (m: number, paused = false, events: object[] = []) => ({ ...calmState, now: at(m), factory: { ...calmState.factory, nextTick: "2026-10-27T18:59:00Z", paused }, herald: heraldOf(events) });
/** A status event at minute `m` with its detail `<tone>: <text>`. */
const status = (m: number, detail: string) => row({ at: at(m), by: "gate", subject: "status", action: "status", note: detail });
/** The text of each status row of the feed. */
const statusRows = (h: string) => [...h.matchAll(/<div data-key="status[^"]*"[^]*?class="event-title" title="([^"]*)"/g)].map((m) => m[1]);

test("a status text change after the first render draws no status-only row; a status event in the stream's rows draws one row with its text", () => {
  const paused = "The factory is paused.";
  view.renderHerald(at_(10));
  expect(view.renderHerald(at_(20, true))).not.toContain('data-key="status');
  expect(statusRows(view.renderHerald(at_(20, true, [status(15, `warning: ${paused}`)])))).toEqual([paused]);
});

test("a kept word filters the Herald's event rows, keeps the running rows, and puts its chip in the aside", () => {
  const ev = (n: number, word: string) => ({ key: `row ${n}`, at: at(n), by: "gate", word, id: [], text: [`row ${n}`], more: 0, lines: [] });
  const s = { ...at_(30, true), runningIssues: [{ id: "aleph-3", title: "Three", stage: "implement", at: at(2) }], running: [] };
  s.herald.rows = [ev(21, "landed"), ev(22, "failed"), ev(23, "landed")];
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, x: string) => { store[k] = x; } };
  try {
    const all = view.renderHerald(s);
    expect(all.match(/data-key="row/g)).toHaveLength(3);
    expect(all).not.toContain("ref-x");
    store["aleph.herald.word"] = JSON.stringify("landed");
    const h = view.renderHerald(s);
    expect([...h.matchAll(/data-key="(row \d+)"/g)].map((m) => m[1])).toEqual(["row 23", "row 21"]);
    expect(h).toContain('data-job="aleph-3"');
    expect(h.match(/<span class="aside">([^]*?)<\/span><\/div>/)![1]).toMatch(/landed <button type="button" class="ref-x" aria-label="Clear">×<\/button>/);
  } finally {
    delete (globalThis as any).localStorage;
  }
});
