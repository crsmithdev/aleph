import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wallStepSince } from "./clock.ts";
import { emptyObjects, fix, gitChecks, homeCheck, lostCheck, unitChecks } from "./doctor.ts";
import { writeRun } from "./ledger.ts";
import { mkdirSync } from "node:fs";

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
    fakeCtl(`case "$2" in is-active) [ "$3" = aleph-tick.service ] && { echo ${svc}; exit ${exit}; }; echo active;; show) echo NextElapseUSecRealtime=; echo NextElapseUSecMonotonic=0;; esac`);
  test("no next run while the tick service is activating (exit 3) passes", () => {
    noNextRun("activating", 3);
    expect(unitChecks().at(-1)).toMatchObject({ name: "timer next run", ok: true, detail: expect.stringContaining("tick is in progress") });
  });
});

test("aleph.home answers or does not", async () => {
  const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (r) => new Response("x", { status: new URL(r.url).pathname === "/down" ? 502 : 200 }) });
  process.env.ALEPH_HOME_URL = `http://127.0.0.1:${s.port}/`;
  expect((await homeCheck()).ok).toBe(true);
  process.env.ALEPH_HOME_URL = `http://127.0.0.1:${s.port}/down`;
  expect((await homeCheck()).ok).toBe(false);
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
