// Archived goal tests from ui/state-load.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { add } from "../../todo/lib/todo.ts";
import { writeList } from "../../todo/lib/store.ts";
import { withEnv, withServer } from "../../ui/test-server.ts";
import { stateBuilds } from "../../ui/state-load.ts";
import { waitFor } from "../../tests/wait.ts";

// /api/state is built in a worker (ui/state-load.ts). ALEPH_STATE_SLOW_MS makes each build sleep that long first, so the
// assertions on the timer, the shared builds and the fresh state hold whatever the machine's speed.
const SLOW = 800;

let base: string, jobs: string, stop: () => void, restoreEnv: () => void, at: (path: string) => Promise<Response>;
const ident = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const sh = (cwd: string, ...a: string[]) => { const p = Bun.spawnSync(a, { cwd, env: { ...process.env, ...ident } }); if (p.exitCode) throw new Error(p.stderr.toString()); };
const get = (p = "/api/state") => at(p);
const names = (body: any): string[] => body.running.map((j: any) => j.name).sort();

let seq = 0;
function writeRun(name: string): void {
  const folder = join(jobs, `20261031-1000${String(seq++).padStart(2, "0")}-demo-${name}-agent`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "state.json"), JSON.stringify({ kind: "build", condition: "running", started: new Date().toISOString(), name, job: name, repo: "demo", on: name }));
}

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-state-load-"));
  jobs = join(base, "jobs");
  const repo = join(base, "demo"), remote = join(base, "items.git"), items = join(base, "items");
  sh(base, "git", "init", "-q", "-b", "main", repo);
  sh(repo, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(repo, "git", "update-ref", "refs/remotes/origin/main", "HEAD");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(base, "git", "clone", "-q", remote, items);
  sh(items, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "git", "push", "-q", "origin", "main");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ demo: { path: repo, main: "main", sandbox: true, checks: [] } }));
  restoreEnv = withEnv({ ...ident, ALEPH_JOBS_DIR: jobs, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: items, ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_STATE_SLOW_MS: String(SLOW) });
  writeList({ key: "demo" }, "fixture", (doc) => { add(doc, "a goal", { request: "## Goal\nx" }); return true; }, true);
  writeRun("demo-1");
  ({ stop, at } = await withServer({ warm: false }));
});

afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

test("a timer in the server keeps firing while /api/state builds", async () => {
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 10);
  const t0 = performance.now();
  const res = await get();
  const took = performance.now() - t0;
  clearInterval(timer);
  expect(res.status).toBe(200);
  expect(names(await res.json())).toContain("demo-1");
  // The build slept SLOW ms, and the timer ticked during it. A build on this thread would let at most one tick
  // through, since a late interval fires once. A count, not the largest gap: another test file in this process
  // may block the thread for a while, and only a block of nearly the whole build drops the count under 3.
  expect(took).toBeGreaterThanOrEqual(SLOW);
  expect(ticks).toBeGreaterThanOrEqual(3);
}, 20_000);

test("requests that arrive during a build share the next one", async () => {
  const before = stateBuilds();
  const first = get();
  // The first request's build has started: the five below come during it.
  await waitFor(() => stateBuilds() > before);
  const rest = await Promise.all(Array.from({ length: 5 }, () => get()));
  const firstBuild = (await first).headers.get("x-aleph-state-build");
  const restBuilds = new Set(rest.map((r) => r.headers.get("x-aleph-state-build")));
  expect(rest.every((r) => r.status === 200)).toBe(true);
  // The five came during the first build: they all got the one build after it.
  expect(restBuilds.size).toBe(1);
  expect([...restBuilds][0]).not.toBe(firstBuild);
  expect(stateBuilds() - before).toBe(2);
}, 20_000);

test("a request that starts after a ledger write returns that write, even while an older build runs", async () => {
  writeRun("demo-2");
  expect(names(await (await get()).json())).toContain("demo-2");
  // A build starts before the write; the request after the write does not get it.
  const built = stateBuilds();
  const older = get();
  await waitFor(() => stateBuilds() > built);
  writeRun("demo-3");
  const after = await (await get()).json();
  expect(names(after)).toContain("demo-3");
  expect((await older).status).toBe(200);
}, 20_000);
