import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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

test("a write to another owner's repo named with -R asks", () => {
  expect(decide("gh issue comment 5 -R suebtwist/btcx-files --body hi")).toBe("ask");
  expect(decide("gh pr create --repo suebtwist/btcx-files --fill")).toBe("ask");
});

test("a write to another owner's repo named by URL asks", () => {
  expect(decide("gh issue comment https://github.com/suebtwist/btcx-files/issues/5 -b hi")).toBe("ask");
  expect(decide("gh repo fork suebtwist/btcx-files")).toBe("ask");
});

test("a write with no named repo goes to the cwd's origin", () => {
  expect(decide("gh issue create -t x -b y", join(root, "theirs"))).toBe("ask");
  expect(decide("gh issue create -t x -b y", join(root, "mine"))).toBe("");
});

test("a write after a cd, with no named repo, asks", () => {
  expect(decide("cd ../theirs && gh issue create -t x -b y")).toBe("ask");
});

test("a write after a cd to a path with a variable asks", () => {
  expect(decide("cd $DIR && gh pr create --fill")).toBe("ask");
});

test("a write to the user's own repo goes through", () => {
  expect(decide("gh pr create -R crsmithdev/btcx-tools --fill", join(root, "theirs"))).toBe("");
});

test("reads go through anywhere", () => {
  expect(decide("gh issue view 5 -R suebtwist/btcx-files --comments")).toBe("");
  expect(decide("gh pr list -R suebtwist/btcx-files")).toBe("");
  expect(decide("gh api repos/suebtwist/btcx-files/issues -q '.[].title'")).toBe("");
  expect(decide("gh api -X GET search/issues -f q=btcx")).toBe("");
});

test("gh api writes to another owner ask", () => {
  expect(decide("gh api repos/suebtwist/btcx-files/issues/5/comments -f body=hi")).toBe("ask");
  expect(decide("gh api --method PATCH repos/suebtwist/btcx-files/issues/5 -f state=closed")).toBe("ask");
  expect(decide("gh api repos/crsmithdev/btcx-tools/issues -f title=x")).toBe("");
  expect(decide("gh api graphql -f query='mutation { addComment(input:{}) { clientMutationId } }'")).toBe("ask");
});

test("a write in a later part of a compound command asks", () => {
  expect(decide("gh issue list -R crsmithdev/btcx-tools; gh issue comment 5 -R suebtwist/btcx-files -b hi")).toBe("ask");
});

test("a command without gh goes through", () => {
  expect(decide("git push origin main")).toBe("");
});
