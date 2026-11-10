import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer, type TestServer } from "./test-server.ts";
import { countsInFactory, countsInRecords } from "./updater.ts";
import { putRun } from "../jobs/lib/records/record.ts";
import type { Run } from "../jobs/lib/records/ledger.ts";

let base: string, runs: string, factory: string, ref: string;
let server: TestServer, stop: () => void, restoreEnv: () => void;

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-events-"));
  runs = join(base, "runs"); factory = join(base, "factory");
  ref = join(base, "issues", ".git", "refs", "remotes", "origin");
  for (const d of [join(runs, "old"), factory, ref]) mkdirSync(d, { recursive: true });
  // The project filter matches only registry keys.
  writeFileSync(join(base, "repos.json"), JSON.stringify({ p: { path: join(base, "p") }, q: { path: join(base, "q") }, "p-x": { path: join(base, "p-x") } }));
  restoreEnv = withEnv({ ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: runs, ALEPH_ISSUES: join(base, "issues"), ALEPH_FACTORY_DIR: factory });
  ({ server, stop } = await withServer({ warm: false }));
  // A change names only the keys a page asked for: Status's key is kept from here on.
  expect((await get("/api/state")).headers.get("x-aleph-keys")).toBe("/api/state");
});

const get = (path: string) => fetch(`http://127.0.0.1:${server.port}${path}`);

afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

/** Opens the stream, waits for its first ping, runs `act` and returns the text up to and with the first `change` event, or null when the stream ends first. */
async function changeAfter(act: () => void, query = ""): Promise<string | null> {
  const ctl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${server.port}/api/events${query}`, { signal: ctl.signal });
  expect(res.headers.get("content-type")).toBe("text/event-stream");
  const reader = res.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value); // the first ping: the watchers are on
  expect(first).toMatch(/^event: ping\ndata: \{"at":\d+\}\n\n/);
  act();
  let text = "";
  try {
    while (!/event: change\ndata: .*\n\n/.test(text)) {
      const { value, done } = await reader.read();
      if (done) return null;
      text += new TextDecoder().decode(value);
    }
    return text;
  } catch { return null; }
  finally { ctl.abort(); }
}

const run = (on: string): Run => ({ kind: "build", job: on, name: on, on, condition: "running", told: false, started: "2026-11-04T10:00:00Z" });

test("a run's write to its job record sends a change naming the kept key, and the refetch has the write", async () => {
  putRun("old", run("r-1"));
  expect(await changeAfter(() => putRun("old", { ...run("r-1"), phase: "worker" }))).toMatch(/event: change\ndata: \{"keys":\["\/api\/state"\]\}/);
  expect(await changeAfter(() => putRun("new", run("r-2")))).not.toBeNull();
  expect(JSON.stringify(await (await get("/api/state")).json())).toContain("r-2");
});

test("a change in the factory folder or to the store's origin/main sends a change", async () => {
  expect(await changeAfter(() => writeFileSync(join(factory, "paused"), ""))).not.toBeNull();
  expect(await changeAfter(() => writeFileSync(join(ref, "main"), "abc"))).not.toBeNull();
});

test("a run that starts sends its event as an ev, before the change, with the event as JSON", async () => {
  const text = (await changeAfter(() => putRun("r3", run("r-3"))))!;
  const ev = /event: ev\ndata: (.*)\n/.exec(text);
  expect(ev).not.toBeNull();
  expect(JSON.parse(ev![1])).toMatchObject({ by: "gate", subject: "r-3", action: "running" });
  expect(text.indexOf("event: ev")).toBeLessThan(text.indexOf("event: change"));
});

test("a stream with a project sends only the ev events of that project, and a change to all", async () => {
  const text = (await changeAfter(() => { for (const on of ["q-1", "q-1.1", "p-x-1", "p-1"]) putRun(on, run(on)); }, "?project=p"))!;
  const subjects = [...text.matchAll(/event: ev\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]).subject);
  expect(subjects).toContain("p-1");
  expect(subjects).not.toContain("q-1");
  expect(subjects).not.toContain("q-1.1");
  expect(subjects).not.toContain("p-x-1");
}, 10_000);

// The watchers pass names relative to the folder, as the tests above show; these files must not count.
test("a temporary record or factory file and a log count as no change", () => {
  expect(countsInRecords("r-1.json.123.tmp")).toBe(false);
  expect(countsInRecords("r-1.json")).toBe(true);
  expect(countsInFactory("tick.log")).toBe(false);
  expect(countsInFactory("tick.json.4242.tmp")).toBe(false);
  expect(countsInFactory("paused")).toBe(true);
});
