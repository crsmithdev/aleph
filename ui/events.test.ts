import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer, type TestServer } from "./test-server.ts";
import { countsInFactory, countsInRecords } from "./api/events.ts";
import { putRun } from "../jobs/lib/records/record.ts";
import type { Run } from "../jobs/lib/records/ledger.ts";

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

/** Opens the stream, runs `act` and waits for a `state` event: true when one comes, false when the stream ends first. */
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
      if (new TextDecoder().decode(value).includes("event: state")) return true;
    }
  } catch { return false; }
  finally { ctl.abort(); }
}

const run = (on: string): Run => ({ kind: "build", job: on, name: on, on, condition: "running", told: false, started: "2026-11-04T10:00:00Z" });

test("a run's write to its job record sends a state, also to a record made after the stream opened", async () => {
  putRun("old", run("r-1"));
  expect(await changeAfter(() => putRun("old", { ...run("r-1"), phase: "worker" }))).toBe(true);
  expect(await changeAfter(() => putRun("new", run("r-2")))).toBe(true);
});

test("a change in the factory folder or to the store's origin/main sends a state", async () => {
  expect(await changeAfter(() => writeFileSync(join(factory, "paused"), ""))).toBe(true);
  expect(await changeAfter(() => writeFileSync(join(ref, "main"), "abc"))).toBe(true);
});

test("a run that starts sends its event as an ev, before the state, with the event as JSON", async () => {
  const ctl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${server.port}/api/events`, { signal: ctl.signal });
  const reader = res.body!.getReader();
  await reader.read();
  putRun("r3", run("r-3"));
  let text = "";
  try {
    while (!text.includes("event: state")) text += new TextDecoder().decode((await reader.read()).value);
  } finally { ctl.abort(); }
  const ev = /event: ev\ndata: (.*)\n/.exec(text);
  expect(ev).not.toBeNull();
  expect(JSON.parse(ev![1])).toMatchObject({ by: "gate", subject: "r-3", action: "running" });
  expect(text.indexOf("event: ev")).toBeLessThan(text.indexOf("event: state"));
});

/** Opens a stream with `query`, runs `acts` one after the other and returns the `state` event each one brings. */
async function statesAfter(query: string, ...acts: (() => void)[]): Promise<Record<string, any>[]> {
  const ctl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${server.port}/api/events${query}`, { signal: ctl.signal });
  const reader = res.body!.getReader();
  await reader.read();
  const out: Record<string, any>[] = [];
  let text = "";
  try {
    for (const act of acts) {
      act();
      for (let m = /event: state\ndata: (.*)\n\n/.exec(text); !m; m = /event: state\ndata: (.*)\n\n/.exec(text)) text += new TextDecoder().decode((await reader.read()).value);
      const m = /event: state\ndata: (.*)\n\n/.exec(text)!;
      out.push(JSON.parse(m[1]));
      text = text.slice(m.index + m[0].length);
    }
  } finally { ctl.abort(); }
  return out;
}

test("a state event has the runs, narrowed to the project of the stream", async () => {
  const mine = { ...run("r-4"), repo: "mine" } as Run, other = { ...run("r-5"), repo: "other" } as Run;
  const [ev] = await statesAfter("?project=mine", () => { putRun("p1", mine); putRun("p2", other); });
  expect(ev.running.map((r: { name: string }) => r.name)).toContain("r-4");
  expect(ev.running.map((r: { name: string }) => r.name)).not.toContain("r-5");
});

test("a second write that changes only the runs sends no key that did not change", async () => {
  const [first, second] = await statesAfter("", () => putRun("q1", run("r-6")), () => putRun("q2", run("r-7")));
  expect(Object.keys(second)).toContain("running");
  expect(Object.keys(second)).not.toContain("queued");
  for (const k of Object.keys(second)) expect(second[k]).not.toEqual(first[k]);
  expect(second.running.map((r: { name: string }) => r.name)).toContain("r-7");
});

// The watchers pass names relative to the folder, as the tests above show; these files must not count.
test("a temporary record file and a log count as no change", () => {
  expect(countsInRecords("r-1.json.123.tmp")).toBe(false);
  expect(countsInRecords("r-1.json")).toBe(true);
  expect(countsInFactory("tick.log")).toBe(false);
  expect(countsInFactory("paused")).toBe(true);
});
