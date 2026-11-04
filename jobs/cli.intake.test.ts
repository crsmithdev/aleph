import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, seedItem, setup, teardown } from "./cli.helpers";
import { issueShow } from "./inproc";
import { issueNotes } from "./lib/flow.testkit.ts";

// The wiring of `aleph intake`; intake's own cases are in jobs/lib/intake.test.ts.
beforeAll(setup);
afterAll(teardown);

const reg = () => { const r = JSON.parse(readFileSync(join(base, "repos.json"), "utf8")); r.fac.author = true; const f = join(base, "repos-author.json"); writeFileSync(f, JSON.stringify(r)); return f; };
// A fake intake run: it records its input in intake-<name>.in, one block per call, and prints the reply.
const fakeIntake = (name: string, verdict: object) => {
  const f = join(base, `intake-${name}.sh`);
  writeFileSync(f, `#!/bin/sh\ncat >> ${base}/intake-${name}.in\necho '=====CALL' >> ${base}/intake-${name}.in\ncat <<'EOF'\n${JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "", structured_output: { verdict }, total_cost_usd: 0.5 })}\nEOF\n`);
  chmodSync(f, 0o755);
  return f;
};
const calls = (name: string) => existsSync(join(base, `intake-${name}.in`)) ? readFileSync(join(base, `intake-${name}.in`), "utf8").split("=====CALL").length - 1 : 0;

test("aleph intake: a goal filed with a spec in a repo with author is taken in once, and its spec rewritten", async () => {
  const id = seedItem("fac", "filed goal", { kind: "goal", issue: "fac-1", after: [] }, "## Goal\nEnd state one.\n\n## Oracle\nORACLE-TEXT\n");
  const verdict = { route: "build", reason: "one run", spec: { goal: "End state one.", edit_surface: [{ path: "one.ts", new: true }], oracle: ["`bun run test` passes"] } };
  const env = { ALEPH_REPOS: reg(), ALEPH_INTAKE_CMD: fakeIntake("c", verdict) };
  const r = await aleph(["intake", `fac-${id}`], env);
  expect(r.json).toMatchObject({ counts: { build: 1 }, skipped: [] });
  expect(readFileSync(join(base, "intake-c.in"), "utf8")).toContain("# Its spec now\n\n## Goal\nEnd state one.");
  const shown = (await issueShow("fac", id)).json;
  expect(shown.spec).toContain("- one.ts (new)");
  expect(await issueNotes("fac", id)).toContain("intake: build: one run");
  expect((await aleph(["intake", `fac-${id}`], env)).json).toMatchObject({ counts: {} });
  expect(calls("c")).toBe(1);
}, 60_000);
