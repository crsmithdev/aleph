import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer, type TestServer } from "./test-server.ts";
import { countsInFactory, countsInRecords } from "./api/events.ts";
import { putRun } from "../jobs/lib/record.ts";
import type { Run } from "../jobs/lib/ledger.ts";

let base: string, runs: string, factory: string, ref: string;
let server: TestServer, stop: () => void, restoreEnv: () => void;

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-events-"));
  runs = join(base, "runs"); factory = join(base, "factory");
  ref = join(base, "issues", ".git", "refs", "remotes", "origin");
  for (const d of [join(runs, "old"), factory, ref]) mkdirSync(d, { recursive: true });
  restoreEnv = withEnv({ ALEPH_JOBS_DIR: runs, ALEPH_ISSUES: join(base, "issues"), ALEPH_FACTORY_DIR: factory });
  ({ server, stop } = await withServer({ warm: false }));
});

afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

/** Opens the stream, runs `act` and waits for a `change` event: true when one comes, false when the stream ends first. */
async function changeAfter(act: () => void): Promise<boolean> {
  const ctl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${server.port}/api/events`, { signal: ctl.signal });
  expect(res.headers.get("content-type")).toBe("text/event-stream");
  const reader = res.body!.getReader();
  await reader.read(); // the first ping: the watchers are on
  act();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return false;
      if (new TextDecoder().decode(value).includes("event: change")) return true;
    }
  } catch { return false; }
  finally { ctl.abort(); }
}

const run = (on: string): Run => ({ kind: "build", job: on, name: on, on, condition: "running", told: false, started: "2026-11-04T10:00:00Z" });

test("a run's write to its job record sends a change, also to a record made after the stream opened", async () => {
  putRun("old", run("r-1"));
  expect(await changeAfter(() => putRun("old", { ...run("r-1"), phase: "worker" }))).toBe(true);
  expect(await changeAfter(() => putRun("new", run("r-2")))).toBe(true);
});

test("a change in the factory folder or to the store's origin/main sends a change", async () => {
  expect(await changeAfter(() => writeFileSync(join(factory, "paused"), ""))).toBe(true);
  expect(await changeAfter(() => writeFileSync(join(ref, "main"), "abc"))).toBe(true);
});

// The watchers pass names relative to the folder, as the tests above show; these files must not count.
test("a temporary record file and a log count as no change", () => {
  expect(countsInRecords("r-1.json.123.tmp")).toBe(false);
  expect(countsInRecords("r-1.json")).toBe(true);
  expect(countsInFactory("tick.log")).toBe(false);
  expect(countsInFactory("paused")).toBe(true);
});
