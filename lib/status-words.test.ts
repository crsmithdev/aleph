import { expect, test } from "bun:test";
import { verdict, type Facts } from "./status-words.ts";

const NOW = "2026-10-27T17:00:00Z";
const calm: Facts = { now: NOW, factory: { paused: false, nextTick: "2026-10-27T17:12:00Z", health: [] }, stuck: [], asks: [] };
const at = (o: Partial<Facts>, f: Partial<Facts["factory"]> = {}): Facts => ({ ...calm, ...o, factory: { ...calm.factory, ...f } });
const mainRed = { text: "health: aleph main is red at abc1234: tsc", kind: "alert", key: "red-main" };
const ciRed = { text: "health: aleph CI on main has failed 2 runs", kind: "alert", key: "red-ci" };
const slow = { text: "health: aleph full suite took 135 s", kind: "warn" };

test("verdict gives each state its tone, label and sentence", () => {
  // prettier-ignore
  const cases: [string, Facts, string, string, string][] = [
    ["calm",                   calm,                                                     "fine",    "Fine",  "Everything is fine."],
    ["paused",                 at({}, { paused: true }),                                 "warning", "Wait",  "The factory is paused."],
    ["an escalated Ask",       at({ asks: [{ escalated: true }] }),                      "ask",     "Ask",   "Your attention is needed."],
    ["an Ask with the director", at({ asks: [{ escalated: false }] }),                   "fine",    "Fine",  "Everything is fine."],
    ["a stuck job",            at({ stuck: [{}] }),                                      "alert",   "Alert", "Alert: Jobs are unhealthy."],
    ["no next tick",           at({}, { nextTick: null }),                               "alert",   "Alert", "Alert: The factory tick has stopped."],
    ["a tick in progress",     at({}, { nextTick: null, tickInProgress: true }),         "fine",    "Fine",  "Everything is fine."],
    ["a tick 4 min late",      at({}, { nextTick: "2026-10-27T16:56:00Z" }),             "fine",    "Fine",  "Everything is fine."],
    ["a tick 6 min late",      at({}, { nextTick: "2026-10-27T16:54:00Z" }),             "alert",   "Alert", "Alert: The factory tick has stopped."],
    ["weekly usage at 90%",    at({ usage: { now: { seven_day: 90 } } }),                "warning", "Warn",  "Everything is fine; weekly usage is at 90%."],
    ["weekly usage at 89.6%",  at({ usage: { now: { seven_day: 89.6 } } }),              "fine",    "Fine",  "Everything is fine."],
    ["a warning health line",  at({}, { health: [slow] }),                               "warning", "Warn",  "Everything is fine; aleph full suite took 135 s."],
    ["alerts ranked",          at({ stuck: [{}] }, { health: [mainRed, ciRed] }),        "alert",   "Alert", "Alert: GitHub CI is broken; the build is failing on main; jobs are unhealthy."],
    ["an alert and an Ask",    at({ asks: [{}] }, { health: [mainRed], paused: true }), "alert",   "Alert", "Alert: The build is failing on main; your attention is needed; the factory is paused."],
  ];
  for (const [name, s, tone, label, text] of cases) expect([name, verdict(s)]).toMatchObject([name, { tone, label, text }]);
});

test("verdict links each alert and Ask part to its card and leaves the others plain", () => {
  const v = verdict(at({ stuck: [{}], asks: [{}], usage: { now: { seven_day: 95 } } }));
  expect(v.parts).toEqual([{ text: "Jobs are unhealthy", href: "#jobs-stuck" }, { text: "your attention is needed", href: "#awaiting" }, { text: "weekly usage is at 95%", href: "" }]);
});

test("an out-of-date verdict says so first, as an alert", () => {
  expect(verdict(at({ asks: [{}] }), true)).toMatchObject({ tone: "alert", text: "Alert: This status is out of date; your attention is needed." });
});

test("verdict keeps each error line in full, once", () => {
  expect(verdict(at({}, { nextTick: null, health: [mainRed, mainRed] })).errors).toEqual([
    { text: "aleph main is red at abc1234: tsc", key: "red-main" },
    { text: "the factory tick has stopped: aleph-tick.timer has no next run", key: "tick" },
  ]);
});
