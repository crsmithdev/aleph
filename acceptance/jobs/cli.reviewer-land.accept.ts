// Archived goal tests from jobs/cli.reviewer-land.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, env, jobsDir, remote, sh, specFile, state, setup, teardown } from "../../jobs/cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, more: string[] = []) =>
    aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), ...more], extra);

  test("a held run landed with the firefighter as lander gets Held-by: firefighter, not Chris", async () => {
    const r = await fjob("fheldff", "commit held/y.txt");
    expect(state(r.json.run)).toMatchObject({ condition: "awaiting", ask: expect.objectContaining({ kind: "approval", reason: "held-path" }) });
    const code = `import { land } from "${join((import.meta.dir + "/../../jobs"), "lib/transitions.ts")}"; const s = await land("fheldff", { lander: "firefighter" }, { output: "ignore" }); await s.child?.exited;`;
    const p = Bun.spawn(["bun", "-e", code], { cwd: base, env: env(), stdout: "pipe", stderr: "pipe" });
    expect(await p.exited).toBe(0);
    const landRun = readdirSync(jobsDir).filter((d) => d.endsWith("-land") || existsSync(join(jobsDir, d, "state.json"))).map((d) => state(d)).filter((x) => x.kind === "land" && x.name === "fheldff").at(-1);
    expect(landRun).toMatchObject({ condition: "landed", held: true, lander: "firefighter" });
    const trailers = remoteGit("log", "-1", "--format=%(trailers:only)", "main");
    expect(trailers).toContain("Held-by: firefighter");
    expect(trailers).not.toContain("Held-by: Chris");
  });
});
