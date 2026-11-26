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

let base: string, hk: string, server: TestServer, stop: () => void, restoreEnv: () => void;

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
  // A housekeeper's change of an issue, made under its own run's id.
  hk = makeJob({ role: "housekeeper", name: "housekeeper", state: "done", reason: "parked: 1 changed" }).id;
  logEvent({ time: at(1), subject: hk, action: "changed", object: "issue.1", detail: "note: x" });
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

const log = async (query = "") => (await fetch(`http://127.0.0.1:${server.port}/api/log${query}`)).json() as Promise<{ rows: any[]; total: number; next: number | null; prev: number | null; from: number }>;

test("serves one event a row, newest first, 25 a page by cursor, without the quiet events", async () => {
  const all = await log();
  expect([all.total, all.rows.length, all.from, all.prev, all.next]).toEqual([66, 25, 1, null, all.rows[24].seq]);
  expect(all.rows.find((r) => r.action === "landed")).toMatchObject({ issue: { id: expect.any(String), to: expect.stringContaining("#/issues/p/1") }, title: "Fix the pager", job: null });
  const two = await log(`?before=${all.next}`);
  expect([two.rows.length, two.from, two.prev, two.rows[0].seq]).toEqual([25, 26, 0, all.rows[24].seq - 1]);
  const last = await log(`?before=${two.next}`);
  expect([last.rows.length, last.from, last.prev, last.next]).toEqual([16, 51, all.rows[24].seq, null]);
  expect(last.rows.map((r) => r.action).slice(-2)).toEqual(["failed", "held"]);
  expect((await log("?before=0")).rows).toEqual(all.rows);
  expect((await fetch(`http://127.0.0.1:${server.port}/api/log?before=soon`)).status).toBe(400);
});

test("gives a job with no issue its name less role and date, and its reason's head word, as keys, the rest as title", async () => {
  expect((await log()).rows.slice(0, 2).map((r) => [r.keys, r.title])).toEqual([[["pass"], "a run backs it"], [["dedupe", "dry"], "5 resolved"]]);
  expect((await log("?q=dedupe")).total).toBe(1);
  expect((await log("?q=pass")).total).toBe(1);
});

test("keeps the rows whose id or title holds the search", async () => {
  expect((await log("?q=PAGER")).total).toBe(63);
  expect((await log("?q=nothing")).total).toBe(0);
});

test("puts an event a job makes in that job's run, and any other in its issue's, else its job's", async () => {
  const one = await log(), two = await log(`?before=${one.next}`), rows = one.rows.concat(two.rows, (await log(`?before=${two.next}`)).rows);
  expect(rows.filter((r) => r.run === hk).map((r) => r.action).sort()).toEqual(["changed", "done"]);
  expect(rows.find((r) => r.action === "landed").run).toBe("issue.1");
});

// Last in the file: the new event stays.
test("a page by cursor holds its rows when a new event arrives above it", async () => {
  const one = await log(), two = await log(`?before=${one.next}`);
  logEvent({ time: new Date(NOW).toISOString(), subject: "gate", action: "failed", object: "issue.1", detail: "y" });
  const again = await log(`?before=${one.next}`);
  expect(again.rows.map((r) => r.seq)).toEqual(two.rows.map((r) => r.seq));
  expect([again.from, again.total]).toEqual([27, 67]);
});
