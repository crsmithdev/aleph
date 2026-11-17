/**
 * Each shared job has one owner module. This test reads every source file and fails when a file
 * outside an owner does the owner's job.
 */
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SKIPPED = /^(node_modules|vendor|\.worktrees|acceptance)\/|\.test\.ts$/;

/** Source files under `dirs` whose text matches `re`, except `owners`. */
function offenders(re: RegExp, owners: string[], dirs = ["**"]): string[] {
  return dirs.flatMap((d) => [...new Glob(`${d}/*.ts`).scanSync(ROOT)])
    .filter((f) => !SKIPPED.test(f) && !owners.includes(f) && re.test(readFileSync(join(ROOT, f), "utf8")))
    .sort();
}

test("only lib/git.ts defines an exported git runner", () => {
  expect(offenders(/export (?:async )?function git(?:With)?\(|export const git(?:With)? =/, ["lib/git.ts"])).toEqual([]);
});

test("only lib/paths.ts reads home or ~/.aleph", () => {
  expect(offenders(/HOME \|\| homedir\(\)|homedir\(\), "\.aleph"|"~\/\.aleph|homedir\(\), "\.claude", "projects"|HOME, "\.aleph|HOME, "\.claude\/projects"/, ["lib/paths.ts"])).toEqual([]);
});

test("lib/, vault/, jobs/ and issues/ do not import ui/", () => {
  expect(offenders(/from "(?:\.\.\/)+ui\//, [], ["lib/**", "vault/**", "jobs/**", "issues/**"])).toEqual([]);
});

test("lib/ does not import jobs/, but the issue store reads an issue's Ask from its job record", () => {
  expect(offenders(/from "(?:\.\.\/)+jobs\//, ["lib/store.ts"], ["lib/**"])).toEqual([]);
  expect(offenders(/from "(?:\.\.\/)+jobs\/(?!lib\/records\/record\.ts")/, [], ["lib/**"])).toEqual([]);
});

test("only lib/langfuse.ts builds Langfuse's authorization", () => {
  expect(offenders(/publicKey\}:\$\{cfg\.secretKey|Basic \$\{/, ["lib/langfuse.ts"])).toEqual([]);
});

test("roles, land and gates do not import the orchestrator", () => {
  expect(offenders(/from "\.\.\/transitions\/factory\.ts"/, [], ["jobs/lib/roles/**", "jobs/lib/land/**", "jobs/lib/gates/**"])).toEqual([]);
});

test("issues/ imports jobs/ only in the issue verbs and issues/cli.ts, the `aleph issue` handler", () => {
  expect(offenders(/from "(?:\.\.\/)+jobs\//, ["issues/lib/issues.ts", "issues/cli.ts"], ["issues/**"])).toEqual([]);
});

test("only lib/day.ts writes a date as toISOString().slice(0, 10)", () => {
  expect(offenders(/toISOString\(\)\.slice\(0, 10\)/, ["lib/day.ts"])).toEqual([]);
});

test("only lib/day.ts subtracts days from a date with a ms-day literal next to today(", () => {
  expect(offenders(/today\(new Date\([^\n]*(?:86400_000|86_400_000|864e5)/, ["lib/day.ts"])).toEqual([]);
});

test("only vault/lib/vault.ts names the recall log file", () => {
  expect(offenders(/\.recall-log\.jsonl/, ["vault/lib/vault.ts", "vault/lib/templates.ts"])).toEqual([]);
});

test("only lib/frontmatter.ts splits a file's frontmatter by a regex", () => {
  expect(offenders(/\/\^---/, ["lib/frontmatter.ts"])).toEqual([]);
});

test("only lib/git.ts and skills/refit-code/ spawn git directly", () => {
  expect(offenders(/spawnSync\(\["git"/, ["lib/git.ts"]).filter((f) => !f.startsWith("skills/refit-code/"))).toEqual([]);
});
