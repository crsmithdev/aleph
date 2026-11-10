import { afterEach, beforeEach, expect, test } from "bun:test";
import { today } from "./day.ts";

const tz = process.env.TZ;
beforeEach(() => { process.env.TZ = "America/Los_Angeles"; });
afterEach(() => { process.env.TZ = tz ?? "UTC"; });

test("today is the local date, zero-padded", () => {
  expect(today(new Date("2026-11-11T04:00:00Z"))).toBe("2026-11-10");
  expect(today(new Date("2026-03-04T12:00:00Z"))).toBe("2026-03-04");
});
