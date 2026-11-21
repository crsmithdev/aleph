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

/** Source files under `dirs` with extension `ext` whose text matches `re`, except `owners`. */
function offenders(re: RegExp, owners: string[], dirs = ["**"], ext = "ts"): string[] {
  return dirs.flatMap((d) => [...new Glob(`${d}/*.${ext}`).scanSync(ROOT)])
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

// Each owner below keeps one rule for its job; a copy elsewhere skips that rule.

test("only lib/errtext.ts writes an error's text, and no file types a catch as any", () => {
  expect(offenders(/\?\.message \?\? String\(|catch \(\w+: any\)/, ["lib/errtext.ts"], ["{jobs,ui,vault,hooks,lib,issues,herdr}/**"])).toEqual([]);
});

test("only lib/layout.ts defines factoryDir or names dispatch.log", () => {
  expect(offenders(/export (?:const|function) factoryDir\b|["'`]dispatch\.log["'`]/, ["lib/layout.ts", "jobs/cli.testkit.ts"], ["{jobs,ui,vault,hooks,lib,issues}/**"])).toEqual([]);
});

test("only lib/naming.ts builds an issue key", () => {
  expect(offenders(/`issue\.\$\{/, ["lib/naming.ts", "lib/issue-file.ts"], ["{jobs,ui,vault,issues,hooks,lib}/**"])).toEqual([]);
});

test("no file commits into the items repo but through the store", () => {
  expect(offenders(/commitPaths\(\s*itemsDir\(\)/, [], ["{jobs,ui,vault,hooks,lib,ideas}/**"])).toEqual([]);
});

test("only lib/store.ts calls itemsDir(), and the files that need the folder itself", () => {
  // The idea files beside the issues, the media folder a run reads, and the guard that protects the checkout.
  const reads = ["ideas/ideas.ts", "jobs/lib/roles/intake.ts", "hooks/git-guard.ts"];
  expect(offenders(/\bitemsDir\(\)/, ["lib/store.ts", ...reads], ["{jobs,ui,vault,hooks,lib,ideas}/**"])).toEqual([]);
});

test("only lib/jsonl.ts parses a transcript line by line", () => {
  expect(offenders(/for \(const \w+ of [^)]*split\("\\n"\)\)[\s\S]{0,120}JSON\.parse\(/, [], ["{hooks,skills}/**"])).toEqual([]);
});

test("only lib/json.ts parses a JSON file it reads: a copy that catches the parse turns a corrupt file into the default", () => {
  expect(offenders(/JSON\.parse\(\s*readFileSync\(/, ["jobs/lib/land/landing.testkit.ts"], ["{jobs,ui,vault,hooks}/**"])).toEqual([]);
});

test("no file writes a fixed `${file}.tmp` for a rename: two writers would collide, so writeJson names it by pid", () => {
  expect(offenders(/\$\{\w+\}\.tmp/, [], ["{jobs,ui,vault,hooks,lib}/**"])).toEqual([]);
});

test("only jobs/lib/infra/process.ts signals a process group: a copy that signals the pid only on a throw leaves a child behind", () => {
  expect(offenders(/process\.kill\(-/, ["jobs/lib/infra/process.ts"], ["{jobs,ui,vault,hooks}/**"])).toEqual([]);
});

test("only the store and the issue verbs read or write an issue's fm field: a caller skips the store's rules for that field", () => {
  expect(offenders(/\b(item|issue|i)\.fm[.[]/, ["lib/store.ts", "lib/issue-file.ts", "ui/fixtures/review/build.ts"], ["{jobs,ui,vault,hooks,lib}/**"])).toEqual([]);
});

test("only jobs/lib/infra/settings.ts reads or writes the settings table; lib/db.ts defines it and lib/jev.ts keeps the judge row", () => {
  expect(offenders(/\b(get|put)Json(<[^>]*>)?\(\s*"settings"/, ["jobs/lib/infra/settings.ts", "lib/db.ts", "lib/jev.ts"], ["{jobs,ui,vault,hooks,lib}/**"])).toEqual([]);
});

test("only jobs/lib/records/status.ts writes or greps a Job: or Issue: trailer", () => {
  expect(offenders(/[`"'](?:Job|Issue): /, ["jobs/lib/records/status.ts"], ["{jobs,ui,vault,hooks,lib,issues}/**"])).toEqual([]);
});

test("only lib/usage.ts runs SQL on the usage or openrouter table; lib/db.ts holds their schema", () => {
  expect(offenders(/\b(FROM|INTO|UPDATE)\s+(usage|openrouter)\b/i, ["lib/usage.ts", "lib/db.ts"], ["{jobs,ui,vault,hooks,lib,ideas,issues}/**"])).toEqual([]);
});

test("only lib/jev.ts runs SQL on the jev table; lib/db.ts holds its schema", () => {
  expect(offenders(/\b(FROM|INTO|UPDATE)\s+jev\b/i, ["lib/jev.ts", "lib/db.ts"], ["{jobs,ui,vault,hooks,lib,ideas,issues}/**"])).toEqual([]);
});

test("no file filters loadVault to the wiki: it reads archive and daily files it drops", () => {
  expect(offenders(/wikiNotes\(\s*await loadVault\(/, [])).toEqual([]);
});

test("vault/lib/index.ts exports recall and not the index handle, which a caller could leak", () => {
  const text = readFileSync(join(ROOT, "vault/lib/index.ts"), "utf8");
  expect(text).toMatch(/export function recall\(/);
  expect(text).not.toMatch(/export function (openIndex|rankNotes)\b/);
});

test("no view's arrow redirect builds its own address but through moved()", () => {
  expect(offenders(/export const redirect = \(hash\) =>(?! moved\()/, [], ["ui/views"], "js")).toEqual([]);
});

test("no ui/views/*.js imports a sibling view, and no ui/views/lib/*.js imports a view", () => {
  expect(offenders(/from "\.\/(?!lib\/)[^"]+"/, [], ["ui/views"], "js")).toEqual([]);
  expect(offenders(/from "\.\.\/[\w-]+\.js"/, [], ["ui/views/lib"], "js")).toEqual([]);
});

for (const [name, re] of Object.entries({
  closed: /\["done",\s*"dropped"/,
  priorities: /"low",\s*"medium",\s*"high",\s*"critical"|"critical",\s*"high",\s*"medium",\s*"low"/,
  sources: /"chris",\s*"worker",\s*"deps",\s*"memory",\s*"agent"/,
})) {
  test(`only lib/naming.ts writes out the ${name} list`, () => {
    expect(offenders(re, [], ["{jobs,ui,issues,hooks}/**"], "{ts,js}")).toEqual([]);
  });
}

test("roles hand the vault a draft through put and write no note file", () => {
  expect(offenders(/\bserializeFrontmatter\b/, [], ["jobs/lib/roles/**"])).toEqual([]);
});

test("gates sit below transitions and land: no file in jobs/lib/gates imports either", () => {
  expect(offenders(/from "\.\.\/(?:transitions|land)\//, [], ["jobs/lib/gates/**"])).toEqual([]);
});
