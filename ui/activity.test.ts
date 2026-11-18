import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { observationsStore } from "../jobs/lib/infra/settings.ts";
import { activity } from "./activity.ts";
import { closePass, openPass } from "../lib/sources.ts";
import { memory, use } from "../lib/langfuse.ts";

const now = new Date(2026, 10, 4, 23, 0, 0);
const at = (daysAgo: number, hour = 10) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour).toISOString();
const gen = (day: number, model: string, cost: number, trace: string) => ({ id: `g${Math.random()}`, traceId: trace, type: "GENERATION", name: model, model, startTime: at(day), calculatedTotalCost: cost });
const tool = (day: number, name: string, trace: string, level = "DEFAULT") => ({ id: `t${Math.random()}`, traceId: trace, type: "TOOL", name, level, startTime: at(day), metadata: { tool: name } });
const span = (day: number, name: string, trace: string, metadata: object = {}, level = "DEFAULT", output = "") => ({ id: `s${Math.random()}`, traceId: trace, type: "SPAN", name, level, startTime: at(day), metadata, output });
const observations = [
  gen(0, "claude-opus-5-5", 0.25, "ta"), gen(0, "claude-haiku-5-5", 0.05, "tb"), gen(1, "claude-opus-5-5", 0.5, "ta"),
  tool(0, "Bash", "ta"), tool(0, "Bash", "ta", "ERROR"), tool(1, "Read", "ta"), tool(0, "Edit", "tb"), tool(0, "skill:goal", "ta"),
  span(0, "verify-gate", "ta", { verdict: "deny" }, "DEFAULT", "deny: nothing was run"),
  span(0, "verify-gate", "tb", { verdict: "pass" }),
  span(1, "vault-recall", "ta", {}, "ERROR"),
];
const rows = { traces: [] as any[], observations };
const lf = memory(rows);
const reads = () => lf.asked.filter((a) => a.list === "observations");

beforeAll(() => use(lf));
afterAll(() => use(null));
const stored = observationsStore().replace(/\.json$/, ".http-langfuse-test.json");
beforeEach(() => { lf.asked.length = 0; lf.down = null; rows.observations = observations; rmSync(stored, { force: true }); });

describe("activity", () => {
  test("counts the tools, hooks and denials of the window", async () => {
    const a = await activity(7, null, now);
    expect(a.langfuse).toBe("ok");
    expect(a.tools.map((t) => [t.name, t.calls, t.errors])).toEqual([["Bash", 2, 1], ["Edit", 1, 0], ["Read", 1, 0]]);
    expect(a.hooks.map((h) => [h.name, h.calls, h.errors])).toEqual([["verify-gate", 2, 0], ["vault-recall", 1, 1]]);
    expect(a.denials).toEqual({ total: 1, recent: [{ at: at(0), reason: "nothing was run" }] });
    // Langfuse filters on one type per read; the model calls are not read.
    expect(reads().length).toBeGreaterThan(0);
    for (const r of reads()) expect(["TOOL", "GUARDRAIL", "SPAN"]).toContain((r.q as any).type);
  });

  test("in a build pass a second read does not reach Langfuse; after a Langfuse change it does", async () => {
    try {
      openPass({ langfuse: 1 }, "activity.test");
      const a = await activity(7, null, now);
      const b = await activity(7, null, now);
      expect(reads().length).toBe(3);
      expect(b).toEqual(a);
      openPass({ langfuse: 2 }, "activity.test");
      await activity(7, null, now);
      expect(reads().length).toBe(6);
    } finally { closePass(); }
  });

  test("in a build pass a later read asks only for the last 10 min and keeps the rows read before; an hour on it reads the last 2 hours and a day on the window", async () => {
    const min = 60_000, startOf = (t: Date) => new Date(t.getFullYear(), t.getMonth(), t.getDate() - 6).getTime();
    const from = () => reads().at(-1)!.q.from!.getTime();
    const late = { ...tool(0, "Bash", "tc"), startTime: new Date(now.getTime() + 2 * min).toISOString() };
    const hour = new Date(now.getTime() + 61 * min), calls = (a: Awaited<ReturnType<typeof activity>>) => a.tools.map((t) => [t.name, t.calls]);
    try {
      openPass({ langfuse: 1 }, "activity.test.later");
      const a = await activity(7, null, now);
      expect(from()).toBe(startOf(now));
      rows.observations = [late];
      openPass({ langfuse: 2 }, "activity.test.later");
      const b = await activity(7, null, new Date(now.getTime() + 5 * min));
      expect(from()).toBe(now.getTime() + min - 10 * min);
      expect(b.tools.find((t) => t.name === "Bash")!.calls).toBe(a.tools.find((t) => t.name === "Bash")!.calls + 1);
      rows.observations = [...observations, late];
      openPass({ langfuse: 3 }, "activity.test.later");
      const c = await activity(7, null, hour);
      expect(from()).toBe(hour.getTime() + min - 120 * min);
      closePass();
      expect(calls(c)).toEqual(calls(await activity(7, null, hour)));
      openPass({ langfuse: 4 }, "activity.test.later");
      const day = new Date(now.getTime() + 25 * 60 * min);
      await activity(7, null, day);
      expect(from()).toBe(startOf(day));
    } finally { closePass(); }
  });

  test("a wider window reads only its older part, and a 30-day and a 7-day read that alternate after it read nothing old", async () => {
    const old = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime(), recent = now.getTime() + 60_000 - 10 * 60_000;
    try {
      openPass({ langfuse: 1 }, "activity.test.wider");
      await activity(7, null, now);
      lf.asked.length = 0;
      openPass({ langfuse: 2 }, "activity.test.wider");
      await activity(30, null, now);
      expect(reads().filter((r) => r.q.to!.getTime() === old).length).toBe(3);
      expect(reads().every((r) => r.q.from!.getTime() === recent || r.q.to!.getTime() === old)).toBe(true);
      lf.asked.length = 0;
      for (const days of [7, 30, 7, 30]) { openPass({ langfuse: days + reads().length }, "activity.test.wider"); await activity(days, null, now); }
      expect(reads().length).toBe(12);
      expect(reads().every((r) => r.q.from!.getTime() === recent)).toBe(true);
    } finally { closePass(); }
  });

  test("after a restart a pass reads from the stored end and gives the same counts", async () => {
    try {
      openPass({ langfuse: 1 }, "activity.test.restart");
      const a = await activity(7, null, now);
      // A new environment drops the rows in memory, as a restart does; the store file stays.
      openPass({ langfuse: 2 }, "activity.test.restart.2");
      const b = await activity(7, null, new Date(now.getTime() + 5 * 60_000));
      expect(reads().slice(3).every((r) => r.q.from!.getTime() === now.getTime() + 60_000 - 10 * 60_000)).toBe(true);
      expect(b.tools).toEqual(a.tools);
    } finally { closePass(); }
  });

  test("after a failed read the next pass reads from where the kept rows end, not from the window's start", async () => {
    const end = now.getTime() + 60_000, recent = end - 10 * 60_000;
    try {
      openPass({ langfuse: 1 }, "activity.test.failed");
      await activity(7, null, now);
      lf.down = new Error("500");
      openPass({ langfuse: 2 }, "activity.test.failed");
      expect((await activity(30, null, now)).langfuse).toBe("error");
      lf.down = null;
      lf.asked.length = 0;
      openPass({ langfuse: 3 }, "activity.test.failed");
      await activity(7, null, now);
      expect(reads().every((r) => r.q.from!.getTime() === recent)).toBe(true);
    } finally { closePass(); }
  });

  test("a window past the pages a read takes comes back with the counts of part of it, and says so", async () => {
    use({ ...lf, observations: async (q) => ({ ...(await lf.observations(q)), partial: true }) });
    try {
      const a = await activity(7, null, now);
      expect([a.langfuse, a.partial]).toEqual(["ok", true]);
    } finally { use(lf); }
  });

  test("a failed read says error, with the reason", async () => {
    lf.down = new Error("500 on /api/public/observations");
    const a = await activity(7, null, now);
    expect([a.langfuse, a.error]).toEqual(["error", "500 on /api/public/observations"]);
  });
});
