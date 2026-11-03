/**
 * The test files that depend on a set of files, read from the tree of one commit. A test depends on a file when it
 * reaches the file through quoted paths: imports, and path strings such as "jobs/cli.ts" that a test spawns.
 */
import { dirname, join, normalize } from "node:path";
import { git } from "./git.ts";

const MODULE = /\.(?:tsx?|m?js|cjs)$/;
const QUOTED = /["'`]((?:\.{1,2}\/)[^"'`\s]+|[\w@./-]+\.(?:tsx?|m?js|cjs))["'`]/g;
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

/**
 * The test files at `commit` that match `globs` and depend on any of `targets`, sorted. Null when a target is not a
 * module, because a test can read such a file in ways that no quoted path shows.
 */
export function relatedTests(repoPath: string, commit: string, targets: string[], globs: string[]): string[] | null {
  if (targets.some((f) => !MODULE.test(f))) return null;
  const files = new Set(git(repoPath, "ls-tree", "-r", "--name-only", commit).out.split("\n").filter((f) => MODULE.test(f)));
  // A target gone from the tree leaves no file to start from, though tests can still name it.
  if (targets.some((f) => !files.has(f))) return null;
  const grep = git(repoPath, "grep", "-I", "-E", "[\"'`]", commit, "--", "*.ts", "*.tsx", "*.js", "*.mjs", "*.cjs");
  // dependents.get(f): the files that name f.
  const dependents = new Map<string, Set<string>>();
  for (const line of grep.out.split("\n")) {
    const at = line.indexOf(":", commit.length + 1);
    if (at < 0) continue;
    const from = line.slice(commit.length + 1, at);
    if (!files.has(from)) continue;
    for (const m of line.slice(at + 1).matchAll(QUOTED)) {
      for (const to of resolve(m[1], from, files)) {
        if (to === from) continue;
        if (!dependents.has(to)) dependents.set(to, new Set());
        dependents.get(to)!.add(from);
      }
    }
  }
  const seen = new Set(targets);
  const queue = [...seen];
  while (queue.length) for (const d of dependents.get(queue.pop()!) ?? []) if (!seen.has(d)) { seen.add(d); queue.push(d); }
  const isTest = (f: string) => globs.some((g) => new Bun.Glob(g).match(f));
  return [...seen].filter(isTest).sort();
}
