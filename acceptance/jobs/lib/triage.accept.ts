// Archived goal tests from jobs/lib/triage.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../../todo/lib/todo.ts";

import { prompt } from "../../../jobs/lib/triage.ts";
import { type Repo } from "../../../jobs/lib/ledger.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base: string;
// The factory dir for the whole file: nothing here may read or write ~/.aleph/factory.
let factoryHome: string;
const repo = { key: "tri", path: "" } as Repo;

function sh(cwd: string, ...args: string[]): void {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}

// The fake triage command: the verdict is named by a `VERDICT:<word>` line in the issue's body.
const FAKE = `#!/bin/bash
prompt=$(cat)
echo "$PWD $*" >> "$FAKE_LOG"
case $prompt in
  *VERDICT:goal*) echo '{"route":"build","spec":"## Goal\\nDo it.\\n## Edit surface\\nx.ts\\n## Oracle\\nbun test\\n## Time box\\n45 minutes"}' ;;
  *VERDICT:close*) echo 'Looked at it. {"route":"close","reason":"duplicate of tri-1"}' ;;
  *VERDICT:chris*) echo '{"route":"ask","question":"Which plan, A or B?"}' ;;
  *VERDICT:structured*) echo '{"route":"ask","question":"A or B?","options":[{"label":"A","line":"do a"},{"label":"B","line":"do b"}],"recommended":"B","why":["one","two"]}' ;;
  *VERDICT:build*) echo '{"route":"ask","question":"Ship it?","options":[{"label":"A","line":"ship"},{"label":"B","line":"wait"}],"recommended":"A","kind":"build"}' ;;
  *VERDICT:live*) echo '{"route":"live","note":"check the prod dashboard"}' ;;
  *VERDICT:flake*) echo '{"route":"flake","note":"a.test.ts > does x: timed out under load"}' ;;
  *VERDICT:fail*) exit 3 ;;
  *VERDICT:bad*) echo '{"route":"maybe"}' ;;
  *) echo 'no json here' ;;
esac
`;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-triage-"));
  factoryHome = join(base, "factory");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
  writeFileSync(join(base, "fake"), FAKE);
  chmodSync(join(base, "fake"), 0o755);
  repo.path = base;
  Object.assign(process.env, gitEnv, {
    ALEPH_ISSUES: join(base, "items"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_TRIAGE_CMD: join(base, "fake"),
    FAKE_LOG: join(base, "calls"), ALEPH_LIVE_CAP: "10", ALEPH_FACTORY_DIR: factoryHome, ALEPH_DISPATCH: "off",
    // Locks live in $XDG_RUNTIME_DIR/aleph, shared by every process on the machine; keep this process's own.
    XDG_RUNTIME_DIR: join(base, "run"),
  });
});
afterAll(() => rmSync(base, { recursive: true, force: true }));
beforeEach(() => { delete process.env.ALEPH_TRIAGE_CAP; delete process.env.ALEPH_TRIAGE_TRIES; writeFileSync(join(base, "calls"), ""); });

test("the prompt says the factory runs the checks, and names no aleph check command", () => {
  const p = prompt(repo, { id: 1, title: "t", request: "", spec: "", notes: [], fm: {} } as unknown as issues.Issue);
  expect(p).toContain("The factory runs this repo's checks itself");
  expect(p).toContain("There is no `aleph check` command");
  expect(p).not.toMatch(/aleph check\s+\S/);
  expect(p).toContain("`bun run test`");
  expect(p).not.toContain("such as `bun test`");
});
