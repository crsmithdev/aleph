import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJsonOr, writeJson } from "./json.ts";

const dir = mkdtempSync(join(tmpdir(), "aleph-json-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("a missing file is the fallback", () => {
  expect(readJsonOr(join(dir, "none.json"), { a: 1 })).toEqual({ a: 1 });
});

test("a file that does not parse throws", () => {
  writeFileSync(join(dir, "bad.json"), "{");
  expect(() => readJsonOr(join(dir, "bad.json"), {})).toThrow();
});

test("writeJson makes the folder and reads back", () => {
  const f = join(dir, "sub", "x.json");
  writeJson(f, { b: [2] });
  expect(readJsonOr(f, {})).toEqual({ b: [2] });
  expect(readFileSync(f, "utf8").endsWith("\n")).toBe(true);
});
