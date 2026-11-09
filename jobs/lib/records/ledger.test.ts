import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admit, loadRegistry, lock } from "./ledger.ts";
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



describe("lock", () => {
  let saved: string | undefined;
  const dir = (name: string) => join(base, "aleph", name);
  const dead = () => Bun.spawnSync(["sh", "-c", "echo $$"], { stdout: "pipe" }).stdout.toString().trim();
  const seed = (name: string, owner?: string) => {
    mkdirSync(dir(name), { recursive: true });
    if (owner !== undefined) writeFileSync(join(dir(name), "owner"), owner);
  };
  beforeEach(() => { saved = process.env.XDG_RUNTIME_DIR; process.env.XDG_RUNTIME_DIR = base; });
  afterEach(() => { if (saved === undefined) delete process.env.XDG_RUNTIME_DIR; else process.env.XDG_RUNTIME_DIR = saved; });

  test("one holder at a time; a release frees it; a held lock times out", async () => {
    const release = (await lock("a"))!;
    expect(readFileSync(join(dir("a"), "owner"), "utf8")).toBe(String(process.pid));
    expect(await lock("a", 0)).toBeNull();
    release();
    (await lock("a", 0))!();
  });

  test("a held lock gives up at once with no wait, even on a frozen clock", async () => {
    const release = (await lock("frozen"))!;
    setSystemTime(new Date(0));
    try {
      expect(await lock("frozen", 0)).toBeNull();
    } finally {
      setSystemTime();
      release();
    }
  });

  test("a dead owner's lock is taken over; a live owner's is not", async () => {
    seed("d", dead());
    (await lock("d", 0))!();
    seed("l", String(process.ppid));
    expect(await lock("l", 0)).toBeNull();
  });

  test("an empty lock directory is free; one with an unreadable owner waits a minute, then is taken over", async () => {
    seed("none");
    (await lock("none", 0))!();
    seed("empty", "");
    expect(await lock("empty", 0)).toBeNull();
    const old = new Date(0);
    utimesSync(dir("empty"), old, old);
    (await lock("empty", 0))!();
  });

  test("a guard left by a crash does not block the takeover for good", async () => {
    seed("g", dead());
    mkdirSync(`${dir("g")}.reclaim`);
    const old = new Date(0);
    utimesSync(`${dir("g")}.reclaim`, old, old);
    (await lock("g", 2000))!();
  });

  test("processes racing for a dead owner's lock never hold it together", async () => {
    const script = join(base, "contend.ts");
    writeFileSync(script, `import { closeSync, openSync, rmSync } from "node:fs";
import { lock } from ${JSON.stringify(join(import.meta.dir, "ledger.ts"))};
for (let i = 0; i < 12; i++) {
  const release = (await lock("race", 25000))!;
  closeSync(openSync(process.argv[2], "wx")); // Throws if another process is inside.
  await new Promise((r) => setImmediate(r));
  rmSync(process.argv[2]);
  release();
}
`);
    seed("race", dead());
    const procs = Array.from({ length: 8 }, () => Bun.spawn(["bun", script, join(base, "inside")], { env: { ...process.env, XDG_RUNTIME_DIR: base }, stdout: "ignore", stderr: "pipe" }));
    const codes = await Promise.all(procs.map((p) => p.exited));
    const errors = await Promise.all(procs.map((p) => new Response(p.stderr).text()));
    expect(codes, errors.join("")).toEqual(procs.map(() => 0));
  }, 30_000);
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
