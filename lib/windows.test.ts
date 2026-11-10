import { expect, test } from "bun:test";
import { buckets, DAY, quantile } from "./windows.ts";

test("buckets align to their unit, cross midnight, and give a DST day its 25 hours", () => {
  const tz = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    // 00:20:30 local: the hour window's last bucket starts on the minute, the day window's on the hour, and both reach back past midnight.
    const now = new Date(2026, 9, 15, 0, 20, 30).getTime();
    const hour = buckets("hour", now), day = buckets("day", now);
    expect([hour.starts.length, hour.starts.at(-1), hour.since, hour.until]).toEqual([60, new Date(2026, 9, 15, 0, 20).getTime(), new Date(2026, 9, 14, 23, 21).getTime(), new Date(2026, 9, 15, 0, 21).getTime()]);
    expect([day.starts.length, day.since, day.until]).toEqual([24, new Date(2026, 9, 14, 1).getTime(), new Date(2026, 9, 15, 1).getTime()]);
    expect([day.slotOf(new Date(2026, 9, 14, 23, 59).getTime()), day.slotOf(now), day.slotOf(day.until), day.slotOf(day.since - 1)]).toEqual([22, 23, -1, -1]);
    // 2026-11-01 ends daylight time: that local day has 25 hours, and the week's buckets start at each local midnight.
    const week = buckets("week", new Date(2026, 10, 3, 9).getTime());
    expect(week.starts.map((t) => new Date(t).getHours())).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(week.starts.map((t) => new Date(t).getDate())).toEqual([28, 29, 30, 31, 1, 2, 3]);
    expect(week.starts[5] - week.starts[4]).toBe(DAY + DAY / 24);
    expect(week.slotOf(new Date(2026, 10, 1, 23, 30).getTime())).toBe(4);
    expect(week.slotOf(new Date(2026, 10, 2, 0, 0).getTime())).toBe(5);
  } finally {
    process.env.TZ = tz ?? "UTC";
    if (tz === undefined) delete process.env.TZ;
  }
});

test("quantile is the nearest rank: the median of an even count is the lower middle value", () => {
  expect([quantile([3, 1, 2], 0.5), quantile([4, 1, 3, 2], 0.5), quantile([4, 1, 3, 2], 0.9), quantile([5], 0.9), quantile([], 0.5)]).toEqual([2, 2, 4, 5, null]);
});
