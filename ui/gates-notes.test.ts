import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../lib/store.ts";
import { add, note } from "../lib/todo.ts";
import { gatesBody, securityFacts } from "./api/gates.ts";
import { withEnv } from "./server.testkit.ts";
import { writeRepos } from "../tests/projects.testkit.ts";

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
  writeRepos({ fac: { path: repo, sandbox: true } }, items);
  restoreEnv = withEnv({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_DB: join(base, "aleph.db"), ALEPH_ITEMS: items, ALEPH_FACTORY_DIR: factory, ...gitEnv });
  writeList({ key: "fac" }, "seed", (doc) => { const it = add(doc, "a task"); note(it, "Chris dropped: not needed"); note(add(doc, "b task"), "Chris decided: go on", new Date("2026-11-03T10:00:00Z")); add(doc, "c task").notes.push("- 2026-11-03 11:00: Chris decided: stop"); note(add(doc, "d task"), "Chris declined: the claim stays", new Date("2026-11-03T12:00:00Z")); return true; }, true);
});
// The test's clock: the notes sit a day before it, inside the 7-day log.
beforeAll(() => setSystemTime(Date.parse("2026-11-04T00:00:00Z")));
afterAll(() => { setSystemTime(); restoreEnv(); rmSync(base, { recursive: true, force: true }); });

test("log() shows an issue note `Chris dropped: <reason>` as a human drop on the issue, the note its text", async () => {
  const d: any = JSON.parse(JSON.stringify(gatesBody(await securityFacts())));
  expect(d.log.entries.find((x: any) => x.subject === "human" && x.object === "fac-1")).toMatchObject({ action: "dropped", detail: "Chris dropped: not needed" });
});

test("log() finds a Chris decision note with an ISO UTC stamp, and not one with a local stamp", async () => {
  const d: any = JSON.parse(JSON.stringify(gatesBody(await securityFacts())));
  expect(d.log.entries.find((x: any) => x.object === "fac-2")).toMatchObject({ time: "2026-11-03T10:00:00.000Z", action: "answered", detail: "Chris decided: go on" });
  expect(d.log.entries.find((x: any) => x.object === "fac-3")).toBeUndefined();
});

test("log() shows a declined core change `Chris declined: <why>` as a human drop on the issue, the note its text", async () => {
  const d: any = JSON.parse(JSON.stringify(gatesBody(await securityFacts())));
  expect(d.log.entries.find((x: any) => x.subject === "human" && x.object === "fac-4")).toMatchObject({ action: "dropped", detail: "Chris declined: the claim stays" });
});
