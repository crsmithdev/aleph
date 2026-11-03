/**
 * The test files that depend on a set of files, read from the tree of one commit. A test depends on a file when it
 * reaches the file through quoted paths: imports, path strings such as "jobs/cli.ts" that a test spawns, and paths
 * that `join(import.meta.dir, ...)` writes in parts. Also the build run's choice of the test files to run.
 */
import { dirname, join, normalize } from "node:path";
import { git } from "./git.ts";
import type { Check, Repo } from "./ledger.ts";

const MODULE = /\.(?:tsx?|m?js|cjs)$/;
const QUOTED = /["'`]((?:\.{1,2}\/)[^"'`\s]+|[\w@./-]+\.(?:tsx?|m?js|cjs))["'`]/g;
/** `join(import.meta.dir, "..", "jobs", "cli.ts")`: the quoted parts after the folder. */
const JOINED = /import\.meta\.dir\s*,\s*((?:["'][^"'\s]+["']\s*,?\s*)+)\)/g;
const ENDINGS = ["", ".ts", ".tsx", ".js", "/index.ts", "/index.js"];

/** The module files in `files` that `spec`, written in `from`, names. */
function resolve(spec: string, from: string, files: Set<string>): string[] {
  const roots = spec.startsWith(".") ? [dirname(from)] : [dirname(from), ""];
  const out: string[] = [];
  for (const root of roots) {
    const base = normalize(join(root, spec));
    const hit = ENDINGS.map((e) => base + e).find((p) => files.has(p));
    if (hit) out.push(hit);
  }
  return out;
}

/** What the tree of one commit names: its module files, for each file the files that name it, and bun's preload files. */
export interface ImportMap { files: Set<string>; dependents: Map<string, Set<string>>; preload: string[] }

/** The import map of `commit` in the repo at `repoPath`. */
export function importMap(repoPath: string, commit: string): ImportMap {
  const files = new Set(git(repoPath, "ls-tree", "-r", "--name-only", commit).out.split("\n").filter((f) => MODULE.test(f)));
  const grep = git(repoPath, "grep", "-I", "-E", "[\"'`]", commit, "--", "*.ts", "*.tsx", "*.js", "*.mjs", "*.cjs");
  const dependents = new Map<string, Set<string>>();
  for (const line of grep.out.split("\n")) {
    const at = line.indexOf(":", commit.length + 1);
    if (at < 0) continue;
    const from = line.slice(commit.length + 1, at);
    if (!files.has(from)) continue;
    const text = line.slice(at + 1);
    const specs = [...text.matchAll(QUOTED)].map((m) => m[1]);
    for (const m of text.matchAll(JOINED)) specs.push(`./${[...m[1].matchAll(/["']([^"']+)["']/g)].map((p) => p[1]).join("/")}`);
    for (const spec of specs) {
      for (const to of resolve(spec, from, files)) {
        if (to === from) continue;
        if (!dependents.has(to)) dependents.set(to, new Set());
        dependents.get(to)!.add(from);
      }
    }
  }
  const bunfig = git(repoPath, "show", `${commit}:bunfig.toml`);
  const list = bunfig.ok ? bunfig.out.match(/^\s*preload\s*=\s*(\[[^\]]*\]|"[^"]*")/m)?.[1] ?? "" : "";
  const preload = [...list.matchAll(/"([^"]+)"/g)].map((m) => normalize(m[1]));
  return { files, dependents, preload };
}

/**
 * The test files in `map` that match `globs` and depend on any of `targets`, sorted. Null when a target is not a
 * module, because a test can read such a file in ways that no quoted path shows, or when a target is gone from the
 * tree: no file is left to start from, though tests can still name it.
 */
export function testsOf(map: ImportMap, targets: string[], globs: string[]): string[] | null {
  if (targets.some((f) => !MODULE.test(f) || !map.files.has(f))) return null;
  const seen = new Set(targets);
  const queue = [...seen];
  while (queue.length) for (const d of map.dependents.get(queue.pop()!) ?? []) if (!seen.has(d)) { seen.add(d); queue.push(d); }
  const isTest = (f: string) => globs.some((g) => new Bun.Glob(g).match(f));
  return [...seen].filter(isTest).sort();
}

/** The test files at `commit` that match `globs` and depend on any of `targets`, sorted, or null as `testsOf` says. */
export function relatedTests(repoPath: string, commit: string, targets: string[], globs: string[]): string[] | null {
  if (targets.some((f) => !MODULE.test(f))) return null;
  return testsOf(importMap(repoPath, commit), targets, globs);
}

/** The names that bun test takes as test files. */
export const BUN_TESTS = ["**/*.{test,spec}.{ts,tsx,js,jsx}", "**/*_{test,spec}.{ts,tsx,js,jsx}"];

/**
 * The test files that a build run's change reaches: each changed test file and each test that depends on a changed
 * file. A test file that the change removes drops out. "full" when `testsOf` gives null, or when a preload file
 * depends on a changed file: a preload runs before every test.
 */
export function buildTests(changed: string[], map: ImportMap, globs: string[]): string[] | "full" {
  const isTest = (f: string) => globs.some((g) => new Bun.Glob(g).match(f));
  const targets = changed.filter((f) => map.files.has(f) || !isTest(f));
  const tests = testsOf(map, targets, [...globs, ...map.preload]);
  if (!tests || tests.some((f) => map.preload.includes(f))) return "full";
  return tests;
}

/** `run` with `files` after it as paths, so bun takes each one as a file and not as a name filter. */
export const withTests = (run: string, files: string[]): string => `${run} ${files.map((f) => `'./${f.replaceAll("'", "'\\''")}'`).join(" ")}`;

const BUN_TEST = /^bun (?:run )?test$/;

/**
 * The checks of a build run on `commit`, with `changed` the files the run changes. A check whose command is
 * `bun test` or `bun run test` runs only the test files that `buildTests` gives, and does not run when it gives none.
 * `tests` holds the file list of each such check. The other checks, and a check that needs the full suite, stay whole.
 */
export function buildChecks(repo: Repo, commit: string, changed: string[]): { checks: Check[]; tests: Map<string, string[]> } {
  const tests = new Map<string, string[]>();
  let map: ImportMap | undefined;
  const checks = repo.checks.flatMap((c): Check[] => {
    if (!BUN_TEST.test(c.run.trim())) return [c];
    map ??= importMap(repo.path, commit);
    const files = buildTests(changed, map, c.tests ?? BUN_TESTS);
    if (files === "full") return [c];
    tests.set(c.name, files);
    return files.length ? [{ ...c, run: withTests(c.run, files) }] : [];
  });
  return { checks, tests };
}
