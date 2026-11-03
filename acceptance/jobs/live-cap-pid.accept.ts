// Archived goal tests from jobs/live-cap-pid.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liveRuns } from "../../jobs/lib/factory-status.ts";
import { writeRun, type Run } from "../../jobs/lib/ledger.ts";
import { STARTING_MS } from "../../jobs/lib/process.ts";

let base: string;
beforeEach(() => { base = mkdtempSync(join(tmpdir(), "aleph-livecap-")); process.env.ALEPH_JOBS_DIR = base; });
afterEach(() => { delete process.env.ALEPH_JOBS_DIR; rmSync(base, { recursive: true, force: true }); });

function run(id: string, extra: Partial<Run>, files: string[] = []): void {
  const folder = join(base, id);
  mkdirSync(folder);
  writeRun(folder, { kind: "build", job: id, name: id, repo: "demo", condition: "running", told: true, started: "2026-10-30T00:00:00Z", made: Date.now(), ...extra } as Run);
  for (const f of files) writeFileSync(join(folder, f), "999999");
}

test("a run with an exit, a run that ended, and a long-silent start do not count", () => {
  run("b", {}, ["exit"]);
  run("c", { condition: "failed" });
  run("d", { made: Date.now() - STARTING_MS - 1000 });
  expect(liveRuns()).toBe(0);
});
