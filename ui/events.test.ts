import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer, type TestServer } from "./server.testkit.ts";
import { countsInFactory, countsInSkills } from "./updater.ts";
import { seed, reseed, type Seed } from "../jobs/job.testkit.ts";
import { newItems, writeRepos } from "../tests/projects.testkit.ts";
import { writeList } from "../issues/lib/store.ts";
import { add } from "../issues/lib/todo.ts";
import { git } from "../lib/git.ts";
import { logEvent } from "../lib/layout.ts";

let base: string, runs: string, factory: string, ref: string, main: string;
let server: TestServer, stop: () => void, restoreEnv: () => void;

beforeAll(async () => {
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
  main = git(join(base, "issues"), "rev-parse", "origin/main").out;
  ({ server, stop } = await withServer({ warm: false }));
  // A change names only the keys a page asked for: Status's key is kept from here on.
  expect((await get("/api/factory")).headers.get("x-aleph-keys")).toBe("/api/factory");
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

const run = (repo: string, n: number): Seed => ({ role: "build", name: `issue.${n}`, repo, target: `issue.${n}`, state: "running", told: false, started: "2026-11-04T10:00:00Z" });
let first: string;

test("a run's write to its job row sends a change naming the kept key, and the refetch has the write", async () => {
  first = seed(run("p", 1)).id;
  expect(await changeAfter(() => reseed(first, { phase: "worker" }))).toMatch(/event: change\ndata: \{"keys":\["\/api\/factory"\]\}/);
  let second = "";
  expect(await changeAfter(() => { second = seed(run("p", 2)).id; })).not.toBeNull();
  expect(JSON.stringify(await (await get("/api/factory")).json())).toContain(second);
});

// AC1: the 3 s is the test's time limit, from the stream's first ping to the change. A job row write that logs no event
// sends none: it waits for the quiet refresh timer.
test("an event written by another process sends its change within 3 s", async () => {
  const code = `import { logEvent } from "./lib/layout.ts"; logEvent({ subject: "human", action: "changed", object: "settings", detail: "x" });`;
  const text = await changeAfter(() => { Bun.spawn(["bun", "-e", code], { cwd: join(import.meta.dir, ".."), env: process.env }); });
  expect(text).toMatch(/event: ev\ndata: .*"key":"issue:settings".*\n\nevent: change\ndata: \{"keys":\["\/api\/factory"\]\}/s);
}, 3_000);

test("a change in the factory folder or to the store's origin/main sends a change", async () => {
  expect(await changeAfter(() => writeFileSync(join(factory, "paused"), ""))).not.toBeNull();
  expect(await changeAfter(() => writeFileSync(join(ref, "main"), "abc"))).not.toBeNull();
});

/** The pages the `ev` events of `text` link: each row's leading ID. */
const linked = (text: string) => [...text.matchAll(/event: ev\ndata: (.*)\n/g)].flatMap((m) => JSON.parse(m[1]).rows.flatMap((r: any) => [...r.id, ...r.lines.flatMap((l: any) => l.text)].flatMap((p: any) => (p.to ? [p.to] : []))));

test("a run that starts sends the Herald's rows as an ev, before the change, with the new event's row among them", async () => {
  let id = "";
  const text = (await changeAfter(() => { id = seed(run("p", 3)).id; }))!;
  const ev = /event: ev\ndata: (.*)\n/.exec(text);
  expect(ev).not.toBeNull();
  const { seq, rows } = JSON.parse(ev![1]);
  expect(seq).toBeGreaterThan(0);
  expect(rows.find((r: any) => r.id[0]?.to === "#/issues/p/3")).toMatchObject({ by: "gate", word: "started", kind: "work" });
  expect(JSON.stringify(rows)).toContain(`#/jobs/${id}`);
  expect(text.indexOf("event: ev")).toBeLessThan(text.indexOf("event: change"));
});

test("a stream with a project sends only the ev events of that project, and a change to all", async () => {
  const ids: Record<string, string> = {};
  const text = (await changeAfter(() => { for (const repo of ["q", "p-x", "p"]) ids[repo] = seed(run(repo, 9)).id; }, "?project=p"))!;
  const to = linked(text);
  expect(to).toContain(`#/jobs/${ids.p}`);
  expect(to).not.toContain(`#/jobs/${ids.q}`);
  expect(to).not.toContain(`#/jobs/${ids["p-x"]}`);
}, 10_000);

test("a stream with a project sends an ev with the row of an event on an issue of that project, and none for another's", async () => {
  // The test above leaves a bad ref in the items repo.
  writeFileSync(join(ref, "main"), `${main}\n`);
  // Logged here, not by a process the test starts: the ref's change above comes 500 ms on, and under load a new bun can start later.
  const text = (await changeAfter(() => { for (const n of [1, 2]) logEvent({ subject: "human", action: "changed", object: `issue.${n}` }); }, "?project=p"))!;
  expect(linked(text)).toContain("#/issues/p/1");
  expect(linked(text)).not.toContain("#/issues/q/2");
}, 10_000);

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
