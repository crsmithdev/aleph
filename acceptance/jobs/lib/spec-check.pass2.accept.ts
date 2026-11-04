// Archived goal tests from jobs/lib/spec-check.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readList, reader, writeList } from "../../../todo/lib/store.ts";
import * as issues from "../../../todo/lib/todo.ts";
import { ctx, notes, setup, teardown } from "../../../jobs/lib/factory.helpers.ts";
import { specVersion } from "../../../jobs/lib/goal-spec.ts";
import { askOf } from "../../../jobs/lib/ask.ts";
import { checkSpec, parseSpecCheck, runSpecCheck } from "../../../jobs/lib/spec-check.ts";

const SPEC = "## Goal\nGOALTEXT\n\n## Edit surface\nSURFACE\n\n## Oracle\nORACLETEXT\n";
let old: string | undefined;
beforeEach(() => { setup(); old = process.env.ALEPH_SPECCHECK_CMD; });
afterEach(() => {
  if (old === undefined) delete process.env.ALEPH_SPECCHECK_CMD; else process.env.ALEPH_SPECCHECK_CMD = old;
  teardown();
});

const repo = () => ({ key: "fac", path: join(ctx.base, "repo"), main: "main" }) as any;
const add = (spec = SPEC): number => writeList({ key: "fac" }, "add", (doc) => issues.add(doc, "T", { spec }).id, true)!.value;
/** A stub agent that records each call in `calls` and prints a stream-json result line whose structured output is `out`. */
function stub(out: object, code = 0): string {
  const bin = join(ctx.base, "stub.sh"), calls = join(ctx.base, "calls");
  const line = JSON.stringify({ type: "result", subtype: "success", result: "", structured_output: out, total_cost_usd: 0.25 });
  writeFileSync(bin, `#!/bin/sh\ncat > /dev/null\npwd >> ${calls}\nprintf '%s\n' '${line.replaceAll("'", "")}'\nexit ${code}\n`);
  chmodSync(bin, 0o755);
  process.env.ALEPH_SPECCHECK_CMD = bin;
  return calls;
}
/** The spec version of item `id` now. */
const version = (id: number) => specVersion(reader().item("fac", id)!);
const count = (calls: string) => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0);

const PASS = { verdict: "pass", blocks: [], notes: [] };
const HOLD = { verdict: "hold", blocks: ["\"ORACLETEXT\" is outside the surface: add it"], notes: [] };

test("parseSpecCheck reads pass, hold with problems, and a reason for no reply", () => {
  expect(parseSpecCheck(PASS)).toMatchObject({ pass: true });
  expect(parseSpecCheck({ ...PASS, verdict: "hold", blocks: ["\"a\" vs \"b\": drop b"] })).toMatchObject({ pass: false, blocks: ["\"a\" vs \"b\": drop b"] });
  expect(parseSpecCheck(undefined)).toBe("no structured output");
});

test("a pass writes its note, returns the cost, and a second call skips", async () => {
  const calls = stub(PASS);
  const id = add();
  expect(await checkSpec(repo(), id)).toEqual({ verdict: "pass", cost: 0.25 });
  expect(notes(id)).toContain(`spec check: ${version(id)} pass`);
  expect(count(calls)).toBe(1);
  expect(readFileSync(calls, "utf8")).not.toContain(join(ctx.base, "repo\n"));
  expect(await checkSpec(repo(), id)).toEqual({ verdict: "skip" });
  expect(count(calls)).toBe(1);
  // After an edit the next call runs again.
  writeList({ key: "fac" }, "edit", (doc) => { issues.find(doc, id)!.spec = SPEC + "\nmore\n"; return true; });
  expect((await checkSpec(repo(), id)).verdict).toBe("pass");
  expect(count(calls)).toBe(2);
});

test("a hold carries its problems", async () => {
  stub(HOLD);
  const id = add();
  expect(await checkSpec(repo(), id)).toEqual({ verdict: "hold", problems: "\"ORACLETEXT\" is outside the surface: add it", cost: 0.25 });
  expect(notes(id)).toContain(`spec check: ${version(id)} hold: "ORACLETEXT" is outside the surface: add it`);
});

test("a spec-check hold adds exactly one new note, the one with the hold text, and sets the Ask", async () => {
  stub(HOLD);
  const id = add();
  const before = readList({ key: "fac" })!.items.find((i) => i.id === id)!.notes.length;
  expect((await runSpecCheck(repo(), id)).verdict).toBe("hold");
  const after = readList({ key: "fac" })!.items.find((i) => i.id === id)!.notes;
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)).toContain(`spec check: ${version(id)} hold: "ORACLETEXT" is outside the surface: add it`);
  expect(after.some((n) => n.includes("asks Chris:"))).toBe(false);
  expect(askOf(reader().item("fac", id)!)).toMatchObject({ reason: "spec-check" });
});

test("an item with no spec is skipped", async () => {
  const calls = stub(PASS);
  expect((await checkSpec(repo(), add(" "))).verdict).toBe("skip");
  expect(count(calls)).toBe(0);
});
