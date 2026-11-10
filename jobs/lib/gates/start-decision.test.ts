import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { readList } from "../../../issues/lib/store.ts";
import { allJobs, loadRegistry } from "../records/ledger.ts";
import { setModel } from "../routing/models.ts";
import type { Tier } from "../routing/route.ts";
import { holdBackend, issueFacts } from "./factory-status.ts";
import { decideStart } from "./start-decision.ts";
import { dispatchIssues, stalled } from "../transitions/factory.ts";
import { mk, newIssue, setup, teardown } from "../transitions/factory.helpers.ts";

const NOW = Date.parse("2026-11-04T00:00:00Z");
const CREDIT = "API Error: 402 This request would exceed your available credits";
let env: Record<string, string | undefined>;
beforeEach(() => { setup(); setSystemTime(NOW); env = { url: process.env.ALEPH_JEV_URL, key: process.env.OPENROUTER_API_KEY }; });
afterEach(() => {
  setSystemTime();
  if (env.url === undefined) delete process.env.ALEPH_JEV_URL; else process.env.ALEPH_JEV_URL = env.url;
  if (env.key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = env.key;
  teardown();
});

/** The decision for issue `id` with a fake route that answers `tier` and counts its calls in `asked`. */
let asked = 0;
async function decide(id: number, tier: Tier | null, extra: object = {}) {
  asked = 0;
  const repo = loadRegistry().fac, jobs = allJobs();
  const item = readList({ key: "fac" })!.items.find((i) => i.id === id)!;
  return decideStart(repo, { ...issueFacts(repo, item, jobs, NOW), done: () => false, ...extra }, jobs, async () => { asked++; return tier as any; });
}

/** A router on a local port that answers `tier` for every spec. */
function router(tier: Tier): { stop: () => void } {
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ answers: { tier: { type: "choice", choice: tier, probabilities: { [tier]: 1 } } } }) });
  Object.assign(process.env, { ALEPH_JEV_URL: `http://127.0.0.1:${server.port}/`, OPENROUTER_API_KEY: "k-test" });
  return { stop: () => server.stop(true) };
}

test("a ready issue starts with no route asked, so the start rates the spec itself", async () => {
  const id = newIssue();
  expect(await decide(id, "opus")).toMatchObject({ kind: "ready", tier: undefined });
  expect(asked).toBe(0);
});

test("with the live cap full of Claude runs, a tier on the local backend starts; a tier on Claude stays held", async () => {
  process.env.ALEPH_LIVE_CAP = "1";
  expect(setModel("worker-low", { model: "gpt-oss-20b" })).toBeNull();
  mk("claude-1", "build", "running", { model: "sonnet", made: NOW });
  const id = newIssue();
  expect(await decide(id, "worker-low")).toMatchObject({ kind: "ready", tier: "worker-low" });
  expect(await decide(id, "opus")).toMatchObject({ kind: "live-cap", tier: "opus", why: "1 agent runs are live" });
  expect(await decide(id, null)).toMatchObject({ kind: "live-cap", tier: null });
  expect(asked).toBe(1);
});

test("the live cap with every tier on Claude asks no route", async () => {
  process.env.ALEPH_LIVE_CAP = "1";
  mk("claude-1", "build", "running", { model: "sonnet", made: NOW });
  const id = newIssue();
  expect(await decide(id, "worker-low")).toMatchObject({ kind: "live-cap", tier: undefined });
  expect(asked).toBe(0);
});

test("a held backend holds an issue whose tier runs on it; another tier starts; an issue with a run is held with no route", async () => {
  expect(setModel("worker-low", { model: "deepseek-v4.1-flash" })).toBeNull();
  await holdBackend("openrouter", CREDIT);
  const id = newIssue();
  expect(await decide(id, "worker-low")).toMatchObject({ kind: "backend", tier: "worker-low", why: `waits for OpenRouter: ${CREDIT}` });
  expect(await decide(id, "opus")).toMatchObject({ kind: "ready", tier: "opus" });
  const ran = newIssue();
  mk(`fac-${ran}`, "build", "failed", { model: "deepseek-v4.1-flash" });
  expect(await decide(ran, "opus")).toMatchObject({ kind: "backend", tier: undefined });
  expect(asked).toBe(0);
});

test("the run cap and the no-commit streak stop a start that the factory gates let through", async () => {
  const id = newIssue();
  expect(await decide(id, null, { startsInHour: 3 })).toMatchObject({ kind: "loop-guard", ask: "run-cap", starts: 3 });
  expect(await decide(id, null, { noCommits: 3 })).toMatchObject({ kind: "loop-guard", ask: "no-commit" });
});

test("stalled and the dispatch agree: a hold on Claude holds an issue with no run for both", async () => {
  await holdBackend("claude", CREDIT);
  const id = newIssue();
  expect(await decide(id, null)).toMatchObject({ kind: "backend" });
  expect(await stalled()).toEqual([]);
  const r = router("opus");
  try {
    const out = await dispatchIssues(async () => null);
    expect(out.started).toEqual([]);
    expect(out.skipped).toEqual([`fac-${id}: waits for Claude: ${CREDIT}`]);
  } finally {
    r.stop();
  }
});

test("stalled and the dispatch agree on a ready issue: stalled lists it and the dispatch starts it", async () => {
  const id = newIssue();
  expect(await stalled()).toEqual([`goal:fac-${id}`]);
  expect((await dispatchIssues(async () => null)).started).toEqual([`fac-${id}`]);
});
