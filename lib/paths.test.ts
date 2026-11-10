import { afterEach, expect, test } from "bun:test";
import { alephPath, vaultDir } from "./paths.ts";

const saved = { HOME: process.env.HOME, ALEPH_VAULT: process.env.ALEPH_VAULT, ALEPH_FACTORY_DIR: process.env.ALEPH_FACTORY_DIR };
afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });

test("a variable with a leading ~ and the default both follow HOME", () => {
  process.env.HOME = "/h";
  process.env.ALEPH_VAULT = "~/v";
  expect(vaultDir()).toBe("/h/v");
  delete process.env.ALEPH_FACTORY_DIR;
  expect(alephPath("ALEPH_FACTORY_DIR", "factory")).toBe("/h/.aleph/factory");
});
