// Archived goal tests from jobs/lib/explain.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../../todo/lib/todo.ts";
import { writeList } from "../../../todo/lib/store.ts";
import { plainAsk, setAsk, type Ask } from "../../../jobs/lib/ask.ts";
import { type Repo } from "../../../jobs/lib/ledger.ts";
import { explainPrompt, pendingCases } from "../../../jobs/lib/explain.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base: string;
const repo = { key: "exp", path: "", main: "main", sandbox: true } as Repo;

function sh(cwd: string, ...args: string[]): void {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}

// The fake explainer: it keeps each prompt, and `FAKE_EXIT` makes it fail.
const FAKE = `#!/bin/bash
prompt=$(cat)
printf '%s' "$prompt" > "$FAKE_DIR/prompt-$(date +%s%N).md"
rec=deny; case $prompt in *"Land x.ts?"*) rec=land ;; esac
echo "$PWD $*" >> "$FAKE_DIR/calls"
if [ -n "$FAKE_HOOK" ]; then eval "$FAKE_HOOK"; fi
if [ -n "$FAKE_EXIT" ]; then echo "boom" >&2; exit "$FAKE_EXIT"; fi
case $prompt in *"approve, decline"*)
echo '{"situation":"The lesson says to check x.ts.","effects":[{"action":"approve","text":"Files a goal."},{"action":"decline","text":"Drops it."}],"recommend":{"action":"decline","why":"Too vague."}}'
exit 0 ;; esac
echo '{"situation":"The run changed x.ts, the parser. I did not check the vault.","effects":[{"action":"checked","text":"Records a claim that the dashboard was looked at; it runs nothing."},{"action":"deny","text":"Leaves the dashboard unchecked."},{"action":"land","text":"Puts x.ts on main."},{"action":"drop","text":"Throws the branch away."}],"recommend":{"action":"'$rec'","why":"Nothing was checked."}}'
`;

let lists = 0;
/** A fresh list with one item that asks `ask`, and a fresh ledger. */
function seed(ask: Ask, notes: string[] = []): number {
  repo.key = `exp${++lists}`;
  process.env.ALEPH_JOBS_DIR = join(base, `jobs-${lists}`);
  let id = 0;
  writeList(repo, "seed", (doc) => {
    const item = issues.add(doc, "Check the dashboard", { request: "Look at the prod dashboard." });
    for (const n of notes) issues.note(item, n);
    setAsk(item, ask);
    id = item.id;
    return true;
  }, true);
  return id;
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-explain-"));
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
  writeFileSync(join(base, "fake"), FAKE);
  chmodSync(join(base, "fake"), 0o755);
  repo.path = base;
  writeFileSync(join(base, "repos.json"), JSON.stringify({ exp: { path: base, sandbox: true } }));
  Object.assign(process.env, gitEnv, {
    ALEPH_ISSUES: join(base, "items"), ALEPH_EXPLAIN_CMD: join(base, "fake"), FAKE_DIR: base,
    ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_DISPATCH: "off", ALEPH_REPOS: join(base, "repos.json"),
    XDG_RUNTIME_DIR: join(base, "run"),
  });
});
afterAll(() => rmSync(base, { recursive: true, force: true }));
beforeEach(() => {
  rmSync(join(base, "factory"), { recursive: true, force: true }); delete process.env.FAKE_HOOK;
  delete process.env.FAKE_EXIT; delete process.env.ALEPH_EXPLAIN_TRIES; delete process.env.ALEPH_EXPLAIN_CAP;
  for (const f of readdirSync(base)) if (f.startsWith("prompt-") || f === "calls") rmSync(join(base, f));
});

test("the explainer prompt states the limits and asks for details", () => {
  seed(plainAsk("host-check", "check it"));
  const p = explainPrompt(pendingCases([repo])[0]);
  expect(p).toContain("at most 3 sentences and 600 characters");
  expect(p).toContain("only risks and gaps");
  expect(p).toContain("not a second summary");
  expect(p).toContain("at most 2 sentences and 220 characters");
  expect(p).toContain('"details"');
});
