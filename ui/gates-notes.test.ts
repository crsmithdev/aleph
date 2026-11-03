import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../todo/lib/store.ts";
import { add, note } from "../todo/lib/todo.ts";
import { gatesBody, securityFacts } from "./api/gates.ts";
import { withEnv } from "./test-server.ts";

// Its own git issue store and sandbox repo, set up as ui/issues.test.ts does; ui/gates.test.ts may have neither.
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base: string, restoreEnv: () => void;
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-gates-notes-"));
  const itemsRemote = join(base, "items.git"), items = join(base, "items");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", itemsRemote);
  sh(base, "git", "clone", "-q", itemsRemote, items);
  sh(items, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "git", "push", "-q", "origin", "main");
  const repo = join(base, "fac-repo");
  mkdirSync(repo);
  const factory = join(base, "factory");
  mkdirSync(factory);
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: repo, sandbox: true } }));
  restoreEnv = withEnv({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: items, ALEPH_FACTORY_DIR: factory, ALEPH_SANDBOX_DIR: join(base, "sandbox"), ...gitEnv });
  writeList({ key: "fac" }, "seed", (doc) => { const it = add(doc, "a task"); note(it, "Chris dropped: not needed"); return true; }, true);
});
afterAll(() => { restoreEnv(); rmSync(base, { recursive: true, force: true }); });

test("log() shows an issue note `Chris dropped: <reason>` as a You entry on the issue", async () => {
  const stub: any = { now: new Date().toISOString(), asks: [], factory: { paused: false, hold: null, probe: null, liveRuns: 0, liveCap: 5, runsToday: 0, dayCap: 12, awaitingCap: 5 } };
  const d: any = JSON.parse(JSON.stringify(gatesBody(stub, await securityFacts())));
  expect(d.log.entries.find((x: any) => x.by === "You" && x.item === "fac-1")).toMatchObject({ what: "Chris dropped: not needed" });
});
