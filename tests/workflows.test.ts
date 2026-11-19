/**
 * Every workflow file in .github/workflows/ parses as YAML with a `jobs` key. The parser must also reject a plain
 * scalar that contains ": ", so a pass on the real files means the parser checks YAML.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "..", ".github", "workflows");

for (const file of readdirSync(DIR).filter((name) => name.endsWith(".yml"))) {
  test(`${file} parses as YAML with a jobs key`, () => {
    // The 7b5bdf514 form of ci.yml: the parser must reject it, or a pass below means nothing.
    const text = 'steps:\n  - run: echo "runner cores: $(nproc)" && bun run test:all\n';
    expect(() => Bun.YAML.parse(text)).toThrow();
    const parsed = Bun.YAML.parse(readFileSync(join(DIR, file), "utf8"));
    expect(parsed).toHaveProperty("jobs");
  });
}

test("ci.yml bails the test step after three failures, and no script bails", () => {
  const ci = Bun.YAML.parse(readFileSync(join(DIR, "ci.yml"), "utf8")) as {
    jobs: { test: { steps: { run?: string }[] } };
  };
  const run = ci.jobs.test.steps.map((step) => step.run).find((text) => text?.includes("bun run test:all"));
  expect(run).toContain("--bail=3");
  // A local `bun run test` must run every test, so --bail stays out of the scripts.
  const { scripts } = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"));
  expect(scripts.test).not.toContain("--bail");
  expect(scripts["test:all"]).not.toContain("--bail");
});

test("guard: ci.yml loads the aleph-tools deploy key before the step that clones it at ALEPH_TOOLS_REF and sets ALEPH_TOOLS", () => {
  const ci = Bun.YAML.parse(readFileSync(join(DIR, "ci.yml"), "utf8")) as {
    jobs: { test: { steps: { run?: string }[] } };
  };
  const steps = ci.jobs.test.steps;
  const key = steps.findIndex((step) => JSON.stringify(step).includes("secrets.ALEPH_TOOLS_DEPLOY_KEY"));
  const clone = steps.findIndex((step) => step.run?.includes("crsmithdev/aleph-tools") && step.run.includes("ALEPH_TOOLS_REF") && step.run.includes("ALEPH_TOOLS="));
  expect(clone).toBeGreaterThan(-1);
  expect(key).toBeGreaterThan(-1);
  expect(key).toBeLessThan(clone);
});
