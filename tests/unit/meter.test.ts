import { test, expect, describe, beforeEach } from "bun:test";
import { openDb } from "../../src/platform/db.ts";
import { EventLog } from "../../src/core/eventlog.ts";
import { Emitter, setEmitter } from "../../src/core/emit.ts";
import { FakeClock } from "../../src/core/clock.ts";
import { Meter } from "../../src/core/meter.ts";
import { loadConfig, type Config } from "../../src/core/config.ts";
import { newTraceId } from "../../src/core/ids.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOML = `runner = "echo"
[meter.capacity]
window_5h = 1000
weekly = 10000
[meter.reserve]
window_5h = 0.30
weekly = 0.25
[meter.weights]
input = 1
output = 5
cache_read = 0.1
cache_creation = 1.25
[lanes.backlog]
enabled = false
`;

function harness(clockIso = "2026-08-20T12:00:00.000Z") {
  const dir = mkdtempSync(join(tmpdir(), "meter-"));
  const file = join(dir, "aleph.toml");
  writeFileSync(file, TOML);
  const { config } = loadConfig({ file, host: "none", env: {} });
  const clock = new FakeClock(Date.parse(clockIso));
  const db = openDb(join(dir, "aleph.db"));
  const log = new EventLog({ dir: join(dir, "events"), db, clock, fsyncIntervalMs: 0 });
  const events: string[] = [];
  setEmitter(new Emitter({ log, clock, strict: true, onEvent: (e) => events.push(e.kind) }));
  return { config: config as Config, clock, db, meter: new Meter(db, config, clock), events, ids: { origin: "system" as const, trace_id: newTraceId() } };
}

describe("weighting", () => {
  test("weights each token class per config", () => {
    const h = harness();
    expect(h.meter.weigh({ input_tokens: 100, output_tokens: 10, cache_read_tokens: 100, cache_creation_tokens: 8 }))
      .toBe(100 * 1 + 10 * 5 + 100 * 0.1 + 8 * 1.25);
  });
});

describe("starvation ladder", () => {
  const cases: Array<[string, number, boolean, "ok" | "lane_disabled" | "window_reserved" | "window_exhausted"]> = [
    ["interactive", 0.10, true, "ok"],
    ["interactive", 0.69, true, "ok"],
    ["interactive", 0.71, true, "ok"],
    ["interactive", 0.99, true, "ok"],
    ["control", 0.71, true, "ok"],
    ["research", 0.10, true, "ok"],
    ["research", 0.69, true, "ok"],
    ["research", 0.71, false, "window_reserved"],
    ["librarian", 0.71, false, "window_reserved"],
    ["backlog", 0.10, false, "lane_disabled"],
  ];

  for (const [lane, share, admit, reason] of cases) {
    test(`${lane} at 5h share ${share} -> ${reason}`, () => {
      const h = harness();
      // capacity 1000 weighted; output weight 5 -> tokens = share*1000/5
      const output = Math.round((share * 1000) / 5);
      if (output > 0) {
        h.meter.record({
          lane: "interactive", model: "test", tier: "T2", input_tokens: 0, output_tokens: output,
          cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: null, source: "estimate",
        }, h.ids);
      }
      const verdict = h.meter.admit(lane as never);
      expect(verdict.admit).toBe(admit);
      expect(verdict.reason).toBe(reason);
    });
  }

  test("the reserve boundary is exactly where the design says it is", () => {
    const h = harness();
    h.meter.record({ lane: "interactive", model: "t", tier: "T2", input_tokens: 0, output_tokens: 138, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: null, source: "estimate" }, h.ids);
    expect(h.meter.window("5h").share).toBeCloseTo(0.69, 5);
    expect(h.meter.admit("research").admit).toBe(true);
    h.meter.record({ lane: "interactive", model: "t", tier: "T2", input_tokens: 0, output_tokens: 4, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: null, source: "estimate" }, h.ids);
    expect(h.meter.window("5h").share).toBeCloseTo(0.71, 5);
    expect(h.meter.admit("research").admit).toBe(false);
    expect(h.meter.admit("interactive").admit).toBe(true);
  });
});

describe("windows", () => {
  test("5h window rolls: usage older than 5h leaves the accumulator", () => {
    const h = harness();
    h.meter.record({ lane: "interactive", model: "t", tier: "T2", input_tokens: 0, output_tokens: 100, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: null, source: "estimate" }, h.ids);
    expect(h.meter.window("5h").share).toBeCloseTo(0.5, 5);
    h.clock.advance(5 * 3600_000 + 1000);
    expect(h.meter.window("5h").share).toBe(0);
    expect(h.meter.window("weekly").share).toBeCloseTo(0.05, 5);
  });

  test("threshold events fire once per crossing, not per call", () => {
    const h = harness();
    for (let i = 0; i < 6; i++) {
      h.meter.record({ lane: "interactive", model: "t", tier: "T2", input_tokens: 0, output_tokens: 20, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: null, source: "estimate" }, h.ids);
      h.clock.advance(1000);
    }
    const crossings = h.events.filter((k) => k === "meter.window_threshold");
    expect(crossings.length).toBe(1);   // 6*20*5 = 600/1000 = 0.6 -> crosses 0.5 only
  });

  test("exhaustion puts the meter in sentinel mode and only recovers on rollover", () => {
    const h = harness();
    h.meter.record({ lane: "interactive", model: "t", tier: "T2", input_tokens: 0, output_tokens: 210, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: null, source: "estimate" }, h.ids);
    expect(h.meter.sentinel).toBe(true);
    expect(h.meter.admit("interactive").reason).toBe("window_exhausted");
    expect(h.events).toContain("meter.window_exhausted");
    h.clock.advance(5 * 3600_000 + 1000);
    expect(h.meter.sweep(h.ids)).toContain("5h");
    expect(h.meter.sentinel).toBe(false);
    expect(h.meter.admit("interactive").admit).toBe(true);
  });
});
