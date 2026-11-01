import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "./server.ts";

let base: string, runs: string, factory: string, ref: string;
let server: Awaited<ReturnType<typeof serve>>;
const saved: Record<string, string | undefined> = {};
const KEYS = ["ALEPH_JOBS_DIR", "ALEPH_ISSUES", "ALEPH_FACTORY_DIR"];

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-events-"));
  runs = join(base, "runs"); factory = join(base, "factory");
  ref = join(base, "issues", ".git", "refs", "remotes", "origin");
  for (const d of [join(runs, "old"), factory, ref]) mkdirSync(d, { recursive: true });
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.ALEPH_JOBS_DIR = runs;
  process.env.ALEPH_ISSUES = join(base, "issues");
  process.env.ALEPH_FACTORY_DIR = factory;
  server = await serve(0, { warm: false });
});

afterAll(() => {
  server.stop(true);
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(base, { recursive: true, force: true });
});

/** Opens the stream, runs `act` and returns whether a `change` event came within `ms`. */
async function changeAfter(act: () => void, ms: number): Promise<boolean> {
  const ctl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${server.port}/api/events`, { signal: ctl.signal });
  expect(res.headers.get("content-type")).toBe("text/event-stream");
  const reader = res.body!.getReader();
  await reader.read(); // the first ping: the watchers are on
  act();
  const timeout = setTimeout(() => ctl.abort(), ms);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return false;
      if (new TextDecoder().decode(value).includes("event: change")) return true;
    }
  } catch { return false; }
  finally { clearTimeout(timeout); ctl.abort(); }
}

test("a run's state.json sends a change, also in a run folder made after the stream opened", async () => {
  expect(await changeAfter(() => writeFileSync(join(runs, "old", "state.json"), "{}"), 5000)).toBe(true);
  expect(await changeAfter(() => { mkdirSync(join(runs, "new")); writeFileSync(join(runs, "new", "state.json"), "{}"); }, 5000)).toBe(true);
});

test("a change in the factory folder or to the store's origin/main sends a change", async () => {
  expect(await changeAfter(() => writeFileSync(join(factory, "paused"), ""), 5000)).toBe(true);
  expect(await changeAfter(() => writeFileSync(join(ref, "main"), "abc"), 5000)).toBe(true);
});

test("a state.json moved into place sends a change, as the ledger writes it", async () => {
  const tmp = join(runs, "old", ".state.json.1");
  expect(await changeAfter(() => { writeFileSync(tmp, "{}"); renameSync(tmp, join(runs, "old", "state.json")); }, 5000)).toBe(true);
});

test("a file in a worker's tree sends no change, also one named state.json", async () => {
  mkdirSync(join(runs, "old", "work", "jobs", "a"), { recursive: true });
  expect(await changeAfter(() => { writeFileSync(join(runs, "old", "work", "x.ts"), "x"); writeFileSync(join(runs, "old", "work", "jobs", "a", "state.json"), "{}"); writeFileSync(join(runs, "old", ".state.json.1"), "{}"); }, 1500)).toBe(false);
});

test("a log write sends no change", async () => {
  expect(await changeAfter(() => { writeFileSync(join(runs, "old", "output.log"), "x"); writeFileSync(join(factory, "tick.log"), "x"); }, 1500)).toBe(false);
});
