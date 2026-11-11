import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as record from "../records/record.ts";
import type { Entry } from "../records/ledger.ts";
import type { Ask } from "./ask.ts";
import { dueAt, readTimeouts, setTimeoutOf, timeoutStep } from "./timeout.ts";

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "timeout-")); process.env.ALEPH_FACTORY_DIR = dir; });

const ask = (recommend = "land"): Ask => ({ kind: "approval", reason: "held-path", question: "Land it?", options: [], why: [], situation: "It changes hooks/.", recommend: { action: recommend, why: "w" } });
const NOW = Date.parse("2026-11-10T12:00:00Z");
let n = 0;
/** A waiting run on a new issue, escalated `ago` minutes before now. */
function waiting(ago: number, a: Ask = ask(), now = NOW): Entry {
  const on = `tmo-${++n}`, id = `run-${n}`;
  record.addEvent(on, { at: new Date(now - ago * 60_000).toISOString(), kind: "director", what: "held-path: escalated", data: { on: id, outcome: "escalated" } });
  return { id, folder: "", run: { n, name: `job-${n}`, on, job: `a${n}`, condition: "waiting", ask: a } as any };
}

test("setTimeoutOf writes minutes for a land reason, 0 removes them, and other reasons are refused", () => {
  expect(setTimeoutOf("held-path", 30)).toBeNull();
  expect(readTimeouts()).toEqual({ "held-path": 30 });
  expect(setTimeoutOf("question", 30)).toContain("has no timeout");
  expect(setTimeoutOf("review", -1)).toContain("whole number");
  expect(setTimeoutOf("held-path", 0)).toBeNull();
  expect(JSON.parse(readFileSync(join(dir, "timeouts.json"), "utf8"))).toEqual({});
});

test("dueAt is the escalation time plus the minutes, only when the director recommends the land", () => {
  const now = NOW;
  const e = waiting(10, ask(), now);
  expect(dueAt(e, {})).toBeNull();
  expect(dueAt(e, { "held-path": 30 })).toBe(now - 10 * 60_000 + 30 * 60_000);
  expect(dueAt(waiting(10, ask("drop")), { "held-path": 30 })).toBeNull();
  expect(dueAt(waiting(10, { ...ask(), situation: undefined }), { "held-path": 30 })).toBeNull();
});

test("timeoutStep lands a due run once, and leaves a run that is not due", async () => {
  setTimeoutOf("held-path", 30);
  const due = waiting(31), early = waiting(5);
  const started: string[] = [];
  const start = async (name: string) => { started.push(name); return null; };
  expect(await timeoutStep(start, NOW, [due, early])).toEqual([due.run.name]);
  expect(await timeoutStep(start, NOW, [due, early])).toEqual([]);
  expect(started).toEqual([due.run.name]);
});

test("timeoutStep does not try a refused land again", async () => {
  setTimeoutOf("held-path", 1);
  const e = waiting(2);
  let tries = 0;
  const start = async () => { tries++; return "not passed"; };
  expect(await timeoutStep(start, NOW, [e])).toEqual([]);
  await timeoutStep(start, NOW, [e]);
  expect(tries).toBe(1);
});
