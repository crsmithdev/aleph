import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reader, writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { ctx, notes, setup, teardown } from "./factory.helpers.ts";
import { specVersion } from "./goal-spec.ts";
import { checkSpec, specVerdict } from "./spec-check.ts";

const SPEC = "## Goal\nGOALTEXT\n\n## Edit surface\nSURFACE\n\n## Oracle\nORACLETEXT\n";
let old: string | undefined;
beforeEach(() => { setup(); old = process.env.ALEPH_SPECCHECK_CMD; });
afterEach(() => {
  if (old === undefined) delete process.env.ALEPH_SPECCHECK_CMD; else process.env.ALEPH_SPECCHECK_CMD = old;
  teardown();
});

const repo = () => ({ key: "fac", path: join(ctx.base, "repo"), main: "main" }) as any;
const add = (spec = SPEC): number => writeList({ key: "fac" }, "add", (doc) => issues.add(doc, "T", { spec }).id, true)!.value;
/** A stub agent that records each call in `calls` and prints a stream-json result line. */
function stub(text: string, code = 0): string {
  const bin = join(ctx.base, "stub.sh"), calls = join(ctx.base, "calls");
  const line = JSON.stringify({ type: "result", subtype: "success", result: text, total_cost_usd: 0.25 });
  writeFileSync(bin, `#!/bin/sh\ncat > /dev/null\npwd >> ${calls}\nprintf '%s\n' '${line.replaceAll("'", "")}'\nexit ${code}\n`);
  chmodSync(bin, 0o755);
  process.env.ALEPH_SPECCHECK_CMD = bin;
  return calls;
}
/** The spec version of item `id` now. */
const version = (id: number) => specVersion(reader().item("fac", id)!);
const count = (calls: string) => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0);

test("specVerdict reads the last capital VERDICT line as lastTagged does: **VERDICT:** pass is pass", () => {
  expect(specVerdict("VERDICT: hold a\n**VERDICT:** pass\nverdict: hold b")).toEqual({ pass: true });
});

test("a failed call or a reply with no verdict is an error that is not tried again", async () => {
  const calls = stub("", 1);
  const id = add();
  expect((await checkSpec(repo(), id)).verdict).toBe("error");
  expect(notes(id)).toContain(`spec check: ${version(id)} error: `);
  expect((await checkSpec(repo(), id)).verdict).toBe("skip");
  expect(count(calls)).toBe(1);
  const calls2 = stub("rambling");
  const id2 = add("## Goal\nOther\n");
  expect((await checkSpec(repo(), id2)).verdict).toBe("error");
  expect(count(calls2)).toBe(2);
});
