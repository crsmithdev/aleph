import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, probe } from "./git.ts";

test("probe answers not-ok for a missing directory and the output for a repo", () => {
  expect(probe(join(tmpdir(), "no-such-dir-git-probe"), "status")).toEqual({ ok: false, out: "" });
  const dir = mkdtempSync(join(tmpdir(), "git-probe-"));
  try {
    git(dir, "init", "-q");
    const r = probe(dir, "rev-parse", "--git-dir");
    expect(r).toEqual({ ok: true, out: ".git" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
