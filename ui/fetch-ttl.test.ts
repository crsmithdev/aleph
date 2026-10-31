import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { add } from "../todo/lib/todo.ts";
import { cacheFetches, readFetched, readList, readLists, uiFetchTtl, writeList } from "../todo/lib/store.ts";
import { routes } from "./api/issues.ts";
import { serve } from "./server.ts";
import { state } from "./state.ts";

let base: string, log: string, stale: string, staleRemote: string;
const saved: Record<string, string | undefined> = {};
const fetches = (): number => readFileSync(log, "utf8").split("\n").filter((l) => l === "fetch").length;
const doneCount = (): number => readFileSync(log, "utf8").split("\n").filter((l) => l === "done").length;
/** Wait until every fetch the shim has logged has ended. */
const settled = async (): Promise<void> => { for (let i = 0; i < 500 && doneCount() < fetches(); i++) await Bun.sleep(20); };
const sh = (cwd: string, ...a: string[]) => { const p = Bun.spawnSync(a, { cwd }); if (p.exitCode) throw new Error(p.stderr.toString()); };

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-ttl-"));
  const remote = join(base, "items.git"), items = join(base, "items");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(base, "git", "clone", "-q", remote, items);
  sh(items, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "git", "push", "-q", "origin", "main");
  // a PATH shim that logs each `git fetch`, then `done` when it has ended. While the stale flag exists, the next fetch of `origin`
  // fetches the stale remote instead (its args are `fetch -q origin <ref>`).
  const real = Bun.spawnSync(["which", "git"]).stdout.toString().trim();
  log = join(base, "fetch.log");
  stale = join(base, "stale");
  staleRemote = join(base, "stale.git");
  writeFileSync(log, "");
  mkdirSync(join(base, "bin"));
  writeFileSync(join(base, "bin", "git"), `#!/bin/sh\n[ "$1" = fetch ] && echo fetch >> ${log}\nif [ "$1" = fetch ]; then s=0; if [ -e ${stale} ]; then rm -f ${stale}; ${real} fetch "$2" stale "$4" || s=$?; else ${real} "$@" || s=$?; fi; echo done >> ${log}; exit $s; fi\nexec ${real} "$@"\n`);
  chmodSync(join(base, "bin", "git"), 0o755);
  writeFileSync(join(base, "repos.json"), JSON.stringify({ a: { path: join(base, "a"), sandbox: true }, b: { path: join(base, "b") } }));
  mkdirSync(join(base, "jobs"));
  for (const [repo, name] of [["a", "a-1"], ["b", "b-1"]]) {
    const folder = join(base, "jobs", `20261027-100000-${repo}-${name}-agent`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "state.json"), JSON.stringify({ kind: "agent", state: "running", started: new Date().toISOString(), name, job: name, repo, todo: 1 }));
  }
  for (const [k, v] of Object.entries({ PATH: `${join(base, "bin")}:${process.env.PATH}`, ALEPH_ITEMS: items, ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_UI_FETCH_TTL: "30" })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  cacheFetches(uiFetchTtl());
});
afterAll(() => {
  cacheFetches(0);
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(base, { recursive: true, force: true });
});

test("the UI fetches the work store at most once per 30 s, across reads and requests, and only the first fetch waits", async () => {
  const t0 = Date.now() + 1_000_000;
  const now = spyOn(Date, "now");
  now.mockReturnValue(t0);
  const before = fetches();
  state();
  expect(fetches()).toBe(before + 1);
  now.mockReturnValue(t0 + 5_000);
  state();
  await routes["GET /api/issues"](new Request("http://x/api/issues"), {}, new URL("http://x/api/issues"));
  expect(fetches()).toBe(before + 1);
  now.mockReturnValue(t0 + 31_000);
  state();
  now.mockRestore();
  // After the first, a fetch runs in the background.
  for (let i = 0; i < 100 && fetches() < before + 2; i++) await Bun.sleep(20);
  expect(fetches()).toBe(before + 2);
});

test("with the cache off, as in the CLI, every read fetches", () => {
  cacheFetches(0);
  const before = fetches();
  readList({ key: "a" });
  readLists([{ key: "a" }, { key: "b" }]);
  expect(fetches()).toBe(before + 2);
  cacheFetches(uiFetchTtl());
});

test("a write fetches in the foreground even with the cache on, and builds on the fresh origin/main", async () => {
  cacheFetches(uiFetchTtl());
  const other = join(base, "other");
  sh(base, "git", "clone", "-q", join(base, "items.git"), other);
  writeList({ key: "a" }, "give a a list", (doc) => { add(doc, "one"); return true; }, true);
  const t0 = Date.now() + 2_000_000;
  const now = spyOn(Date, "now");
  now.mockReturnValue(t0);
  try {
    // The background fetch of the test before can still be open; let it end before this test counts.
    await settled();
    const before = fetches();
    readList({ key: "a" });
    // The read past the TTL starts one background fetch; its log line can come late under load.
    for (let i = 0; i < 100 && fetches() < before + 1; i++) await Bun.sleep(20);
    expect(fetches()).toBe(before + 1);
    await settled();
    readList({ key: "a" });
    expect(fetches()).toBe(before + 1);
    sh(other, "git", "pull", "-q", "origin", "main");
    sh(other, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "elsewhere");
    sh(other, "git", "push", "-q", "origin", "main");
    const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: other }).stdout.toString().trim();
    const w = writeList({ key: "a" }, "write", (doc) => { add(doc, "two"); return true; });
    expect(w).not.toBeNull();
    expect(fetches()).toBe(before + 2);
    const parent = Bun.spawnSync(["git", "rev-parse", `${w!.commit}^`], { cwd: join(base, "items") }).stdout.toString().trim();
    expect(parent).toBe(head);
    readList({ key: "a" });
    expect(fetches()).toBe(before + 2);
  } finally { now.mockRestore(); }
});

test("with the cache on and warm, a write fetches synchronously once and a read right after fetches none", async () => {
  const now = spyOn(Date, "now");
  try {
    now.mockReturnValue(Date.now() + 4_000_000);
    await settled();
    const start = fetches();
    readList({ key: "a" });
    // The warm read past the TTL starts one fetch; wait for it to start and finish.
    for (let i = 0; i < 100 && fetches() < start + 1; i++) await Bun.sleep(20);
    expect(fetches()).toBe(start + 1);
    await settled();
    const before = fetches();
    writeList({ key: "a" }, "ttl write", () => true, true);
    expect(fetches()).toBe(before + 1);
    readList({ key: "a" });
    expect(fetches()).toBe(before + 1);
  } finally {
    now.mockRestore();
  }
});

test("serve() leaves the cache off: only the UI process turns it on, in its main block", async () => {
  cacheFetches(0);
  const server = await serve(0, { warm: false });
  server.stop();
  const before = fetches();
  readList({ key: "a" });
  readList({ key: "a" });
  expect(fetches()).toBe(before + 2);
  cacheFetches(uiFetchTtl());
});

test("a background fetch that brings an older remote state cannot move origin/main back", async () => {
  cacheFetches(uiFetchTtl());
  const items = join(base, "items");
  // the remote as it is before the write: the older state the stale fetch will bring
  sh(base, "git", "clone", "-q", "--bare", join(base, "items.git"), staleRemote);
  sh(items, "git", "remote", "add", "stale", staleRemote);
  sh(items, "git", "config", "remote.stale.fetch", "+refs/heads/*:refs/remotes/origin/*");
  const w = writeList({ key: "a" }, "write after the snapshot", (doc) => { add(doc, "written"); return true; });
  expect(w).not.toBeNull();
  const now = spyOn(Date, "now");
  now.mockReturnValue(Date.now() + 60_000);
  writeFileSync(stale, "");
  await settled();
  const dones = doneCount();
  try { readList({ key: "a" }); } finally { now.mockRestore(); }
  for (let i = 0; i < 100 && doneCount() <= dones; i++) await Bun.sleep(20);
  expect(doneCount()).toBeGreaterThan(dones);
  expect(Bun.spawnSync(["git", "rev-parse", "origin/main"], { cwd: items }).stdout.toString().trim()).toBe(w!.commit);
  expect(readFetched({ key: "a" })!.items.some((i) => i.title === "written")).toBe(true);
});

test("with the cache on and warm, a write builds on origin/main as another clone just moved it", () => {
  cacheFetches(uiFetchTtl());
  if (!readList({ key: "a" })) {
    writeList({ key: "a" }, "give a a list", (doc) => { add(doc, "one"); return true; }, true);
    expect(readList({ key: "a" })).not.toBeNull();
  }
  const rev = (cwd: string, r: string): string => Bun.spawnSync(["git", "rev-parse", r], { cwd }).stdout.toString().trim();
  const items = join(base, "items"), pusher = join(base, "pusher");
  sh(base, "git", "clone", "-q", join(base, "items.git"), pusher);
  writeFileSync(join(pusher, "elsewhere.txt"), "pushed inside the TTL\n");
  sh(pusher, "git", "add", "elsewhere.txt");
  sh(pusher, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "elsewhere");
  sh(pusher, "git", "push", "-q", "origin", "main");
  const pushed = rev(pusher, "HEAD");
  const w = writeList({ key: "a" }, "write over a moved origin", (doc) => { add(doc, "two"); return true; });
  expect(w).not.toBeNull();
  expect(rev(items, "origin/main^")).toBe(pushed);
  expect(rev(items, "origin/main")).not.toBe(pushed);
  expect(rev(items, "origin/main")).toBe(w!.commit);
});
