import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readHidden, reader, writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { change, ctx, notes, setup, teardown } from "./factory.helpers.ts";
import { specVersion } from "./goal-spec.ts";
import { checkSpec, parseSpecCheck, passNotes, specCheckPrompt } from "./spec-check.ts";
import { seal } from "./author.ts";
import { setAside } from "./acceptance.ts";

const SPEC = "## Goal\nGOALTEXT\n\n## Edit surface\nSURFACE\n\n## Oracle\nORACLETEXT\n";
let old: string | undefined;
let oldAuthor: string | undefined;
beforeEach(() => { setup(); old = process.env.ALEPH_SPECCHECK_CMD; oldAuthor = process.env.ALEPH_AUTHOR_CMD; });
afterEach(() => {
  if (old === undefined) delete process.env.ALEPH_SPECCHECK_CMD; else process.env.ALEPH_SPECCHECK_CMD = old;
  if (oldAuthor === undefined) delete process.env.ALEPH_AUTHOR_CMD; else process.env.ALEPH_AUTHOR_CMD = oldAuthor;
  teardown();
});

const repo = () => ({ key: "fac", path: join(ctx.base, "repo"), main: "main" }) as any;
const add = (spec = SPEC): number => writeList({ key: "fac" }, "add", (doc) => issues.add(doc, "T", { spec }).id, true)!.value;
const authorRepo = () => ({ ...repo(), author: true, sandbox: true });
/** A stub author that appends each prompt to `author.in`, one `=====CALL` line after each, and replies `text`. */
function author(text: string): string {
  const bin = join(ctx.base, "author.sh"), input = join(ctx.base, "author.in");
  const line = JSON.stringify({ type: "result", subtype: "success", result: text, total_cost_usd: 0.25 });
  writeFileSync(bin, `#!/bin/sh\ncat >> ${input}\necho =====CALL >> ${input}\nprintf '%s\n' '${line.replaceAll("'", "")}'\n`);
  chmodSync(bin, 0o755);
  process.env.ALEPH_AUTHOR_CMD = bin;
  return input;
}
/** The spec check's structured output. */
const verdict = (v: "pass" | "hold", o: { blocks?: string[]; notes?: string[]; set_aside?: { scenario: number; why: string }[] } = {}) => ({ verdict: v, blocks: [], notes: [], ...o });
/** A stub spec check that appends each prompt to `spec.in` and replies with `out` as its structured output. */
function specStub(out: object): string {
  const bin = join(ctx.base, "spec.sh"), input = join(ctx.base, "spec.in");
  const line = JSON.stringify({ type: "result", subtype: "success", result: "", structured_output: out, total_cost_usd: 0.5 });
  writeFileSync(bin, `#!/bin/sh\ncat >> ${input}\necho =====CALL >> ${input}\nprintf '%s\n' '${line.replaceAll("'", "")}'\n`);
  chmodSync(bin, 0o755);
  process.env.ALEPH_SPECCHECK_CMD = bin;
  return input;
}
const callsIn = (f: string) => (existsSync(f) ? readFileSync(f, "utf8").split("=====CALL").length - 1 : 0);
const sealed = (id: number) => readHidden({ key: "fac" }, `fac-${id}`)["scenarios.md"];
const SCENES = "1. FIRST-SCENE is seen.\n2. SECOND-SCENE is seen.\n3. THIRD-SCENE is seen.\n";

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

test("the prompt carries the spec-review method, with and without sealed scenarios", () => {
  const item = { title: "T", spec: SPEC, request: "" } as any;
  for (const p of [specCheckPrompt(item), specCheckPrompt(item, "1. A is seen.\n")]) {
    for (const s of ["Not observable", "Out of reach", "Bare bun test path", "A name is not evidence", "When <trigger or input>", "Read the spec as the builder"]) expect(p).toContain(s);
  }
  expect(specCheckPrompt(item, "1. A is seen.\n")).toContain('Put each one that does not in "set_aside"');
});

test("the prompt holds only on a block, carries the request, and with held it cannot hold", () => {
  const item = { title: "T", spec: SPEC, request: "REQUESTTEXT" } as any;
  const p = specCheckPrompt(item);
  for (const s of ["## Request", "REQUESTTEXT", "## Block or note", 'The verdict is "hold" when one problem or more blocks the goal', 'Each block goes in "blocks"', "It never asks the builder to add a committed test"]) expect(p).toContain(s);
  const h = specCheckPrompt(item, "", true);
  expect(h).toContain("Do not hold it again");
  expect(h).toContain('The verdict is "pass", and every problem goes in "notes".');
  expect(h).not.toContain('"hold"');
  expect(specCheckPrompt({ ...item, request: "" })).not.toContain("## Request");
});

test("parseSpecCheck reads the verdict, each problem on one line, and the set-aside scenarios; a missing or odd reply is a reason", () => {
  expect(parseSpecCheck(verdict("pass", { notes: ["\"a\"\n  say b"] }))).toEqual({ pass: true, blocks: [], notes: ["\"a\" say b"], asides: new Map() });
  expect(parseSpecCheck(verdict("hold", { blocks: ["x"], set_aside: [{ scenario: 2, why: "no" }] }))).toEqual({ pass: false, blocks: ["x"], notes: [], asides: new Map([[2, "no"]]) });
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

test("the spec check seals first, gives the scenarios to the check, and counts both costs", async () => {
  const asked = author(SCENES);
  const spec = specStub(verdict("pass"));
  const id = add();
  const c = await checkSpec(authorRepo(), id);
  expect(c).toMatchObject({ verdict: "pass", cost: 0.75 });
  expect(callsIn(asked)).toBe(1);
  expect(sealed(id)).toBe(SCENES);
  expect(notes(id)).toContain(`sealed checks: ${version(id)} 3 scenarios from a fresh author`);
  const p = readFileSync(spec, "utf8");
  expect(p).toContain("## Sealed scenarios");
  expect(p).toContain("2. SECOND-SCENE is seen.");
  expect(p).toContain('"set_aside"');
});

test("a repo without author seals nothing and asks three questions", async () => {
  const asked = author(SCENES);
  const spec = specStub(verdict("pass"));
  const id = add();
  expect((await checkSpec(repo(), id)).verdict).toBe("pass");
  expect(callsIn(asked)).toBe(0);
  expect(notes(id)).not.toContain("sealed checks:");
  expect(readFileSync(spec, "utf8")).toContain("Answer three questions");
});

test("the same spec version is not sealed again; a new version re-seals and overwrites the scenarios", async () => {
  const asked = author(SCENES);
  specStub(verdict("pass"));
  const id = add();
  await checkSpec(authorRepo(), id);
  const first = version(id);
  await seal(authorRepo(), id);
  expect(callsIn(asked)).toBe(1);
  change(id, (item) => { item.spec = SPEC.replace("GOALTEXT", "GOALTEXT TWO"); });
  author("1. NEW-SCENE is seen.\n");
  expect((await checkSpec(authorRepo(), id)).verdict).toBe("pass");
  expect(version(id)).not.toBe(first);
  expect(callsIn(asked)).toBe(2);
  expect(sealed(id)).toBe("1. NEW-SCENE is seen.\n");
  expect(notes(id)).toContain(`sealed checks: ${version(id)} 1 scenario from a fresh author`);
});

test("a new version whose author writes none empties the old scenarios", async () => {
  author(SCENES);
  specStub(verdict("pass"));
  const id = add();
  await checkSpec(authorRepo(), id);
  change(id, (item) => { item.spec = SPEC.replace("GOALTEXT", "GOALTEXT TWO"); });
  author("I cannot write these.");
  await checkSpec(authorRepo(), id);
  expect(sealed(id)).toBe("");
  expect(notes(id)).toContain(`sealed checks: ${version(id)} none: the author's reply has no numbered scenario`);
});

test("a SET-ASIDE line removes that scenario, keeps the others' numbers, and notes it; the goal is not held", async () => {
  author(SCENES);
  specStub(verdict("pass", { set_aside: [{ scenario: 2, why: "it asks for more than the Goal" }, { scenario: 9, why: "not a scenario" }] }));
  const id = add();
  expect((await checkSpec(authorRepo(), id)).verdict).toBe("pass");
  expect(sealed(id)).toBe("1. FIRST-SCENE is seen.\n3. THIRD-SCENE is seen.\n");
  expect(notes(id)).toContain(`sealed checks: ${version(id)} the spec check set aside: scenario 2: it asks for more than the Goal`);
  expect(notes(id)).not.toContain("scenario 9");
  // The note is not the reviewer's: acceptance sets nothing aside for it.
  expect([...setAside(reader().item("fac", id)!)]).toEqual([]);
});

test("when every scenario is set aside, the goal has none", async () => {
  author("1. A.\n2. B.\n");
  specStub(verdict("pass", { set_aside: [{ scenario: 1, why: "no" }, { scenario: 2, why: "no" }] }));
  const id = add();
  await checkSpec(authorRepo(), id);
  expect(sealed(id)).toBe("");
});
