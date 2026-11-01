import { expect, test } from "bun:test";
import { parseFrontmatter, serializeFrontmatter, splitFrontmatter } from "./frontmatter.ts";

const roundTrip = (fm: Record<string, string | string[]>) => parseFrontmatter(splitFrontmatter(serializeFrontmatter(fm)).frontmatter!);

test.each([
  ["a plain scalar", "plain words"],
  ["an empty scalar", ""],
  ["a line break", "multi\nline"],
  ["a colon, hash and quotes", `a: b # "c" 'd'`],
  ["a backslash", "a\\b"],
  ["a leading indicator", "`code` first"],
  ["edge spaces", " padded "],
])("a scalar with %s survives a round trip", (_name, value) => {
  expect(roundTrip({ key: value })).toEqual({ key: value });
});

test.each([
  ["no items", []],
  ["plain items", ["a", "b c"]],
  ["a double quote", ['x"y', "b,c"]],
  ["a single quote", ["it's", "b"]],
  ["an empty item", ["", "a"]],
  ["a hash", ["#go", "a # b"]],
  ["brackets", ["[x]", "y]"]],
  ["a backslash before a quote", ['a\\"', "b"]],
  ["a line break", ["two\nlines", "b"]],
])("a list with %s survives a round trip", (_name, value) => {
  expect(roundTrip({ key: value as string[] })).toEqual({ key: value as string[] });
});

test("a note written by hand still parses: comments, single quotes and block lists", () => {
  expect(parseFrontmatter("a: b # note\nc: [x, 'y z'] # note\nd:\n  - e\n  - \"f\"")).toEqual({ a: "b", c: ["x", "y z"], d: ["e", "f"] });
});
