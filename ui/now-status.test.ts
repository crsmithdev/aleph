import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { attend } from "./asks.ts";
import { held, job, state } from "./fixtures/status-state.ts";
import { asksOf, issue, withFactory } from "./test-now.ts";

const calmState = { ...withFactory({}), asks: [], stuck: [] };

const said = (o: object, top: object = {}) => view.renderLede({ ...calmState, ...top, factory: { ...calmState.factory, ...o } }).replace(/<[^>]*>/g, "");

const ciRed = "health: aleph CI on main has failed 2 runs in a row since 2026-11-01 10:00 UTC (abc1234): https://x";

const mainRed = "health: aleph main is red at abc1234: tsc";

test("with nothing wrong the status sentence is the fine sentence", () => {
  expect(said({})).toBe("Everything is running smoothly.");
  expect(view.renderLede(calmState)).toContain('class="say fine"');
});

test("each error line says its alert, in red", () => {
  const cases: [object, string][] = [
    [{ health: [ciRed] }, "GitHub CI is broken"],
    [{ health: [mainRed] }, "the build is failing on main"],
    [{ probe: { at: "x", ok: false, failed: ["no network"] } }, "the sandbox is broken"],
    [{ health: ["health: 2 passed runs did not land in 15 minutes"] }, "lands are stuck"],
    [{ health: ["health: the land run of aleph-5 is live for over 30 minutes"] }, "lands are stuck"],
    [{ health: ["health: 2 goals can start, but no run started in 15 minutes"] }, "queued jobs are not starting"],
    [{ health: ["health: 1 new issue did not move to jobs in 15 minutes"] }, "new issues are not becoming jobs"],
    [{ health: ["health: something new broke."] }, "something new broke"],
  ];
  for (const [o, text] of cases) {
    expect(said(o)).toBe(`Alert: ${text}.`);
    expect(view.renderLede({ ...calmState, factory: { ...calmState.factory, ...o } })).toContain('class="say error"');
  }
});

test("stuck and failed jobs are one alert that links to their cards", () => {
  const stuck = [job({ name: "aleph-1", condition: "stuck" }), job({ name: "aleph-2", condition: "failed" })];
  const h = view.renderLede({ ...calmState, stuck });
  expect(h).toBe('<span class="say error">Alert: <a href="#jobs-stuck">jobs are unhealthy</a>.</span>');
});

test("two repos with the same trouble say it once", () => {
  expect(said({ health: [mainRed, "health: koans main is red at def5678: lint"] })).toBe("Alert: the build is failing on main.");
});

test("the sentence says at most three parts, the most serious first", () => {
  const stuck = [job({ name: "aleph-1", condition: "stuck" })];
  expect(said({ health: ["health: something new broke.", mainRed, ciRed] }, { stuck })).toBe("Alert: GitHub CI is broken; the build is failing on main; jobs are unhealthy.");
});

test("what asks for you follows the fine sentence, in the warning colour", () => {
  const ask = (kind: string) => ({ kind });
  const asks = (...k: string[]) => ({ asks: k.map(ask) });
  const raw = (top: object, o: object = {}) => view.renderLede({ ...calmState, ...top, factory: { ...calmState.factory, ...o } });
  expect(raw(asks("approval"))).toBe('<span class="say warning">Everything is running smoothly; <a href="#awaiting">your attention is needed</a>.</span>');
  expect(raw(asks("input", "input"))).toBe(raw(asks("approval")));
  expect(raw(asks("input", "approval"))).toBe(raw(asks("approval")));
  expect(raw({}, { runsToday: 12 })).toBe('<span class="say fine">Everything is running smoothly.</span>');
  expect(raw(asks("approval"), { health: [mainRed] })).toContain('say error">Alert: <a href="#awaiting">the build is failing on main</a>; <a href="#awaiting">your attention is needed</a>.');
});

test("a paused factory does not say it runs smoothly", () => {
  expect(said({ paused: true })).toBe("The factory is paused.");
  expect(view.renderLede({ ...calmState, factory: { ...calmState.factory, paused: true } })).toContain('class="say warning"');
  expect(said({ paused: true, runsToday: 12 })).toBe("The factory is paused.");
  expect(said({ paused: true, health: [mainRed] })).toBe("Alert: the build is failing on main; the factory is paused.");
});

const weekAt = (seven_day: number) => ({ usage: { now: { seven_day } } });

test("an alert keeps its red sentence and holds the weekly usage part; three alerts cut it", () => {
  expect(said({ health: [mainRed] }, weekAt(90))).toBe("Alert: the build is failing on main; weekly usage is at 90%.");
  expect(view.renderLede({ ...calmState, ...weekAt(90), factory: { ...calmState.factory, health: [mainRed] } })).toContain('class="say error"');
  const three = { health: [ciRed, mainRed, "health: something new broke."] };
  expect(said(three, weekAt(90))).toBe("Alert: GitHub CI is broken; the build is failing on main; something new broke.");
});

test("a full suite over its budget is a warning part, not an alert and not a card", () => {
  const slow = "health: aleph full suite took 135 s; the budget is 120 s";
  expect(said({ health: [slow] })).toBe("Everything is running smoothly; aleph full suite took 135 s; the budget is 120 s.");
  expect(view.renderLede({ ...calmState, factory: { ...calmState.factory, health: [slow] } })).toContain('class="say warning"');
  expect(said({ health: [mainRed, slow] })).toBe("Alert: the build is failing on main; aleph full suite took 135 s; the budget is 120 s.");
  expect(view.view.render(withFactory({ health: [slow] }))).not.toContain('data-kind="error"');
});

test("a failed nightly acceptance run is a warning part, not an alert and not a card", () => {
  const failed = "health: aleph nightly acceptance run failed at abc1234: 2 tests failed";
  expect(said({ health: [failed] })).toBe("Everything is running smoothly; aleph nightly acceptance run failed at abc1234: 2 tests failed.");
  expect(view.view.render(withFactory({ health: [failed] }))).not.toContain('data-kind="error"');
});

test("the page has no banner and the status line holds the alert", () => {
  const page = view.view.render(withFactory({ health: [mainRed] }));
  expect(page).not.toContain('class="banner"');
  expect(page).toMatch(/<header class="ph shead">[^]*the build is failing on main/);
});

test("the most flaked line stays in the report and off the status sentence and the error rows", () => {
  const line = "health: most flaked in acceptance in 7 days: a.test.ts > twice (1 times)";
  const page = view.view.render({ ...withFactory({ health: [line] }), asks: [], stuck: [] });
  expect(page).not.toContain("most flaked");
});

test("the status line says your attention is needed when the Issues section has an item", () => {
  const calm = { ...state, asks: [], stuck: [], issues: [], factory: { ...state.factory, health: [], paused: false } };
  for (const o of [{ asks: asksOf([], [{ ...issue(7), question: "q", ask: { kind: "input", reason: "question", question: "q", options: [], why: [], situation: "Escalated." } }]) }]) {
    const h = view.renderLede({ ...calm, ...o });
    expect(h).toContain("your attention is needed");
    expect(h).not.toContain("Awaiting");
  }
});

test("a held run asks for your attention once the director escalates it, and not while the director holds it", () => {
  const calm = { ...state, stuck: [], factory: { ...state.factory, health: [] } };
  const withDirector = attend({ runs: [held], issues: [] }, []).items;
  expect(view.renderLede({ ...calm, asks: withDirector })).not.toContain("your attention is needed");
  const asks = attend({ runs: [{ ...held, ask: { ...held.ask, situation: "It changes hooks/lib/digest.ts." } }], issues: [] }, []).items;
  const h = view.renderLede({ ...calm, asks });
  expect(h).toContain("your attention is needed");
  expect(h).toContain('class="say warning"');
});

test("the status sentence wraps instead of clipping: .shead .say has no ellipsis or hidden overflow, and wraps", async () => {
  const html = await Bun.file(new URL("./app.css", import.meta.url)).text();
  const say = [...html.matchAll(/\.shead \.say[^{}]*\{([^}]*)\}/g)].map((m) => m[1]).join("\n");
  expect(say).not.toContain("text-overflow: ellipsis");
  expect(say).not.toContain("overflow: hidden");
  expect(say).toContain("white-space: normal");
});

const OOD = "Alert: this status is out of date.";

const strip = (h: string) => h.replace(/<[^>]*>/g, "");

test("the out-of-date part comes first and survives MAX_SAID", () => {
  const s = { ...calmState, health: { ...(calmState as any).health }, asks: [{ kind: "approval" }, { kind: "input" }], stuck: [{}] };
  const base = said({}, { stuck: [{}], asks: [{ kind: "approval" }, { kind: "input" }] });
  const h = strip(view.renderLede(s, true));
  expect(h.startsWith(OOD.slice(0, -1) + "; ")).toBe(true);
  expect(h.split("; ").length).toBe(base.split("; ").length + 1);
});

test("a dead factory tick says the alert, in red", () => {
  const dead = "Alert: the factory tick has stopped.";
  for (const o of [{ nextTick: null }, { nextTick: "2026-10-27T16:54:59Z" }]) {
    expect(said(o)).toBe(dead);
    expect(view.renderLede({ ...calmState, factory: { ...calmState.factory, ...o } })).toContain('class="say error"');
  }
  const fine = "Everything is running smoothly.";
  for (const o of [{ nextTick: "2026-10-27T17:12:00Z" }, { nextTick: "2026-10-27T16:56:00Z" }, { nextTick: null, tickInProgress: true }, { nextTick: "2026-10-27T16:00:00Z", tickInProgress: true }]) expect(said(o)).toBe(fine);
  expect(said({ paused: true, nextTick: null })).toBe("Alert: the factory tick has stopped; the factory is paused.");
});
