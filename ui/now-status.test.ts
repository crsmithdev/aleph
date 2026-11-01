import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { attend } from "./asks.ts";
import { held, job, state } from "./fixtures/status-state.ts";
import { asksOf, withAttn, issue, withFactory } from "./test-now.ts";

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
    [{ hold: "Held: aleph-116 is stuck (merge conflict). No run starts or lands until it is cleared." }, "jobs are unhealthy"],
    [{ health: ["health: 2 passed runs did not land in 15 minutes"] }, "lands are stuck"],
    [{ health: ["health: the land run of aleph-5 is live for over 30 minutes"] }, "lands are stuck"],
    [{ health: ["health: 2 goals can start, but no run started in 15 minutes"] }, "queued jobs are not starting"],
    [{ health: ["health: 1 new issue did not move to jobs in 15 minutes"] }, "new issues are not becoming jobs"],
    [{ health: ["health: 4 runs wait for Chris; no new run starts"] }, "new runs wait for your answers"],
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
  expect(said({ health: ["health: 4 runs wait for Chris; no new run starts", mainRed, ciRed] }, { stuck })).toBe("Alert: GitHub CI is broken; the build is failing on main; jobs are unhealthy.");
});

test("what asks for you follows the fine sentence, in the warning colour", () => {
  const ask = (kind: string) => ({ kind });
  const asks = (...k: string[]) => ({ asks: k.map(ask) });
  const raw = (top: object, o: object = {}) => view.renderLede({ ...calmState, ...top, factory: { ...calmState.factory, ...o } });
  expect(raw(asks("approval"))).toBe('<span class="say warning">Everything is running smoothly; <a href="#awaiting">your attention is needed</a>.</span>');
  expect(raw(asks("input", "input"))).toBe(raw(asks("approval")));
  expect(raw(asks("input", "approval"))).toBe(raw(asks("approval")));
  expect(raw({}, { runsToday: 12 })).toContain("Everything is running smoothly; the day cap is reached.");
  expect(raw(asks("approval"), { health: [mainRed] })).toContain('say error">Alert: <a href="#awaiting">the build is failing on main</a>; <a href="#awaiting">your attention is needed</a>.');
});

test("a paused factory does not say it runs smoothly", () => {
  expect(said({ paused: true })).toBe("The factory is paused.");
  expect(view.renderLede({ ...calmState, factory: { ...calmState.factory, paused: true } })).toContain('class="say warning"');
  expect(said({ paused: true, runsToday: 12 })).toBe("The factory is paused; the day cap is reached.");
  expect(said({ paused: true, health: [mainRed] })).toBe("Alert: the build is failing on main; the factory is paused.");
});

const weekAt = (seven_day: number) => ({ usage: { now: { seven_day } } });

test("a weekly usage of 90% or more is said after the other parts, in the warning colour", () => {
  expect(said({}, weekAt(90))).toBe("Everything is running smoothly; weekly usage is at 90%.");
  expect(view.renderLede({ ...calmState, ...weekAt(90) })).toContain('class="say warning"');
  expect(said({}, weekAt(89.6))).toBe("Everything is running smoothly.");
  expect(view.renderLede({ ...calmState, ...weekAt(89.6) })).toContain('class="say fine"');
  expect(said({}, { usage: undefined })).toBe("Everything is running smoothly.");
  expect(said({}, weekAt(93.4))).toContain("weekly usage is at 93%");
  expect(said({ runsToday: 12, dayCap: 12 }, weekAt(95))).toBe("Everything is running smoothly; the day cap is reached; weekly usage is at 95%.");
});

test("an alert keeps its red sentence and holds the weekly usage part; three alerts cut it", () => {
  expect(said({ health: [mainRed] }, weekAt(90))).toBe("Alert: the build is failing on main; weekly usage is at 90%.");
  expect(view.renderLede({ ...calmState, ...weekAt(90), factory: { ...calmState.factory, health: [mainRed] } })).toContain('class="say error"');
  const three = { health: [ciRed, mainRed, "health: 4 runs wait for Chris; no new run starts"] };
  expect(said(three, weekAt(90))).toBe("Alert: GitHub CI is broken; the build is failing on main; new runs wait for your answers.");
});

test("a paused factory with weekly usage at 90% says so", () => {
  expect(said({ paused: true }, weekAt(90))).toBe("The factory is paused; weekly usage is at 90%.");
});

test("the page has no banner and the status line holds the alert", () => {
  const page = view.view.render(withFactory({ health: [mainRed] }));
  expect(page).not.toContain('class="banner"');
  expect(page).toMatch(/<p class="lede">[^]*the build is failing on main/);
});

test("the most flaked line stays in the report and off the status sentence and the error rows", () => {
  const line = "health: most flaked in acceptance in 7 days: a.test.ts > twice (1 times)";
  const page = view.view.render({ ...withFactory({ health: [line] }), asks: [], stuck: [] });
  expect(page).not.toContain("most flaked");
});

test("a flake line is not shown on the Status page", () => {
  const calm = { ...withFactory({ health: ["health: aleph check tests passed on rerun 4 times in 7 days"] }), asks: [], stuck: [] };
  const h = view.renderLede(calm);
  expect(h).toContain('class="say fine"');
  expect(h).not.toContain("Awaiting");
  expect(h).not.toContain("rerun");
  expect(view.view.render(calm)).not.toContain("rerun");
  expect(withAttn(calm)).not.toContain("rerun");
});

test("the status line says your attention is needed when the Issues section has an item", () => {
  const calm = { ...state, asks: [], stuck: [], issues: [], factory: { ...state.factory, health: [], hold: undefined, paused: false } };
  for (const o of [{ asks: asksOf([], [{ ...issue(7), question: "q" }]) }]) {
    const h = view.renderLede({ ...calm, ...o });
    expect(h).toContain("your attention is needed");
    expect(h).not.toContain("Awaiting");
  }
});

test("a held run that waits for the firefighter still asks for your attention", () => {
  const calm = { ...state, stuck: [], factory: { ...state.factory, health: [] } };
  const asks = attend({ runs: [held], issues: [] }, { "held-path": { action: "firefighter", at: "2026-10-28T00:00:00.000Z" } }, []).items;
  const h = view.renderLede({ ...calm, asks });
  expect(h).toContain("your attention is needed");
  expect(h).toContain('class="say warning"');
});

test("the status sentence wraps instead of clipping: .lede .say has no ellipsis or hidden overflow, and wraps", async () => {
  const html = await Bun.file(new URL("./app.css", import.meta.url)).text();
  const say = [...html.matchAll(/\.lede \.say[^{}]*\{([^}]*)\}/g)].map((m) => m[1]).join("\n");
  expect(say).not.toContain("text-overflow: ellipsis");
  expect(say).not.toContain("overflow: hidden");
  expect(say).toContain("white-space: normal");
});

test("a long unbroken word in the status sentence (a URL) breaks: .lede .say sets overflow-wrap: anywhere", async () => {
  const html = await Bun.file(new URL("./app.css", import.meta.url)).text();
  const say = [...html.matchAll(/\.lede \.say[^{}]*\{([^}]*)\}/g)].map((m) => m[1]).join("\n");
  expect(say).toContain("overflow-wrap: anywhere");
});

const OOD = "Alert: this status is out of date.";

const strip = (h: string) => h.replace(/<[^>]*>/g, "");

test("out-of-date data says so, in place of the fine and the paused sentence", () => {
  const h = view.renderLede(calmState, true);
  expect(strip(h)).toBe(OOD);
  expect(h).toContain('class="say error"');
  const p = view.renderLede({ ...calmState, factory: { ...calmState.factory, paused: true } }, true);
  expect(strip(p)).toBe(OOD);
});

test("the out-of-date part comes first and survives MAX_SAID", () => {
  const s = { ...calmState, health: { ...(calmState as any).health }, asks: [{ kind: "approval" }, { kind: "input" }], stuck: [{}] };
  const base = said({}, { stuck: [{}], asks: [{ kind: "approval" }, { kind: "input" }] });
  const h = strip(view.renderLede(s, true));
  expect(h.startsWith(OOD.slice(0, -1) + "; ")).toBe(true);
  expect(h.split("; ").length).toBe(base.split("; ").length + 1);
});

test("without the out-of-date input the sentence is unchanged", () => {
  expect(view.renderLede(calmState, false)).toBe(view.renderLede(calmState));
  expect(said({})).toBe("Everything is running smoothly.");
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

test("the tick alert ranks after the probe and before the queued-jobs alert, and reads as a Check row", () => {
  const o = { nextTick: null, probe: { at: "x", ok: false, failed: ["no network"] }, health: ["health: 2 goals can start, but no run started in 15 minutes"] };
  expect(said(o)).toBe("Alert: the sandbox is broken; the factory tick has stopped; queued jobs are not starting.");
  expect(withAttn(withFactory({ nextTick: null }))).toContain("Check: the factory tick has stopped: aleph-tick.timer has no next run");
});
