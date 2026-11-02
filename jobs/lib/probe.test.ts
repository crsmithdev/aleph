import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failedChecks, probe } from "./probe.ts";
import type { Repo } from "./ledger.ts";

let base: string;
let repoDir: string;
const keys = ["ALEPH_SANDBOX_CMD", "ALEPH_SANDBOX_DIR", "ALEPH_FACTORY_DIR", "ALEPH_WORKER_TOKEN", "ALEPH_PROBE_FAKE"];
const saved: Record<string, string | undefined> = {};
const sh = (cwd: string, ...a: string[]) => { const p = Bun.spawnSync(a, { cwd }); if (p.exitCode) throw new Error(p.stderr.toString()); };

beforeAll(() => {
  for (const k of keys) saved[k] = process.env[k];
  delete process.env.ALEPH_PROBE_FAKE;
  base = mkdtempSync(join(tmpdir(), "probe-"));
  repoDir = join(base, "repo");
  mkdirSync(repoDir);
  sh(repoDir, "git", "init", "-q", "-b", "main");
  sh(repoDir, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x");
  sh(repoDir, "git", "update-ref", "refs/remotes/origin/main", "HEAD");
  writeFileSync(join(base, "token"), "tok\n");
  // Exits 3 with "boom" on stderr; fails if stderr of an earlier probe is still there.
  writeFileSync(join(base, "boom"), `#!/bin/bash\nif grep -q 'old probe' "$STDERR_FILE"; then echo "stale stderr" >&2; exit 9; fi\necho "boom: listen failed" >&2\nexit 3\n`, { mode: 0o755 });
  process.env.ALEPH_SANDBOX_CMD = join(base, "boom");
  process.env.ALEPH_SANDBOX_DIR = join(base, "runs");
  process.env.ALEPH_FACTORY_DIR = join(base, "factory");
  process.env.ALEPH_WORKER_TOKEN = join(base, "token");
});
afterAll(() => {
  for (const k of keys) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
  rmSync(base, { recursive: true, force: true });
});

const repo = (): Repo => ({ key: "demo", path: repoDir, main: "main", setup: [], checks: [], manual: [], autoland: true, sandbox: true, held: [], hiddenRun: "" });

test("a probe with no results names exit code and stderr, not an earlier probe's", async () => {
  const log = join(base, "probe.log");
  process.env.STDERR_FILE = `${log}.stderr`;
  writeFileSync(`${log}.stderr`, "old probe text\n");
  const p = await probe(repo(), log);
  expect(p.ok).toBe(false);
  expect(p.results).toEqual([]);
  expect(p.failed).toHaveLength(1);
  expect(p.failed[0]).toContain("11 checks gave no answer");
  expect(p.failed[0]).toContain("exit 3");
  expect(p.failed[0]).toContain("boom: listen failed");
  expect(p.failed[0]).not.toContain("old probe");
  expect(p.failed[0]).not.toContain("stale");
});

test("a failed bun test with all results gives only bun test, whatever is on stderr", async () => {
  const log = join(base, "probe2.log");
  const lines = [...Array(10).keys()].map((i) => `PASS check ${i}: denied`);
  writeFileSync(join(base, "all"), `#!/bin/bash\necho "error: 1 test failed" >&2\n${lines.map((l) => `echo "${l}"`).join("\n")}\necho "FAIL bun test: failed"\n`, { mode: 0o755 });
  process.env.ALEPH_SANDBOX_CMD = join(base, "all");
  try {
    const p = await probe(repo(), log);
    expect(p.results).toHaveLength(11);
    expect(p.failed).toEqual(["bun test"]);
  } finally { process.env.ALEPH_SANDBOX_CMD = join(base, "boom"); }
});

test("failedChecks keeps its list when all results are in", () => {
  expect(failedChecks([{ name: "bun test", ok: false }], 1, null)).toEqual(["bun test"]);
});

test("the probe script sets each NO_SUBMODULES setting after git init and before git fetch", async () => {
  const { NO_SUBMODULES } = await import("./git.ts");
  const out = join(base, "script.txt");
  writeFileSync(join(base, "rec"), `#!/bin/bash\nfor a; do last="$a"; done\nprintf '%s' "$last" > "${out}"\n`, { mode: 0o755 });
  process.env.ALEPH_SANDBOX_CMD = join(base, "rec");
  try {
    await probe(repo(), join(base, "probe3.log"));
    const script = await Bun.file(out).text();
    const init = script.indexOf("git init -q .");
    const fetch = script.indexOf("git fetch");
    expect(init).toBeGreaterThan(-1);
    expect(NO_SUBMODULES).toHaveLength(2);
    for (const s of NO_SUBMODULES) {
      expect(script.indexOf(s)).toBeGreaterThan(init);
      expect(script.indexOf(s)).toBeLessThan(fetch);
    }
  } finally { process.env.ALEPH_SANDBOX_CMD = join(base, "boom"); }
});
