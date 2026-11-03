// Archived goal tests from jobs/cli.slots-workers.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { base, repo, setup, teardown } from "../../jobs/cli.helpers";

beforeAll(() => {
  setup();
  const regs = JSON.parse(readFileSync(join(base, "repos.json"), "utf8"));
  const check = (log: string) => ({ name: "slot", run: `echo "$(date +%s%N) start" >> ${log}; sleep 2; echo "$(date +%s%N) end" >> ${log}; echo "$ALEPH_TEST_PARALLEL" > ${log}.env` });
  regs.slotfac = { path: repo, sandbox: true, autoland: false, checks: [check(join(base, "slotfac.log"))] };
  writeFileSync(join(base, "repos.json"), JSON.stringify(regs));
});
afterAll(teardown);

const cores = availableParallelism();

describe("test workers per suite", () => {
  test("package.json reads ALEPH_TEST_PARALLEL and falls back to the core count", () => {
    const run = (extra: Record<string, string>) => {
      const e: Record<string, string> = { ...(process.env as Record<string, string>) };
      delete e.ALEPH_TEST_PARALLEL;
      const script = JSON.parse(readFileSync(join((import.meta.dir + "/../../jobs"), "..", "package.json"), "utf8")).scripts.test.replace(/^bun test/, "echo");
      const dir = join(base, "pkg");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: script } }));
      return Bun.spawnSync(["bun", "run", "test"], { cwd: dir, env: { ...e, ...extra }, stdout: "pipe" }).stdout.toString();
    };
    expect(run({})).toContain(`--parallel=${cores}\n`);
    expect(run({ ALEPH_TEST_PARALLEL: "7" })).toContain("--parallel=7\n");
  });
});
