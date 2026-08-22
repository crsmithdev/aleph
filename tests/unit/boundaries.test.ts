/**
 * The dependency rule from docs/design/phase-1.md §3, enforced by a test rather
 * than by convention — that is the only kind of architectural rule that holds.
 */
import { test, expect, describe } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";

const SRC = resolve("src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".ts") ? [path] : [];
  });
}

function localImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/from\s+"(\.[^"]+)"/g)].map((m) => resolve(dirname(file), m[1]!));
}

const moduleOf = (file: string) => relative(SRC, file).split("/")[0]!;

describe("module boundaries", () => {
  const files = walk(SRC);

  test("core/ depends only on platform/ and itself", () => {
    const offenders: string[] = [];
    for (const file of files.filter((f) => moduleOf(f) === "core")) {
      for (const imp of localImports(file)) {
        const target = moduleOf(imp);
        if (target !== "core" && target !== "platform") offenders.push(`${relative(SRC, file)} -> ${relative(SRC, imp)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("nothing imports daemon.ts", () => {
    const offenders = files
      .filter((f) => relative(SRC, f) !== "daemon.ts")
      .filter((f) => localImports(f).some((i) => i.endsWith("daemon.ts") || i.endsWith("/daemon")));
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  test("no import cycles", () => {
    const graph = new Map<string, string[]>();
    for (const file of files) graph.set(file, localImports(file).map((i) => (i.endsWith(".ts") ? i : `${i}.ts`)));
    const state = new Map<string, number>();
    const cycles: string[] = [];
    const visit = (node: string, stack: string[]): void => {
      if (state.get(node) === 2) return;
      if (state.get(node) === 1) { cycles.push([...stack, node].map((n) => relative(SRC, n)).join(" -> ")); return; }
      state.set(node, 1);
      for (const next of graph.get(node) ?? []) if (graph.has(next)) visit(next, [...stack, node]);
      state.set(node, 2);
    };
    for (const file of files) visit(file, []);
    expect(cycles).toEqual([]);
  });

  test("only src/platform touches bun:sqlite", () => {
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes('from "bun:sqlite"') && moduleOf(f) !== "platform");
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });
});

/**
 * CLAUDE.md states "do not call Date.now() outside src/core/clock.ts" and until
 * now nothing checked it. `src/vault/writer.ts` had drifted: `log/` keyed off a
 * UTC `new Date()` that the fake clock could not move, so the "today only"
 * prohibition rolled over at 17:00 local.
 *
 * The allowlist is the debt that existed when this test was written, named
 * rather than hidden. Adding to it requires a reason in the diff.
 */
describe("the clock invariant", () => {
  const ALLOWED = new Map([
    ["core/clock.ts", "the definition"],
    ["core/bus.ts", "drain deadline — a wall-clock timeout, not clock arithmetic"],
    ["vault/bootstrap.ts", "one-shot init, takes an injectable `now` and falls back"],
    ["cli/os.ts", "a short-lived client process with no clock to inject"],
  ]);

  test("nothing outside src/core/clock.ts reads the wall clock unbidden", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\b(Date\.now\(\)|new Date\(\s*\))/g)) {
        offenders.push(`${rel}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
