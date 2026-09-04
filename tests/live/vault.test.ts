/**
 * LIVE: two headless claude sessions against a temp vault. The first writes a
 * note through /aleph:vault; the second reports what its injected Home says.
 * Needs the plugin loaded from ~/.claude/skills/aleph. ALEPH_LIVE=1 bun test tests/live
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const live = process.env.ALEPH_LIVE === "1";
const describeLive = live ? describe : describe.skip;
const CLI = join(import.meta.dir, "../../vault/cli.ts");

describeLive("live vault", () => {
  let vault: string;
  beforeAll(() => {
    vault = join(mkdtempSync(join(tmpdir(), "aleph-livevault-")), "vault");
    const p = Bun.spawnSync(["bun", CLI, "init"], { env: { ...process.env, ALEPH_VAULT: vault }, stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  });
  afterAll(() => rmSync(join(vault, ".."), { recursive: true, force: true }));

  function headless(prompt: string): string {
    const env = { ...process.env, ALEPH_VAULT: vault, MAX_THINKING_TOKENS: "0" };
    delete (env as any).CLAUDECODE;
    const p = Bun.spawnSync(["claude", "-p", prompt, "--model", "sonnet", "--permission-mode", "bypassPermissions"], { env, cwd: vault, stdout: "pipe", stderr: "pipe", timeout: 240_000 });
    if (p.exitCode !== 0) throw new Error(p.stderr.toString());
    return p.stdout.toString();
  }

  test("a note written in one session is in the next session's injected Home", () => {
    headless("Use the /aleph:vault skill to write a gotcha titled 'Live Vault Probe' with scope global, confidence measured, sources [chris], claim 'The live vault test ran, as of 2026-09-04.' and add it to Home.md under Gotchas. Do nothing else.");
    expect(existsSync(join(vault, "wiki", "gotchas", "Live Vault Probe.md"))).toBe(true);
    const out = headless("Without reading any file or running any tool, list the note titles under Gotchas in the vault Home that was injected into your context. Answer with the titles only.");
    expect(out).toContain("Live Vault Probe");
    expect(readdirSync(join(vault, "daily")).some((f) => f.endsWith(".md"))).toBe(true);
  }, 500_000);
});
