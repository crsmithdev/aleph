import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, seedItem, setup, teardown } from "./cli.helpers";
import { issueShow } from "./inproc";
import { issueNotes } from "./lib/flow.testkit.ts";

// The wiring of `aleph spec-check`; the factory's checks run in-process in jobs/lib/checks.flow.test.ts.
beforeAll(setup);
afterAll(teardown);

const reg = () => { const r = JSON.parse(readFileSync(join(base, "repos.json"), "utf8")); r.fac.author = true; const f = join(base, "repos-author.json"); writeFileSync(f, JSON.stringify(r)); return f; };
// A fake spec check: it records its input in specs-<name>.in, one block per call, and prints the reply.
const fakeSpec = (name: string, reply: string, code = 0) => {
  const f = join(base, `spec-${name}.sh`);
  writeFileSync(f, `#!/bin/sh\ncat >> ${base}/spec-${name}.in\necho '=====CALL' >> ${base}/spec-${name}.in\ncat <<'EOF'\n${JSON.stringify({ type: "result", subtype: "success", is_error: false, result: reply, total_cost_usd: 0.5 })}\nEOF\nexit ${code}\n`);
  chmodSync(f, 0o755);
  return f;
};
const calls = (name: string) => existsSync(join(base, `spec-${name}.in`)) ? readFileSync(join(base, `spec-${name}.in`), "utf8").split("=====CALL").length - 1 : 0;
const goalWith = (title: string) => seedItem("fac", title, { kind: "goal", issue: "fac-1", after: [] }, "## Goal\nEnd state one.\n\n## Oracle\nORACLE-TEXT\n");

test("aleph spec-check: a hold asks and is noted, and the same version is not checked again", async () => {
  const id = goalWith("held goal");
  const env = { ALEPH_REPOS: reg(), ALEPH_SPECCHECK_CMD: fakeSpec("c", "looked.\nVERDICT: hold the Oracle names needHead, which is outside the Edit surface") };
  const r = await aleph(["spec-check", `fac-${id}`], env);
  expect(r.json).toMatchObject({ verdict: "hold", problems: expect.stringContaining("needHead"), cost: 0.5 });
  const shown = (await issueShow("fac", id)).json;
  const ask = shown.ask ?? shown.item?.ask;
  expect(ask).toMatchObject({ kind: "input", reason: "spec-check" });
  expect(ask.question).toContain("needHead");
  expect(await issueNotes("fac", id)).toMatch(/spec check: [0-9a-f]{12} hold: the Oracle names needHead/);
  expect((await aleph(["spec-check", `fac-${id}`], env)).json).toMatchObject({ verdict: "skip" });
  expect(calls("c")).toBe(1);
}, 60_000);
