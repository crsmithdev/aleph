import { afterEach, beforeEach, expect, test } from "bun:test";
import { addDays, clock, daysAgo, today, yesterday } from "./day.ts";

const tz = process.env.TZ;
beforeEach(() => { process.env.TZ = "America/Los_Angeles"; });
afterEach(() => { process.env.TZ = tz ?? "UTC"; });

test("today is the local date, zero-padded", () => {
  expect(today(new Date("2026-11-11T04:00:00Z"))).toBe("2026-11-10");
  expect(today(new Date("2026-03-04T12:00:00Z"))).toBe("2026-03-04");
});

test("clock is the local hour and minute, zero-padded", () => {
  expect(clock(new Date("2026-11-11T04:05:00Z"))).toBe("20:05");
  expect(clock(new Date("2026-11-11T08:07:00Z"))).toBe("00:07");
});

test("addDays moves a date by calendar days across a month, a year and a DST change", () => {
  expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
  expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  expect(addDays("2026-02-27", 3)).toBe("2026-03-02");
});

test("yesterday is the local date before now", () => {
  expect(yesterday(Date.parse("2026-11-04T12:00:00Z"))).toBe("2026-11-03");
  expect(yesterday(Date.parse("2026-11-04T04:00:00Z"))).toBe("2026-11-02");
});

test("daysAgo counts calendar days back from a time, over a DST change", () => {
  const from = new Date(2026, 2, 9, 1);
  expect([0, 1, 2, 9].map((n) => daysAgo(n, from))).toEqual(["2026-03-09", "2026-03-08", "2026-03-07", "2026-02-28"]);
});
