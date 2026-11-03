import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, jobsDir, remote, repo, sh, state, setup, teardown, seedItem } from "../cli.helpers";
import { issueClose, issueList, issueShow } from "../inproc.ts";
import { tick } from "./flow.testkit.ts";

// The ticks run in-process, as `aleph tick` runs them; each run's unit is a process of its own.
// `aleph tick` keeps its CLI test in jobs/cli.reviewer-sweep.test.ts.
beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  test("a tick starts one run per open goal, lands it, and then has nothing to start", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const id = seedItem("fac", "ship the goal", { kind: "goal" }, "ACTION: commit goal.txt\n".trim());
    const t = await tick();
    expect(t.skipped).toEqual([]);
    expect(t.started).toEqual([`fac-${id}`]);
    const runs = readdirSync(jobsDir).filter((d) => d.includes(`-fac-fac-${id}-`)).sort();
    expect(runs.map((d) => [state(d).kind, state(d).condition])).toEqual([["build", "passed"], ["land", "landed"]]);
    expect((await issueShow("fac", id)).json.status).toBe("done");
    expect(remoteGit("log", "-1", "--format=%(trailers:only)", "main")).toContain(`Issue: fac-${id}`);
    expect((await tick()).started).toEqual([]);
  }, 30_000);

  test("the nightly sweep logs a repo with no list and still files the next repo's proposals", async () => {
    const cmd = join(base, "outdated-nolist.sh");
    writeFileSync(cmd, `#!/bin/bash\ncat <<'EOF'\n| Package | Current | Update | Latest |\n|---------|---------|--------|--------|\n| left-pad | 1.0.0 | 1.0.0 | 1.2.0 |\nEOF\n`, { mode: 0o755 });
    const reg = readFileSync(join(base, "repos.json"), "utf8");
    // "nolist" comes first, so the sweep must go on past it to "fac".
    writeFileSync(join(base, "repos.json"), JSON.stringify({ nolist: { path: repo, sandbox: true, checks: [], autoland: false }, ...JSON.parse(reg) }));
    try {
      rmSync(join(base, "factory", "probe.json"), { force: true });
      await tick({ ALEPH_OUTDATED_CMD: cmd, ALEPH_PROBE_FAKE: "pass" });
      expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toMatch(/deps nolist: .*no list/);
      const rows = [...(await issueList("fac")).json as any[], ...(await issueList("fac", { status: "dropped" })).json as any[]].filter((r) => r.title.startsWith("Update "));
      expect(rows.map((r) => r.title)).toContain("Update left-pad to 1.2.0");
      for (const r of rows) await issueClose("fac", r.id, "drop", "test over");
    } finally {
      writeFileSync(join(base, "repos.json"), reg);
      writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    }
  }, 120_000);
});
