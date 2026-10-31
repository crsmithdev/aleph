import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, repo, setup, teardown } from "./cli.helpers";

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
    const proposals = async () => ((await aleph(["issue", "list", "fac", "--json"])).json as any[]).filter((r) => r.title.startsWith("Update "));
    // The sweep files into the fac list, and the store has no list until an item is added to it.
    await aleph(["issue", "add", "fac", "the list the nightly sweep files into", "--body", "Added so that fac has a list on main."]);
    give("5.9.2");
    stale();
    await aleph(["tick"], { ALEPH_OUTDATED_CMD: cmd, ALEPH_PROBE_FAKE: "fail" });
    expect(await proposals()).toHaveLength(0);
    stale();
    await aleph(["tick"], { ALEPH_OUTDATED_CMD: cmd, ALEPH_PROBE_FAKE: "pass" });
    const first = await proposals();
    expect(first.map((r) => r.title).sort()).toEqual(["Update left-pad 1.0.0 to 1.2.0", "Update typescript 5.8.3 to 5.9.2"]);
    for (const r of first) {
      const item = (await aleph(["issue", "show", "fac", String(r.id), "--json"])).json;
      expect(item).toMatchObject({ source: "deps", kind: "issue", areas: [], ask: { kind: "approval", reason: "proposal" } });
    }
    const rep = (await aleph(["report"])).stdout;
    expect(rep).toContain("Update left-pad 1.0.0 to 1.2.0");
    expect((await aleph(["report"])).stdout).not.toContain("Update left-pad");
    stale();
    await aleph(["tick"], { ALEPH_OUTDATED_CMD: cmd, ALEPH_PROBE_FAKE: "pass" });
    expect(await proposals()).toHaveLength(2);
    give("5.9.3");
    stale();
    await aleph(["tick"], { ALEPH_OUTDATED_CMD: cmd, ALEPH_PROBE_FAKE: "pass" });
    expect((await proposals()).map((r) => r.title)).toContain("Update typescript 5.8.3 to 5.9.3");
    expect(await proposals()).toHaveLength(3);
    for (const r of await proposals()) await aleph(["issue", "drop", "fac", String(r.id), "test over"]);
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
  }, 120_000);

  test("the nightly sweep logs a repo with no list and still files the next repo's proposals", async () => {
    const cmd = join(base, "outdated-nolist.sh");
    writeFileSync(cmd, `#!/bin/bash\ncat <<'EOF'\n| Package | Current | Update | Latest |\n|---------|---------|--------|--------|\n| left-pad | 1.0.0 | 1.0.0 | 1.2.0 |\nEOF\n`, { mode: 0o755 });
    const reg = readFileSync(join(base, "repos.json"), "utf8");
    // "nolist" comes first, so the sweep must go on past it to "fac".
    writeFileSync(join(base, "repos.json"), JSON.stringify({ nolist: { path: repo, sandbox: true, checks: [], autoland: false }, ...JSON.parse(reg) }));
    try {
      rmSync(join(base, "factory", "probe.json"), { force: true });
      await aleph(["tick"], { ALEPH_OUTDATED_CMD: cmd, ALEPH_PROBE_FAKE: "pass" });
      expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toMatch(/deps nolist: .*no list/);
      const rows = ((await aleph(["issue", "list", "fac", "--json"])).json as any[]).filter((r) => r.title.startsWith("Update "));
      expect(rows.map((r) => r.title)).toContain("Update left-pad 1.0.0 to 1.2.0");
      for (const r of rows) await aleph(["issue", "drop", "fac", String(r.id), "test over"]);
    } finally {
      writeFileSync(join(base, "repos.json"), reg);
      writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    }
  }, 120_000);
});
