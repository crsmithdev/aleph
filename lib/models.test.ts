import { expect, test } from "bun:test";
import { bare, isLocal } from "./models.ts";

test("bare drops a provider prefix, and isLocal finds the local model with or without one", () => {
  expect(bare("deepseek/deepseek-v4.1-flash")).toBe("deepseek-v4.1-flash");
  expect(bare("sonnet")).toBe("sonnet");
  expect(bare(undefined)).toBeUndefined();
  expect(isLocal("gpt-oss-20b")).toBe(true);
  expect(isLocal("local/gpt-oss-20b")).toBe(true);
  expect(isLocal("deepseek/deepseek-v4.1-flash")).toBe(false);
  expect(isLocal(undefined)).toBe(false);
});
