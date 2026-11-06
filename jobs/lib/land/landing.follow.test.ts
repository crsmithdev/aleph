import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { base, file, other, repo, sh, setup, teardown } from "../../cli.helpers";
import { actionJob, land as landJob } from "../../inproc";

beforeAll(setup);
afterAll(teardown);

describe("land follows main", () => {
  const land = async (name: string, action: string, repoKey = "demo", extra: Record<string, string> = {}) => {
    await actionJob(name, action, {}, repoKey);
    return landJob(name, {}, extra);
  };

  // A small server graph on origin/main, fast-forwarded into the aleph fixture repo.
  const seedGraph = () => {
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    const files: Record<string, string> = {
      "ui/server.ts": 'import "../jobs/lib/infra/git.ts";\nimport "./banner.ts";\n',
      "ui/banner.ts": 'import "./views/now.js";\n',
      "ui/api/now.ts": 'import "../../lib/env.ts";\n',
      "jobs/lib/infra/git.ts": "1\n",
      "lib/env.ts": "1\n",
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
    const recorded = () => (existsSync(rec) ? readFileSync(rec, "utf8") : "");
    // ui/views/other.js sits beside a graph file, but no import reaches it.
    const outside = await land("follow4", "commit ui/views/other.js", "aleph", extra);
    expect(recorded()).toBe("");
    expect(file(outside.json.run, "land.log")).not.toContain("aleph-ui restarted");
    // ui/views/now.js is reached through ui/banner.ts.
    const inside = await land("follow5", "commit ui/views/now.js", "aleph", extra);
    expect(recorded()).toBe(call);
    expect(file(inside.json.run, "land.log")).toContain("aleph-ui restarted");
  }, 120_000);
});

