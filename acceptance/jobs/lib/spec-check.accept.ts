// Archived goal tests from jobs/lib/spec-check.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { setup, teardown } from "../../../jobs/lib/factory.helpers.ts";
import { specCheckPrompt } from "../../../jobs/lib/spec-check.ts";

const SPEC = "## Goal\nGOALTEXT\n\n## Edit surface\nSURFACE\n\n## Oracle\nORACLETEXT\n";
let old: string | undefined;
beforeEach(() => { setup(); old = process.env.ALEPH_SPECCHECK_CMD; });
afterEach(() => {
  if (old === undefined) delete process.env.ALEPH_SPECCHECK_CMD; else process.env.ALEPH_SPECCHECK_CMD = old;
  teardown();
});

test("the prompt holds the three parts of the spec and the verdict instruction", () => {
  const p = specCheckPrompt({ title: "T", spec: SPEC } as any);
  for (const s of ["GOALTEXT", "SURFACE", "ORACLETEXT", "VERDICT: pass", "VERDICT: hold"]) expect(p).toContain(s);
});
