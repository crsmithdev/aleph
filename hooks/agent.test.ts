import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A factory agent (ALEPH_AGENT) gets identity/AGENT.md and identity/VOICE.md, and nothing from the vault.
const ROOT = join(import.meta.dir, "..");
const vault = mkdtempSync(join(tmpdir(), "aleph-agent-"));
mkdirSync(join(vault, "wiki", "decisions"), { recursive: true });
writeFileSync(join(vault, "VAULT.md"), "# VAULT.md\n");
writeFileSync(join(vault, "MEMORY.md"), "# Memory\n\nThe user's profile.\n");
writeFileSync(join(vault, "wiki", "decisions", "Names Are Short.md"), "---\nkind: decision\nscope: global\ncore: Names are short.\n---\nBody.\n");
afterAll(() => rmSync(vault, { recursive: true, force: true }));

async function hook(argv: string[], payload: object, agent: boolean): Promise<string> {
  const p = Bun.spawn(["bun", ...argv], {
    stdin: new Blob([JSON.stringify(payload)]), stdout: "pipe", stderr: "pipe",
    env: { ...process.env, ALEPH_VAULT: vault, ALEPH_AGENT: agent ? "1" : "", LANGFUSE_BASE_URL: "http://127.0.0.1:9" },
  });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out.trim();
}

test("an agent's start context is AGENT.md and VOICE.md, with no MEMORY.md and no core lines", async () => {
  const start = { hook_event_name: "SessionStart", cwd: vault };
  const user = await hook([join(ROOT, "hooks", "vault-context.ts")], start, false);
  expect(user).toContain("The user's profile.");
  const agent = JSON.parse(await hook([join(ROOT, "hooks", "vault-context.ts")], start, true)).hookSpecificOutput.additionalContext;
  expect(agent).toContain("# Aleph factory agent");
  expect(user).toContain("Names are short.");
  expect(agent).not.toContain("Names are short.");
  expect(agent).not.toContain("<vault");
  expect(agent).not.toContain("aleph memory recall");
  expect(agent).toContain("# Voice");
  expect(user).not.toContain("# Voice");
  expect(agent).not.toContain("The user's profile.");
});

test("an agent's code style rule points at write-code/RULES.md, not SKILL.md", async () => {
  const start = { hook_event_name: "SessionStart", cwd: vault };
  const agent = JSON.parse(await hook([join(ROOT, "hooks", "vault-context.ts")], start, true)).hookSpecificOutput.additionalContext;
  expect(agent).toContain("skills/write-code/RULES.md");
  expect(agent).not.toContain("skills/write-code/SKILL.md");
});
