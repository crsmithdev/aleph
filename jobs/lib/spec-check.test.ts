import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reader, writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { change, ctx, notes, setup, teardown } from "./factory.helpers.ts";
import { specVersion } from "./goal-spec.ts";
import { checkSpec, parseSpecCheck, passNotes, specCheckPrompt } from "./spec-check.ts";

const SPEC = "## Goal\nGOALTEXT\n\n## Edit surface\nSURFACE\n\n## Oracle\nORACLETEXT\n";
let old: string | undefined;
beforeEach(() => { setup(); old = process.env.ALEPH_SPECCHECK_CMD; });
afterEach(() => {
  if (old === undefined) delete process.env.ALEPH_SPECCHECK_CMD; else process.env.ALEPH_SPECCHECK_CMD = old;
  teardown();
});

const repo = () => ({ key: "fac", path: join(ctx.base, "repo"), main: "main" }) as any;
const add = (spec = SPEC): number => writeList({ key: "fac" }, "add", (doc) => issues.add(doc, "T", { spec }).id, true)!.value;
/** The spec check's structured output. */
const verdict = (v: "pass" | "hold", o: { blocks?: string[]; notes?: string[] } = {}) => ({ verdict: v, blocks: [], notes: [], ...o });
/** A stub spec check that appends each prompt to `spec.in` and replies with `out` as its structured output. */
function specStub(out: object): string {
  const bin = join(ctx.base, "spec.sh"), input = join(ctx.base, "spec.in");
  const line = JSON.stringify({ type: "result", subtype: "success", result: "", structured_output: out, total_cost_usd: 0.5 });
  writeFileSync(bin, `#!/bin/sh\ncat >> ${input}\necho =====CALL >> ${input}\nprintf '%s\n' '${line.replaceAll("'", "")}'\n`);
  chmodSync(bin, 0o755);
  process.env.ALEPH_SPECCHECK_CMD = bin;
  return input;
}

/** A stub agent that records each call in `calls` and prints a stream-json result line with `text` and no structured output. */
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

test("the prompt carries the spec-review method", () => {
  const p = specCheckPrompt({ title: "T", spec: SPEC, request: "" } as any);
  for (const s of ["Not observable", "Out of reach", "Bare bun test path", "A name is not evidence", "When <trigger or input>", "Read the spec as the builder"]) expect(p).toContain(s);
});

test("the prompt holds only on a block, carries the request, and with held it cannot hold", () => {
  const item = { title: "T", spec: SPEC, request: "REQUESTTEXT" } as any;
  const p = specCheckPrompt(item);
  for (const s of ["## Request", "REQUESTTEXT", "## Block or note", 'The verdict is "hold" when one problem or more blocks the goal', 'Each block goes in "blocks"', "It never asks the builder to add a committed test"]) expect(p).toContain(s);
  const h = specCheckPrompt(item, true);
  expect(h).toContain("Do not hold it again");
  expect(h).toContain('The verdict is "pass", and every problem goes in "notes".');
  expect(h).not.toContain('"hold"');
  expect(specCheckPrompt({ ...item, request: "" })).not.toContain("## Request");
});

test("parseSpecCheck reads the verdict, each problem on one line, ; a missing or odd reply is a reason", () => {
  expect(parseSpecCheck(verdict("pass", { notes: ["\"a\"\n  say b"] }))).toEqual({ pass: true, blocks: [], notes: ["\"a\" say b"] });
  expect(parseSpecCheck(verdict("hold", { blocks: ["x"] }))).toEqual({ pass: false, blocks: ["x"], notes: [] });
  expect(parseSpecCheck(undefined)).toBe("no structured output");
  expect(parseSpecCheck({ verdict: "maybe" })).toBe('unknown verdict "maybe"');
});

test("a pass with notes records them for the worker; a plain pass has none", async () => {
  specStub(verdict("pass", { notes: ["\"GOALTEXT\" is vague; say which page", "\"SURFACE\" names no file"] }));
  const id = add();
  expect((await checkSpec(repo(), id)).verdict).toBe("pass");
  expect(notes(id)).toContain(`spec check: ${version(id)} pass: "GOALTEXT" is vague; say which page | "SURFACE" names no file`);
  expect(passNotes(reader().item("fac", id)!)).toBe(`"GOALTEXT" is vague; say which page | "SURFACE" names no file`);
  specStub(verdict("pass"));
  const id2 = add("## Goal\nOther\n");
  await checkSpec(repo(), id2);
  expect(passNotes(reader().item("fac", id2)!)).toBe("");
});

test("a goal is held at most once: after an edit, a second hold passes with its problems as notes", async () => {
  const input = specStub(verdict("hold", { blocks: ["\"ORACLETEXT\" names no command; name one"] }));
  const id = add();
  expect((await checkSpec(repo(), id)).verdict).toBe("hold");
  change(id, (item) => { item.spec = SPEC.replace("ORACLETEXT", "ORACLE TWO"); });
  expect((await checkSpec(repo(), id)).verdict).toBe("pass");
  expect(notes(id)).toContain(`spec check: ${version(id)} pass: "ORACLETEXT" names no command; name one`);
  const prompts = readFileSync(input, "utf8").split("=====CALL");
  expect(prompts[0]).not.toContain("Do not hold it again");
  expect(prompts[1]).toContain("Do not hold it again");
});

test("a failed call or a reply with no verdict is an error that is not tried again", async () => {
  const calls = stub("", 1);
  const id = add();
  expect((await checkSpec(repo(), id)).verdict).toBe("error");
  expect(notes(id)).toContain(`spec check: ${version(id)} error: `);
  expect((await checkSpec(repo(), id)).verdict).toBe("skip");
  expect(count(calls)).toBe(1);
  // A reply with text and no structured output: VERDICT lines are not read.
  const calls2 = stub("rambling\nVERDICT: pass");
  const id2 = add("## Goal\nOther\n");
  expect((await checkSpec(repo(), id2)).verdict).toBe("error");
  expect(count(calls2)).toBe(2);
});

test("the spec check asks three questions", async () => {
  const spec = specStub(verdict("pass"));
  const id = add();
  expect((await checkSpec(repo(), id)).verdict).toBe("pass");
  expect(readFileSync(spec, "utf8")).toContain("Answer three questions");
});
