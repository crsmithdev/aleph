import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "gh-guard.ts");
let root: string;

function repo(name: string, origin: string): string {
  const dir = join(root, name);
  mkdirSync(dir);
  Bun.spawnSync(["git", "init", "-q", dir]);
  Bun.spawnSync(["git", "-C", dir, "remote", "add", "origin", origin]);
  return dir;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "aleph-gh-guard-"));
  repo("mine", "git@github.com:crsmithdev/btcx-tools.git");
  repo("theirs", "https://github.com/suebtwist/btcx-files.git");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** The hook's decision for a Bash command run in `cwd`: "ask", or "" when it lets the command through. */
function decide(command: string, cwd = join(root, "mine")): string {
  const r = Bun.spawnSync(["bun", HOOK], {
    stdin: Buffer.from(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd })),
    env: { ...process.env, ALEPH_GH_USER: "crsmithdev" },
    stdout: "pipe", stderr: "pipe",
  });
  expect(r.exitCode).toBe(0);
  const out = r.stdout.toString().trim();
  return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : "";
}

// Each row: the behaviour, then each command with its decision ("" goes through) and its folder under root, mine when not given.
test.each<[string, [string, string, string?][]]>([
  ["a write to another owner's repo named with -R asks", [["gh issue comment 5 -R suebtwist/btcx-files --body hi", "ask"], ["gh pr create --repo suebtwist/btcx-files --fill", "ask"]]],
  ["a write to another owner's repo named by URL asks", [["gh issue comment https://github.com/suebtwist/btcx-files/issues/5 -b hi", "ask"], ["gh repo fork suebtwist/btcx-files", "ask"]]],
  ["a write with no named repo goes to the cwd's origin", [["gh issue create -t x -b y", "ask", "theirs"], ["gh issue create -t x -b y", "", "mine"]]],
  ["a write after a cd, with no named repo, asks", [["cd ../theirs && gh issue create -t x -b y", "ask"]]],
  ["a write after a cd to a path with a variable asks", [["cd $DIR && gh pr create --fill", "ask"]]],
  ["a write to the user's own repo goes through", [["gh pr create -R crsmithdev/btcx-tools --fill", "", "theirs"]]],
  ["reads go through anywhere", [
    ["gh issue view 5 -R suebtwist/btcx-files --comments", ""], ["gh pr list -R suebtwist/btcx-files", ""],
    ["gh api repos/suebtwist/btcx-files/issues -q '.[].title'", ""], ["gh api -X GET search/issues -f q=btcx", ""],
  ]],
  ["gh api writes to another owner ask", [
    ["gh api repos/suebtwist/btcx-files/issues/5/comments -f body=hi", "ask"], ["gh api --method PATCH repos/suebtwist/btcx-files/issues/5 -f state=closed", "ask"],
    ["gh api repos/crsmithdev/btcx-tools/issues -f title=x", ""], ["gh api graphql -f query='mutation { addComment(input:{}) { clientMutationId } }'", "ask"],
  ]],
  ["a write in a later part of a compound command asks", [["gh issue list -R crsmithdev/btcx-tools; gh issue comment 5 -R suebtwist/btcx-files -b hi", "ask"]]],
  ["a command without gh goes through", [["git push origin main", ""]]],
])("%s", (_, cases) => {
  expect(cases.map(([cmd, , dir]) => decide(cmd, join(root, dir ?? "mine")))).toEqual(cases.map(([, want]) => want));
});

/** The decision for a write to the user's own repo with no ALEPH_GH_USER, where a fake login lookup prints `login` and notes each call in `calls`. */
function viaLookup(login: string, spool: string, calls: string): string {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho x >> ${calls}\n[ -n "${login}" ] && echo ${login}\nexit 0\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const r = Bun.spawnSync(["bun", HOOK], {
    stdin: Buffer.from(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "gh issue create -t x -b y" }, cwd: join(root, "mine") })),
    env: { ...process.env, ALEPH_GH_USER: "", ALEPH_SPOOL: spool, PATH: `${bin}:${process.env.PATH}` },
    stdout: "pipe", stderr: "pipe",
  });
  const out = r.stdout.toString().trim();
  return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : "";
}
const lookups = (calls: string) => readFileSync(calls, "utf8").split("\n").filter(Boolean).length;

test("the gh login is asked of gh once a day, and a login that gh does not give is not kept", () => {
  const spool = join(root, "spool-day"), calls = join(root, "calls-day");
  writeFileSync(calls, "");
  expect(viaLookup("", spool, calls)).toBe("ask");
  expect(viaLookup("crsmithdev", spool, calls)).toBe("");
  expect(viaLookup("crsmithdev", spool, calls)).toBe("");
  expect(lookups(calls)).toBe(2);
  writeFileSync(join(spool, "gh-user.json"), JSON.stringify({ day: "2000-01-01", login: "suebtwist" }));
  expect(viaLookup("crsmithdev", spool, calls)).toBe("");
  expect(lookups(calls)).toBe(3);
});
