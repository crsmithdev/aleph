// Archived goal tests from jobs/lib/landing.follow.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { base, file, other, repo, sh, state, setup, teardown } from "../../../jobs/cli.helpers";
import { actionJob, land as landJob } from "../../../jobs/inproc";

beforeAll(setup);
afterAll(teardown);

describe("land follows main", () => {
  const land = async (name: string, action: string, repoKey = "demo", extra: Record<string, string> = {}) => {
    await actionJob(name, action, {}, repoKey);
    return landJob(name, {}, extra);
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
    expect(state(r.json.run).condition).toBe("landed");
    expect(sh(repo, "git", "rev-parse", "HEAD")).toBe(head);
    expect(file(r.json.run, "land.log")).toContain("README");
    sh(repo, "git", "checkout", "README");
    sh(repo, "git", "merge", "-q", "--ff-only", "origin/main");
  });

  test("a main checkout on another branch is not moved, and the log says which", async () => {
    sh(repo, "git", "checkout", "-q", "-b", "elsewhere");
    const r = await land("follow3", "commit follow3.txt");
    expect(state(r.json.run).condition).toBe("landed");
    expect(file(r.json.run, "land.log")).toContain("it is on elsewhere");
    sh(repo, "git", "checkout", "-q", "main");
    sh(repo, "git", "branch", "-q", "-D", "elsewhere");
    sh(repo, "git", "merge", "-q", "--ff-only", "origin/main");
  });

  // A small server graph on origin/main, fast-forwarded into the aleph fixture repo.
  const seedGraph = () => {
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    const files: Record<string, string> = {
      "ui/server.ts": 'import "../jobs/lib/store.ts";\nimport "./banner.ts";\n',
      "ui/banner.ts": 'import "./views/now.js";\n',
      "ui/api/now.ts": 'import "../../hooks/lib/env.ts";\n',
      "jobs/lib/store.ts": "1\n",
      "hooks/lib/env.ts": "1\n",
      "ui/views/now.js": "1\n",
      "ui/views/other.js": "1\n",
      "ui/index.html": "1\n",
      "ui/x.test.ts": "1\n",
    };
    for (const [f, body] of Object.entries(files)) {
      mkdirSync(dirname(join(other, f)), { recursive: true });
      writeFileSync(join(other, f), body);
    }
    sh(other, "git", "add", ".");
    sh(other, "git", "commit", "-qm", "seed ui graph");
    sh(other, "git", "push", "-q", "origin", "main");
    sh(repo, "git", "pull", "-q", "--ff-only", "origin", "main");
  };
  beforeAll(() => seedGraph());

  test("a failed restart leaves the land landed, and a later land restarts for an earlier graph commit", async () => {
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
    const a = await land("follow6", "commit hooks/lib/env.ts", "aleph", nopath);
    expect(state(a.json.run).condition).toBe("landed");
    sh(repo, "git", "checkout", "README");
    // The checkout was dirty, so it did not move; the next land moves it across hooks/lib/env.ts.
    writeFileSync(join(bin, "systemctl"), `#!/bin/sh\necho "$@" >> ${rec}\n`, { mode: 0o755 });
    const b = await land("follow7", "commit other.txt", "aleph", { PATH: `${bin}:${process.env.PATH}` });
    expect(readFileSync(rec, "utf8")).toBe("--user try-restart --no-block aleph-ui.service\n");
    expect(file(b.json.run, "land.log")).toContain("aleph-ui restarted");
  });
});

