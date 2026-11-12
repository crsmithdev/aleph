import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { watch } from "node:fs";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { add } from "../issues/lib/todo.ts";
import { fetchStore, readFetched, readList, skipFetches, writeList } from "../issues/lib/store.ts";
import { routes } from "./api/issues.ts";
import { withEnv, withServer } from "./test-server.ts";
import { state } from "./state.ts";
import { putRun } from "../jobs/lib/records/record.ts";

let base: string, log: string, stale: string, staleRemote: string;
let restoreEnv: () => void;
const fetches = (): number => readFileSync(log, "utf8").split("\n").filter((l) => l === "fetch").length;
const doneCount = (): number => readFileSync(log, "utf8").split("\n").filter((l) => l === "done").length;
/** Resolves when `cond` holds, checked on each write to the shim's log: an event, not a timer. */
const reached = (cond: () => boolean): Promise<void> => new Promise((done) => {
  const w = watch(log, () => { if (cond()) { w.close(); done(); } });
  if (cond()) { w.close(); done(); }
});
/** Wait until every fetch the shim has logged has ended. */
const settled = (): Promise<void> => reached(() => doneCount() >= fetches());
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
  restoreEnv = withEnv({ PATH: `${join(base, "bin")}:${process.env.PATH}`, ALEPH_ISSUES: items, ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_FACTORY_DIR: join(base, "factory") });
  for (const [repo, name] of [["a", "a-1"], ["b", "b-1"]]) {
    const folder = join(base, "jobs", `20261027-100000-${repo}-${name}-agent`);
    mkdirSync(folder, { recursive: true });
    putRun(basename(join(folder)), { n: 1, kind: "build", condition: "running", started: "2026-10-27T10:00:00.000Z", name, job: name, repo, on: `${repo}-1` } as any);
  }
});
// Each test starts with fetches skipped, as in the UI: the preload turns them on again after every test.
beforeEach(() => skipFetches());
afterAll(() => {
  skipFetches(false);
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

test("with fetches skipped, as in the UI, no read and no request fetches the work store", async () => {
  await settled();
  const before = fetches();
  state();
  await routes["GET /api/issues"](new Request("http://x/api/issues"), {}, new URL("http://x/api/issues"));
  readList({ key: "a" });
  expect(fetches()).toBe(before);
});

test("a write fetches in the foreground even with fetches skipped, and builds on the fresh origin/main", async () => {
  const other = join(base, "other");
  sh(base, "git", "clone", "-q", join(base, "items.git"), other);
  writeList({ key: "a" }, "give a a list", (doc) => { add(doc, "one"); return true; }, true);
  await settled();
  const before = fetches();
  sh(other, "git", "pull", "-q", "origin", "main");
  sh(other, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "elsewhere");
  sh(other, "git", "push", "-q", "origin", "main");
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: other }).stdout.toString().trim();
  const w = writeList({ key: "a" }, "write", (doc) => { add(doc, "two"); return true; });
  expect(w).not.toBeNull();
  expect(fetches()).toBe(before + 1);
  const parent = Bun.spawnSync(["git", "rev-parse", `${w!.commit}^`], { cwd: join(base, "items") }).stdout.toString().trim();
  expect(parent).toBe(head);
});

test("serve() turns fetches off for its process: the updater fetches the store instead", async () => {
  skipFetches(false);
  const { stop } = await withServer({ warm: false });
  stop();
  const before = fetches();
  readList({ key: "a" });
  expect(fetches()).toBe(before);
});

test("fetchStore fetches without blocking and says why it failed", async () => {
  const before = fetches();
  expect(await fetchStore()).toBeNull();
  expect(fetches()).toBe(before + 1);
  const bad = join(base, "not-a-repo");
  mkdirSync(bad);
  expect(await fetchStore(bad)).toMatch(/not a git repository/);
});

test("a fetch that brings an older remote state cannot move origin/main back", async () => {
  const items = join(base, "items");
  // the remote as it is before the write: the older state the stale fetch will bring
  sh(base, "git", "clone", "-q", "--bare", join(base, "items.git"), staleRemote);
  sh(items, "git", "remote", "add", "stale", staleRemote);
  sh(items, "git", "config", "remote.stale.fetch", "+refs/heads/*:refs/remotes/origin/*");
  const w = writeList({ key: "a" }, "write after the snapshot", (doc) => { add(doc, "written"); return true; }, true);
  expect(w).not.toBeNull();
  writeFileSync(stale, "");
  await settled();
  await fetchStore();
  expect(Bun.spawnSync(["git", "rev-parse", "origin/main"], { cwd: items }).stdout.toString().trim()).toBe(w!.commit);
  expect(readFetched({ key: "a" })!.items.some((i) => i.title === "written")).toBe(true);
});
