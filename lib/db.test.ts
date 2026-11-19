import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { conn, getJson, next, putJson, tx } from "./db.ts";
import { withEnv } from "../ui/server.testkit.ts";

const names = (type: string) => (conn().query("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name").all(type) as { name: string }[]).map((r) => r.name);

/** Runs `check` on a database file at `version` that `sql` built, opened through conn() as a migration would see it. */
function atVersion(version: number, sql: string[], check: () => void): void {
  const file = join(mkdtempSync(join(tmpdir(), "aleph-db-")), `v${version}.db`);
  const old = new Database(file, { create: true });
  for (const q of [...sql, `PRAGMA user_version = ${version}`]) old.run(q);
  old.close();
  const off = withEnv({ ALEPH_DB: file });
  try { check(); } finally { off(); }
}

test("the schema is created under user_version 8, in WAL", () => {
  expect(names("table")).toEqual(expect.arrayContaining(["counters", "events", "issue_state", "jobs", "settings", "state", "tick", "usage", "openrouter", "jev", "suite_history", "flaky"]));
  expect(names("view")).toEqual(["event_rows"]);
  expect((conn().query("PRAGMA user_version").get() as any).user_version).toBe(8);
  expect((conn().query("PRAGMA journal_mode").get() as any).journal_mode).toBe("wal");
});

test("a file at user_version 1 gains only the new tables and the event size", () => {
  atVersion(1, [
    "CREATE TABLE counters (kind TEXT PRIMARY KEY, last INTEGER NOT NULL)",
    "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    "CREATE TABLE events (seq INTEGER PRIMARY KEY, time TEXT NOT NULL, subject TEXT NOT NULL, action TEXT NOT NULL, object TEXT NOT NULL, detail TEXT)",
    "CREATE TABLE jobs (id TEXT PRIMARY KEY, role TEXT NOT NULL, model TEXT, tier TEXT, project TEXT, target TEXT, cost REAL, commit_sha TEXT, started TEXT, ended TEXT, was TEXT)",
    "CREATE VIEW event_rows AS SELECT * FROM events",
    "CREATE TABLE issue_state (issue TEXT PRIMARY KEY, ask TEXT, ask_job TEXT, wait_kind TEXT, wait_reason TEXT, wait_since TEXT, ci TEXT)",
    "INSERT INTO settings VALUES ('keep', '1')",
  ], () => {
    expect((conn().query("PRAGMA user_version").get() as any).user_version).toBe(8);
    expect(names("table")).toEqual(expect.arrayContaining(["state", "usage", "openrouter", "jev", "suite_history", "flaky"]));
    expect(getJson("settings", "keep", 0)).toBe(1);
    expect((conn().query("PRAGMA table_info(events)").all() as { name: string }[]).map((c) => c.name)).toContain("size");
  });
});

test("a file at user_version 3 has the Ask reason review read as review-held", () => {
  atVersion(3, [
    "CREATE TABLE issue_state (issue TEXT PRIMARY KEY, ask TEXT, ask_job TEXT, wait_kind TEXT, wait_reason TEXT, wait_since TEXT, ci TEXT)",
    "CREATE TABLE events (seq INTEGER PRIMARY KEY, time TEXT NOT NULL, subject TEXT NOT NULL, action TEXT NOT NULL, object TEXT NOT NULL, detail TEXT, tier TEXT)",
    "CREATE TABLE jobs (id TEXT PRIMARY KEY, role TEXT NOT NULL, model TEXT, tier TEXT, project TEXT, target TEXT, cost REAL, commit_sha TEXT, started TEXT, ended TEXT, was TEXT)",
    "CREATE VIEW event_rows AS SELECT * FROM events",
    "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    "CREATE TABLE usage (seq INTEGER PRIMARY KEY, time TEXT NOT NULL, five_hour REAL, seven_day REAL NOT NULL, seven_day_resets_at TEXT)",
    "INSERT INTO issue_state (issue, ask) VALUES ('issue.1', '{\"kind\":\"approval\",\"reason\":\"review\",\"why\":[]}'), ('issue.2', '{\"kind\":\"input\",\"reason\":\"question\"}')",
    "INSERT INTO events (time, subject, action, object, detail) VALUES ('t', 'rule', 'question', 'issue.1', 'review'), ('t', 'rule', 'question', 'issue.2', 'no commit')",
    "INSERT INTO settings VALUES ('always', '{\"review\":{\"action\":\"land\",\"at\":\"t\"},\"question\":{\"action\":\"user\",\"at\":\"t\"}}')",
  ], () => {
    expect((conn().query("PRAGMA user_version").get() as any).user_version).toBe(8);
    expect(conn().query("SELECT issue, json_extract(ask, '$.reason') AS reason FROM issue_state ORDER BY issue").all()).toEqual([{ issue: "issue.1", reason: "review-held" }, { issue: "issue.2", reason: "question" }]);
    expect(conn().query("SELECT detail FROM events ORDER BY seq").all()).toEqual([{ detail: "review-held" }, { detail: "no commit" }]);
    expect(getJson("settings", "always", {})).toEqual({ "review-held": { action: "land", at: "t" }, question: { action: "user", at: "t" } });
  });
});

test("a file at user_version 6 loses the wait columns and the rows that held only a wait", () => {
  atVersion(6, [
    "CREATE TABLE issue_state (issue TEXT PRIMARY KEY, ask TEXT, ask_job TEXT, wait_kind TEXT, wait_reason TEXT, wait_since TEXT, ci TEXT)",
    "CREATE TABLE jobs (id TEXT PRIMARY KEY, was TEXT)",
    "CREATE TABLE usage (seq INTEGER PRIMARY KEY, five_hour REAL)",
    "INSERT INTO issue_state (issue, ask, wait_kind) VALUES ('issue.1', '{}', 'red'), ('issue.2', NULL, 'red')",
  ], () => {
    expect(conn().query("SELECT * FROM issue_state").all()).toEqual([{ issue: "issue.1", ask: "{}", ask_job: null, ci: null }]);
  });
});

test("a file at user_version 3 has each build's tier or model read as its size, and no tier column", () => {
  atVersion(3, [
    "CREATE TABLE jobs (id TEXT PRIMARY KEY, role TEXT NOT NULL, model TEXT, tier TEXT, project TEXT, target TEXT, cost REAL, commit_sha TEXT, started TEXT, ended TEXT, was TEXT)",
    "CREATE TABLE events (seq INTEGER PRIMARY KEY, time TEXT NOT NULL, subject TEXT NOT NULL, action TEXT NOT NULL, object TEXT NOT NULL, detail TEXT, tier TEXT)",
    `CREATE VIEW event_rows AS SELECT e.seq, e.time, e.subject, e.action, e.object, e.detail, coalesce(e.tier, o.tier) AS tier,
      o.model FROM events e LEFT JOIN jobs o ON o.id = e.object`,
    ...["issue_state (issue TEXT PRIMARY KEY, ask TEXT, ask_job TEXT, wait_kind TEXT, wait_reason TEXT, wait_since TEXT, ci TEXT)", "settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)", "usage (seq INTEGER PRIMARY KEY, time TEXT NOT NULL, five_hour REAL)"].map((t) => `CREATE TABLE ${t}`),
    "INSERT INTO jobs (id, role, model, tier) VALUES ('job.1', 'build', 'deepseek-v4.1-flash', 'haiku'), ('job.2', 'build', 'opus', NULL), ('job.3', 'review', 'sonnet', NULL)",
    "INSERT INTO events (time, subject, action, object, detail, tier) VALUES ('t', 'rule', 'started', 'issue.1', 'model sonnet', 'worker-medium')",
  ], () => {
    expect((conn().query("PRAGMA user_version").get() as any).user_version).toBe(8);
    expect(conn().query("SELECT id, size FROM jobs ORDER BY id").all()).toEqual([{ id: "job.1", size: "small" }, { id: "job.2", size: "large" }, { id: "job.3", size: null }]);
    expect(conn().query("SELECT size FROM events").all()).toEqual([{ size: "medium" }]);
    for (const t of ["jobs", "events", "event_rows"]) expect((conn().query(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name)).not.toContain("tier");
  });
});

test("a file at user_version 4 loses the leaked fixture events and usage rows", () => {
  atVersion(4, [
    "CREATE TABLE events (seq INTEGER PRIMARY KEY, time TEXT NOT NULL, subject TEXT NOT NULL, action TEXT NOT NULL, object TEXT NOT NULL, detail TEXT, tier TEXT)",
    "CREATE TABLE jobs (id TEXT PRIMARY KEY, role TEXT NOT NULL, model TEXT, tier TEXT, project TEXT, target TEXT, cost REAL, commit_sha TEXT, started TEXT, ended TEXT, was TEXT)",
    "CREATE VIEW event_rows AS SELECT * FROM events",
    "CREATE TABLE issue_state (issue TEXT PRIMARY KEY, ask TEXT, ask_job TEXT, wait_kind TEXT, wait_reason TEXT, wait_since TEXT, ci TEXT)",
    "CREATE TABLE usage (seq INTEGER PRIMARY KEY, time TEXT NOT NULL, five_hour REAL, seven_day REAL NOT NULL, seven_day_resets_at TEXT)",
    "INSERT INTO events (time, subject, action, object) VALUES ('2026-11-12T05:23:00Z', 'gate', 'running', 'a-1'), ('2026-11-12T18:44:00Z', 'gate', 'running', 'b-1'), ('2026-11-14T00:00:00Z', 'job', 'end', 'issue.1')",
    "INSERT INTO usage (time, seven_day, seven_day_resets_at) VALUES ('2026-11-20T12:00:00Z', 5, '2026-11-07T00:00:00Z'), ('2026-11-20T12:00:00.000Z', 5, '2026-11-07T00:00:00Z'), ('2026-11-14T00:00:00Z', 3, '2026-11-21T00:00:00Z')",
  ], () => {
    expect((conn().query("PRAGMA user_version").get() as any).user_version).toBe(8);
    expect(conn().query("SELECT time, subject, action, object FROM events").all()).toEqual([{ time: "2026-11-14T00:00:00Z", subject: "job", action: "end", object: "issue.1" }]);
    expect(conn().query("SELECT time, seven_day, seven_day_resets_at FROM usage").all()).toEqual([{ time: "2026-11-14T00:00:00Z", seven_day: 3, seven_day_resets_at: "2026-11-21T00:00:00Z" }]);
  });
});

test("a file at user_version 7 loses usage.five_hour and jobs.was", () => {
  atVersion(7, [
    "CREATE TABLE jobs (id TEXT PRIMARY KEY, was TEXT)",
    "CREATE TABLE usage (seq INTEGER PRIMARY KEY, time TEXT NOT NULL, five_hour REAL, seven_day REAL NOT NULL)",
    "INSERT INTO usage (time, five_hour, seven_day) VALUES ('t', 1, 2)",
  ], () => {
    expect(conn().query("SELECT * FROM usage").all()).toEqual([{ seq: 1, time: "t", seven_day: 2 }]);
    expect((conn().query("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name)).toEqual(["id"]);
  });
});

test("getJson gives the fallback for a missing row and putJson replaces a row", () => {
  expect(getJson("state", "t-row", { a: 0 })).toEqual({ a: 0 });
  putJson("state", "t-row", { a: 1 });
  putJson("state", "t-row", { a: 2 });
  expect(getJson("state", "t-row", { a: 0 })).toEqual({ a: 2 });
});

test("next counts up per kind and never returns a number at or under the floor", () => {
  expect([next("t1"), next("t1"), next("t2")]).toEqual([1, 2, 1]);
  expect(next("t1", 10)).toBe(11);
  expect(next("t1", 5)).toBe(12);
});

test("a failed tx rolls back", () => {
  expect(() => tx((d) => { d.run("INSERT INTO settings VALUES ('k', 'v')"); throw new Error("no"); })).toThrow("no");
  expect(conn().query("SELECT count(*) AS n FROM settings").get()).toEqual({ n: 0 });
});

test("the connection follows ALEPH_DB", () => {
  const off = withEnv({ ALEPH_DB: join(mkdtempSync(join(tmpdir(), "aleph-db-")), "other.db") });
  try { expect(next("t1")).toBe(1); } finally { off(); }
  expect(next("t1")).toBe(13);
});

test("counters from 4 processes at once never repeat", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "aleph-db-")), "race.db");
  const code = `import { next } from ${JSON.stringify(join(import.meta.dir, "db.ts"))}; for (let i = 0; i < 100; i++) console.log(next("race"));`;
  const run = () => Bun.spawn(["bun", "-e", code], { env: { ...process.env, ALEPH_DB: file }, stdout: "pipe", stderr: "pipe" });
  const procs = [run(), run(), run(), run()];
  const out = await Promise.all(procs.map(async (p) => ({ text: await new Response(p.stdout).text(), err: await new Response(p.stderr).text(), code: await p.exited })));
  expect(out.map((o) => o.code)).toEqual([0, 0, 0, 0]);
  const nums = out.flatMap((o) => o.text.trim().split("\n").map(Number));
  expect(new Set(nums).size).toBe(400);
  expect(Math.max(...nums)).toBe(400);
});
