import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { health, mainRed, redMains, writeBaseline } from "./factory-status.ts";
import type { Repo } from "../records/ledger.ts";

const KEYS = ["ALEPH_FACTORY_DIR", "XDG_RUNTIME_DIR"];
let base: string, saved: (string | undefined)[] = [];
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-main-health-"));
  saved = KEYS.map((k) => process.env[k]);
  process.env.ALEPH_FACTORY_DIR = join(base, "factory");
  process.env.XDG_RUNTIME_DIR = join(base, "xdg");
  mkdirSync(join(base, "factory"));
});
afterEach(() => {
  KEYS.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
  rmSync(base, { recursive: true, force: true });
});

const sh = (cwd: string, ...a: string[]) => Bun.spawnSync(a, { cwd, stdout: "pipe", stderr: "ignore" }).stdout.toString().trim();

/** A repo whose origin/main is a commit made here. */
function repo(): Repo & { commit: () => string } {
  const path = join(base, "repo");
  mkdirSync(path);
  sh(path, "git", "init", "-q", "-b", "main");
  const commit = () => {
    sh(path, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "c");
    sh(path, "git", "update-ref", "refs/remotes/origin/main", "HEAD");
    return sh(path, "git", "rev-parse", "HEAD");
  };
  return { key: "fac", path, main: "main", commit } as unknown as Repo & { commit: () => string };
}

test("a red baseline stops issues after main moves, until a later baseline is green", async () => {
  const r = repo();
  const old = r.commit();
  await writeBaseline("fac", () => ({ repo: "fac", commit: old, ok: false, failed: "tests" }));
  expect(mainRed()(r)).toBe(`main is red at ${old.slice(0, 7)}: tests`);
  const next = r.commit();
  expect(mainRed()(r)).toBe(`main is red at ${old.slice(0, 7)}: tests`);
  await writeBaseline("fac", () => ({ repo: "fac", commit: next, ok: true }));
  expect(mainRed()(r)).toBeNull();
});

test("every red main, the baselines first, with the ids the firefighter keys its events by", async () => {
  await writeBaseline("fac", () => ({ repo: "fac", commit: "a".repeat(40), ok: false, failed: "types" }));
  await writeBaseline("demo", () => ({ repo: "demo", commit: "b".repeat(40), ok: true }));
  writeFileSync(join(base, "factory", "ci.json"), JSON.stringify({ demo: { repo: "demo", ok: false, sha: "d1", url: "u", sinceSha: "d0", runs: 2 } }));
  const reds = redMains();
  expect(reds.map((r) => [r.repo, r.source, r.id])).toEqual([["fac", "baseline", `red:fac:${"a".repeat(40)}`], ["demo", "ci", "ci:demo:d0:d1"]]);
  expect(reds[0].line).toBe("fac main is red at aaaaaaa: types");
  expect(health()).toContainEqual({ text: "health: fac main is red at aaaaaaa: types", kind: "warn", key: "red-main" });
});

test("a red baseline of aleph is an alert, and one of another repo is a warning", async () => {
  await writeBaseline("aleph", () => ({ repo: "aleph", commit: "c".repeat(40), ok: false, failed: "tests" }));
  await writeBaseline("fac", () => ({ repo: "fac", commit: "a".repeat(40), ok: false, failed: "types" }));
  expect(health().map((l) => [l.kind, l.key, l.text])).toEqual([
    ["alert", "red-main", "health: aleph main is red at ccccccc: tests"],
    ["warn", "red-main", "health: fac main is red at aaaaaaa: types"],
  ]);
});
