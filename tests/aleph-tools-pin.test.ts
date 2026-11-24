/**
 * The aleph-tools checkout that aleph loads (ui/dock.ts) is at the commit in ALEPH_TOOLS_REF, the commit CI clones.
 * The test skips when the checkout is missing or is not a git repository.
 */
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { root } from "../ui/dock.ts";

const PIN = join(import.meta.dir, "..", "ALEPH_TOOLS_REF");

/** "" when the HEAD of the checkout `dir` is the commit in `pinFile`, null when `dir` is no git repository, else a message naming both. */
function drift(dir: string, pinFile: string): string | null {
  const head = Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" });
  if (head.exitCode !== 0) return null;
  const [sha, pin] = [head.stdout.toString().trim(), readFileSync(pinFile, "utf8").trim()];
  return sha === pin ? "" : `aleph-tools HEAD is ${sha} but ALEPH_TOOLS_REF pins ${pin}`;
}

/** A repo with one commit, and a pin file that holds `pin(sha)`. */
function fixture(pin: (sha: string) => string): { dir: string; pinFile: string } {
  const base = mkdtempSync(join(tmpdir(), "aleph-tools-pin-"));
  const dir = join(base, "tools");
  mkdirSync(dir);
  const git = (...args: string[]) => Bun.spawnSync(["git", "-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdout: "pipe" });
  git("init");
  git("commit", "--allow-empty", "-m", "x");
  const pinFile = join(base, "ALEPH_TOOLS_REF");
  writeFileSync(pinFile, pin(git("rev-parse", "HEAD").stdout.toString().trim()) + "\n");
  return { dir, pinFile };
}

const live = drift(root, PIN);
test.skipIf(live === null)("the aleph-tools checkout is at the commit in ALEPH_TOOLS_REF", () => {
  expect(live).toBe("");
});

test("drift names both commits when HEAD is not the pin", () => {
  const { dir, pinFile } = fixture(() => "0".repeat(40));
  const head = Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"], { stdout: "pipe" }).stdout.toString().trim();
  expect(drift(dir, pinFile)).toBe(`aleph-tools HEAD is ${head} but ALEPH_TOOLS_REF pins ${"0".repeat(40)}`);
});

test("drift is empty when HEAD is the pin", () => {
  const { dir, pinFile } = fixture((sha) => sha);
  expect(drift(dir, pinFile)).toBe("");
});

test("drift is null in a directory that is no git repository", () => {
  const { pinFile } = fixture((sha) => sha);
  expect(drift(mkdtempSync(join(tmpdir(), "aleph-tools-pin-")), pinFile)).toBeNull();
});
