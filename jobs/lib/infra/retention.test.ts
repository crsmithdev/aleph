import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { archiveDir, putRun } from "../records/record.ts";
import { recordsDir } from "../../../lib/layout.ts";
import { today } from "../../../lib/day.ts";
import { birthDay, retain } from "./retention.ts";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const ago = (d: number) => new Date(NOW - d * 864e5);
let base = "";

const age = (p: string, d: number) => utimesSync(p, ago(d), ago(d));
/** A run folder of the job `on`, ended `d` days ago; with `archived` its record moves to the archive. */
function run(id: string, on: string, d: number, archived: boolean) {
  const folder = join(base, "runs", id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "output.log"), "x");
  putRun(basename(folder), { n: 1, kind: "build", job: id, name: id, on, condition: "done", started: ago(d).toISOString(), ended: ago(d).toISOString() } as any);
  if (archived) { mkdirSync(archiveDir(), { recursive: true }); renameSync(join(recordsDir(), `${on}.json`), join(archiveDir(), `${on}.json`)); }
  return folder;
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-retention-"));
  Object.assign(process.env, {
    ALEPH_JOBS_DIR: join(base, "runs"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_REPOS: join(base, "repos.json"),
    ALEPH_USAGE_FILE: join(base, "usage.jsonl"), XDG_RUNTIME_DIR: join(base, "run"),
  });
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

test("retain deletes old run folders only of archived records, and keeps events and records", () => {
  const old = run("r-old", "rt-1", 91, true), recent = run("r-new", "rt-2", 89, true), live = run("r-live", "rt-3", 100, false);
  const orphan = join(base, "runs", "orphan"), fresh = join(base, "runs", "orphan-new");
  for (const f of [orphan, fresh]) { mkdirSync(f); writeFileSync(join(f, "a.log"), "x"); }
  for (const p of [join(orphan, "a.log"), orphan]) age(p, 100);
  const events = join(base, "factory", "events", "2020-01-01.jsonl");
  mkdirSync(join(base, "factory", "events"), { recursive: true });
  writeFileSync(events, "{}\n");
  age(events, 400);
  age(join(archiveDir(), "rt-1.json"), 400);

  retain(NOW);

  expect(existsSync(old)).toBe(false);
  expect(existsSync(recent)).toBe(true);
  expect(existsSync(live)).toBe(true);
  expect(existsSync(orphan)).toBe(false);
  expect(existsSync(fresh)).toBe(true);
  expect(existsSync(recordsDir())).toBe(true);
  expect(existsSync(events)).toBe(true);
  expect(existsSync(join(archiveDir(), "rt-1.json"))).toBe(true);
});

test("retain trims usage rows and old registry backups", () => {
  const row = (d: number) => JSON.stringify({ at: ago(d).toISOString(), five_hour: 1 });
  writeFileSync(join(base, "usage.jsonl"), `${row(91)}\n${row(10)}\n`);
  const oldBak = join(base, "repos.json.bak-1"), newBak = join(base, "repos.json.bak-2");
  for (const [f, d] of [[oldBak, 91], [newBak, 10]] as const) { writeFileSync(f, "{}"); age(f, d); }

  retain(NOW);

  expect(readFileSync(join(base, "usage.jsonl"), "utf8")).toBe(`${row(10)}\n`);
  expect(existsSync(oldBak)).toBe(false);
  expect(existsSync(newBak)).toBe(true);
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
