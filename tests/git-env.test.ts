import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const preload = join(import.meta.dir, "preload.ts");

test("a test process started with GIT_DIR set runs its git in its own repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "gitenv-"));
  try {
    const outer = join(dir, "outer.git");
    Bun.spawnSync(["git", "init", "-q", "--bare", outer]);
    writeFileSync(join(dir, "fixture.test.ts"), `
      import { expect, test } from "bun:test";
      test("git resolves its own repo", () => {
        const git = (...a: string[]) => Bun.spawnSync(["git", ...a], { cwd: ${JSON.stringify(dir)} });
        git("init", "-q");
        expect(git("rev-parse", "--git-dir").stdout.toString().trim()).toBe(".git");
      });
    `);
    const run = Bun.spawnSync(["bun", "test", "--preload", preload, join(dir, "fixture.test.ts")], {
      cwd: dir, env: { ...process.env, GIT_DIR: outer }, stdout: "pipe", stderr: "pipe",
    });
    expect(run.stderr.toString() + run.stdout.toString()).toContain("1 pass");
    expect(run.exitCode).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
