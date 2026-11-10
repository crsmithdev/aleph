import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { factoryCookie, writeSessions } from "./ui-token.ts";

const dir = mkdtempSync(join(tmpdir(), "aleph-ui-token-"));
const was = process.env.ALEPH_FACTORY_DIR;
process.env.ALEPH_FACTORY_DIR = dir;
afterAll(() => {
  if (was === undefined) delete process.env.ALEPH_FACTORY_DIR;
  else process.env.ALEPH_FACTORY_DIR = was;
  rmSync(dir, { recursive: true, force: true });
});

const mode = (f: string) => statSync(join(dir, f)).mode & 0o777;

test("only the owner can read the factory token and the sessions, as the token is a login", () => {
  factoryCookie();
  expect(mode("ui-factory-token")).toBe(0o600);
  expect(mode("ui-sessions.json")).toBe(0o600);
  writeSessions(["a", "b"]);
  expect(mode("ui-sessions.json")).toBe(0o600);
});
