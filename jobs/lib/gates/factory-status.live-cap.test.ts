import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liveRuns } from "./gpu.ts";
import { type Run } from "../records/ledger.ts";
import { seed } from "../../job.testkit.ts";

const NOW = Date.parse("2026-10-30T00:00:00Z");
let base: string;
beforeEach(() => { setSystemTime(NOW); base = mkdtempSync(join(tmpdir(), "aleph-livecap-")); process.env.ALEPH_JOBS_DIR = base; process.env.ALEPH_DB = join(base, "aleph.db"); });
afterEach(() => { setSystemTime(); delete process.env.ALEPH_JOBS_DIR; delete process.env.ALEPH_DB; rmSync(base, { recursive: true, force: true }); });

function run(id: string, extra: Partial<Run>, files: string[] = []): void {
  const { folder } = seed({ role: "build", name: id, repo: "demo", state: "running", started: "2026-10-30T00:00:00Z", made: NOW, ...extra });
  for (const f of files) writeFileSync(join(folder, f), "999999");
}

test("a started run with no pid yet counts against the live cap", () => {
  run("a", {});
  expect(liveRuns()).toBe(1);
});
