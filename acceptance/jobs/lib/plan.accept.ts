// Archived goal tests from jobs/lib/plan.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prompt,  } from "../../../jobs/lib/plan.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): void {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}

const child = (title: string, oracle = "`bun test jobs/lib/x.test.ts`") =>
  ({ title, body: `## Goal\nDo ${title}.\n## Edit surface\njobs/lib/x.ts\n## Oracle\n${oracle}\n## Time box\n30 minutes` });
const reply = (children: object[]) => JSON.stringify({ children });
const THREE = reply([child("one"), { ...child("two"), waits_on: [1] }, { ...child("three"), waits_on: [1, 2] }]);
const ONE = reply([child("only")]);
const NO_ORACLE = reply([child("one"), { title: "two", body: "## Goal\nx\n## Edit surface\na/b.ts\n## Time box\n1 hour" }]);

// The fake planner: the reply is named by a `PLAN:<word>` line in the goal's body; each call is logged.
const fake = (base: string) => `#!/bin/bash
prompt=$(cat)
echo "$*" >> "${join(base, "calls")}"
case $prompt in
  *PLAN:three*) cat <<'J'
Here is the plan. ${THREE}
J
  ;;
  *PLAN:slow*) for _ in $(seq 600); do { [ -e "${join(base, "release")}" ] || [ ! -d "${base}" ]; } && break; sleep 0.05; done; echo '${THREE}' ;;
  *PLAN:one*) echo '${ONE}' ;;
  *PLAN:nooracle*) echo '${NO_ORACLE}' ;;
  *PLAN:badthengood*) if [ -e "${join(base, "once")}" ]; then echo '${THREE}'; else touch "${join(base, "once")}"; echo '${ONE}'; fi ;;
  *) echo 'no json' ;;
esac
`;

const KEYS = ["ALEPH_ISSUES", "ALEPH_REPOS", "ALEPH_JOBS_DIR", "ALEPH_FACTORY_DIR", "XDG_RUNTIME_DIR", "ALEPH_DAY_CAP", "ALEPH_LIVE_CAP", "SIDETONE_TELL_URL", "ALEPH_PLAN_CMD", "ALEPH_DISPATCH", "ALEPH_VAULT"];
let base: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-plan-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  writeFileSync(join(base, "fake"), fake(base));
  chmodSync(join(base, "fake"), 0o755);
  writeFileSync(join(base, "calls"), "");
  // An empty vault, so the planner's recall never reads the real ~/.aleph/vault.
  mkdirSync(join(base, "vault-empty"));
  Object.assign(process.env, {
    ALEPH_ISSUES: join(base, "items"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "jobs"),
    ALEPH_FACTORY_DIR: join(base, "factory"), XDG_RUNTIME_DIR: join(base, "run"), ALEPH_DAY_CAP: "100", ALEPH_LIVE_CAP: "5",
    SIDETONE_TELL_URL: "http://127.0.0.1:1/tell", ALEPH_PLAN_CMD: join(base, "fake"), ALEPH_DISPATCH: "off",
    ALEPH_VAULT: join(base, "vault-empty"),
  });
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "repo.git"));
  sh(base, "git", "clone", "-q", join(base, "repo.git"), join(base, "repo"));
  sh(join(base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", "init");
  sh(join(base, "repo"), "git", "push", "-q", "origin", "main");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: join(base, "repo"), sandbox: true, autoland: false } }));
});

afterEach(() => {
  writeFileSync(join(base, "release"), "");
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(base, { recursive: true, force: true });
});


describe("the planner prompt's similar episodes", () => {
  let vaultSaved: string | undefined;
  beforeEach(() => { vaultSaved = process.env.ALEPH_VAULT; });
  afterEach(() => { if (vaultSaved === undefined) delete process.env.ALEPH_VAULT; else process.env.ALEPH_VAULT = vaultSaved; });

  test("the prompt names bun run test for the full suite, not bun test", () => {
    const p = prompt({ key: "fac" } as any, { id: 1, title: "t", fm: {}, request: "", spec: "b", notes: [] } as any);
    expect(p).toContain("bun run test");
    expect(p).toContain("There is no `aleph check` command");
    expect(p).not.toContain("such as `bun test`");
  });
});
