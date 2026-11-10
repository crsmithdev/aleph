import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Answer } from "./build.ts";
import { createUpdater, DROP_MS, KEEP_MS, keyOf } from "./updater.ts";

/** A fake build: each key's answer and sources come from `world`, and every build is logged. */
function fake() {
  const world: Record<string, { body: unknown; sources: string[]; status?: number; fails?: string }> = {};
  const log: string[] = [];
  let gate: Promise<void> | null = null;
  let clock = 1_000_000;
  const build = async (key: string, gens: Record<string, number>) => {
    log.push(key);
    if (gate) await gate;
    const w = world[key];
    if (w.fails) throw Object.assign(new Error(w.fails), { sources: w.sources });
    return { answer: { status: w.status ?? 200, body: w.body } as Answer, sources: w.sources, gens };
  };
  return { world, log, build, now: () => clock, tick: (ms: number) => { clock += ms; }, hold: () => { let go = () => {}; gate = new Promise((r) => { go = r; }); return () => { gate = null; go(); }; } };
}

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "aleph-ui-updater-")); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("a key is its path and its non-empty query, sorted", () => {
  expect(keyOf(new URL("http://x/api/speed?window=week&baseline=1&project="))).toBe("/api/speed?baseline=1&window=week");
  expect(keyOf(new URL("http://x/api/state"))).toBe("/api/state");
});

test("a change builds the kept keys that read the source, and only then signals the keys whose answer changed", async () => {
  const f = fake(), u = createUpdater(f);
  f.world["/a"] = { body: 1, sources: ["records"] };
  f.world["/b"] = { body: 1, sources: ["langfuse"] };
  f.world["/c"] = { body: 1, sources: ["records"] };
  for (const k of ["/a", "/b", "/c"]) expect((await u.get(k)).answer.body).toBe(1);
  const heard: string[][] = [];
  u.onChange((keys) => heard.push(keys));
  f.world["/a"].body = 2; // /c reads the records too, but its answer stays the same
  const release = f.hold();
  u.changed("records");
  const flushing = u.flush();
  // The build runs: the old answer is served meanwhile, and no change has gone out.
  expect((await u.get("/a")).answer.body).toBe(1);
  expect(heard).toEqual([]);
  release();
  await flushing;
  expect(heard).toEqual([["/a"]]);
  expect((await u.get("/a")).answer.body).toBe(2);
  expect(f.log.filter((k) => k === "/b")).toHaveLength(1); // a key that does not read the records is not built again
});

test("every key reads the action source: a POST makes each key's next request wait for a build", async () => {
  const f = fake(), u = createUpdater(f);
  f.world["/a"] = { body: 1, sources: ["store"] };
  await u.get("/a");
  f.world["/a"].body = 2;
  u.changed("action");
  expect((await u.get("/a")).answer.body).toBe(2);
});

test("a key not asked for in 10 min is not built on a change, but its next request waits for a build; after 1 h it is dropped", async () => {
  const f = fake(), u = createUpdater({ ...f, file: () => join(dir, "drop.json") });
  f.world["/a"] = { body: 1, sources: ["records"] };
  await u.get("/a");
  f.tick(KEEP_MS);
  f.world["/a"].body = 2;
  u.changed("records");
  await u.flush();
  expect(f.log).toEqual(["/a"]);
  expect((await u.get("/a")).answer.body).toBe(2); // never an answer from before the change
  expect(f.log).toEqual(["/a", "/a"]);
  f.tick(DROP_MS);
  u.sweep();
  expect(JSON.parse(readFileSync(join(dir, "drop.json"), "utf8"))).toEqual({});
});

test("concurrent requests for a cold key share one build", async () => {
  const f = fake(), u = createUpdater(f);
  f.world["/a"] = { body: 1, sources: [] };
  const release = f.hold();
  const both = Promise.all([u.get("/a"), u.get("/a")]);
  release();
  await both;
  expect(f.log).toEqual(["/a"]);
});

test("a failed build keeps the last answer with its error and time, and a change goes out as the key enters and leaves that state", async () => {
  const f = fake(), u = createUpdater(f);
  f.world["/a"] = { body: { n: 1 }, sources: ["records"] };
  await u.get("/a");
  const heard: string[][] = [];
  u.onChange((keys) => heard.push(keys));
  f.world["/a"].fails = "disk on fire";
  u.changed("records");
  await u.flush();
  const got = await u.get("/a");
  expect(got).toMatchObject({ answer: { body: { n: 1 } }, error: "disk on fire", since: new Date(f.now()).toISOString() });
  f.world["/a"] = { body: { n: 1 }, sources: ["records"], status: 502 };
  u.changed("records");
  await u.flush();
  expect((await u.get("/a")).error).toBe("answered 502"); // a 5xx answer is a failure too, and keeps the first time
  delete f.world["/a"].status;
  u.changed("records");
  await u.flush();
  expect((await u.get("/a")).error).toBeUndefined();
  expect(heard).toEqual([["/a"], ["/a"]]);
});

test("a first build that fails answers 502 with the error, and the next request builds again", async () => {
  const f = fake(), u = createUpdater(f);
  f.world["/a"] = { body: null, sources: [], fails: "no Langfuse" };
  expect((await u.get("/a")).answer).toEqual({ status: 502, body: { error: "no Langfuse" } });
  f.world["/a"] = { body: 1, sources: [] };
  expect((await u.get("/a")).answer.body).toBe(1);
});

test("a Langfuse poll builds the kept keys that read it and signals only those whose answer changed; skills keys every fourth poll", async () => {
  const f = fake(), u = createUpdater(f);
  f.world["/s"] = { body: 1, sources: ["langfuse"] };
  f.world["/api/skills/x"] = { body: 1, sources: ["langfuse"] };
  f.world["/q"] = { body: 1, sources: ["records"] };
  for (const k of ["/s", "/api/skills/x", "/q"]) await u.get(k);
  const heard: string[][] = [];
  u.onChange((keys) => heard.push(keys));
  await u.poll();
  expect(heard).toEqual([]); // same answer, no change
  f.world["/s"].body = 2;
  f.world["/api/skills/x"].body = 2;
  await u.poll();
  await u.poll();
  expect(heard).toEqual([["/s"]]);
  await u.poll();
  expect(heard).toEqual([["/s"], ["/api/skills/x"]]);
  expect(f.log.filter((k) => k === "/q")).toHaveLength(1);
  expect(u.gens.langfuse).toBe(4);
});

test("a failed fetch of the work store marks the keys that read the store until a fetch works", async () => {
  const f = fake();
  let error: string | null = "could not resolve host";
  const u = createUpdater({ ...f, fetch: async () => error });
  f.world["/i"] = { body: { n: 1 }, sources: ["store"] };
  f.world["/r"] = { body: { n: 1 }, sources: ["records"] };
  await u.get("/i"); await u.get("/r");
  const heard: string[][] = [];
  u.onChange((keys) => heard.push(keys));
  await u.fetchStore();
  expect(await u.get("/i")).toMatchObject({ error: "could not resolve host" });
  expect((await u.get("/r")).error).toBeUndefined();
  error = null;
  await u.fetchStore();
  expect((await u.get("/i")).error).toBeUndefined();
  expect(heard).toEqual([["/i"], ["/i"]]);
});

test("the kept keys are saved, and a restart builds them at once: a request shares that build", async () => {
  const f = fake(), file = join(dir, "keys.json");
  const u = createUpdater({ ...f, file: () => file });
  f.world["/a"] = { body: 1, sources: [] };
  f.world["/b"] = { body: 1, sources: [] };
  await u.get("/a"); await u.get("/b");
  expect(Object.keys(JSON.parse(readFileSync(file, "utf8")))).toEqual(["/a", "/b"]);
  const g = fake();
  Object.assign(g.world, f.world);
  const v = createUpdater({ ...g, file: () => file });
  const release = g.hold();
  v.restore();
  expect(g.log).toEqual(["/a", "/b"]); // both started before any request
  const got = v.get("/a");
  release();
  expect((await got).answer.body).toBe(1);
  expect(g.log).toEqual(["/a", "/b"]);
});

test("a restart skips a saved key older than 1 h", () => {
  const f = fake(), file = join(dir, "old.json");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ "/old": f.now() - DROP_MS, "/new": f.now() }));
  f.world["/new"] = { body: 1, sources: [] };
  createUpdater({ ...f, file: () => file }).restore();
  expect(f.log).toEqual(["/new"]);
});

test("a change during a build builds the key once more, and the signal waits for that build", async () => {
  const f = fake(), u = createUpdater(f);
  f.world["/a"] = { body: 1, sources: ["records"] };
  await u.get("/a");
  const heard: string[][] = [];
  u.onChange((keys) => heard.push(keys));
  const release = f.hold();
  u.changed("records");
  const flushing = u.flush();
  f.world["/a"].body = 2; // written after the build read the sources
  u.changed("records");
  release();
  await flushing;
  expect(f.log).toEqual(["/a", "/a", "/a"]);
  expect(heard).toEqual([["/a"]]);
  expect((await u.get("/a")).answer.body).toBe(2);
});

test("while a build runs in the Worker, the server answers other routes: /api/projects/keys comes back before a slow /api/state", async () => {
  const { withEnv, withServer } = await import("./test-server.ts");
  const restore = withEnv({ ALEPH_STATE_SLOW_MS: "1500", ALEPH_FACTORY_DIR: join(dir, "factory"), ALEPH_JOBS_DIR: join(dir, "runs") });
  const { at, stop } = await withServer({ warm: false });
  try {
    const order: string[] = [];
    const state = at("/api/state").then((r) => { order.push("state"); return r; });
    const keys = at("/api/projects/keys").then((r) => { order.push("projects"); return r; });
    const [s, k] = await Promise.all([state, keys]);
    expect([s.status, k.status]).toEqual([200, 200]);
    expect(order).toEqual(["projects", "state"]);
    expect(s.headers.get("x-aleph-keys")).toBe("/api/state");
  } finally { stop(); restore(); }
});
