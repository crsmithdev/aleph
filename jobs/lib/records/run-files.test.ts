import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobFolder, jobOfFolder, logStream, logTo, readSection, runFile } from "./run-files.ts";

let dir: string;
const saved = process.env.ALEPH_JOBS_DIR;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "aleph-run-files-")); process.env.ALEPH_JOBS_DIR = dir; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); if (saved === undefined) delete process.env.ALEPH_JOBS_DIR; else process.env.ALEPH_JOBS_DIR = saved; });

test("the folder of job.<n> is <jobs>/<n>, and the key comes back from the folder", () => {
  expect(jobFolder("job.6802")).toBe(join(dir, "6802"));
  expect(jobOfFolder(join(dir, "6802"))).toBe("job.6802");
  expect(() => jobFolder("issue.3")).toThrow();
});

test("every file of a job folder is named by runFile", () => {
  expect(runFile("/f", "transcript.jsonl")).toBe("/f/transcript.jsonl");
  expect(runFile("/f", "log.txt")).toBe("/f/log.txt");
});

test("log.txt holds sections: each logTo adds a block, readSection joins the blocks of one section", () => {
  const f = dir;
  logTo(f, "command", "aleph job demo x");
  logTo(f, "setup", "## bun install\nok");
  logTo(f, "checks", "## tests: exit 1");
  logTo(f, "checks", "## lint: exit 0");
  expect(readSection(f, "command")).toBe("aleph job demo x\n");
  expect(readSection(f, "checks")).toBe("## tests: exit 1\n## lint: exit 0\n");
  expect(readSection(f, "land")).toBeUndefined();
  expect(readFileSync(join(f, "log.txt"), "utf8")).toBe("=== command ===\naleph job demo x\n=== setup ===\n## bun install\nok\n=== checks ===\n## tests: exit 1\n=== checks ===\n## lint: exit 0\n");
});

test("a process that appends to the path of logStream writes into its section", async () => {
  const path = logStream(dir, "stderr");
  await Bun.spawn(["bash", "-c", "echo oops"], { stdout: Bun.file(path) }).exited.then(() => {});
  expect(path).toBe(join(dir, "log.txt"));
});
