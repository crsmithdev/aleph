import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { aleph, base, file, job, other, repo, sh, state, setup, teardown } from "./cli.helpers";

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

  // A small server graph on origin/main, fast-forwarded into the aleph fixture repo.
  const seedGraph = () => {
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    const files: Record<string, string> = {
      "ui/server.ts": 'import "../jobs/lib/store.ts";\nimport "./attention.ts";\n',
      "ui/attention.ts": 'import "./views/now.js";\n',
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

  test("aleph-ui restarts when an aleph land changes a file in the server's import graph, and only then", async () => {
    seedGraph();
    const bin = join(base, "systemctl-bin");
    const rec = join(base, "systemctl.args");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "systemctl"), `#!/bin/sh\necho "$@" >> ${rec}\n`, { mode: 0o755 });
    const extra = { PATH: `${bin}:${process.env.PATH}` };
    const call = "--user try-restart --no-block aleph-ui.service\n";
    let calls = 0;
    const recorded = () => (existsSync(rec) ? readFileSync(rec, "utf8") : "");
    for (const [name, f] of [["follow4", "docs-only.txt"], ["follow4a", "ui/index.html"], ["follow4b", "ui/views/other.js"], ["follow4c", "ui/x.test.ts"]]) {
      const r = await land(name, `commit ${f}`, "aleph", extra);
      expect(recorded()).toBe(call.repeat(calls));
      expect(file(r.json.run, "land.log")).not.toContain("aleph-ui restarted");
    }
    for (const [name, f] of [["follow5", "jobs/lib/store.ts"], ["follow5a", "ui/views/now.js"]]) {
      const r = await land(name, `commit ${f}`, "aleph", extra);
      calls++;
      expect(recorded()).toBe(call.repeat(calls));
      expect(file(r.json.run, "land.log")).toContain("aleph-ui restarted");
    }
  }, 120_000);

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
    expect(state(a.json.run).state).toBe("landed");
    sh(repo, "git", "checkout", "README");
    // The checkout was dirty, so it did not move; the next land moves it across hooks/lib/env.ts.
    writeFileSync(join(bin, "systemctl"), `#!/bin/sh\necho "$@" >> ${rec}\n`, { mode: 0o755 });
    const b = await land("follow7", "commit other.txt", "aleph", { PATH: `${bin}:${process.env.PATH}` });
    expect(readFileSync(rec, "utf8")).toBe("--user try-restart --no-block aleph-ui.service\n");
    expect(file(b.json.run, "land.log")).toContain("aleph-ui restarted");
  });
});

