import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fit, gainSince, pollOnce, readSnapshots, share, sinceReset, summary, type Snapshot } from "./usage.ts";
// @ts-ignore plain JS, shared with the page
import { costHtml, wkText } from "./lib.js";
// @ts-ignore plain JS view
import { renderUsage } from "./views/now.js";

let dir: string, server: ReturnType<typeof Bun.serve>;
const TOKEN = "sk-ant-oat-secret-token";
const H = 3600_000;
const T0 = Date.parse("2026-10-26T00:00:00Z");
const snap = (h: number, seven: number, reset = "2026-11-02T00:00:00Z"): Snapshot => ({ at: new Date(T0 + h * H).toISOString(), five_hour: 0, seven_day: seven, seven_day_resets_at: reset });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-"));
  process.env.ALEPH_USAGE_FILE = join(dir, "usage.jsonl");
  process.env.ALEPH_CLAUDE_CREDENTIALS = join(dir, "cred.json");
  writeFileSync(process.env.ALEPH_CLAUDE_CREDENTIALS, JSON.stringify({ claudeAiOauth: { accessToken: TOKEN } }));
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) {
    if (req.headers.get("authorization") !== `Bearer ${TOKEN}` || req.headers.get("anthropic-beta") !== "oauth-2025-04-20") return new Response("no", { status: 401 });
    return Response.json({ five_hour: { utilization: 0, resets_at: "2026-10-28T20:00:00Z" }, seven_day: { utilization: 25, resets_at: "2026-11-02T00:00:00Z" } });
  } });
  process.env.ALEPH_USAGE_URL = `http://127.0.0.1:${server.port}/`;
});
afterEach(() => { server.stop(true); rmSync(dir, { recursive: true }); delete process.env.ALEPH_USAGE_URL; });

test("a poll appends the snapshot and the token is nowhere in it", async () => {
  const s = await pollOnce();
  expect(s?.seven_day).toBe(25);
  const text = readFileSync(process.env.ALEPH_USAGE_FILE!, "utf8");
  expect(text).not.toContain(TOKEN);
  expect(readSnapshots()).toHaveLength(1);
  expect(summary().now?.seven_day).toBe(25);
  expect(JSON.stringify(summary())).not.toContain(TOKEN);
});

test("a bad token records nothing and the usage is unknown", async () => {
  await pollOnce();
  writeFileSync(process.env.ALEPH_CLAUDE_CREDENTIALS!, JSON.stringify({ claudeAiOauth: { accessToken: "bad" } }));
  expect(await pollOnce()).toBeNull();
  expect(readFileSync(process.env.ALEPH_USAGE_FILE!, "utf8").trim().split("\n")).toHaveLength(1);
  expect(summary().now).toBeNull();
  expect(renderUsage({ now: new Date().toISOString(), usage: summary() })).toContain("usage unknown");
});

test("no credentials file records nothing", async () => {
  rmSync(process.env.ALEPH_CLAUDE_CREDENTIALS!);
  expect(await pollOnce()).toBeNull();
  expect(existsSync(process.env.ALEPH_USAGE_FILE!)).toBe(false);
});

test("the window starts at the last reset", () => {
  const w = sinceReset([snap(0, 80, "2026-10-26T00:00:00Z"), snap(1, 90, "2026-10-26T00:00:00Z"), snap(2, 1), snap(3, 2)]);
  expect(w.map((s) => s.seven_day)).toEqual([1, 2]);
});

test("under 6 hours of snapshots there is no share", () => {
  expect(fit([snap(0, 0), snap(5, 5)], [{ at: T0 + 2 * H, model: "m", cost: 10 }])).toBeNull();
});

test("r is the rise per dollar, per model when it has $5, pooled otherwise", () => {
  const snaps = [snap(0, 0), snap(4, 4), snap(8, 6), snap(12, 8)];
  // a: 10 $ → 4 %; 5 $ → 1 %... fable burns 2x per dollar
  const spends = [
    { at: T0 + 2 * H, model: "fable", cost: 4 }, { at: T0 + 3 * H, model: "opus", cost: 4 },
    { at: T0 + 6 * H, model: "opus", cost: 4 }, { at: T0 + 10 * H, model: "opus", cost: 4 }, { at: T0 + 11 * H, model: "tiny", cost: 1 },
  ];
  const f = fit(snaps, spends)!;
  expect(f.hours).toBe(12);
  expect(f.byModel.opus).toBeGreaterThan(0);
  expect(f.byModel.fable).toBeUndefined();
  expect(share(f, 2, "opus")).toEqual({ pct: 2 * f.byModel.opus, pooled: false });
  expect(share(f, 2, "fable")).toEqual({ pct: 2 * f.pooled, pooled: true });
  expect(share(null, 2, "opus")).toBeUndefined();
});

test("the share is shown first, with a tooltip, and the dollars stay", () => {
  const html = costHtml(2.3, { pct: 1.44, pooled: true });
  expect(html.indexOf("≈1.4% wk")).toBeLessThan(html.indexOf("$2.30"));
  expect(html).toContain("estimate");
  expect(html).toContain("claude.ai");
  expect(html).toContain("pooled");
  expect(costHtml(2.3)).toBe("$2.30");
  expect(wkText({ pct: 0.01, pooled: false })).toBe("≈<0.1% wk");
});

test("gainSince: the latest weekly percent minus the snapshot nearest to 5 hours before, in the reset window", () => {
  const t = (h: number) => new Date(Date.UTC(2026, 9, 29, 12) - h * 3600_000).toISOString();
  const snap = (h: number, seven_day: number): Snapshot => ({ at: t(h), five_hour: 1, seven_day, seven_day_resets_at: "2026-11-02T09:00:00Z" });
  expect(gainSince([snap(6, 20), snap(5.1, 22), snap(2, 25), snap(0, 30)], 5 * 3600_000)).toBe(8);
  expect(gainSince([snap(1, 20), snap(0, 30)], 5 * 3600_000)).toBeNull();
  expect(gainSince([snap(0, 30)], 5 * 3600_000)).toBeNull();
  expect(gainSince([], 5 * 3600_000)).toBeNull();
});
