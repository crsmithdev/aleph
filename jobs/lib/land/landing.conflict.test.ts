import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, file, jobsDir, other, remote, sh, state, told, setup, teardown } from "../../cli.helpers";
import { actionJob, land } from "../../flow.testkit.ts";

beforeAll(setup);
afterAll(teardown);

describe("land: conflicts", () => {
  const remoteHead = () => sh(base, "git", "--git-dir", remote, "rev-parse", "main");
  function pushFromOther(f: string, content: string): void {
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    mkdirSync(join(other, f, ".."), { recursive: true });
    writeFileSync(join(other, f), content);
    sh(other, "git", "add", f);
    sh(other, "git", "commit", "-qm", `other ${f}`);
    sh(other, "git", "push", "-q", "origin", "main");
  }

  const runsOf = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-demo-${name}-`)).sort().map((d) => ({ id: d, ...state(d) }));

  // flaky: tests/flaky.md#conflict-records-paths
  test.skip("a conflict records its paths, sends the job back to the worker, and the passed follow-up lands", async () => {
    await actionJob("mend", "resolve-later mend.txt");
    pushFromOther("mend.txt", "theirs\n");
    const r = await land("mend");
    expect(state(r.json.run)).toMatchObject({ condition: "failed", reason: "merge conflict", conflicts: ["mend.txt"], next: "worker" });
    expect(file(r.json.run, "land.log")).toContain("## conflicts\nmend.txt");
    expect(told).toContain("demo/mend failed; sent back to the worker");
    const runs = runsOf("mend");
    expect(runs.map((x) => [x.kind, x.condition])).toEqual([["build", "passed"], ["land", "failed"], ["build", "passed"], ["land", "landed"]]);
    expect(runs[2].land).toBe(true);
    expect(state(runs[2].id)).toMatchObject({ merge: true, model: "haiku" });
    expect(file(runs[2].id, "prompt.md")).toContain("mend.txt");
    expect(file(runs[2].id, "prompt.md")).not.toContain("ACTION:");
    expect(file(runs[2].id, "prompt.md")).not.toContain("## Spec");
    expect(file(runs[1].id, "next.log")).not.toContain("held:");
    expect(sh(base, "git", "--git-dir", remote, "show", "main:mend.txt")).toBe("mine");
    expect(remoteHead()).toBe(runs[3].commit);
  }, 30_000);

});
