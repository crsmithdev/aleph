
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prompt } from "../../../jobs/lib/firefighter.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base: string;
let server: ReturnType<typeof Bun.serve>;
let told: string[] = [];

function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

// The fake firefighter: it counts its calls, keeps the prompt, and prints the reply the test wrote.
const FAKE = `#!/bin/bash
cat > "$FF_DIR/prompt.md"
echo x >> "$FF_DIR/calls"
cat "$FF_DIR/reply.json"
`;
const repoPath = () => join(base, "repo");
const reply = (actions: object[]) => writeFileSync(join(base, "reply.json"), JSON.stringify({ actions }));

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-firefighter-"));
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
  sh(base, "git", "init", "-q", "-b", "main", repoPath());
  writeFileSync(join(repoPath(), "README"), "r\n");
  sh(repoPath(), "git", "add", "-A");
  sh(repoPath(), "git", "commit", "-q", "-m", "start");
  writeFileSync(join(base, "fake"), FAKE);
  chmodSync(join(base, "fake"), 0o755);
  server = Bun.serve({ port: 0, fetch: async (req) => { told.push(await req.text()); return new Response("ok"); } });
  Object.assign(process.env, gitEnv, {
    ALEPH_ISSUES: join(base, "items"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_FIREFIGHTER_CMD: join(base, "fake"), FF_DIR: base,
    ALEPH_DISPATCH: "off", SIDETONE_TELL_URL: `http://127.0.0.1:${server.port}/tell`,
    XDG_RUNTIME_DIR: join(base, "run"),
    // Not the factory's ~/.aleph/sandbox: a concurrent copy of this file names its land folder the same in the same second, and removes it.
    ALEPH_SANDBOX_DIR: join(base, "sandbox"),
  });
});
afterAll(() => { server.stop(true); rmSync(base, { recursive: true, force: true }); });
beforeEach(() => { rmSync(join(base, "calls"), { force: true }); told = []; reply([]); });

test("prompt lists after in the drop and edit-goal lines, and says a note alone does not stop a rerun", () => {
  const p = prompt([]);
  const lines = p.split("\n");
  expect(lines.find((l) => l.startsWith('- {"do": "drop"'))).toContain('"after"');
  expect(lines.find((l) => l.startsWith('- {"do": "edit-goal"'))).toContain('"after"');
  expect(lines.find((l) => l.startsWith('- {"do": "answer"'))).toContain('"after"');
  expect(p).toContain("A note or a drop reason alone does not stop a rerun.");
});
