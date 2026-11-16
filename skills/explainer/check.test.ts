import { expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromeUsable } from "../../ui/test-browser.ts";

test.skipIf(!chromeUsable)("the check runs on an unfilled base.html and prints its faults and three screenshots", async () => {
  const dir = mkdtempSync(join(tmpdir(), "explainer-test-"));
  try {
    copyFileSync(join(import.meta.dir, "base.html"), join(dir, "page.html"));
    const run = Bun.spawnSync(["bun", join(import.meta.dir, "check.ts"), join(dir, "page.html")], { stdout: "pipe", stderr: "pipe" });
    const lines = run.stdout.toString().split("\n");
    expect(run.stderr.toString()).not.toMatch(/SyntaxError|export named|Export named|Cannot find module/);
    // A check that dies before it prints a fault has its cause on stderr: put it in the failure.
    if (!lines.some((l) => l.startsWith("✗"))) throw new Error(`the check printed no fault line (exit ${run.exitCode}); stderr:\n${run.stderr.toString()}`);
    expect(lines.some((l) => l.startsWith("✗ the placeholder"))).toBe(true);
    expect(lines.filter((l) => l.startsWith("screenshot:"))).toHaveLength(3);
    expect(run.exitCode).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 90_000);
