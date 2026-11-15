import { beforeEach, expect, test } from "bun:test";
import { getJson, putJson } from "../../../lib/db.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as record from "../records/record.ts";
import type { Entry } from "../records/ledger.ts";
import { seed } from "../../job.testkit.ts";
import type { Ask } from "./ask.ts";
import { dueAt, issueAsks, readTimeouts, setTimeoutOf, timeoutStep } from "./timeout.ts";

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "timeout-")); process.env.ALEPH_FACTORY_DIR = dir; process.env.ALEPH_DB = join(dir, "aleph.db"); });

const ask = (recommend = "land"): Ask => ({ reason: "review-held", question: "Land it?", options: [], why: [], situation: "It changes hooks/.", recommend: { action: recommend, why: "w" } });
const NOW = Date.parse("2026-11-10T12:00:00Z");
let n = 0;
/** A director job whose decision escalated the Ask of `on`, `at` ms. */
const escalated = (on: string, at: number) => seed({ role: "director", name: "director", decision: { on, outcome: "escalated", at: new Date(at).toISOString() } as any });
/** A waiting run on a new issue, escalated `ago` minutes before now. */
function waiting(ago: number, a: Ask = ask(), now = NOW): Entry {
  const target = `issue.${++n}`, id = `job.${9000 + n}`;
  escalated(id, now - ago * 60_000);
  return { id, folder: "", run: { name: `job-${n}`, target, job: id, state: "waiting", ask: a } as any };
}

test("setTimeoutOf writes minutes and pick or drop for any reason in the table, 0 removes them, and other reasons are refused", () => {
  expect(setTimeoutOf("review-held", 30)).toBeNull();
  expect(setTimeoutOf("question", 20, "drop")).toBeNull();
  expect(setTimeoutOf("no-commit", 10, "pick")).toBeNull();
  expect(readTimeouts()).toEqual({ "review-held": { minutes: 30, then: "pick" }, question: { minutes: 20, then: "drop" }, "no-commit": { minutes: 10, then: "pick" } });
  expect(setTimeoutOf("question", 40)).toBeNull();
  expect(readTimeouts().question).toEqual({ minutes: 40, then: "drop" });
  expect(setTimeoutOf("nonsense", 30)).toContain("has no timeout");
  expect(setTimeoutOf("question", 30, "wait")).toContain("pick or drop");
  expect(setTimeoutOf("review-held", -1)).toContain("whole number");
  expect(setTimeoutOf("review-held", 0)).toBeNull();
  expect(getJson("settings", "timeouts", {})).toEqual({ question: { minutes: 40, then: "drop" }, "no-commit": { minutes: 10, then: "pick" } });
});

test("dueAt is the escalation time plus the minutes, only when the case text recommends an action", () => {
  const now = NOW;
  const e = waiting(10, ask(), now);
  expect(dueAt(e, {})).toBeNull();
  expect(dueAt(e, { "review-held": { minutes: 30, then: "pick" } })).toEqual({ at: now - 10 * 60_000 + 30 * 60_000, action: "land" });
  expect(dueAt(waiting(10, { ...ask(), reason: "question" }), { question: { minutes: 30, then: "drop" } })?.action).toBe("drop");
  expect(dueAt(waiting(10, { ...ask(), recommend: undefined }), { "review-held": { minutes: 30, then: "pick" } })).toBeNull();
  expect(dueAt(waiting(10, { ...ask(), situation: undefined }), { "review-held": { minutes: 30, then: "pick" } })).toBeNull();
});

test("timeoutStep lands a due run once, and leaves a run that is not due", async () => {
  setTimeoutOf("review-held", 30);
  const due = waiting(31), early = waiting(5);
  const started: string[] = [];
  const start = async (name: string) => { started.push(name); return null; };
  expect(await timeoutStep(start, NOW, [due, early])).toEqual([due.run.name]);
  expect(await timeoutStep(start, NOW, [due, early])).toEqual([]);
  expect(started).toEqual([due.run.name]);
});

test("timeoutStep does not try a refused land again", async () => {
  setTimeoutOf("review-held", 1);
  const e = waiting(2);
  let tries = 0;
  const start = async () => { tries++; return "not passed"; };
  expect(await timeoutStep(start, NOW, [e])).toEqual([]);
  await timeoutStep(start, NOW, [e]);
  expect(tries).toBe(1);
});

const question = (recommend?: string): Ask => ({
  reason: "question", question: "A or B?", options: [{ label: "A", line: "Do A." }, { label: "B", line: "Do B." }], why: [],
  situation: "The spec leaves A or B open.", ...(recommend ? { recommend: { action: recommend, why: "w" } } : {}),
});
/** An issue with `a` on it, escalated `ago` minutes before now. */
function onIssue(ago: number, a: Ask) {
  const ref = `issue.${++n}`;
  record.setIssueAsk(ref, a);
  escalated(ref, NOW - ago * 60_000);
  return issueAsks(new Map([[ref, record.read(ref)!]]));
}
const taker = (took: string[]) => async (name: string, action: string) => { took.push(`${name} ${action}`); return null; };

test("timeoutStep takes the recommended decide:A on an issue's question Ask once", async () => {
  setTimeoutOf("question", 30);
  const asks = onIssue(31, question("decide:A")), took: string[] = [];
  expect(await timeoutStep(taker(took), NOW, [], asks)).toEqual([asks[0].name]);
  expect(await timeoutStep(taker(took), NOW, [], asks)).toEqual([]);
  expect(took).toEqual([`${asks[0].name} decide:A`]);
});

test("a due drop timeout takes the reason's drop, close or deny; an Ask not due, or with no recommendation under pick, gets nothing", async () => {
  setTimeoutOf("question", 30, "drop");
  setTimeoutOf("no-commit", 30, "drop");
  setTimeoutOf("review-held", 30, "drop");
  const deny = onIssue(31, question("decide:A")), early = onIssue(5, question("decide:A"));
  const close = onIssue(31, { reason: "no-commit", question: "Rerun?", options: [], why: [], situation: "No commit." });
  const run = waiting(31);
  const took: string[] = [];
  await timeoutStep(taker(took), NOW, [run], [...deny, ...early, ...close]);
  expect(took).toEqual([`${run.run.name} drop`, `${deny[0].name} deny`, `${close[0].name} close`]);
  setTimeoutOf("rescue", 30, "pick");
  const none = onIssue(31, { reason: "rescue", question: "What now?", options: [], why: [], situation: "Stuck." });
  await timeoutStep(taker(took), NOW, [], none);
  expect(took).toHaveLength(3);
});

test("held-path has no timeout: setTimeoutOf refuses it, readTimeouts ignores a stored entry, and a due held-path run is left waiting", async () => {
  expect(setTimeoutOf("held-path", 30)).toContain("has no timeout");
  putJson("settings", "timeouts", { "held-path": 30, question: 20 });
  expect(readTimeouts()).toEqual({ question: { minutes: 20, then: "pick" } });
  const held = waiting(31, { ...ask(), reason: "held-path" }), took: string[] = [];
  expect(await timeoutStep(taker(took), NOW, [held])).toEqual([]);
  expect(took).toEqual([]);
});

test("core-change has no timeout: setTimeoutOf refuses it, readTimeouts ignores a stored entry, and a due core-change Ask that recommends approve is left waiting", async () => {
  expect(setTimeoutOf("core-change", 30)).toContain("has no timeout");
  putJson("settings", "timeouts", { "core-change": 30, question: 20 });
  expect(readTimeouts()).toEqual({ question: { minutes: 20, then: "pick" } });
  const core = onIssue(31, { ...ask("approve"), reason: "core-change" }), took: string[] = [];
  expect(await timeoutStep(taker(took), NOW, [], core)).toEqual([]);
  expect(took).toEqual([]);
});
