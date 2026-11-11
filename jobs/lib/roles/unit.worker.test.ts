import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, fakeLog, jobsDir, state, setup, teardown } from "../../cli.helpers";
import { actionJob, drop } from "../../flow.testkit.ts";

// The runs start in-process, as `aleph job` starts them; each run's unit is a process of its own.
beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const fjob = (name: string, action: string, extra: Record<string, string> = {}) => actionJob(name, action, extra, "fac");

  test("a worker that commits only result.md is stuck with no commit, and no check, review or land starts", async () => {
    const r = await fjob("fresult", "commit result.md", { ALEPH_FIX_ROUNDS: "0" });
    const s = state(r.json.run);
    expect(s).toMatchObject({ condition: "failed", reason: "no commit" });
    expect(s.checks ?? []).toEqual([]);
    expect(s.review).toBeUndefined();
    expect(readdirSync(jobsDir).filter((d) => d.includes("-fac-fresult-")).map((d) => state(d).kind)).not.toContain("land");
    await drop("fresult");
  }, 30_000);

  test("a worker-medium tier set to gpt-oss-20b runs the worker on gpt-oss-20b at the local base URL with cost 0, and a sonnet tier on sonnet", async () => {
    const slot = (backend: string) => { mkdirSync(join(base, "factory"), { recursive: true }); writeFileSync(join(base, "factory", "models.json"), JSON.stringify({ "worker-medium": { enabled: true, model: backend } })); };
    const spec = (n: string) => `Goal: ${n}\nACTION: commit ${n}.txt\n`;
    slot("gpt-oss-20b");
    const local = await aleph(["job", "fac", "flocal", "--spec", "-", "--model", "sonnet"], { ALEPH_FIX_ROUNDS: "0" }, spec("flocal"));
    expect(readFileSync(join(fakeLog, "args"), "utf8")).toContain("--model gpt-oss-20b");
    expect(readFileSync(join(fakeLog, "env"), "utf8")).toContain("ANTHROPIC_BASE_URL=http://127.0.0.1:8012");
    expect(state(local.json.run)).toMatchObject({ model: "gpt-oss-20b", cost: 0 });
    slot("sonnet");
    const claude = await aleph(["job", "fac", "fclaude", "--spec", "-", "--model", "sonnet"], { ALEPH_FIX_ROUNDS: "0" }, spec("fclaude"));
    expect(readFileSync(join(fakeLog, "args"), "utf8")).toContain("--model sonnet");
    expect(readFileSync(join(fakeLog, "env"), "utf8")).not.toContain("ANTHROPIC_BASE_URL");
    expect(state(claude.json.run).model).toBe("sonnet");
    await drop("flocal");
    await drop("fclaude");
  }, 60_000);

  test("a worker-medium tier set to an OpenRouter model runs the worker on OpenRouter with the key, and prices the run from the table, not Claude Code's cost", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "models.json"), JSON.stringify({ "worker-medium": { enabled: true, model: "deepseek-v4.1-flash" } }));
    const r = await aleph(["job", "fac", "frouted", "--spec", "-", "--model", "sonnet"], { ALEPH_FIX_ROUNDS: "0", OPENROUTER_API_KEY: "sk-or-test" }, "Goal: frouted\nACTION: commit frouted.txt\n");
    expect(readFileSync(join(fakeLog, "args"), "utf8")).toContain("--model deepseek/deepseek-v4.1-flash");
    const env = readFileSync(join(fakeLog, "env"), "utf8");
    expect(env).toContain("ANTHROPIC_BASE_URL=https://openrouter.ai/api");
    expect(env).toContain("ANTHROPIC_AUTH_TOKEN=sk-or-test");
    // The fake reports 1M input and 1M output tokens and $0.01: the table's $0.045 + $0.50 wins.
    expect(state(r.json.run)).toMatchObject({ model: "deepseek-v4.1-flash", tier: "sonnet", cost: 0.545 });
    await drop("frouted");
  }, 30_000);

  test("a worker-low tier set to gpt-oss-20b leaves a run record with model gpt-oss-20b and tier haiku", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "models.json"), JSON.stringify({ "worker-low": { enabled: true, model: "gpt-oss-20b" } }));
    const r = await aleph(["job", "fac", "flowtier", "--spec", "-", "--model", "haiku"], { ALEPH_FIX_ROUNDS: "0" }, "Goal: flowtier\nACTION: commit flowtier.txt\n");
    expect(state(r.json.run)).toMatchObject({ model: "gpt-oss-20b", tier: "haiku" });
    await drop("flowtier");
  }, 30_000);
});
