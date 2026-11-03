// Archived goal tests from jobs/cli.recheck-tick.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, jobsDir, state, setup, teardown, items } from "../../jobs/cli.helpers";
import { issueAdd, issueList } from "../../jobs/inproc";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  // `aleph tick`, `pause` and `resume` keep their CLI tests here: each is composed in jobs/cli.ts. The rest is in-process.
  test("a tick triages an open issue that is not a goal, and its line counts the verdicts", async () => {
    const cmd = join(base, "triage-fake");
    writeFileSync(cmd, `#!/bin/bash\ncat > /dev/null\necho '{"route":"live","note":"check the live site"}'\n`, { mode: 0o755 });
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const id = (await issueAdd("fac", "needs a live look")).json.added;
    const first = (await issueList("fac")).json.filter((i: any) => i.status === "open" && !i.ask)[0];
    const t = await aleph(["tick"], { ALEPH_TRIAGE_CAP: "1", ALEPH_TRIAGE_CMD: cmd });
    expect(t.json.triaged).toEqual({ ask: 1 });
    const stored = readFileSync(join(items, "fac", "backlog", "tasks", `fac-${first.id}.md`), "utf8");
    expect(stored).toContain("ask: input");
    expect(stored).toContain("reason: host-check");
    expect(readdirSync(jobsDir).filter((d) => d.endsWith("-triage")).map((d) => state(d).kind)).toContain("triage");
    expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toContain("triaged ask 1");
    expect(id).toBeGreaterThan(0);
  }, 30_000);
});
