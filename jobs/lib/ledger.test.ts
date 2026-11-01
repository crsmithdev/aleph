import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allJobs, issue, stateOf, view } from "./job.ts";
import { askOf, isAwaiting, isBuild, isOpen, lock, newsLine, onOf, OPEN, reviewOf, writeRun, type Run } from "./ledger.ts";

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

function write(id: string, extra: Partial<Run>, files: Record<string, string> = {}): void {
  const folder = join(base, id);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { job: id, name: "n", repo: "fac", told: true, started: "2026-10-30T00:00:00Z", ...extra } as Run);
  for (const [f, text] of Object.entries(files)) writeFileSync(join(folder, f), text);
}

const ask = { kind: "approval" as const, reason: "held-path", question: "", options: [], why: [] };

describe("the run shape", () => {
  test("a run answers from on, ask and review", () => {
    write("20261030-000001-run", { kind: "build", condition: "awaiting", ask, on: "fac-7" }, { "call.md": "VERDICT: chris sure?\n" });
    const [j] = allJobs();
    expect(isOpen(j)).toBe(true);
    expect(stateOf(j)).toBe("awaiting");
    expect(issue(j)).toBe(7);
    expect(onOf(j[0].run)).toBe(7);
    expect(askOf(j[0].run)).toMatchObject({ kind: "approval", reason: "held-path" });
    expect(reviewOf(j[0])).toEqual({ call: "ask", reason: "sure?" });
    const v = view(j);
    expect(v.condition).toBe("awaiting");
    expect(v.needs).toBe("held");
    expect(v.review).toEqual({ call: "ask", reason: "sure?" });
    expect(v.run.kind).toBe("build");
  });

  test("news line names the state and the wait", () => {
    write("20261030-000001-run", { kind: "build", condition: "awaiting", ask, on: "fac-7" });
    expect(newsLine(allJobs()[0][0].run)).toBe("fac/n awaiting held");
  });
});

describe("accessors", () => {
  test("predicates", () => {
    expect(OPEN).toContain("awaiting");
    expect(isAwaiting("awaiting") && !isAwaiting("passed")).toBe(true);
    expect(isBuild("build") && !isBuild("land")).toBe(true);
  });

  test("onOf: the number for the run's repo; a dotted on of the run's repo is its goal; a foreign one gives none", () => {
    const r = { repo: "fac" } as Run;
    expect(onOf({ ...r, on: "fac-7" })).toBe(7);
    expect(onOf({ ...r, on: "fac-7.2" })).toBe("7.2");
    expect(onOf({ ...r, on: "fac-5.1" })).toBe("5.1");
    expect(onOf({ ...r, on: "aleph-577.1" })).toBeUndefined();
    expect(onOf({ ...r, on: "oth-7" })).toBeUndefined();
    expect(onOf(r)).toBeUndefined();
  });

  test("a run with a dotted on is found under its goal", () => {
    write("20261030-000003-goal", { kind: "build", condition: "awaiting", ask, on: "fac-7.2" });
    expect(issue(allJobs()[0])).toBe("7.2");
  });

  test("askOf is the run's ask, else none", () => {
    expect(askOf({ ask } as unknown as Run)).toBe(ask);
    expect(askOf({} as Run)).toBeUndefined();
  });
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
    const old = new Date(Date.now() - 120_000);
    utimesSync(dir("empty"), old, old);
    (await lock("empty", 0))!();
  });

  test("a guard left by a crash does not block the takeover for good", async () => {
    seed("g", dead());
    mkdirSync(`${dir("g")}.reclaim`);
    const old = new Date(Date.now() - 60_000);
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
  await Bun.sleep(1);
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
