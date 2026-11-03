// Archived goal tests from jobs/lib/doctor.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyObjects, fix, gitChecks, unitChecks } from "../../../jobs/lib/doctor.ts";
import { writeFacts } from "../../../jobs/lib/status.ts";
import { loadRegistry } from "../../../jobs/lib/ledger.ts";
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

describe("git", () => {
  test("an empty object fails both git checks; a clean repo passes", () => {
    expect(gitChecks().every((c) => c.ok)).toBe(true);
    const sha = sh(repo, "git hash-object -w f");
    const path = join(repo, ".git/objects", sha.slice(0, 2), sha.slice(2));
    sh(repo, `rm -f ${path} && : > ${path}`);
    expect(emptyObjects(repo)).toEqual([path]);
    expect(gitChecks().map((c) => c.ok)).toEqual([false, false]);
  });
  test("--fix leaves an empty object behind a real ref", () => {
    const tree = sh(repo, "git rev-parse HEAD^{tree}");
    sh(repo, `p=.git/objects/${tree.slice(0, 2)}/${tree.slice(2)}; rm -f $p; : > $p`);
    fakeCtl("exit 0");
    const said = fix();
    expect(said.join("\n")).toContain("left");
    expect(emptyObjects(repo).length).toBe(1);
  });
  test("a 0-byte pack in objects/pack is an empty object", () => {
    const pack = join(repo, ".git/objects/pack/pack-0000000000000000000000000000000000000000.pack");
    sh(repo, `mkdir -p .git/objects/pack && : > ${pack}`);
    expect(emptyObjects(repo)).toEqual([pack]);
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
  test("a timer whose triggers a drop-in cleared (empty TimersMonotonic, no next run) fails", () => {
    fakeCtl(`case "$2" in is-active) [ "$3" = aleph-tick.service ] && { echo inactive; exit 3; }; echo active;; show) echo TimersMonotonic=; echo NextElapseUSecRealtime=; echo NextElapseUSecMonotonic=0;; esac`);
    expect(unitChecks().at(-1)).toMatchObject({ name: "timer next run", ok: false });
  });
  test("a timer with no next run fails", () => {
    fakeCtl(`case "$2" in is-active) [ "$3" = aleph-tick.service ] && { echo inactive; exit 3; }; echo active;; show) echo NextElapseUSecRealtime=; echo NextElapseUSecMonotonic=0;; esac`);
    expect(unitChecks().at(-1)).toMatchObject({ ok: false });
  });
  const noNextRun = (svc: string, exit: number) =>
    fakeCtl(`case "$2" in is-active) [ "$3" = aleph-tick.service ] && { echo ${svc}; exit ${exit}; }; echo active;; show) echo NextElapseUSecRealtime=; echo NextElapseUSecMonotonic=0;; esac`);
  test("no next run while the tick service is active passes", () => {
    noNextRun("active", 0);
    expect(unitChecks().at(-1)).toMatchObject({ name: "timer next run", ok: true });
  });
  test("no next run while the tick service is inactive (exit 3) fails", () => {
    noNextRun("inactive", 3);
    expect(unitChecks().at(-1)).toMatchObject({ name: "timer next run", ok: false });
  });
  test("no next run while the tick service is failed (exit 3) fails", () => {
    noNextRun("failed", 3);
    expect(unitChecks().at(-1)).toMatchObject({ name: "timer next run", ok: false });
  });
  test("a next run present passes with it as the detail", () => {
    fakeCtl(`case "$2" in is-active) echo active;; show) echo NextElapseUSecRealtime=Fri 2026-10-30 18:00:00 UTC; echo NextElapseUSecMonotonic=0;; esac`);
    expect(unitChecks().at(-1)).toMatchObject({ name: "timer next run", ok: true, detail: "Fri 2026-10-30 18:00:00 UTC" });
  });
});
