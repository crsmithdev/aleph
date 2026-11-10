import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wallStepSince } from "./clock.ts";
import { emptyObjects, fix, gitChecks, homeCheck, linkCheck, lostCheck, unitChecks, doctor } from "./doctor.ts";
import { writeRun } from "../records/ledger.ts";
import { mkdirSync, symlinkSync } from "node:fs";

let dir: string, repo: string;
const saved = { ...process.env };
const sh = (cwd: string, cmd: string) => { const p = Bun.spawnSync(["bash", "-c", cmd], { cwd, stdout: "pipe", stderr: "pipe" }); if (p.exitCode) throw new Error(p.stderr.toString()); return p.stdout.toString().trim(); };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "doctor-"));
  repo = join(dir, "r");
  sh(dir, `git init -q -b main r && cd r && git config user.email a@b && git config user.name a && echo x > f && git add f && git commit -qm one`);
  writeFileSync(join(dir, "repos.json"), JSON.stringify({ r: { path: repo, sandbox: true } }));
  sh(dir, `git init -q --bare -b main items.git && git clone -q items.git items 2>/dev/null && cd items && git config user.email a@b && git config user.name a && echo x > f && git add f && git commit -qm init && git push -q origin main`);
  Object.assign(process.env, { ALEPH_ISSUES: join(dir, "items"), ALEPH_REPOS: join(dir, "repos.json"), ALEPH_JOBS_DIR: join(dir, "jobs"), ALEPH_FACTORY_DIR: join(dir, "factory") });
  mkdirSync(join(dir, "jobs"));
});
afterEach(() => { process.env = { ...saved }; rmSync(dir, { recursive: true, force: true }); });

const fakeCtl = (script: string) => {
  const f = join(dir, "ctl");
  writeFileSync(f, `#!/bin/bash\n${script}\n`);
  chmodSync(f, 0o755);
  process.env.ALEPH_SYSTEMCTL = f;
};

describe("clock", () => {
  test("a wall clock that jumps beyond the monotonic clock is a step", () => {
    let wall = 1000, mono = 0;
    const c = { wall: () => wall, mono: () => mono };
    const start = { wall: 1000, mono: 0 };
    wall += 15_000; mono += 15_000;
    expect(wallStepSince(start, c)).toBe(0);
    wall += 3600_000;
    expect(wallStepSince(start, c)).toBe(3600_000);
  });
});

describe("git", () => {
  test("a 0-byte git lock in objects is not an empty object", () => {
    const lock = join(repo, ".git/objects/maintenance.lock");
    sh(repo, `: > ${lock}`);
    expect(emptyObjects(repo)).toEqual([]);
    expect(gitChecks().find((c) => c.name === "empty objects")?.ok).toBe(true);
    fakeCtl("exit 0");
    expect(fix()).toEqual(["started aleph-tick.service"]);
  });
});

describe("units", () => {
  const noNextRun = (svc: string, exit: number) =>
    fakeCtl(`case "$2" in is-active) [ "$3" = aleph-tick.service ] && { echo ${svc}; exit ${exit}; }; echo active;; list-timers) echo '[]';; esac`);
  test("no next run while the tick service is activating (exit 3) passes", () => {
    noNextRun("activating", 3);
    expect(unitChecks().find((c) => c.name === "aleph-tick.timer next run")).toMatchObject({ ok: true, detail: "aleph-tick.service is running" });
  });

  test("the next run is the wall-clock time from list-timers less now, for the tick and the suite, not the monotonic time from boot", () => {
    const now = Date.parse("2026-11-04T20:00:00Z");
    const at = (ms: number) => (now + ms) * 1000;
    fakeCtl(`case "$2" in is-active) echo active;; list-timers) echo '[{"next":${at(250_000)},"unit":"aleph-tick.timer"},{"next":${at(45 * 60_000)},"unit":"aleph-suite.timer"}]';; show) echo NextElapseUSecMonotonic=14h 18min;; esac`);
    expect(unitChecks(now).filter((c) => c.name.endsWith("next run"))).toEqual([
      { name: "aleph-tick.timer next run", ok: true, detail: "in 4 min 10 s (2026-11-04T20:04:10.000Z)" },
      { name: "aleph-suite.timer next run", ok: true, detail: "in 45 min 0 s (2026-11-04T20:45:00.000Z)" },
    ]);
  });

  test("a timer with no next run and no running service fails, and the suite timer is checked", () => {
    fakeCtl(`case "$2" in is-active) [ "$3" = aleph-suite.timer ] && { echo inactive; exit 3; }; [ "$3" = aleph-suite.service ] && { echo inactive; exit 3; }; echo active;; list-timers) echo '[]';; esac`);
    const c = unitChecks(Date.parse("2026-11-04T20:00:00Z"));
    expect(c.find((x) => x.name === "unit aleph-suite.timer")).toMatchObject({ ok: false, detail: "inactive" });
    expect(c.find((x) => x.name === "aleph-suite.timer next run")).toMatchObject({ ok: false, detail: "aleph-suite.timer has no next run" });
  });
});

test("aleph.home answers or does not", async () => {
  const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (r) => new Response(new URL(r.url).pathname === "/api/state" ? "{}" : "x", { status: new URL(r.url).pathname === "/down" ? 502 : 200 }) });
  process.env.ALEPH_HOME_URL = `http://127.0.0.1:${s.port}/`;
  expect(await homeCheck()).toMatchObject({ ok: true, detail: `http://127.0.0.1:${s.port}/ answered 200` });
  process.env.ALEPH_HOME_URL = `http://127.0.0.1:${s.port}/down`;
  expect((await homeCheck()).ok).toBe(false);
  s.stop(true);
});

test("aleph.home fails when the JSON route's gzip body does not decode", async () => {
  const json = JSON.stringify({ items: [] });
  let body: BodyInit = Bun.gzipSync(json) as Uint8Array<ArrayBuffer>;
  const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (r) => new URL(r.url).pathname === "/api/state" ? new Response(body, { headers: { "content-type": "application/json", "content-encoding": "gzip" } }) : new Response("x") });
  process.env.ALEPH_HOME_URL = `http://127.0.0.1:${s.port}/`;
  expect((await homeCheck()).ok).toBe(true);
  body = json;
  const c = await homeCheck();
  expect(c.ok).toBe(false);
  expect(c.detail).toContain(`http://127.0.0.1:${s.port}/api/state`);
  s.stop(true);
});

test("a run with a pid, no exit and no process is lost", () => {
  expect(lostCheck().ok).toBe(true);
  const f = join(dir, "jobs", "20261030-000000-x");
  mkdirSync(f);
  writeRun(f, { kind: "plain", job: "x", name: "x", condition: "running", told: false, started: "2026-10-30T00:00:00Z" });
  writeFileSync(join(f, "pid"), "999999\n");
  expect(lostCheck()).toMatchObject({ ok: false });
});

describe("unit links", () => {
  test("a link into .worktrees or to a missing file fails the check; a good link passes; doctor() includes it", async () => {
    const units = join(dir, "units"), good = join(dir, "main", "a.service"), wt = join(dir, ".worktrees", "job-x", "jobs", "systemd", "b.service");
    mkdirSync(join(units, "default.target.wants"), { recursive: true });
    mkdirSync(join(dir, "main")); mkdirSync(join(wt, ".."), { recursive: true });
    writeFileSync(good, ""); writeFileSync(wt, "");
    process.env.ALEPH_UNIT_DIR = units;
    symlinkSync(good, join(units, "a.service"));
    expect(linkCheck().ok).toBe(true);
    symlinkSync(wt, join(units, "b.service"));
    symlinkSync(join(dir, "gone.service"), join(units, "default.target.wants", "c.service"));
    const c = linkCheck();
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("b.service");
    expect(c.detail).toContain("c.service");
    expect(c.detail).not.toContain("a.service");
    fakeCtl("exit 0");
    process.env.ALEPH_HOME_URL = "http://127.0.0.1:1/";
    process.env.ALEPH_DOCTOR_CLOCK_MS = "50";
    expect((await doctor()).map((x) => x.name)).toContain("unit links");
  });
});
