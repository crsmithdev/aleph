import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer, type TestServer } from "./test-server.ts";
import { countsInFactory, countsInLedger } from "./api/events.ts";

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

test("a run's state.json sends a change, also in a run folder made after the stream opened", async () => {
  expect(await changeAfter(() => writeFileSync(join(runs, "old", "state.json"), "{}"))).toBe(true);
  expect(await changeAfter(() => { mkdirSync(join(runs, "new")); writeFileSync(join(runs, "new", "state.json"), "{}"); })).toBe(true);
});

test("a change in the factory folder or to the store's origin/main sends a change", async () => {
  expect(await changeAfter(() => writeFileSync(join(factory, "paused"), ""))).toBe(true);
  expect(await changeAfter(() => writeFileSync(join(ref, "main"), "abc"))).toBe(true);
});

test("a state.json moved into place sends a change, as the ledger writes it", async () => {
  const tmp = join(runs, "old", ".state.json.1");
  expect(await changeAfter(() => { writeFileSync(tmp, "{}"); renameSync(tmp, join(runs, "old", "state.json")); })).toBe(true);
});

// The watchers pass names relative to the folder, as the tests above show; these files must not count.
test("a file in a worker's tree, a temp state file and a log count as no change", () => {
  for (const f of ["old/work/x.ts", "old/work/jobs/a/state.json", "old/.state.json.1", "old/output.log"]) expect(countsInLedger(f)).toBe(false);
  for (const f of ["old/state.json", "new/call.md"]) expect(countsInLedger(f)).toBe(true);
  expect(countsInFactory("tick.log")).toBe(false);
  expect(countsInFactory("paused")).toBe(true);
});
