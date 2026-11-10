import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACTIONS } from "../../../lib/naming.ts";
import { eventsDir } from "../../../lib/layout.ts";
import { markFile, migrateWords } from "./migrate.ts";
import { archiveDir, recordsDir } from "./record.ts";

const KEYS = ["ALEPH_RECORDS_DIR", "ALEPH_JOBS_DIR", "ALEPH_FACTORY_DIR", "XDG_RUNTIME_DIR"] as const;
const saved = KEYS.map((k) => process.env[k]);
let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-migrate-"));
  process.env.ALEPH_RECORDS_DIR = join(base, "records");
  process.env.ALEPH_JOBS_DIR = join(base, "runs");
  process.env.ALEPH_FACTORY_DIR = join(base, "factory");
  process.env.XDG_RUNTIME_DIR = join(base, "run");
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  KEYS.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i])));
});

const AT = "2026-10-20T10:00:00.000Z";
const run = (id: string, o: Record<string, unknown>) => ({ id, kind: "build", job: "j", name: "aleph-5", repo: "aleph", on: "aleph-5", condition: "done", told: true, started: AT, ...o });
const put = (dir: string, issue: string, runs: unknown[], events: unknown[] = []) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${issue}.json`), JSON.stringify({ issue, ask: null, wait: null, rounds: 0, cost: 0, runs, events }, null, 1) + "\n");
};
const read = (dir: string, issue: string) => JSON.parse(readFileSync(join(dir, `${issue}.json`), "utf8"));
/** Every file the migration may write, by path, with its text. */
const files = () => Object.fromEntries([recordsDir(), archiveDir(), eventsDir()].flatMap((d) => readdirSync(d).map((f) => [join(d, f), readFileSync(join(d, f), "utf8")])));

test("the migration rewrites the records, the archive and the event log into new words once, and a second run changes no byte", () => {
  put(recordsDir(), "aleph-5", [
    run("20261020-1", { condition: "awaiting" }),
    run("20261020-2", { condition: "stuck", failed: "review", cause: "reviewer", n: 2 }),
    run("20261020-3", { condition: "stuck", cause: "time-box" }),
    run("20261020-4", { kind: "agent", condition: "passed", review: { call: "back", reason: "no" } }),
    run("20261020-5", { condition: "needs-you" }),
    run("20261020-6", { condition: "stuck", reason: "time box" }),
    run("20261020-7", { condition: "passed" }),
  ], [{ at: AT, kind: "hold", what: "after aleph-5", data: { gate: "after" } }]);
  mkdirSync(join(base, "runs", "20261020-7"), { recursive: true });
  writeFileSync(join(base, "runs", "20261020-7", "call.md"), "Merged and checked.\nVERDICT: land\n");
  put(archiveDir(), "aleph-6", [run("20261019-1", { on: "aleph-6", name: "aleph-6", condition: "stuck", failed: "tests", reason: "tests failed" })]);
  mkdirSync(eventsDir(), { recursive: true });
  const kept = JSON.stringify({ at: AT, by: "gate", subject: "aleph-5", action: "landed" });
  writeFileSync(join(eventsDir(), "2026-10-20.jsonl"), `${kept}\n${JSON.stringify({ at: AT, by: "rule", subject: "aleph-5", action: "" })}\n${JSON.stringify({ at: AT, by: "human", subject: "aleph-5", action: "land" })}\n`);

  expect(migrateWords()).toBe(true);
  const runs = read(recordsDir(), "aleph-5").runs;
  expect(runs.map((x: any) => x.condition)).toEqual(["waiting", "returned", "failed", "passed", "waiting", "failed", "passed"]);
  expect(runs.map((x: any) => x.cause)).toEqual([undefined, "review", "timeout", undefined, undefined, "timeout", undefined]);
  expect(runs[3]).toMatchObject({ kind: "build", review: { call: "returned", reason: "no" } });
  expect(runs[6].review).toEqual({ call: "passed" });
  // The stored 2 stays, and the others take the free numbers in start order.
  expect(runs.map((x: any) => x.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(read(recordsDir(), "aleph-5").events[0].data.event).toEqual({ at: AT, by: "gate", subject: "aleph-5", action: "after", on: ["aleph-5"] });
  expect(read(archiveDir(), "aleph-6").runs[0]).toMatchObject({ condition: "returned", cause: "check", checkName: "tests", n: 1 });
  const lines = readFileSync(join(eventsDir(), "2026-10-20.jsonl"), "utf8").trim().split("\n");
  expect(lines[0]).toBe(kept);
  expect(lines.map((l) => JSON.parse(l)).map(({ action, note }) => ({ action, note }))).toEqual([
    { action: "landed", note: undefined }, { action: "changed", note: undefined }, { action: "landed", note: "land" },
  ]);
  for (const l of lines) expect(ACTIONS).toContain(JSON.parse(l).action);
  expect(existsSync(markFile())).toBe(true);

  const before = files();
  expect(migrateWords()).toBe(false);
  rmSync(markFile());
  expect(migrateWords()).toBe(true);
  expect(files()).toEqual(before);
});

test.each([
  ["no commit", "no-commit", undefined],
  ["job lock busy", "locked", undefined],
  ["fetch failed: x", "infra", undefined],
  ["API Error: 402 This request would exceed your available credits", "credit", undefined],
  ["merge conflict: a.ts", "conflict", undefined],
  ["main moved during the land; land again", "moved", undefined],
  ["the branch changes docs/todo.md; change the list with aleph issue", "other", undefined],
  ["timed out: check types", "check", "types"],
  ["malformed verdict: x", "unanswered", undefined],
  ["failed: x", "unanswered", undefined],
  ["the work has no commit and a time box", undefined, undefined],
] as const)("a run with only the sentence %p gets the cause %p", (reason, cause, check) => {
  put(recordsDir(), "aleph-5", [run("1", { condition: "failed", reason }), run("2", { condition: "dropped", noCommit: true, reason })]);
  migrateWords();
  const [x, kept] = read(recordsDir(), "aleph-5").runs;
  expect([x.cause, x.checkName]).toEqual([cause, check]);
  expect(kept.cause).toBeUndefined();
});
