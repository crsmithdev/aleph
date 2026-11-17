import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git.ts";
import { alephPath, scopeOfCwd, vaultDir } from "./paths.ts";
import { newItems, writeRepos } from "../tests/projects.testkit.ts";

const saved = { HOME: process.env.HOME, ALEPH_VAULT: process.env.ALEPH_VAULT, ALEPH_FACTORY_DIR: process.env.ALEPH_FACTORY_DIR, ALEPH_ITEMS: process.env.ALEPH_ITEMS };
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

test("scopeOfCwd gives the registry key of a repo whose folder has another name, from its worktree too, else the folder name; by path alone with git false", () => {
  const dir = mkdtempSync(join(tmpdir(), "paths-"));
  try {
    const items = newItems(dir, "items");
    const repo = (name: string) => {
      const at = join(dir, name);
      mkdirSync(at);
      git(at, "init", "-q", "-b", "main");
      git(at, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "start");
      return at;
    };
    const checkout = repo("checkout"), other = repo("other");
    writeRepos({ alpha: { path: checkout } }, items);
    process.env.ALEPH_ITEMS = items;
    const tree = join(dir, "tree");
    git(checkout, "worktree", "add", "-q", tree, "-b", "x");
    expect(scopeOfCwd(checkout)).toBe("alpha");
    expect(scopeOfCwd(tree)).toBe("alpha");
    expect(scopeOfCwd(join(checkout, "gone", "deep"))).toBe("alpha");
    expect(scopeOfCwd(other)).toBe("other");
    expect(scopeOfCwd(join(checkout, "gone", "deep"), false)).toBe("alpha");
    expect(scopeOfCwd(tree, false)).toBe("");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/** The passwd home of this uid, read the way lib/paths.ts reads it. */
function userInfoHome(): string {
  const row = readFileSync("/etc/passwd", "utf8").split("\n").map((l) => l.split(":")).find((f) => f[2] === String(process.getuid?.()));
  return row![5];
}
