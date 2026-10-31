import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failedChecks } from "./probe.ts";
import { wallStepSince } from "./clock.ts";
import { emptyObjects, fix, gitChecks, homeCheck, lostCheck, probeCheck, unitChecks } from "./doctor.ts";
import { FACTS_REF, writeFacts } from "./status.ts";
import { loadRegistry, writeRun } from "./ledger.ts";
import { saveProbe } from "./factory.ts";
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
  test("a clock fault replaces a bun test failure, and nothing else", () => {
    const r = [{ name: "claude -p", ok: true }, { name: "bun test", ok: false }];
    expect(failedChecks(r, 2, null)).toEqual(["bun test"]);
    expect(failedChecks(r, 2, "clock stepped 5 ms")).toEqual(["clock stepped 5 ms"]);
    expect(failedChecks([{ name: "bun test", ok: true }], 1, "clock stepped 5 ms")).toEqual([]);
    expect(failedChecks([{ name: "read ~/.ssh", ok: false }], 2, "clock stepped 5 ms")).toEqual(["read ~/.ssh", "1 checks gave no answer"]);
  });
});

describe("git", () => {
  test("an empty object fails both git checks; a clean repo passes", () => {
    expect(gitChecks().every((c) => c.ok)).toBe(true);
    const sha = sh(repo, "git hash-object -w f");
    const path = join(repo, ".git/objects", sha.slice(0, 2), sha.slice(2));
    sh(repo, `rm -f ${path} && : > ${path}`);
    expect(emptyObjects(repo)).toEqual([path]);
    expect(gitChecks().map((c) => c.ok)).toEqual([false, false]);
  });
  test("--fix removes an empty object behind refs/aleph/facts and writes the ref again", () => {
    writeFacts(loadRegistry().r);
    const tree = sh(repo, `git rev-parse ${FACTS_REF}^{tree}`);
    sh(repo, `p=.git/objects/${tree.slice(0, 2)}/${tree.slice(2)}; rm -f $p; : > $p`);
    fakeCtl("exit 0");
    expect(gitChecks()[1].ok).toBe(false);
    expect(fix()).toContain("started aleph-tick.service");
    expect(emptyObjects(repo)).toEqual([]);
    expect(gitChecks().every((c) => c.ok)).toBe(true);
  });
  test("--fix leaves an empty object behind a real ref", () => {
    const tree = sh(repo, "git rev-parse HEAD^{tree}");
    sh(repo, `p=.git/objects/${tree.slice(0, 2)}/${tree.slice(2)}; rm -f $p; : > $p`);
    fakeCtl("exit 0");
    const said = fix();
    expect(said.join("\n")).toContain("left");
    expect(emptyObjects(repo).length).toBe(1);
  });
});

describe("git blobs", () => {
  test("--fix leaves an empty blob a real ref needs, even with refs/aleph/facts present", () => {
    writeFacts(loadRegistry().r);
    const blob = sh(repo, "git rev-parse HEAD:f");
    const p = join(repo, ".git/objects", blob.slice(0, 2), blob.slice(2));
    sh(repo, `rm -f ${p}; : > ${p}`);
    fakeCtl("exit 0");
    expect(fix().join("\n")).toContain("left");
    expect(emptyObjects(repo)).toEqual([p]);
  });
});

describe("units", () => {
  test("active units with a next run pass; an inactive one fails", () => {
    fakeCtl(`case "$2" in is-active) [ "$3" = home-proxy ] && { echo inactive; exit 3; }; echo active;; show) echo NextElapseUSecRealtime=Fri 2026-10-30 18:00:00 UTC; echo NextElapseUSecMonotonic=0;; esac`);
    const c = unitChecks();
    expect(c.map((x) => [x.name, x.ok])).toEqual([["unit aleph-ui", true], ["unit home-proxy", false], ["unit aleph-tick.timer", true], ["timer next run", true]]);
  });
  test("a timer with no next run fails", () => {
    fakeCtl(`case "$2" in is-active) echo active;; show) echo NextElapseUSecRealtime=; echo NextElapseUSecMonotonic=0;; esac`);
    expect(unitChecks().at(-1)).toMatchObject({ ok: false });
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

test("the last probe", () => {
  expect(probeCheck().ok).toBe(false);
  saveProbe({ at: new Date().toISOString(), ok: true, failed: [] });
  expect(probeCheck().ok).toBe(true);
  expect(probeCheck(Date.now() + 30 * 3600_000).ok).toBe(false);
  saveProbe({ at: new Date().toISOString(), ok: false, failed: ["bun test"] });
  expect(probeCheck().detail).toContain("bun test");
});

test("a run with a pid, no exit and no process is lost", () => {
  expect(lostCheck().ok).toBe(true);
  const f = join(dir, "jobs", "20261030-000000-x");
  mkdirSync(f);
  writeRun(f, { kind: "plain", job: "x", name: "x", state: "running", told: false, started: new Date().toISOString() });
  writeFileSync(join(f, "pid"), "999999\n");
  expect(lostCheck()).toMatchObject({ ok: false });
});
