import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { add } from "../todo/lib/todo.ts";
import { cacheFetches, readList, readLists, uiFetchTtl, writeList } from "../todo/lib/store.ts";
import { routes } from "./api/issues.ts";
import { state } from "./state.ts";

let base: string, log: string;
const saved: Record<string, string | undefined> = {};
const fetches = (): number => readFileSync(log, "utf8").split("\n").filter(Boolean).length;
const sh = (cwd: string, ...a: string[]) => { const p = Bun.spawnSync(a, { cwd }); if (p.exitCode) throw new Error(p.stderr.toString()); };

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-ttl-"));
  const remote = join(base, "items.git"), items = join(base, "items");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(base, "git", "clone", "-q", remote, items);
  sh(items, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "git", "push", "-q", "origin", "main");
  // a PATH shim that logs each `git fetch`
  const real = Bun.spawnSync(["which", "git"]).stdout.toString().trim();
  log = join(base, "fetch.log");
  writeFileSync(log, "");
  mkdirSync(join(base, "bin"));
  writeFileSync(join(base, "bin", "git"), `#!/bin/sh\n[ "$1" = fetch ] && echo fetch >> ${log}\nexec ${real} "$@"\n`);
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

test("a write fetches in the foreground even with the cache on, and builds on the fresh origin/main", () => {
  cacheFetches(uiFetchTtl());
  const other = join(base, "other");
  sh(base, "git", "clone", "-q", join(base, "items.git"), other);
  writeList({ key: "a" }, "give a a list", (doc) => { add(doc, "one"); return true; }, true);
  const t0 = Date.now() + 2_000_000;
  const now = spyOn(Date, "now");
  now.mockReturnValue(t0);
  try {
    const before = fetches();
    readList({ key: "a" });
    expect(fetches()).toBe(before + 1);
    readList({ key: "a" });
    expect(fetches()).toBe(before + 1);
    sh(other, "git", "pull", "-q", "origin", "main");
    sh(other, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "elsewhere");
    sh(other, "git", "push", "-q", "origin", "main");
    const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: other }).stdout.toString().trim();
    const w = writeList({ key: "a" }, "write", () => true);
    expect(w).not.toBeNull();
    expect(fetches()).toBe(before + 2);
    const parent = Bun.spawnSync(["git", "rev-parse", `${w!.commit}^`], { cwd: join(base, "items") }).stdout.toString().trim();
    expect(parent).toBe(head);
    readList({ key: "a" });
    expect(fetches()).toBe(before + 2);
  } finally { now.mockRestore(); }
});
