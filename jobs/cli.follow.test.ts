import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, file, job, repo, sh, state, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("land follows main", () => {
  const land = async (name: string, action: string, repoKey = "demo", extra: Record<string, string> = {}) => {
    await job(name, action, {}, repoKey);
    return aleph(["land", name], extra);
  };

  test("a clean main checkout moves to the landed commit", async () => {
    const r = await land("follow1", "commit follow1.txt");
    expect(sh(repo, "git", "rev-parse", "HEAD")).toBe(state(r.json.run).commit);
    expect(file(r.json.run, "land.log")).toContain("main checkout updated");
  });

  test("a tracked change in the main checkout keeps it where it is, and the land still lands", async () => {
    writeFileSync(join(repo, "README"), "edited\n");
    const head = sh(repo, "git", "rev-parse", "HEAD");
    const r = await land("follow2", "commit follow2.txt");
    expect(state(r.json.run).state).toBe("landed");
    expect(sh(repo, "git", "rev-parse", "HEAD")).toBe(head);
    expect(file(r.json.run, "land.log")).toContain("README");
    sh(repo, "git", "checkout", "README");
    sh(repo, "git", "merge", "-q", "--ff-only", "origin/main");
  });

  test("a main checkout on another branch is not moved, and the log says which", async () => {
    sh(repo, "git", "checkout", "-q", "-b", "elsewhere");
    const r = await land("follow3", "commit follow3.txt");
    expect(state(r.json.run).state).toBe("landed");
    expect(file(r.json.run, "land.log")).toContain("it is on elsewhere");
    sh(repo, "git", "checkout", "-q", "main");
    sh(repo, "git", "branch", "-q", "-D", "elsewhere");
    sh(repo, "git", "merge", "-q", "--ff-only", "origin/main");
  });

  test("aleph-ui restarts when an aleph land changes ui/, and only then", async () => {
    const bin = join(base, "systemctl-bin");
    const rec = join(base, "systemctl.args");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "systemctl"), `#!/bin/sh\necho "$@" >> ${rec}\n`, { mode: 0o755 });
    const extra = { PATH: `${bin}:${process.env.PATH}` };
    await land("follow4", "commit docs-only.txt", "aleph", extra);
    expect(existsSync(rec)).toBe(false);
    const r = await land("follow5", "commit ui/x", "aleph", extra);
    expect(readFileSync(rec, "utf8")).toBe("--user try-restart --no-block aleph-ui.service\n");
    expect(file(r.json.run, "land.log")).toContain("aleph-ui restarted");
  });

  test("a failed restart leaves the land landed, and a later land restarts for an earlier ui/ commit", async () => {
    const bin = join(base, "systemctl-bin2");
    const rec = join(base, "systemctl2.args");
    mkdirSync(bin, { recursive: true });
    // A PATH with the tools the land needs and no systemctl: spawning it throws.
    const bare = join(base, "bare-bin");
    mkdirSync(bare, { recursive: true });
    for (const tool of ["bun", "git", "sh", "bash", "env", "timeout"]) {
      const found = Bun.which(tool);
      if (found && !existsSync(join(bare, tool))) symlinkSync(found, join(bare, tool));
    }
    const nopath = { PATH: bare };
    // systemctl cannot be spawned: the land still lands.
    sh(repo, "git", "checkout", "-q", "main");
    writeFileSync(join(repo, "README"), "dirty\n");
    const a = await land("follow6", "commit ui/y", "aleph", nopath);
    expect(state(a.json.run).state).toBe("landed");
    sh(repo, "git", "checkout", "README");
    // The checkout was dirty, so it did not move; the next land moves it across ui/y.
    writeFileSync(join(bin, "systemctl"), `#!/bin/sh\necho "$@" >> ${rec}\n`, { mode: 0o755 });
    const b = await land("follow7", "commit other.txt", "aleph", { PATH: `${bin}:${process.env.PATH}` });
    expect(readFileSync(rec, "utf8")).toBe("--user try-restart --no-block aleph-ui.service\n");
    expect(file(b.json.run, "land.log")).toContain("aleph-ui restarted");
  });
});

