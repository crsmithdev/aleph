import { expect, test } from "bun:test";
import { setCodes } from "../lib/naming.ts";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { attend } from "./asks.ts";
import { held, job, state } from "./fixtures/status-state.ts";
import { asksOf, issue, withFactory } from "./test-now.ts";
// @ts-ignore lib.js is plain JS, shared with the page
import { pageHead } from "./lib.js";
import { labelOf, verdict } from "../lib/status-words.ts";

const calmState = { ...withFactory({}), asks: [], stuck: [] };

const said = (o: object, top: object = {}) => view.renderLede({ ...calmState, ...top, factory: { ...calmState.factory, ...o } }).replace(/<[^>]*>/g, "");

const alert = (text: string, key?: string) => ({ text, kind: "alert", key });
const warn = (text: string) => ({ text, kind: "warn" });

const ciRed = alert("health: aleph CI on main has failed 2 runs in a row since 2026-11-01 10:00 UTC (abc1234): https://x", "red-ci");

const mainRed = alert("health: aleph main is red at abc1234: tsc", "red-main");

test("with nothing wrong the status sentence is the fine sentence", () => {
  expect(said({})).toBe("Everything is fine.");
  expect(view.renderLede(calmState)).toContain('class="say fine"');
});

test("each error line says its alert, in red", () => {
  const cases: [object, string][] = [
    [{ health: [ciRed] }, "GitHub CI is broken"],
    [{ health: [mainRed] }, "the build is failing on main"],
    [{ health: [alert("health: 2 passed runs did not land in 15 minutes", "lands-stuck")] }, "lands are stuck"],
    [{ health: [alert("health: the land run of aleph-5 is live for over 30 minutes", "lands-stuck")] }, "lands are stuck"],
    [{ health: [alert("health: 2 goals can start, but no run started in 15 minutes", "queue-stuck")] }, "queued jobs are not starting"],
    [{ health: [alert("health: 1 new issue did not move to jobs in 15 minutes", "issues-stuck")] }, "new issues are not becoming jobs"],
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
    const page = view.view.render(withFactory({ health: [alert("health: the land run of aleph-5 is live for over 30 minutes", "lands-stuck")] }));
    expect(page).toContain("the land run of a5 is live for over 30 minutes");
    expect(page).not.toContain("aleph-5");
    expect(said({ health: [warn("health: koans main is red at def5678: aleph-6 is the cause")] })).toBe("Everything is fine; koans main is red at def5678: a6 is the cause.");
  } finally {
    setCodes({});
  }
});

test("stuck and failed jobs are one alert that links to their cards", () => {
  const stuck = [job({ name: "aleph-1", condition: "failed" }), job({ name: "aleph-2", condition: "failed" })];
  const h = view.renderLede({ ...calmState, stuck });
  expect(h).toBe('<span class="say error">Alert: <a href="#jobs-stuck">Jobs are unhealthy</a>.</span>');
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
  const stuck = [job({ name: "aleph-1", condition: "failed" })];
  expect(said({ health: [alert("health: something new broke."), mainRed, ciRed] }, { stuck })).toBe("Alert: GitHub CI is broken; the build is failing on main; jobs are unhealthy.");
});

test("what asks for you leads the status sentence, in the warning colour", () => {
  const ask = (kind: string) => ({ kind });
  const asks = (...k: string[]) => ({ asks: k.map(ask) });
  const raw = (top: object, o: object = {}) => view.renderLede({ ...calmState, ...top, factory: { ...calmState.factory, ...o } });
  expect(raw(asks("approval"))).toBe('<span class="say warning"><a href="#awaiting">Your attention is needed</a>.</span>');
  expect(raw(asks("input", "input"))).toBe(raw(asks("approval")));
  expect(raw(asks("input", "approval"))).toBe(raw(asks("approval")));
  expect(raw({}, { runsToday: 12 })).toBe('<span class="say fine">Everything is fine.</span>');
  expect(raw(asks("approval"), { health: [mainRed] })).toContain('say error">Alert: <a href="#awaiting">The build is failing on main</a>; <a href="#awaiting">your attention is needed</a>.');
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
  expect(view.view.render(withFactory({ health: [slow] }))).not.toContain('data-kind="error"');
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

test("the status line says your attention is needed when the Issues section has an item", () => {
  const calm = { ...state, asks: [], stuck: [], issues: [], factory: { ...state.factory, health: [], paused: false } };
  for (const o of [{ asks: asksOf([], [{ ...issue(7), question: "q", ask: { kind: "input", reason: "question", question: "q", options: [], why: [], situation: "Escalated." } }]) }]) {
    const h = view.renderLede({ ...calm, ...o });
    expect(h).toMatch(/your attention is needed/i);
    expect(h).not.toContain("Awaiting");
  }
});

test("a held run asks for your attention once the director escalates it, and not while the director holds it", () => {
  const calm = { ...state, stuck: [], factory: { ...state.factory, health: [] } };
  const withDirector = attend({ runs: [held], issues: [] }, []).items;
  expect(view.renderLede({ ...calm, asks: withDirector })).not.toMatch(/your attention is needed/i);
  const asks = attend({ runs: [{ ...held, ask: { ...held.ask, situation: "It changes hooks/lib/digest.ts." } }], issues: [] }, []).items;
  const h = view.renderLede({ ...calm, asks });
  expect(h).toMatch(/your attention is needed/i);
  expect(h).toContain('class="say warning"');
});

test("the status sentence wraps instead of clipping: .shead .say has no ellipsis or hidden overflow, and wraps", async () => {
  const html = await Bun.file(new URL("./app.css", import.meta.url)).text();
  const say = [...html.matchAll(/\.shead \.say[^{}]*\{([^}]*)\}/g)].map((m) => m[1]).join("\n");
  expect(say).not.toContain("text-overflow: ellipsis");
  expect(say).not.toContain("overflow: hidden");
  expect(say).toContain("white-space: normal");
});

const OOD = "Alert: This status is out of date.";

const strip = (h: string) => h.replace(/<[^>]*>/g, "");

test("the out-of-date part comes first and survives MAX_SAID", () => {
  const s = { ...calmState, health: { ...(calmState as any).health }, asks: [{ kind: "approval" }, { kind: "input" }], stuck: [{}] };
  const base = said({}, { stuck: [{}], asks: [{ kind: "approval" }, { kind: "input" }] });
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
  const stuck = [job({ name: "aleph-1", condition: "failed" })];
  const lede = view.renderLede({ ...calmState, stuck, asks: [{ kind: "approval" }] });
  const needs = view.renderNeeds({ ...calmState, stuck, asks: [{ id: "a1", kind: "input", at: "2026-11-01T00:00:00Z", text: "x" }] });
  const alerts = needs.split('<h2 id="h-needs">Alerts</h2>')[1] ?? "";
  const ids = [...lede.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  expect(ids).toContain("jobs-stuck");
  for (const id of ids) expect(alerts).toContain(`id="${id}"`);
});

test("one mapping gives each status sentence its Herald label, on the page too", () => {
  expect(labelOf("warning", "The factory is paused")).toBe("Wait");
  expect(labelOf("warning", "Your attention is needed")).toBe("Ask");
  expect(labelOf("alert", "Alert: The build is failing on main")).toBe("Alert");
  expect(labelOf("fine", "Everything is fine")).toBe("Fine");
  expect(verdict({ ...calmState, factory: { ...calmState.factory, paused: true } }).label).toBe("Wait");
});
