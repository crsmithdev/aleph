// Archived goal tests from ui/timeline.test.ts: `bun run accept` runs them, `bun run test` does not.
import { describe, expect, test } from "bun:test";
// @ts-ignore plain JS, shared with the page
import { axisTimes, compactScale, gaps, lifespan, noteEvent, renderTimeline, spans, waitEvent } from "../../ui/timeline.js";
// @ts-ignore
import { issueSegments, renderIssue } from "../../ui/views/issues.js";

describe("waitEvent", () => {
  const t0 = Date.parse("2026-11-01T08:00:00Z"), min = 60_000;
  const w = { start: t0, end: t0 + 9 * min, chris: false };
  const iso = (m: number) => new Date(t0 + m * min).toISOString();
  test("names each reason with its minutes, in order", () => {
    const e = waitEvent(w, [
      { at: iso(-5), name: "a", kind: "held", text: "it waits for aleph-1045.2: both change jobs/lib/factory.ts" },
      { at: iso(7), name: "a", kind: "held", text: "main checks are red" },
    ]);
    expect(e.html).toBe("Waited 9 min: 7 min because it waits for aleph-1045.2: both change jobs/lib/factory.ts; 2 min because main checks are red.");
  });
  test("keeps for your answer", () => {
    const e: any = waitEvent({ ...w, chris: true });
    expect(e.html).toBe("Waited 9 min for your answer.");
    expect(e.tag).toBe("Awaiting you");
  });
});
