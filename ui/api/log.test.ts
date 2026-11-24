import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer, type TestServer } from "../server.testkit.ts";
import { newItems, writeRepos } from "../../tests/projects.testkit.ts";
import { writeList } from "../../lib/store.ts";
import { add } from "../../lib/issue-file.ts";
import { logEvent } from "../../lib/layout.ts";
import { makeJob } from "../../jobs/lib/records/record.ts";

let base: string, server: TestServer, stop: () => void, restoreEnv: () => void;

/** The fixed time of the file: the route reads its window back from now. */
const NOW = Date.UTC(2026, 10, 1, 8);

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-log-"));
  for (const d of ["runs", "factory"]) mkdirSync(join(base, d), { recursive: true });
  newItems(base, "issues");
  writeRepos({ p: { path: join(base, "p") } }, join(base, "issues"));
  restoreEnv = withEnv({ ALEPH_JOBS_DIR: join(base, "runs"), ALEPH_DB: join(base, "aleph.db"), ALEPH_ITEMS: join(base, "issues"), ALEPH_FACTORY_DIR: join(base, "factory") });
  writeList({ key: "p" }, "seed", (doc) => { add(doc, "Fix the pager"); return true; }, true);
  setSystemTime(new Date(NOW));
  const at = (m: number) => new Date(NOW - m * 60_000).toISOString();
  // Oldest first: the rule's start and the hold on the issue's own job say nothing the log keeps.
  logEvent({ time: at(9), subject: "rule", action: "started", object: "issue.1" });
  logEvent({ time: at(8), subject: "gate", action: "held", object: "issue.1", detail: "job: job.4" });
  logEvent({ time: at(7), subject: "gate", action: "held", object: "issue.1", detail: "file: a.ts: job.4" });
  logEvent({ time: at(6), subject: "gate", action: "failed", object: "issue.1", detail: "x" });
  for (let i = 0; i < 60; i++) logEvent({ time: at(5 - i / 100), subject: "gate", action: "landed", object: "issue.1" });
  // Two jobs with no issue: one named for its task, one named for its role.
  for (const [role, name, reason] of [["maintainer", "dedupe-2026-11-01", "dry: 5 resolved"], ["judge", "judge", "pass: a run backs it"]] as const) makeJob({ role, name, state: "done", reason });
  ({ server, stop } = await withServer({ warm: false }));
});

afterAll(() => {
  setSystemTime();
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

const log = async (query = "") => (await fetch(`http://127.0.0.1:${server.port}/api/log${query}`)).json() as Promise<{ rows: any[]; total: number }>;

test("serves one event a row, newest first, 25 a page, without the quiet events", async () => {
  const all = await log();
  expect(all.total).toBe(64);
  expect(all.rows).toHaveLength(25);
  expect(all.rows.find((r) => r.issue)).toMatchObject({ action: "landed", issue: { id: expect.any(String), to: expect.stringContaining("#/issues/p/1") }, title: "Fix the pager", job: null });
  expect((await log("?page=2")).rows).toHaveLength(25);
  const last = await log("?page=3");
  expect(last.rows).toHaveLength(14);
  expect(last.rows.map((r) => r.action).slice(-2)).toEqual(["failed", "held"]);
});

test("titles a job with no issue by its name, unless it repeats the role, then its reason", async () => {
  expect((await log()).rows.slice(0, 2).map((r) => r.title)).toEqual(["pass: a run backs it", "dedupe-2026-11-01: dry: 5 resolved"]);
  expect((await log("?q=dedupe")).total).toBe(1);
});

test("keeps one kind, and the rows whose id or title holds the search", async () => {
  expect((await log("?kind=problem")).rows.map((r) => r.action)).toEqual(["failed"]);
  expect((await log("?kind=hold")).total).toBe(1);
  expect((await log("?q=PAGER")).total).toBe(62);
  expect((await log("?q=nothing")).total).toBe(0);
});
