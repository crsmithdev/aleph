import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../../../lib/git.ts";
import * as store from "../../../lib/store.ts";
import { type Repo, type Run } from "../records/ledger.ts";
import { allRuns } from "../records/record.ts";
import { runFile } from "../records/run-files.ts";
import { seed } from "../../job.testkit.ts";
import { reviewer } from "./review.ts";

let root = "";
let repo: Repo;
let folder = "", id = "", run: Run;
const saved = { ALEPH_ITEMS: process.env.ALEPH_ITEMS, ALEPH_RULE_CMD: process.env.ALEPH_RULE_CMD, GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL, GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL, ALEPH_JOBS_DIR: process.env.ALEPH_JOBS_DIR, ALEPH_DB: process.env.ALEPH_DB, ALEPH_REVIEWER_CMD: process.env.ALEPH_REVIEWER_CMD };
const commit = (path: string, file: string, text: string, msg: string) => {
  writeFileSync(join(path, file), text);
  git(path, "add", "."); git(path, "commit", "-qm", msg);
};
/** A fake reviewer whose reply's structured output is `verdict`. */
const fake = (verdict: object) => {
  const path = join(root, "reviewer");
  writeFileSync(path, `#!/bin/sh\ncat > /dev/null\necho '${JSON.stringify({ type: "result", is_error: false, result: "", structured_output: verdict })}'\n`, { mode: 0o755 });
  process.env.ALEPH_REVIEWER_CMD = path;
};
/** The reviewer on `work` from `base`, and its review job. */
const review = async (r: Run, base: string) => {
  const call = await reviewer(() => {})(folder, r, repo, base, "work", [], ["job.txt"], {});
  return { call, job: allRuns().findLast((e) => e.run.role === "review")! };
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "review-"));
  const path = join(root, "repo");
  mkdirSync(path);
  git(path, "init", "-q", "-b", "main");
  git(path, "config", "user.email", "a@b.c");
  git(path, "config", "user.name", "a");
  commit(path, "a.txt", "1\n", "one");
  git(path, "switch", "-q", "-c", "work");
  commit(path, "job.txt", "the job's change\n", "job");
  git(path, "switch", "-q", "main");
  repo = { key: "r", path, main: "main", setup: [], checks: [], manual: [], autoland: true, sandbox: true, held: [] } as unknown as Repo;
  process.env.ALEPH_JOBS_DIR = join(root, "jobs");
  process.env.ALEPH_DB = join(root, "aleph.db");
  ({ folder, id, run } = seed({ role: "build", name: "j1", state: "running" }));
  writeFileSync(runFile(folder, "spec.md"), "## Goal\nx\n");
  fake({ verdict: "pass", summary: "fine", failures: [] });
  // An items store of its own; the title writer's model fails, so a follow-up gets cutTitle's title.
  const bare = join(root, "items.git");
  git(root, "init", "-q", "--bare", "-b", "main", bare);
  git(root, "clone", "-q", bare, join(root, "items"));
  git(join(root, "items"), "commit", "-q", "--allow-empty", "-m", "start");
  git(join(root, "items"), "push", "-q", "origin", "main");
  Object.assign(process.env, { ALEPH_ITEMS: join(root, "items"), ALEPH_RULE_CMD: "false", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

test("a merge run's reviewer reads only how the merge commit resolved its conflict; another run reads the whole branch", async () => {
  const path = repo.path;
  commit(path, "main.txt", "main's change\n", "main moves");
  commit(path, "shared.txt", "main's line\n", "main edits shared");
  git(path, "switch", "-q", "work");
  commit(path, "shared.txt", "the job's line\n", "work edits shared");
  git(path, "merge", "-q", "--no-edit", "main");
  writeFileSync(join(path, "shared.txt"), "both lines, resolved\n");
  git(path, "add", "shared.txt");
  git(path, "commit", "-q", "--no-edit");
  git(path, "switch", "-q", "main");
  const base = git(path, "merge-base", "main", "work").out;
  const merge = readFileSync(runFile((await review({ ...run, merge: true }, base)).job.folder, "prompt.md"), "utf8");
  expect(merge).toContain("## The merge commit's conflict resolution");
  expect(merge).toContain("+both lines, resolved");
  expect(merge).not.toContain("main's change");
  const whole = readFileSync(runFile((await review(run, base)).job.folder, "prompt.md"), "utf8");
  expect(whole).toContain("## Diff from the merge base");
  expect(whole).toContain("+the job's change");
});

test("a hold is the reason to hold, and the review job that follows the build ends done", async () => {
  fake({ verdict: "hold", summary: "no test", failures: [{ clause: "a test fails without the fix", observed: "none" }] });
  const { call, job } = await review(run, git(repo.path, "rev-parse", "main").out);
  expect(call.reason).toBe("reviewer: a test fails without the fix");
  expect(job.run).toMatchObject({ prev: id, state: "done", told: false });
  expect(readFileSync(runFile(job.folder, "review.json"), "utf8")).toContain('"verdict":"hold"');
});

test("a reply with no verdict holds the run, and its review job ends failed", async () => {
  fake({ verdict: "maybe" });
  const { call, job } = await review(run, git(repo.path, "rev-parse", "main").out);
  expect(call).toMatchObject({ reason: 'reviewer: no verdict (unknown verdict "maybe")', none: true });
  expect(job.run).toMatchObject({ state: "failed", reason: 'unknown verdict "maybe"' });
});

const minor = { title: "Rename the loose helper in a.ts", location: "a.ts:3", saw: "a wording nit", why: "it reads wrong", impact: 1, risk: 1, effort: 1 };
const filed = () => store.readList(repo)?.items ?? [];

test("a pass files its follow-up as one parked worker task that names the review job; no follow-up, or a hold, files none", async () => {
  const main = git(repo.path, "rev-parse", "main").out;
  await review(run, main);
  fake({ verdict: "hold", summary: "no", failures: [{ clause: "c", observed: "o" }], followups: [minor] });
  expect((await review(run, main)).call.reason).toBe("reviewer: c");
  expect(filed()).toHaveLength(0);
  fake({ verdict: "pass", summary: "fine", failures: [], followups: [minor] });
  const { call, job } = await review(run, main);
  expect(call.reason).toBeNull();
  expect(filed()).toHaveLength(1);
  expect(filed()[0]).toMatchObject({ fm: { kind: "task", source: "worker", parked: "true" } });
  expect(filed()[0].request).toContain(`the reviewer found in review ${job.id}`);
});
