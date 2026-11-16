import { afterAll, beforeEach, expect, test } from "bun:test";
import { heraldRows, plain, type Context } from "./herald.ts";
import { row } from "./now.testkit.ts";
import { setCodes } from "../lib/naming.ts";

beforeEach(() => setCodes({ aleph: "a" }));
afterAll(() => setCodes({}));

const ctx = (o: Partial<Context> = {}): Context => ({ titles: {}, runs: {}, attempts: {}, reviewed: {}, ...o });
/** Rows of events given in any order, as the server builds them from the oldest first. */
const rows = (events: any[], c: Partial<Context> = {}) => heraldRows([...events].sort((a, b) => (a.time < b.time ? -1 : 1)), ctx(c));
const e = (at: string, subject: string, action: string, on: string[], o: object = {}) => row({ at, by: "gate", subject, action, on, ...o });

test("an issue's events are one row: the newest event heads it, the older ones are its lines, and its title and kind are in the row", () => {
  const [r, ...rest] = rows([e("2026-11-09T11:00:00Z", "aleph-9", "done", ["job.1"]), e("2026-11-09T12:00:00Z", "aleph-9", "done", ["job.2"]), e("2026-11-09T10:30:00Z", "aleph-9", "started", [])],
    { titles: { "aleph-9": "Fix the footer" }, runs: { "job.1": "intake", "job.2": "build" } });
  expect(rest).toEqual([]);
  expect([r.key, r.kind, r.word, r.more, plain(r.id), plain(r.text)]).toEqual(["issue:aleph-9", "work", "closed", 3, "a9", "Fix the footer"]);
  expect(r.lines.map((l) => [l.label, plain(l.text)])).toEqual([["implement", "j-00002 ✓"], ["intake", "j-00001 ✓"], ["started", "by the gate"]]);
});

test("a second attempt of an issue is a row of its own, and an event with no job goes with the first attempt", () => {
  const events = [e("2026-11-13T12:00:00Z", "aleph-7", "done", ["job.9"]), e("2026-11-13T10:00:00Z", "aleph-7", "done", ["job.1"]), row({ at: "2026-11-13T09:00:00Z", by: "claude", subject: "aleph-7", action: "filed" })];
  const out = rows(events, { runs: { "job.1": "intake", "job.9": "intake" }, attempts: { "job.1": "job.1", "job.9": "job.9" } });
  expect(out.map((r) => r.key)).toEqual(["issue:aleph-7:job.9", "issue:aleph-7:job.1"]);
  expect(out[1].lines.map((l) => l.label)).toContain("filed");
});

test("a build's line has its size and model from its start, which is not a line of its own, and its time and cost", () => {
  const events = [
    e("2026-11-13T10:10:00Z", "aleph-7", "passed", ["job.2"], { cost: 0.5 }), e("2026-11-13T10:05:00Z", "aleph-7", "running", ["job.2"]),
    row({ at: "2026-11-13T10:01:00Z", by: "rule", subject: "aleph-7", action: "started", note: "model: haiku", size: "small" }),
  ];
  const [r] = rows(events, { runs: { "job.2": "build" } });
  expect(r.lines.map((l) => plain(l.text))).toEqual(["j-00002 ✓ small · haiku · 5m 00s · $0.50"]);
});

test("the model of a start comes from its detail word, not from text that begins with `model`", () => {
  const start = (note: string) => row({ at: "2026-11-13T10:01:00Z", by: "rule", subject: "aleph-7", action: "started", note });
  const withRun = (note: string) => rows([e("2026-11-13T10:10:00Z", "aleph-7", "passed", ["job.2"]), e("2026-11-13T10:05:00Z", "aleph-7", "running", ["job.2"]), start(note)], { runs: { "job.2": "build" } })[0].lines.map((l) => plain(l.text));
  expect(withRun("model: opus")).toEqual(["j-00002 ✓ opus · 5m 00s"]);
  // A start with no word is a note: it gives the build no model.
  expect(withRun("model opus")).toEqual(["j-00002 ✓ 5m 00s"]);
});

test("a routine run with changes is one factory row that counts its edits by their past word, with a line for each in the order they ran", () => {
  const hk = (at: string, action: string) => e(at, "housekeeper", action, ["job.57"]);
  const change = (at: string, issue: string, note: string) => row({ at, by: "job.57", subject: issue, action: "changed", note });
  const [r, ...rest] = rows([hk("2026-11-15T13:10:00Z", "done"), change("2026-11-15T13:07:00Z", "aleph-9", "note: second look"), change("2026-11-15T13:06:00Z", "aleph-8", "note: first look"), change("2026-11-15T13:05:00Z", "aleph-5", "retitle: New title"), hk("2026-11-15T13:00:00Z", "running")], { reviewed: { "job.57": 3 } });
  expect(rest).toEqual([]);
  expect([r.kind, r.word, r.more, plain(r.id), plain(r.text)]).toEqual(["factory", "ended", 3, "j-00057", "reviewed 3 · retitled 1 · commented 2"]);
  expect(r.lines.map((l) => [l.label, plain(l.text)])).toEqual([["retitled", "a5 New title"], ["commented", "a8 first look"], ["commented", "a9 second look"]]);
});

test("a routine run that ended with no change has no row, and one that is still running has", () => {
  const hk = (at: string, action: string, job: string) => e(at, "housekeeper", action, [job]);
  expect(rows([hk("2026-11-15T12:00:00Z", "running", "job.56"), hk("2026-11-15T12:10:00Z", "done", "job.56")], { reviewed: { "job.56": 4 } })).toEqual([]);
  expect(rows([hk("2026-11-15T12:00:00Z", "running", "job.56")]).map((r) => [r.word, plain(r.id)])).toEqual([["started", "j-00056"]]);
});

test("a routing event with no size is a system row with its note, and a hold is no row", () => {
  const out = rows([row({ at: "2026-11-09T10:00:00Z", by: "rule", subject: "aleph-9", action: "routed", note: "small by classifier jev-1.13" }), row({ at: "2026-11-09T11:00:00Z", by: "gate", subject: "aleph-9", action: "after", on: ["aleph-7"] })], { titles: { "aleph-9": "Fix it" } });
  expect(out.map((r) => [r.sys, r.id, plain(r.text)])).toEqual([[true, [], "small by classifier jev-1.13"]]);
});

test("a stalled event of a job folds into its issue's row, which the start heads", () => {
  const events = [{ ...row({ at: "2026-11-15T13:30:00Z", by: "rule", subject: "issue.2072", action: "stalled", on: ["job.9"] }), project: "aleph" }, { ...row({ at: "2026-11-15T13:10:00Z", by: "gate", subject: "issue.2072", action: "running", on: ["job.9"] }), project: "aleph" }];
  const [r, ...rest] = rows(events, { runs: { "job.9": "intake" } });
  expect(rest).toEqual([]);
  expect([r.word, plain(r.id)]).toEqual(["started", "a-02072"]);
  expect(r.lines.map((l) => plain(l.text))).toEqual(["stalled a-02072 · intake"]);
});
