import { afterEach, expect, test } from "bun:test";
import { checkSeconds, stallSeconds } from "./settings.ts";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

test("an empty variable is unset and gives the default", () => {
  process.env.ALEPH_CHECK_TIMEOUT = "";
  process.env.ALEPH_STALL_SECONDS = "";
  expect(checkSeconds()).toBe(1200);
  expect(stallSeconds()).toBe(600);
});

test("a set variable gives its number", () => {
  process.env.ALEPH_STALL_SECONDS = "7";
  expect(stallSeconds()).toBe(7);
});
