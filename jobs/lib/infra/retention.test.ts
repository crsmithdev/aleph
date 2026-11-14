import { afterAll, beforeAll, expect, test } from "bun:test";
import { conn } from "../../../lib/db.ts";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allRunRecords, patchRun } from "../records/record.ts";
import { seed } from "../../job.testkit.ts";
import { today } from "../../../lib/day.ts";
import { birthDay, retain } from "./retention.ts";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const ago = (d: number) => new Date(NOW - d * 864e5);
let base = "";

const age = (p: string, d: number) => utimesSync(p, ago(d), ago(d));
/** A job folder of a job that ended `d` days ago, or that has not ended when `d` is null; the folder holds one file. */
function run(name: string, d: number | null) {
  const { id, folder } = seed({ role: "build", name, state: d === null ? "running" : "done", started: ago(d ?? 0).toISOString() });
  if (d !== null) patchRun(id, { ended: ago(d).toISOString() });
  writeFileSync(join(folder, "transcript.jsonl"), "x");
  return { id, folder };
}

const KEYS = ["ALEPH_DB", "ALEPH_JOBS_DIR", "ALEPH_FACTORY_DIR", "XDG_RUNTIME_DIR"];
let saved: (string | undefined)[] = [];
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-retention-"));
  saved = KEYS.map((k) => process.env[k]);
  Object.assign(process.env, {
    ALEPH_DB: join(base, "aleph.db"), ALEPH_JOBS_DIR: join(base, "runs"), ALEPH_FACTORY_DIR: join(base, "factory"),
    XDG_RUNTIME_DIR: join(base, "run"),
  });
  mkdirSync(join(base, "factory"));
});
afterAll(() => {
  KEYS.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
  rmSync(base, { recursive: true, force: true });
});

test("retain deletes the folder of a job 90 days after it ended, and keeps its row, the events and a recent or running job", () => {
  const old = run("r-old", 91), recent = run("r-new", 89), live = run("r-live", null);
  const orphan = join(base, "runs", "orphan"), fresh = join(base, "runs", "orphan-new");
  for (const f of [orphan, fresh]) { mkdirSync(f); writeFileSync(join(f, "a.log"), "x"); }
  for (const p of [join(orphan, "a.log"), orphan]) age(p, 100);
  const events = join(base, "factory", "events", "2020-01-01.jsonl");
  mkdirSync(join(base, "factory", "events"), { recursive: true });
  writeFileSync(events, "{}\n");
  age(events, 400);

  retain(NOW);

  expect(existsSync(old.folder)).toBe(false);
  expect(existsSync(recent.folder)).toBe(true);
  expect(existsSync(live.folder)).toBe(true);
  expect(existsSync(orphan)).toBe(false);
  expect(existsSync(fresh)).toBe(true);
  expect(existsSync(events)).toBe(true);
  expect(allRunRecords().map((r) => r.id)).toContain(old.id);
});

test("retain trims usage rows", () => {
  const row = (d: number) => conn().query("INSERT INTO usage (time, five_hour, seven_day) VALUES (?, 1, 2)").run(ago(d).toISOString());
  row(91);
  row(10);

  retain(NOW);

  expect(conn().query("SELECT time FROM usage").all()).toEqual([{ time: ago(10).toISOString() }]);
});

test("retain moves dispatch.log aside by the day it began, once a day, and deletes the aside files over 90 days old", () => {
  const dir = join(base, "factory");
  const day = (d: number) => today(ago(d));
  for (const d of [91, 10]) writeFileSync(join(dir, `dispatch.${day(d)}.log`), "x");
  // The log began 2 days ago and had a write today, before this tick.
  writeFileSync(join(dir, "dispatch.day"), day(2));
  writeFileSync(join(dir, "dispatch.log"), "since 2 days");
  age(join(dir, "dispatch.log"), 0);

  retain(NOW);
  writeFileSync(join(dir, "dispatch.log"), "today");
  retain(NOW);

  expect(existsSync(join(dir, `dispatch.${day(91)}.log`))).toBe(false);
  expect(existsSync(join(dir, `dispatch.${day(10)}.log`))).toBe(true);
  expect(readFileSync(join(dir, `dispatch.${day(2)}.log`), "utf8")).toBe("since 2 days");
  expect(readFileSync(join(dir, "dispatch.log"), "utf8")).toBe("today");
  expect(readFileSync(join(dir, "dispatch.day"), "utf8")).toBe(day(0));
});

test("retain marks a log with no mark at once by its birth day, then moves it aside on a later day", () => {
  const dir = join(base, "factory");
  rmSync(join(dir, "dispatch.day"), { force: true });
  writeFileSync(join(dir, "dispatch.log"), "old lines");
  const born = birthDay(statSync(join(dir, "dispatch.log"))), t = Date.parse(`${born}T12:00:00Z`);

  retain(t);
  expect(readFileSync(join(dir, "dispatch.day"), "utf8")).toBe(born);
  expect(existsSync(join(dir, "dispatch.log"))).toBe(true);

  retain(t + 864e5);
  expect(existsSync(join(dir, "dispatch.log"))).toBe(false);
  expect(readFileSync(join(dir, `dispatch.${born}.log`), "utf8")).toBe("old lines");
});

test("birthDay takes the birth day, and the mtime day when the birth time is 0", () => {
  const mtime = new Date("2026-11-09T12:00:00Z");
  expect(birthDay({ birthtime: new Date("2026-10-27T05:00:00Z"), mtime })).toBe("2026-10-27");
  expect(birthDay({ birthtime: new Date(0), mtime })).toBe("2026-11-09");
});
