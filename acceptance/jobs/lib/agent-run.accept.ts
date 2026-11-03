// Archived goal tests from jobs/lib/agent-run.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentCause, agentScript } from "../../../jobs/lib/agent-run.ts";

let base: string;
const saved = { ...process.env };

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-agent-run-"));
  process.env.ALEPH_JOBS_DIR = join(base, "jobs");
  process.env.XDG_RUNTIME_DIR = join(base, "run");
});
afterEach(() => { delete process.env.ALEPH_FACTS_CMD; delete process.env.ALEPH_FACTS_TIMEOUT; });
afterAll(() => { rmSync(base, { recursive: true, force: true }); process.env = saved; });

test("agentScript: the argv alone without a bundle, and the git prelude and setup on stderr with one", () => {
  expect(agentScript(["claude", "-p", "it's"])).toBe(`exec 'claude' '-p' 'it'\\''s'`);
  const s = agentScript(["claude", "-p"], { bundle: "../in.bundle", refs: ["+refs/heads/b:refs/heads/b"], setup: ["git switch -q 'b'", "bun install"] }).split("\n");
  expect(s.slice(0, 2)).toEqual(["set -e", "exec 3>&1 1>&2"]);
  expect(s[2]).toBe("git init -q .");
  expect(s).toContain("git fetch -q ../in.bundle '+refs/heads/b:refs/heads/b'");
  expect(s.slice(-4)).toEqual(["git switch -q 'b'", "bun install", "exec 1>&3 3>&-", "exec 'claude' '-p'"]);
});

test("agentCause: a stall, then the time box, then a reply that is not ok, else null", () => {
  process.env.ALEPH_STALL_SECONDS = "120";
  try {
    const ok = { ok: true, line: "", result: "hi" };
    const bad = { ok: false, line: "", result: "" };
    expect(agentCause({ code: 1, timedOut: true, stalled: true }, bad)).toEqual({ kind: "stalled", reason: "stalled: no output for 2 minutes" });
    expect(agentCause({ code: 1, timedOut: true, stalled: false }, ok)).toEqual({ kind: "time-box", reason: "time box" });
    expect(agentCause({ code: 3, timedOut: false, stalled: false }, bad)).toEqual({ kind: "other", reason: "exit 3" });
    expect(agentCause({ code: 3, timedOut: false, stalled: false }, { ...bad, line: "boom" })).toEqual({ kind: "other", reason: "boom" });
    expect(agentCause({ code: 0, timedOut: false, stalled: false }, ok)).toBeNull();
  } finally { delete process.env.ALEPH_STALL_SECONDS; }
});
