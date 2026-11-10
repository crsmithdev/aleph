import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { activity } from "./activity.ts";
import { closePass, openPass } from "../jobs/lib/infra/sources.ts";
import { memory, use } from "./langfuse.ts";

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
beforeEach(() => { lf.asked.length = 0; lf.down = null; rows.observations = observations; });

describe("activity", () => {
  test("counts the tools, hooks and denials of the window", async () => {
    const a = await activity(7, null, now);
    expect(a.langfuse).toBe("ok");
    expect(a.tools.map((t) => [t.name, t.calls, t.errors])).toEqual([["Bash", 2, 1], ["Edit", 1, 0], ["Read", 1, 0]]);
    expect(a.hooks.map((h) => [h.name, h.calls, h.errors])).toEqual([["verify-gate", 2, 0], ["vault-recall", 1, 1]]);
    expect(a.denials).toEqual({ total: 1, recent: [{ at: at(0), reason: "nothing was run" }] });
  });

  test("in a build pass a second read does not reach Langfuse; after a Langfuse change it does", async () => {
    try {
      openPass({ langfuse: 1 }, "activity.test");
      const a = await activity(7, null, now);
      const b = await activity(7, null, now);
      expect(reads().length).toBe(1);
      expect(b).toEqual(a);
      openPass({ langfuse: 2 }, "activity.test");
      await activity(7, null, now);
      expect(reads().length).toBe(2);
    } finally { closePass(); }
  });

  test("in a build pass a later read asks only for the last 10 min and keeps the rows read before; after an hour it reads the window again", async () => {
    const min = 60_000, start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
    const from = () => reads().at(-1)!.q.from!.getTime();
    try {
      openPass({ langfuse: 1 }, "activity.test.later");
      const a = await activity(7, null, now);
      expect(from()).toBe(start);
      rows.observations = [{ ...tool(0, "Bash", "tc"), startTime: new Date(now.getTime() + 2 * min).toISOString() }];
      openPass({ langfuse: 2 }, "activity.test.later");
      const b = await activity(7, null, new Date(now.getTime() + 5 * min));
      expect(from()).toBe(now.getTime() + min - 10 * min);
      expect(b.tools.find((t) => t.name === "Bash")!.calls).toBe(a.tools.find((t) => t.name === "Bash")!.calls + 1);
      openPass({ langfuse: 3 }, "activity.test.later");
      // Two hours on is the next day, so the window starts a day later.
      await activity(7, null, new Date(now.getTime() + 2 * 60 * min));
      expect(from()).toBe(start + 24 * 60 * min);
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
