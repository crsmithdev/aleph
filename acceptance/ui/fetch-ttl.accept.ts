// Archived goal tests from ui/fetch-ttl.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { add } from "../../todo/lib/todo.ts";
import { cacheFetches, readList, readLists, uiFetchTtl, writeList } from "../../todo/lib/store.ts";
import { withEnv } from "../../ui/test-server.ts";
import { waitFor } from "../../tests/wait.ts";

let base: string, log: string, stale: string;
let restoreEnv: () => void;
const fetches = (): number => readFileSync(log, "utf8").split("\n").filter((l) => l === "fetch").length;
const doneCount = (): number => readFileSync(log, "utf8").split("\n").filter((l) => l === "done").length;
/** Wait until every fetch the shim has logged has ended. */
const settled = async (): Promise<void> => { await waitFor(() => doneCount() >= fetches(), { timeout: 10_000 }); };
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
  writeFileSync(log, "");
  mkdirSync(join(base, "bin"));
  writeFileSync(join(base, "bin", "git"), `#!/bin/sh\n[ "$1" = fetch ] && echo fetch >> ${log}\nif [ "$1" = fetch ]; then s=0; if [ -e ${stale} ]; then rm -f ${stale}; ${real} fetch "$2" stale "$4" || s=$?; else ${real} "$@" || s=$?; fi; echo done >> ${log}; exit $s; fi\nexec ${real} "$@"\n`);
  chmodSync(join(base, "bin", "git"), 0o755);
  writeFileSync(join(base, "repos.json"), JSON.stringify({ a: { path: join(base, "a"), sandbox: true }, b: { path: join(base, "b") } }));
  mkdirSync(join(base, "jobs"));
  for (const [repo, name] of [["a", "a-1"], ["b", "b-1"]]) {
    const folder = join(base, "jobs", `20261027-100000-${repo}-${name}-agent`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "state.json"), JSON.stringify({ kind: "build", condition: "running", started: new Date().toISOString(), name, job: name, repo, on: `${repo}-1` }));
  }
  restoreEnv = withEnv({ PATH: `${join(base, "bin")}:${process.env.PATH}`, ALEPH_ISSUES: items, ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_UI_FETCH_TTL: "30" });
  cacheFetches(uiFetchTtl());
});
afterAll(() => {
  cacheFetches(0);
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

test("with the cache off, as in the CLI, every read fetches", () => {
  cacheFetches(0);
  const before = fetches();
  readList({ key: "a" });
  readLists([{ key: "a" }, { key: "b" }]);
  expect(fetches()).toBe(before + 2);
  cacheFetches(uiFetchTtl());
});

test("with the cache on and warm, a write fetches synchronously once and a read right after fetches none", async () => {
  const now = spyOn(Date, "now");
  try {
    now.mockReturnValue(Date.now() + 4_000_000);
    await settled();
    const start = fetches();
    readList({ key: "a" });
    // The warm read past the TTL starts one fetch; wait for it to start and finish.
    await waitFor(() => fetches() >= start + 1, { timeout: 2000 });
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
