import { expect, test } from "bun:test";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "bash-allow.ts");

/** The hook's decision for a Bash command: "deny", or "" when it lets the command through. */
function decide(command: string, allow?: string[]): string {
  const r = Bun.spawnSync(["bun", HOOK], {
    stdin: Buffer.from(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } })),
    env: { ...process.env, ALEPH_BASH_ALLOW: allow && JSON.stringify(allow) },
    stdout: "pipe", stderr: "pipe",
  });
  expect(r.exitCode).toBe(0);
  const out = r.stdout.toString().trim();
  return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : "";
}

const RECALL = ["aleph memory recall"];

test("with a list, a command outside it is denied and one that starts with it runs", () => {
  expect(decide("ls /", RECALL)).toBe("deny");
  expect(decide('aleph memory recall "x"', RECALL)).toBe("");
  expect(decide("aleph memory recall", RECALL)).toBe("");
  expect(decide("aleph memory recalls x", RECALL)).toBe("deny");
  expect(decide("ls /", ["ls", ...RECALL])).toBe("");
});

test("a command that chains, pipes, redirects or substitutes after the prefix is denied", () => {
  for (const c of ["aleph memory recall x; ls /", "aleph memory recall x && ls", "aleph memory recall x | sh", "aleph memory recall x > /tmp/y", 'aleph memory recall "$(ls /)"', "aleph memory recall `ls`", "aleph memory recall x\nls /"]) {
    expect(decide(c, RECALL)).toBe("deny");
  }
  expect(decide("aleph memory recall 'a; b | c'", RECALL)).toBe("");
});

test("with no list, every command runs", () => {
  expect(decide("ls /")).toBe("");
});
