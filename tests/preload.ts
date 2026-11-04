/**
 * Loaded before every test file (bunfig.toml). It points each setting whose default is under ~/.aleph or
 * ~/.claude at a folder of its own for this test process, so no test reads or writes Chris's live data.
 * A test that sets one of them itself still wins; the processes a test starts inherit them.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { procId } from "./git-fixture.ts";

// bun --parallel never fires process.on("exit"), so each folder carries the id of its process, and a test
// process deletes the folders of processes that are gone. It leaves folders without an id alone.
const PREFIX = "aleph-test-home-";
for (const name of readdirSync(tmpdir()).filter((n) => n.startsWith(PREFIX))) {
  const m = name.slice(PREFIX.length).match(/^(\d+)-\d+-/);
  if (m && procId(m[1]) !== name.slice(PREFIX.length, PREFIX.length + m[0].length - 1)) {
    rmSync(join(tmpdir(), name), { recursive: true, force: true });
  }
}
const dir = mkdtempSync(join(tmpdir(), `${PREFIX}${procId(process.pid)}-`));
const vars: Record<string, string> = {
  ALEPH_ISSUES: join(dir, "issues"), ALEPH_JOBS_DIR: join(dir, "runs"),
  ALEPH_FACTORY_DIR: join(dir, "factory"), ALEPH_VAULT: join(dir, "vault"), ALEPH_REPOS: join(dir, "repos.json"),
  ALEPH_SKILLS_STORE: join(dir, "skills-store.json"), ALEPH_USAGE_FILE: join(dir, "usage.jsonl"),
  ALEPH_CLAUDE_CREDENTIALS: join(dir, "credentials.json"), ALEPH_SPOOL: join(dir, "spool"),
  ALEPH_CLAUDE_SETTINGS: join(dir, "settings.json"), ALEPH_JUDGE_FILE: join(dir, "judge"),
  // No test reaches the live model through the monitor's reader: `false` fails, and a test that wants a reply gives a fake.
  ALEPH_MONITOR_CMD: "false",
  // Nor through the title writer: `false` fails, so a title that breaks the rule is cut.
  ALEPH_RULE_CMD: "false",
};
for (const [k, v] of Object.entries(vars)) process.env[k] ??= v;
// A factory worker's shell carries its job's variables. A test reads them as a worker, so they are cleared here;
// a test that sets one of them itself still gets the value it sets.
delete process.env.ALEPH_JOB_ID;
delete process.env.ALEPH_JOB_RUN;
// No check, worker or land in a test waits for the host's load: the admission's own tests give a fake load.
process.env.ALEPH_LOAD_LIMIT = "Infinity";

// Bun.spawn and Bun.spawnSync without an `env` give the child the environment this process started with, not
// process.env, so the child would miss the settings above. Here a call without an `env` passes process.env.
for (const name of ["spawn", "spawnSync"] as const) {
  const real = Bun[name] as (...a: any[]) => any;
  (Bun as any)[name] = (cmd: any, opts?: any) => Array.isArray(cmd)
    ? real(cmd, { ...opts, env: opts?.env ?? process.env })
    : real({ ...cmd, env: cmd.env ?? process.env });
}

// No test reaches a live service through a key or URL it inherits from the shell or ~/.aleph/.env: Langfuse,
// OpenRouter (the Jev screen), the Anthropic API and its usage endpoint, GitHub (`gh`), and the phone (Sidetone).
// ALEPH_ENV_FILE names a file that does not exist, so no test reads ~/.aleph/.env. Port 1 refuses each connection.
// A test that needs one of these points it at a fake server of its own. The live tests (ALEPH_LIVE=1) keep them.
if (process.env.ALEPH_LIVE !== "1") {
  const nowhere = "http://127.0.0.1:1";
  Object.assign(process.env, {
    ALEPH_ENV_FILE: join(dir, ".env"),
    LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "", LANGFUSE_BASE_URL: nowhere,
    OPENROUTER_API_KEY: "", ALEPH_JEV_URL: `${nowhere}/jev`, ALEPH_USAGE_URL: `${nowhere}/usage`,
    SIDETONE_TELL_URL: `${nowhere}/tell`, GH_CONFIG_DIR: join(dir, "gh"),
  });
  for (const k of ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"]) delete process.env[k];
}
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
