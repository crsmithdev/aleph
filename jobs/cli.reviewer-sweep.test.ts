import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, setup, teardown } from "./cli.helpers";
import { issueAdd, issueClose, issueList, issueShow } from "./inproc";
import { reportText } from "./lib/flow.testkit.ts";

// The wiring of `aleph tick`: its probe, then its sweep. The other tick cases run in-process in jobs/lib/factory.tick.test.ts.
beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  test("the nightly sweep files one proposal per stale package, once, and a moved latest files one more", async () => {
    const table = (latest: string) => [
      "| Package          | Current | Update | Latest |",
      "|------------------|---------|--------|--------|",
      "| left-pad         | 1.0.0   | 1.0.0  | 1.2.0  |",
      `| typescript (dev) | 5.8.3   | 5.9.2  | ${latest} |`,
    ].join("\n");
    const cmd = join(base, "outdated.sh");
    // The probe runs with the tick; the hook makes it pass without the sandbox.
    const give = (latest: string) => writeFileSync(cmd, `#!/bin/bash\ncat <<'EOF'\n${table(latest)}\nEOF\n`, { mode: 0o755 });
    const stale = () => rmSync(join(base, "factory", "probe.json"), { force: true });
    const proposals = async () => ((await issueList("fac")).json as any[]).filter((r) => r.title.startsWith("Update "));
    // The sweep files into the fac list, and the store has no list until an item is added to it.
    await issueAdd("fac", "the list the nightly sweep files into", { request: "Added so that fac has a list on main." });
    give("5.9.2");
    stale();
    await aleph(["tick"], { ALEPH_OUTDATED_CMD: cmd, ALEPH_PROBE_FAKE: "fail" });
    expect(await proposals()).toHaveLength(0);
    stale();
    await aleph(["tick"], { ALEPH_OUTDATED_CMD: cmd, ALEPH_PROBE_FAKE: "pass" });
    const first = await proposals();
    expect(first.map((r) => r.title).sort()).toEqual(["Update left-pad 1.0.0 to 1.2.0", "Update typescript 5.8.3 to 5.9.2"]);
    for (const r of first) {
      expect((await issueShow("fac", r.id)).json).toMatchObject({ source: "deps", areas: ["deps"], ask: { kind: "approval", reason: "proposal" } });
    }
    const rep = await reportText();
    expect(rep).toContain("Update left-pad 1.0.0 to 1.2.0");
    expect(await reportText()).not.toContain("Update left-pad");
    // The unchanged left-pad row files nothing again (deps.test.ts covers the reuse); the moved typescript row files one.
    give("5.9.3");
    stale();
    await aleph(["tick"], { ALEPH_OUTDATED_CMD: cmd, ALEPH_PROBE_FAKE: "pass" });
    expect((await proposals()).map((r) => r.title)).toContain("Update typescript 5.8.3 to 5.9.3");
    expect(await proposals()).toHaveLength(3);
    for (const r of await proposals()) await issueClose("fac", r.id, "drop", "test over");
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
  }, 120_000);
});
