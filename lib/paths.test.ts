import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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

test("under bun test, a path in the live store throws, even when HOME is the live home", () => {
  const owner = userInfoHome();
  process.env.HOME = owner;
  delete process.env.ALEPH_FACTORY_DIR;
  expect(() => alephPath("ALEPH_FACTORY_DIR", "factory")).toThrow("a test reached the live store: ALEPH_FACTORY_DIR unset");
  process.env.ALEPH_FACTORY_DIR = `${owner}/.aleph/factory`;
  expect(() => alephPath("ALEPH_FACTORY_DIR", "factory")).toThrow("a test reached the live store");
});

/** The passwd home of this uid, read the way lib/paths.ts reads it. */
function userInfoHome(): string {
  const row = readFileSync("/etc/passwd", "utf8").split("\n").map((l) => l.split(":")).find((f) => f[2] === String(process.getuid?.()));
  return row![5];
}
