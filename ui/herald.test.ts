import { afterAll, beforeEach, expect, test } from "bun:test";
import { heraldRows, plain, type Context } from "./herald.ts";
import { row } from "./now.testkit.ts";
import { detailOf, missedOf, setCodes } from "../lib/naming.ts";

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
  expect([r.key, r.word, r.more, plain(r.id), plain(r.text)]).toEqual(["issue:aleph-9", "closed", 3, "a9", "Fix the footer"]);
  expect(r.lines.map((l) => [l.label, plain(l.text)])).toEqual([["implement", "j2 ✓"], ["intake", "j1 ✓"], ["started", "by the gate"]]);
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
  expect(r.lines.map((l) => plain(l.text))).toEqual(["j2 ✓ small · haiku · 5m 00s · $0.50"]);
});

test("the model of a start comes from its detail word, not from text that begins with `model`", () => {
  const start = (note: string) => row({ at: "2026-11-13T10:01:00Z", by: "rule", subject: "aleph-7", action: "started", note });
  const withRun = (note: string) => rows([e("2026-11-13T10:10:00Z", "aleph-7", "passed", ["job.2"]), e("2026-11-13T10:05:00Z", "aleph-7", "running", ["job.2"]), start(note)], { runs: { "job.2": "build" } })[0].lines.map((l) => plain(l.text));
  expect(withRun("model: opus")).toEqual(["j2 ✓ opus · 5m 00s"]);
  // A start with no word is a note: it gives the build no model.
  expect(withRun("model opus")).toEqual(["j2 ✓ 5m 00s"]);
});

test("a held-path land line names the held file and who approved it", () => {
  const [r] = rows([e("2026-11-13T10:05:00Z", "aleph-7", "done", []), row({ at: "2026-11-13T10:00:00Z", by: "rule", subject: "aleph-7", action: "landed", note: "held: path docs/a.md · approved by Always" })]);
  expect(r.lines.map((l) => [l.label, plain(l.text)])).toEqual([["landed", "held path docs/a.md · approved by Always"]]);
});

test("a routine run with changes is one factory row that counts its edits by their past word, with a line for each in the order they ran", () => {
  const hk = (at: string, action: string) => e(at, "housekeeper", action, ["job.57"]);
  const change = (at: string, issue: string, note: string) => row({ at, by: "job.57", subject: issue, action: "changed", note });
  const [r, ...rest] = rows([hk("2026-11-15T13:10:00Z", "done"), change("2026-11-15T13:07:00Z", "aleph-9", "note: second look"), change("2026-11-15T13:06:00Z", "aleph-8", "note: first look"), change("2026-11-15T13:05:00Z", "aleph-5", "retitle: New title"), hk("2026-11-15T13:00:00Z", "running")], { runs: { "job.57": "housekeeper" }, reviewed: { "job.57": 3 } });
  expect(rest).toEqual([]);
  expect([r.word, r.more, plain(r.id), plain(r.text)]).toEqual(["ended", 3, "housekeeper j57", "reviewed 3 · retitled 1 · commented 2"]);
  expect(r.lines.map((l) => [l.label, plain(l.text)])).toEqual([["retitled", "a5 New title"], ["commented", "a8 first look"], ["commented", "a9 second look"]]);
});

test("a routine run that ended with no change has no row, and one that is still running has", () => {
  const hk = (at: string, action: string, job: string) => e(at, "housekeeper", action, [job]);
  expect(rows([hk("2026-11-15T12:00:00Z", "running", "job.56"), hk("2026-11-15T12:10:00Z", "done", "job.56")], { reviewed: { "job.56": 4 } })).toEqual([]);
  expect(rows([hk("2026-11-15T12:00:00Z", "running", "job.56")], { runs: { "job.56": "housekeeper" } }).map((r) => [r.word, plain(r.id)])).toEqual([["started", "housekeeper j56"]]);
  expect(rows([hk("2026-11-15T12:00:00Z", "running", "job.56")]).map((r) => [r.word, plain(r.id)])).toEqual([["started", "j56"]]);
});

test("a routing event with no size is a system row with its note, and a hold is no row", () => {
  const out = rows([row({ at: "2026-11-09T10:00:00Z", by: "rule", subject: "aleph-9", action: "routed", note: "small by classifier jev-1.13" }), row({ at: "2026-11-09T11:00:00Z", by: "gate", subject: "aleph-9", action: "after", on: ["aleph-7"] })], { titles: { "aleph-9": "Fix it" } });
  expect(out.map((r) => [r.sys, r.id, plain(r.text)])).toEqual([[true, [], "small by classifier jev-1.13"]]);
});

test("a routed line in an issue's fold names the size and the classifier from the event's size and detail", () => {
  const [r] = rows([row({ at: "2026-11-09T10:00:00Z", by: "rule", subject: "aleph-9", action: "routed", size: "small", note: detailOf("routed", "classifier", "jev-1.13") }), e("2026-11-09T11:00:00Z", "aleph-9", "started", [])]);
  expect(r.lines.map((l) => [l.label, plain(l.text)])).toEqual([["routed", "small · classifier jev-1.13"]]);
});

test("a routing choice shows a cost under half a cent as money() does", () => {
  const out = rows([row({ at: "2026-11-09T10:00:00Z", by: "rule", subject: "aleph-9", action: "routed", size: "medium", model: "sonnet", cost: 0.00003 })]);
  expect(out[0].lines.map((l) => plain(l.text))).toEqual(["medium · sonnet · <$0.01"]);
});

test("a stalled event of a job folds into its issue's row, which the start heads", () => {
  const events = [{ ...row({ at: "2026-11-15T13:30:00Z", by: "rule", subject: "issue.2072", action: "stalled", on: ["job.9"] }), project: "aleph" }, { ...row({ at: "2026-11-15T13:10:00Z", by: "gate", subject: "issue.2072", action: "running", on: ["job.9"] }), project: "aleph" }];
  const [r, ...rest] = rows(events, { runs: { "job.9": "intake" } });
  expect(rest).toEqual([]);
  expect([r.word, plain(r.id)]).toEqual(["started", "a2072"]);
  expect(r.lines.map((l) => plain(l.text))).toEqual(["stalled a2072 · intake"]);
});

test("a missed event on an issue is a row with its short ID, a link and the stalled step, and shows no raw key", () => {
  for (const key of ["issue:issue.3203", "goal:issue.3203"]) expect(missedOf(key)).toEqual({ object: "issue.3203", detail: "start" });
  const { object, detail } = missedOf("issue:issue.3203");
  const [r, ...rest] = rows([{ ...row({ at: "2026-11-18T10:00:00Z", by: "rule", subject: object, action: "missed", note: detail }), project: "aleph" }]);
  expect(rest).toEqual([]);
  expect(r.id).toEqual([{ id: "a3203", to: "#/issues/aleph/3203" }]);
  expect(plain([...r.id, ...r.text, ...r.lines.flatMap((l) => l.text)])).toContain("start");
  expect(JSON.stringify(r)).not.toContain("goal:");
});

test("a hold word of lib/naming.ts that the Herald once lacked is a wait and has no row", () => {
  const [r] = rows([e("2026-11-13T10:00:00Z", "aleph-7", "done", ["job.1"]), e("2026-11-13T11:00:00Z", "aleph-7", "parked", [])], { attempts: { "job.1": "job.1" } });
  expect([r.key, r.word]).toEqual(["issue:aleph-7:job.1", "closed"]);
});

test("an ID with a # that parseKey does not read as a job is not a job ID", () => {
  const [r] = rows([e("2026-11-13T10:00:00Z", "aleph-7", "done", ["job.1#2"])], { attempts: { "job.1#2": "job.1#2" } });
  expect(r.key).toBe("issue:aleph-7");
});
