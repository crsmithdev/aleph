import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admit, loadRegistry } from "./ledger.ts";
import { lock } from "../infra/locks.ts";
import { setCodes, shortId } from "../../../lib/naming.ts";

let base: string;
let saved: string | undefined;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ledger-"));
  saved = process.env.ALEPH_JOBS_DIR;
  process.env.ALEPH_JOBS_DIR = base;
});

afterEach(() => {
  if (saved === undefined) delete process.env.ALEPH_JOBS_DIR;
  else process.env.ALEPH_JOBS_DIR = saved;
  rmSync(base, { recursive: true, force: true });
});


describe("admit", () => {
  const keys = ["XDG_RUNTIME_DIR", "ALEPH_LOAD_LIMIT"];
  let saved: Record<string, string | undefined>;
  beforeEach(() => { saved = Object.fromEntries(keys.map((k) => [k, process.env[k]])); Object.assign(process.env, { XDG_RUNTIME_DIR: base, ALEPH_LOAD_LIMIT: "4" }); });
  afterEach(() => { for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });

  test("a start that had to wait keeps the queue for the gap; the next start waits behind it and then reads the load", async () => {
    let endGap!: () => void;
    const gap = new Promise<void>((r) => { endGap = r; });
    const reads: string[] = [];
    const first = { load: () => { reads.push("first"); return reads.length === 1 ? 6 : 1; }, pause: (ms: number) => ms === 15_000 ? gap : Promise.resolve() };
    await admit(() => {}, first);
    expect(reads).toEqual(["first", "first"]);
    let queued!: (line: string) => void;
    const said = new Promise<string>((r) => { queued = r; });
    const second = admit((l) => queued(l), { load: () => { reads.push("second"); return 1; }, pause: () => Promise.resolve() });
    expect(await said).toBe("waiting: queued behind another start under load");
    expect(reads).toEqual(["first", "first"]);
    endGap();
    await second;
    expect(reads).toEqual(["first", "first", "second"]);
    // The second start did not wait for the load, so it keeps no gap: the queue is free.
    (await lock("admit", 0))!();
  });
});

describe("loadRegistry codes", () => {
  afterEach(() => setCodes({}));
  const load = (repos: object) => {
    const file = join(base, "repos.json");
    writeFileSync(file, JSON.stringify(repos));
    const old = process.env.ALEPH_REPOS;
    process.env.ALEPH_REPOS = file;
    try { return loadRegistry(); } finally { if (old === undefined) delete process.env.ALEPH_REPOS; else process.env.ALEPH_REPOS = old; }
  };
  test("a repo's code sets its short IDs", () => {
    expect(load({ aleph: { path: "/a", code: "a" }, koans: { path: "/k" } }).aleph.code).toBe("a");
    expect(shortId("aleph-12")).toBe("a12");
    expect(shortId("koans-3")).toBe("koans-3");
  });
  test("a code on two repos, or not 1–2 letters, is refused", () => {
    expect(() => load({ aleph: { path: "/a", code: "a" }, other: { path: "/o", code: "a" } })).toThrow(/more than one/);
    expect(() => load({ aleph: { path: "/a", code: "a1" } })).toThrow(/letters/);
  });
});
