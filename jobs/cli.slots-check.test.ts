import { afterAll, beforeAll, expect, test } from "bun:test";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, job, jobsDir, repo, setup, state, teardown, until } from "./cli.helpers";
import { checkSlot } from "./lib/ledger.ts";

beforeAll(() => {
  setup();
  const regs = JSON.parse(readFileSync(join(base, "repos.json"), "utf8"));
  regs.slots = { path: repo, autoland: false, checks: [{ name: "suite", run: `echo ran >> ${join(base, "slots.log")}` }] };
  writeFileSync(join(base, "repos.json"), JSON.stringify(regs));
});
afterAll(teardown);

/** The phase of the one run of job `name`, or "" before its state.json exists. */
const phaseOf = (name: string): string => {
  const run = existsSync(jobsDir) ? readdirSync(jobsDir).find((d) => d.endsWith(`-${name}-build`)) : undefined;
  try { return run ? state(run).phase ?? "" : ""; } catch { return ""; }
};

// The rule that the time limit starts only once a slot is taken is in jobs/lib/checks.test.ts, with a fake exec.
test("with every slot taken a run's checks wait, and run once the slot is free", async () => {
  const old = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = join(base, "run"); // The locks of the CLI runs: cli.helpers env().
  const free = await checkSlot();
  process.env.XDG_RUNTIME_DIR = old;
  let freed = false;
  try {
    const run = job("s1", "commit s1.txt", { ALEPH_CHECK_SLOTS: "1" }, "slots");
    await until(() => phaseOf("s1") === "verify");
    // The test holds the only slot, so the check cannot run before the test frees it.
    appendFileSync(join(base, "slots.log"), "freed\n");
    free();
    freed = true;
    const r = await run;
    expect(state(r.json.run)).toMatchObject({ condition: "passed" });
    expect(readFileSync(join(base, "slots.log"), "utf8")).toBe("freed\nran\n");
  } finally {
    if (!freed) free();
  }
}, 60_000);
