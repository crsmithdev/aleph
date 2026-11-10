import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { liveRuns } from "./factory-status.ts";
import { type Run } from "../records/ledger.ts";
import { putRun } from "../records/record.ts";

const NOW = Date.parse("2026-10-30T00:00:00Z");
let base: string;
beforeEach(() => { setSystemTime(NOW); base = mkdtempSync(join(tmpdir(), "aleph-livecap-")); process.env.ALEPH_JOBS_DIR = base; });
afterEach(() => { setSystemTime(); delete process.env.ALEPH_JOBS_DIR; rmSync(base, { recursive: true, force: true }); });

function run(id: string, extra: Partial<Run>, files: string[] = []): void {
  const folder = join(base, id);
  mkdirSync(folder);
  putRun(basename(folder), { kind: "build", job: id, name: id, repo: "demo", condition: "running", told: true, started: "2026-10-30T00:00:00Z", made: NOW, ...extra } as Run);
  for (const f of files) writeFileSync(join(folder, f), "999999");
}

test("a started run with no pid yet counts against the live cap", () => {
  run("a", {});
  expect(liveRuns()).toBe(1);
});
