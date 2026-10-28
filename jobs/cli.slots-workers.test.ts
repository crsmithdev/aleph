import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { aleph, base, fakeLog, repo, setup, specFile, state, teardown } from "./cli.helpers";

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
  test("a factory run's worker and its checks in the sandbox carry cores / slots", async () => {
    const r = await aleph(["job", "slotfac", "wenv", "--spec", specFile("Goal: wenv\nACTION: commit wenv.txt\n")], { ALEPH_CHECK_SLOTS: "4" });
    expect(state(r.json.run).state).toBe("passed");
    const want = String(Math.floor(cores / 4));
    expect(readFileSync(join(fakeLog, "env"), "utf8")).toContain(`ALEPH_TEST_PARALLEL=${want}\n`);
    expect(readFileSync(join(base, "slotfac.log.env"), "utf8").trim()).toBe(want);
  }, 60_000);

  test("package.json reads ALEPH_TEST_PARALLEL and falls back to the core count", () => {
    const run = (extra: Record<string, string>) => {
      const e: Record<string, string> = { ...(process.env as Record<string, string>) };
      delete e.ALEPH_TEST_PARALLEL;
      const script = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")).scripts.test.replace(/^bun test/, "echo");
      const dir = join(base, "pkg");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: script } }));
      return Bun.spawnSync(["bun", "run", "test"], { cwd: dir, env: { ...e, ...extra }, stdout: "pipe" }).stdout.toString();
    };
    expect(run({})).toContain(`--parallel=${cores}\n`);
    expect(run({ ALEPH_TEST_PARALLEL: "7" })).toContain("--parallel=7\n");
  });
});
