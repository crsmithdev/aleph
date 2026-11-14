import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { conn, getJson, next, putJson, tx } from "./db.ts";

const names = (type: string) => (conn().query("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name").all(type) as { name: string }[]).map((r) => r.name);

test("the schema is created under user_version 2, in WAL", () => {
  expect(names("table")).toEqual(expect.arrayContaining(["counters", "events", "issue_state", "jobs", "settings", "state", "tick", "usage", "openrouter", "jev", "suite_history", "flaky"]));
  expect(names("view")).toEqual(["event_rows"]);
  expect((conn().query("PRAGMA user_version").get() as any).user_version).toBe(2);
  expect((conn().query("PRAGMA journal_mode").get() as any).journal_mode).toBe("wal");
});

test("a file at user_version 1 gains only the new tables", () => {
  const file = join(mkdtempSync(join(tmpdir(), "aleph-db-")), "v1.db");
  const old = new Database(file, { create: true });
  old.run("CREATE TABLE counters (kind TEXT PRIMARY KEY, last INTEGER NOT NULL)");
  old.run("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  old.run("INSERT INTO settings VALUES ('keep', '1')");
  old.run("PRAGMA user_version = 1");
  old.close();
  const was = process.env.ALEPH_DB;
  process.env.ALEPH_DB = file;
  try {
    expect((conn().query("PRAGMA user_version").get() as any).user_version).toBe(2);
    expect(names("table")).toEqual(expect.arrayContaining(["state", "usage", "openrouter", "jev", "suite_history", "flaky"]));
    expect(getJson("settings", "keep", 0)).toBe(1);
  } finally { process.env.ALEPH_DB = was; }
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
  const was = process.env.ALEPH_DB;
  process.env.ALEPH_DB = join(mkdtempSync(join(tmpdir(), "aleph-db-")), "other.db");
  try { expect(next("t1")).toBe(1); } finally { process.env.ALEPH_DB = was; }
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
