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

// No test reaches a live service through a key or URL it inherits from the shell or ~/.aleph/.env: Langfuse,
// OpenRouter (the Jev screen), the Anthropic API and its usage endpoint, GitHub (`gh`), and the phone (Sidetone).
// An empty key counts as set, so loadDotenv does not fill it from ~/.aleph/.env. Port 1 refuses each connection.
// A test that needs one of these points it at a fake server of its own. The live tests (ALEPH_LIVE=1) keep them.
if (process.env.ALEPH_LIVE !== "1") {
  const nowhere = "http://127.0.0.1:1";
  Object.assign(process.env, {
    LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "", LANGFUSE_BASE_URL: nowhere,
    OPENROUTER_API_KEY: "", ALEPH_JEV_URL: `${nowhere}/jev`, ALEPH_USAGE_URL: `${nowhere}/usage`,
    SIDETONE_TELL_URL: `${nowhere}/tell`, GH_CONFIG_DIR: join(dir, "gh"),
  });
  for (const k of ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"]) delete process.env[k];
}
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
