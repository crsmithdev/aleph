import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, other, sh, setup, teardown, seedItem } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  test("a baseline whose checks cannot start records no red, and the next dispatch runs it again", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    writeFileSync(join(other, "new.txt"), `${Math.random()}\n`);
    sh(other, "git", "add", "new.txt"); sh(other, "git", "commit", "-qm", "another commit"); sh(other, "git", "push", "-q", "origin", "main");
    const id = seedItem("fac", "baseline retried", { kind: "goal" }, "ACTION: commit retried.txt\n".trim());
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
