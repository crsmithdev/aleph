// Archived goal tests from jobs/cli.reviewer-hold.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { aleph, specFile, state, setup, teardown } from "../../jobs/cli.helpers";

// setup spawns openssl and git, so it can outlast the 5 s bun default; bun run test uses 30 s.
beforeAll(setup, 30_000);
afterAll(teardown);

describe("a factory run", () => {
  test("a run held for a held path is awaiting, with an approval ask and no needs; aleph jobs lists it as awaiting held", async () => {
    // No background review: it would rewrite the run's reason.
    const r = await aleph(["job", "fac", "rheldpath", "--spec", specFile("Goal: rheldpath\nACTION: commit held/rp.txt\n")], { ALEPH_REVIEW_CMD: "/bin/false" });
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "build", condition: "awaiting", ask: { kind: "approval", reason: "held-path" } });
    expect(s.needs).toBeUndefined();
    const listed = (await aleph(["jobs"])).json.find((j: any) => j.name === "rheldpath");
    expect(listed).toMatchObject({ condition: "awaiting", needs: "held" });
    await aleph(["drop", "rheldpath"]);
  });
});
