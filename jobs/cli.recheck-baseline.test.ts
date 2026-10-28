import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, other, remote, sh, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  test("a red main starts no run, is checked once per commit, and clears with a passing commit", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const trees = () => existsSync(join(base, "trees")) ? readFileSync(join(base, "trees"), "utf8").trim().split("\n").length : 0;
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    writeFileSync(join(other, "FAIL"), "red\n");
    sh(other, "git", "add", "FAIL"); sh(other, "git", "commit", "-qm", "break main"); sh(other, "git", "push", "-q", "origin", "main");
    const sha7 = remoteGit("rev-parse", "main").slice(0, 7);
    const id = (await aleph(["todo", "add", "fac", "wait for green", "--labels", "goal", "--body", "-"], {}, "ACTION: commit green.txt\n")).json.added;
    const before = trees();
    const t = await aleph(["tick"]);
    expect(t.json.started).toEqual([]);
    expect(t.json.skipped).toEqual([`fac-${id}: main is red at ${sha7}: tests`]);
    expect((await aleph(["report"])).stdout).toContain(`health: fac main is red at ${sha7}: tests`);
    expect(trees()).toBe(before);
    expect((await aleph(["tick"])).json.skipped).toEqual([`fac-${id}: main is red at ${sha7}: tests`]);
    expect(trees()).toBe(before);
    sh(other, "git", "rm", "-q", "FAIL"); sh(other, "git", "commit", "-qm", "fix main"); sh(other, "git", "push", "-q", "origin", "main");
    expect((await aleph(["tick"])).json.started).toEqual([`fac-${id}`]);
    expect(trees()).toBeGreaterThan(before);
    expect((await aleph(["report"])).stdout).not.toContain("main is red");
  }, 60_000);

  test("two dispatches at once run the baseline once; the second reports it running", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const trees = () => existsSync(join(base, "trees")) ? readFileSync(join(base, "trees"), "utf8").trim().split("\n").length : 0;
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    writeFileSync(join(other, "new.txt"), `${Math.random()}\n`);
    sh(other, "git", "add", "new.txt"); sh(other, "git", "commit", "-qm", "new commit"); sh(other, "git", "push", "-q", "origin", "main");
    const id = (await aleph(["todo", "add", "fac", "baseline once", "--labels", "goal", "--body", "-"], {}, "ACTION: commit once.txt\n")).json.added;
    const before = trees();
    writeFileSync(join(base, "slowbase"), "");
    const first = aleph(["tick"]);
    for (let i = 0; i < 300 && trees() === before; i++) await Bun.sleep(100);
    const second = await aleph(["tick"]);
    expect(second.json.started).toEqual([]);
    expect(second.json.skipped).toEqual([`fac-${id}: main baseline running`]);
    expect(trees() - before).toBe(1);
    rmSync(join(base, "slowbase"));
    expect((await first).json.started).toEqual([`fac-${id}`]);
  }, 60_000);

  test("a goal added during the baseline is started by the dispatch that runs it", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const trees = () => existsSync(join(base, "trees")) ? readFileSync(join(base, "trees"), "utf8").trim().split("\n").length : 0;
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    writeFileSync(join(other, "late.txt"), `${Math.random()}\n`);
    sh(other, "git", "add", "late.txt"); sh(other, "git", "commit", "-qm", "late commit"); sh(other, "git", "push", "-q", "origin", "main");
    const early = (await aleph(["todo", "add", "fac", "first late goal", "--labels", "goal", "--body", "-"], {}, "ACTION: commit late1.txt\n")).json.added;
    const before = trees();
    writeFileSync(join(base, "slowbase"), "");
    const tick = aleph(["tick"]);
    for (let i = 0; i < 300 && trees() === before; i++) await Bun.sleep(100);
    const late = (await aleph(["todo", "add", "fac", "second late goal", "--labels", "goal", "--body", "-"], {}, "ACTION: commit late2.txt\n")).json.added;
    const second = await aleph(["tick"]);
    expect(second.json.started).toEqual([]);
    expect(second.json.skipped).toContain(`fac-${late}: main baseline running`);
    rmSync(join(base, "slowbase"));
    const started = (await tick).json.started;
    expect(started).toContain(`fac-${early}`);
    expect(started).toContain(`fac-${late}`);
  }, 60_000);

  test("a baseline whose checks cannot start records no red, and the next dispatch runs it again", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    writeFileSync(join(other, "new.txt"), `${Math.random()}\n`);
    sh(other, "git", "add", "new.txt"); sh(other, "git", "commit", "-qm", "another commit"); sh(other, "git", "push", "-q", "origin", "main");
    const id = (await aleph(["todo", "add", "fac", "baseline retried", "--labels", "goal", "--body", "-"], {}, "ACTION: commit retried.txt\n")).json.added;
    const broken = join(base, "broken-sandbox");
    // Only the baseline's script fails to start; the probe and the runs go through.
    writeFileSync(broken, `#!/bin/bash\ncase "\${@: -1}" in *base.bundle*) exit 3 ;; esac\nexec ${join(base, "pass")} "$@"\n`, { mode: 0o755 });
    const t = await aleph(["tick"], { ALEPH_SANDBOX_CMD: broken });
    expect(t.json.started).toEqual([]);
    expect(t.json.skipped[0]).toContain(`fac-${id}: main is unchecked: checks did not start`);
    expect((await aleph(["report"])).stdout).not.toContain("main is red");
    expect((await aleph(["tick"])).json.started).toEqual([`fac-${id}`]);
  }, 60_000);
});
