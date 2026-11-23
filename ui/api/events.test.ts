import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer, type TestServer } from "../server.testkit.ts";
import { countsInFactory, countsInSkills } from "../updater.ts";
import { pings } from "./events.ts";
import { seed, reseed, type Seed } from "../../jobs/job.testkit.ts";
import { newItems, writeRepos } from "../../tests/projects.testkit.ts";
import { writeList } from "../../lib/store.ts";
import { add } from "../../lib/issue-file.ts";

let base: string, runs: string, factory: string, ref: string;
let server: TestServer, stop: () => void, restoreEnv: () => void, pingMs: number;

beforeAll(async () => {
  // Set before the first stream starts the pings: ten pings in a row are a quiet second.
  pingMs = pings.ms;
  pings.ms = 100;
  base = mkdtempSync(join(tmpdir(), "aleph-ui-events-"));
  runs = join(base, "runs"); factory = join(base, "factory");
  ref = join(base, "issues", ".git", "refs", "remotes", "origin");
  for (const d of [join(runs, "old"), factory]) mkdirSync(d, { recursive: true });
  newItems(base, "issues");
  // The project filter matches only registry keys.
  writeRepos({ p: { path: join(base, "p") }, q: { path: join(base, "q") }, "p-x": { path: join(base, "p-x") } }, join(base, "issues"));
  restoreEnv = withEnv({ ALEPH_JOBS_DIR: runs, ALEPH_DB: join(base, "aleph.db"), ALEPH_ITEMS: join(base, "issues"), ALEPH_FACTORY_DIR: factory });
  // Issue 1 is p's and issue 2 is q's.
  for (const repo of ["p", "q"]) writeList({ key: repo }, "seed", (doc) => { add(doc, `an issue of ${repo}`); return true; }, true);
  ({ server, stop } = await withServer({ warm: false }));
  // A change names only the keys a page asked for: Status's key is kept from here on.
  expect((await get("/api/factory")).headers.get("x-aleph-keys")).toBe("/api/factory");
});

const get = (path: string) => fetch(`http://127.0.0.1:${server.port}${path}`);

afterAll(() => {
  pings.ms = pingMs;
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

/** Opens the stream, waits for its first ping, runs `act` and returns the text up to and with the first chunk `enough` holds for, or null when the stream ends first. */
async function streamUntil(act: () => void, enough: (text: string) => boolean, query = ""): Promise<string | null> {
  const ctl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${server.port}/api/events${query}`, { signal: ctl.signal });
  expect(res.headers.get("content-type")).toBe("text/event-stream");
  const reader = res.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value); // the first ping: the watchers are on
  expect(first).toMatch(/^event: ping\ndata: \{"at":\d+\}\n\n/);
  act();
  let text = "";
  try {
    while (!enough(text)) {
      const { value, done } = await reader.read();
      if (done) return null;
      text += new TextDecoder().decode(value);
    }
    return text;
  } catch { return null; }
  finally { ctl.abort(); }
}

/** The bytes that end a `change` event. */
const CHANGE = /event: change\ndata: .*\n\n/;

/** Runs `act` and returns the text up to and with the first `change` event, or null when the stream ends first. */
const changeAfter = (act: () => void, query = "") => streamUntil(act, (text) => CHANGE.test(text), query);

const run = (repo: string, n: number): Seed => ({ role: "build", name: `issue.${n}`, repo, target: `issue.${n}`, state: "running", told: false, started: "2026-11-04T10:00:00Z" });
let first: string;

test("a run's write to its job row sends a change naming the kept key, and the refetch has the write", async () => {
  first = seed(run("p", 1)).id;
  expect(await changeAfter(() => reseed(first, { phase: "worker" }))).toMatch(/event: change\ndata: \{"keys":\["\/api\/factory"\]\}/);
  let second = "";
  expect(await changeAfter(() => { second = seed(run("p", 2)).id; })).not.toBeNull();
  expect(JSON.stringify(await (await get("/api/factory")).json())).toContain(second);
});

// AC1: the 3 s is the test's time limit, from the stream's first ping to the change.
test("an event row written by another process sends a change and no ev event, within 3 s", async () => {
  const code = `import { logEvent } from "../lib/layout.ts"; logEvent({ subject: "human", action: "changed", object: "settings", detail: "x" });`;
  const text = await changeAfter(() => { Bun.spawn(["bun", "-e", code], { cwd: join(import.meta.dir, ".."), env: process.env }); });
  expect(text).toMatch(/event: change\ndata: \{"keys":\["\/api\/factory"\]\}/);
  expect(text).not.toContain("event: ev");
}, 3_000);

/** Ten pings in a row end the text: a second with no change, longer than a change takes to settle. */
const QUIET = /(event: ping\ndata: .*\n\n){10}$/;

test("a job row write that logs no event sends a change naming Status's key, and with no write the stream sends only pings", async () => {
  // The writes of the tests before settle first, so the change is the job row's.
  expect(await streamUntil(() => {}, (text) => QUIET.test(text))).not.toBeNull();
  const text = await streamUntil(() => reseed(first, { phase: "reviewer" }), (t) => CHANGE.test(t) && QUIET.test(t));
  expect(text).toMatch(/event: change\ndata: \{"keys":\[[^\]]*"\/api\/factory"/);
  expect(text).not.toContain("event: ev");
  const quiet = (await streamUntil(() => {}, (t) => t.split("event: ").length > 10))!;
  expect(quiet.match(/^event: \w+/gm)?.slice()).toEqual(Array(10).fill("event: ping"));
}, 15_000);

test("a change in the factory folder or to the store's origin/main sends a change", async () => {
  expect(await changeAfter(() => writeFileSync(join(factory, "paused"), ""))).not.toBeNull();
  expect(await changeAfter(() => writeFileSync(join(ref, "main"), "abc"))).not.toBeNull();
});

// The watchers pass names relative to the folder, as the tests above show; these files must not count.
test("a temporary factory file and a log count as no change", () => {
  expect(countsInFactory("x.log")).toBe(false);
  expect(countsInFactory("tick.json.4242.tmp")).toBe(false);
  expect(countsInFactory("paused")).toBe(true);
});

test("a skill folder or its SKILL.md counts as a skills change; another file in the folder does not", () => {
  expect(countsInSkills("vault")).toBe(true);
  expect(countsInSkills("vault/SKILL.md")).toBe(true);
  expect(countsInSkills("vault/cli.ts")).toBe(false);
  expect(countsInSkills("vault/refs/SKILL.md")).toBe(false);
});
