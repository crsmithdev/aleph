import { expect, test } from "bun:test";
// @ts-ignore the module is plain JS, shared with the page
import { localMs, when, clock, failMessage, pct, wkText, dur } from "./format.js";

test("failMessage shows the reason from the body", () => {
  expect(failMessage("/api/sessions", 502, '{"error":"Langfuse is unreachable at http://x"}')).toBe("/api/sessions answered 502: Langfuse is unreachable at http://x");
  expect(failMessage("/api/sessions", 404, "not found")).toBe("/api/sessions answered 404: not found");
  expect(failMessage("/api/sessions", 500, "")).toBe("/api/sessions answered 500");
  expect(failMessage("/api/x", 500, "a".repeat(1000))).toBe(`/api/x answered 500: ${"a".repeat(300)}`);
});

test("when gives mm/dd hh:mm this year, YYYY-MM-DD another year, and '' for a bad date", () => {
  const now = new Date(2026, 10, 4);
  expect(when(new Date(2026, 9, 28, 14, 5), now)).toBe("10/28 14:05");
  expect(when(new Date(2025, 11, 3, 14, 5), now)).toBe("2025-12-03");
  expect(when("x")).toBe("");
});

test("wkText follows the pct rule, and the Values table of design/rules.md lists those examples", async () => {
  const got = [1.4, 0.4].map((p) => wkText({ pct: p }));
  expect(got).toEqual(["≈1% wk", "≈0.4% wk"]);
  const row = (await Bun.file(new URL("../../../design/rules.md", import.meta.url)).text()).split("\n").find((l) => l.startsWith("| Weekly share |"))!;
  expect(row.split("|")[2].trim().split(", ")).toEqual(got);
});

test("clock gives hh:mm, and '' when it gets no time", () => {
  expect([null, undefined, "", "x"].map(clock)).toEqual(["", "", "", ""]);
  expect(clock(new Date(2026, 9, 28, 14, 5))).toBe("14:05");
});

test("pct shows whole percents, one decimal under 1%, <0.1% under 0.05 and – for none", () => {
  expect([null, undefined, NaN].map(pct)).toEqual(["–", "–", "–"]);
  expect([0.02, 0.5, 30, 2.5].map(pct)).toEqual(["<0.1%", "0.5%", "30%", "3%"]);
});

test("dur writes seconds, minutes, hours and days", () => {
  expect([43, 245, 3720, 187200, null].map(dur)).toEqual(["43s", "4m 05s", "1h 02m", "2d 04h", "–"]);
});

test("localMs reads a bare date as local midnight, not UTC midnight", () => {
  const tz = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    expect(localMs("2026-11-05")).toBe(new Date(2026, 10, 5).getTime());
  } finally {
    // Bun reads a new TZ when it is set, not when it is deleted: set UTC back first.
    process.env.TZ = tz ?? "UTC";
    if (tz === undefined) delete process.env.TZ;
  }
});
