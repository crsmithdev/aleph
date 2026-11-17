import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { held, lock, lockSync } from "./locks.ts";

let base: string;
let saved: string | undefined;
const dir = (name: string) => join(base, "aleph", name);
const dead = () => Bun.spawnSync(["sh", "-c", "echo $$"], { stdout: "pipe" }).stdout.toString().trim();
const seed = (name: string, owner?: string) => {
  mkdirSync(dir(name), { recursive: true });
  if (owner !== undefined) writeFileSync(join(dir(name), "owner"), owner);
};
const age = (path: string) => utimesSync(path, new Date(0), new Date(0));

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-locks-"));
  saved = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = base;
});

afterEach(() => {
  if (saved === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = saved;
  rmSync(base, { recursive: true, force: true });
});

/** A script that takes the lock `race` 12 times with `take`, and fails if another process is inside at the same time. */
const contend = (take: string) => `import { closeSync, openSync, rmSync } from "node:fs";
import { lock, lockSync } from ${JSON.stringify(join(import.meta.dir, "locks.ts"))};
for (let i = 0; i < 12; i++) {
  const release = (${take})!;
  closeSync(openSync(process.argv[2], "wx")); // Throws if another process is inside.
  await new Promise((r) => setImmediate(r));
  rmSync(process.argv[2]);
  release();
}
`;

async function race(take: string): Promise<void> {
  const script = join(base, "contend.ts");
  writeFileSync(script, contend(take));
  seed("race", dead());
  const procs = Array.from({ length: 8 }, () => Bun.spawn(["bun", script, join(base, "inside")], { env: { ...process.env, XDG_RUNTIME_DIR: base }, stdout: "ignore", stderr: "pipe" }));
  const codes = await Promise.all(procs.map((p) => p.exited));
  const errors = await Promise.all(procs.map((p) => new Response(p.stderr).text()));
  expect(codes, errors.join("")).toEqual(procs.map(() => 0));
}

describe("lock", () => {
  test("one holder at a time; a release frees it; a held lock times out", async () => {
    const release = (await lock("a"))!;
    expect(readFileSync(join(dir("a"), "owner"), "utf8")).toBe(String(process.pid));
    expect(held("a")).toBe(true);
    expect(await lock("a", 0)).toBeNull();
    expect(lockSync("a", 0)).toBeNull();
    release();
    expect(held("a")).toBe(false);
    lockSync("a", 0)!();
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
    expect(held("d")).toBe(false);
    (await lock("d", 0))!();
    seed("s", dead());
    lockSync("s", 0)!();
    seed("l", String(process.ppid));
    expect(held("l")).toBe(true);
    expect(await lock("l", 0)).toBeNull();
  });

  test("an empty lock directory is free; one with an unreadable owner waits a minute, then is taken over", async () => {
    seed("none");
    (await lock("none", 0))!();
    seed("empty", "");
    expect(await lock("empty", 0)).toBeNull();
    age(dir("empty"));
    (await lock("empty", 0))!();
  });

  test("a guard left by a crash does not block the takeover for good", async () => {
    seed("g", dead());
    mkdirSync(`${dir("g")}.reclaim`);
    age(`${dir("g")}.reclaim`);
    (await lock("g", 2000))!();
  });

  // The second of two contenders who both saw the dead owner: the first holds the guard. The second must not
  // remove the lock, which the first may by now hold, and must give up at its deadline.
  test("a contender without the guard leaves a stale lock alone and keeps its deadline", async () => {
    const pid = dead();
    seed("c", pid);
    mkdirSync(`${dir("c")}.reclaim`);
    expect(lockSync("c", 100)).toBeNull();
    expect(await lock("c", 100)).toBeNull();
    expect(readFileSync(join(dir("c"), "owner"), "utf8")).toBe(pid);
    rmSync(`${dir("c")}.reclaim`, { recursive: true });
    lockSync("c", 0)!();
  });

  test("processes racing for a dead owner's lock never hold it together", () => race(`await lock("race", 25000)`), 30_000);

  test("processes racing for a dead owner's lock with lockSync never hold it together", () => race(`lockSync("race", 25000)`), 30_000);
});
