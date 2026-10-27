import { expect, test } from "bun:test";
import { parseOutdated } from "./deps.ts";

const TABLE = `
| Package          | Current | Update | Latest |
|------------------|---------|--------|--------|
| left-pad         | 1.0.0   | 1.0.0  | 1.2.0  |
| typescript (dev) | 5.8.3   | 5.9.2  | 5.9.2  |
| same             | 2.0.0   | 2.0.0  | 2.0.0  |
`;

test("a bun outdated table gives one proposal per package whose latest is newer", () => {
  expect(parseOutdated(TABLE)).toEqual([
    { name: "left-pad", current: "1.0.0", latest: "1.2.0" },
    { name: "typescript", current: "5.8.3", latest: "5.9.2" },
  ]);
});

test("the box-drawing table parses the same, and noise gives nothing", () => {
  expect(parseOutdated("│ Package │ Current │ Update │ Latest │\n│ a │ 1.9.0 │ 1.9.0 │ 1.10.0 │\n")).toEqual([{ name: "a", current: "1.9.0", latest: "1.10.0" }]);
  expect(parseOutdated("bun outdated v1.4.2\nnothing to do\n")).toEqual([]);
});
