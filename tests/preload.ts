/**
 * Loaded before every test file (bunfig.toml). It points each setting whose default is under ~/.aleph or
 * ~/.claude at a folder of its own for this test process, so no test reads or writes Chris's live data.
 * A test that sets one of them itself still wins; the processes a test starts inherit them.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "aleph-test-home-"));
const vars: Record<string, string> = {
  ALEPH_ISSUES: join(dir, "issues"), ALEPH_JOBS_DIR: join(dir, "runs"), ALEPH_SANDBOX_DIR: join(dir, "sandbox"),
  ALEPH_FACTORY_DIR: join(dir, "factory"), ALEPH_VAULT: join(dir, "vault"), ALEPH_REPOS: join(dir, "repos.json"),
  ALEPH_SKILLS_STORE: join(dir, "skills-store.json"), ALEPH_USAGE_FILE: join(dir, "usage.jsonl"),
  ALEPH_CLAUDE_CREDENTIALS: join(dir, "credentials.json"), ALEPH_SPOOL: join(dir, "spool"),
};
for (const [k, v] of Object.entries(vars)) process.env[k] ??= v;
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
