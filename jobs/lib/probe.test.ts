import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probe } from "./probe.ts";
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

// The probe's clock check reads the wall clock, the monotonic clock and Windows time; under load they part, so the tests give it no fault.
const noFault = () => null;
const repo = (): Repo => ({ key: "demo", path: repoDir, main: "main", setup: [], checks: [], manual: [], autoland: true, sandbox: true, held: [], hiddenRun: "" });

test("the probe script sets each NO_SUBMODULES setting after git init and before git fetch", async () => {
  const { NO_SUBMODULES } = await import("./git.ts");
  const out = join(base, "script.txt");
  writeFileSync(join(base, "rec"), `#!/bin/bash\nfor a; do last="$a"; done\nprintf '%s' "$last" > "${out}"\n`, { mode: 0o755 });
  process.env.ALEPH_SANDBOX_CMD = join(base, "rec");
  try {
    await probe(repo(), join(base, "probe3.log"), noFault);
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
