import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findingsOf, monitorDue, monitorStep, readerPrompt } from "./monitor.ts";
import { monitorPanel, reportFile, reportLine, type Report } from "./monitor-table.ts";
import { allRuns } from "./ledger.ts";
import { setPaused } from "./factory-status.ts";

const KEYS = ["ALEPH_FACTORY_DIR", "ALEPH_JOBS_DIR", "ALEPH_REPOS", "ALEPH_ISSUES", "ALEPH_VAULT", "ALEPH_MONITOR_CMD", "ALEPH_MONITOR", "FAKE_DIR"] as const;
const GIT = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base = "", saved: Record<string, string | undefined> = {};

// The fake reader: it keeps its prompt and its arguments, and replies two ranked findings.
const FAKE = `#!/bin/bash
cat > "$FAKE_DIR/prompt.md"
echo "$*" > "$FAKE_DIR/args"
echo "1. Build runs with no usable result rose to 38% from 20%."
echo "2. Plan runs per item rose to 1.4 from 1.1."
`;

const now = new Date("2026-10-21T08:00:00");

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  base = mkdtempSync(join(tmpdir(), "monitor-"));
  writeFileSync(join(base, "fake"), FAKE);
  chmodSync(join(base, "fake"), 0o755);
  Object.assign(process.env, {
    ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_JOBS_DIR: join(base, "runs"), ALEPH_REPOS: join(base, "repos.json"),
    ALEPH_ISSUES: join(base, "issues"), ALEPH_VAULT: join(base, "vault"), ALEPH_MONITOR_CMD: join(base, "fake"), FAKE_DIR: base,
  });
  delete process.env.ALEPH_MONITOR;
});

afterEach(() => {
  for (const k of KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  rmSync(base, { recursive: true, force: true });
});

const initVault = () => {
  const p = Bun.spawnSync(["bun", join(import.meta.dir, "..", "..", "vault", "cli.ts"), "init"], { env: { ...process.env, ...GIT }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
};

test("the tick's step reads yesterday's table with a tool-less reader once a day, while the factory is paused", async () => {
  setPaused(true);
  initVault();
  Object.assign(process.env, GIT);
  const r = (await monitorStep(now))!;
  expect(r.day).toBe("2026-10-20");
  expect(r.findings).toEqual(["Build runs with no usable result rose to 38% from 20%.", "Plan runs per item rose to 1.4 from 1.1."]);
  const prompt = readFileSync(join(base, "prompt.md"), "utf8");
  expect(prompt).toContain("# Factory monitor 2026-10-20");
  expect(prompt).toContain("Acceptance failures that led to a real fix: 0 of 0");
  expect(readFileSync(join(base, "args"), "utf8")).toContain("--model claude-opus-5-5 --tools ");
  const runs = allRuns().filter((e) => e.run.kind === "monitor");
  expect(runs).toHaveLength(1);
  expect(runs[0].run).toMatchObject({ condition: "done", reason: "2 findings", name: "monitor-2026-10-20" });
  const kept: Report = JSON.parse(readFileSync(reportFile("2026-10-20"), "utf8"));
  expect(kept.findings).toEqual(r.findings);
  expect(kept.note).toBeUndefined();
  expect(existsSync(join(base, "vault", "wiki", "gotchas", "Factory Monitor 2026-10-20.md"))).toBe(false);
  // Once a day: the report of yesterday is there.
  expect(monitorDue(now)).toBeNull();
  expect(await monitorStep(now)).toBeNull();
  expect(allRuns().filter((e) => e.run.kind === "monitor")).toHaveLength(1);
});

test("a reader that fails leaves a report with the table and the error, and the run states no-answer", async () => {
  process.env.ALEPH_MONITOR_CMD = "false";
  const r = (await monitorStep(now))!;
  expect(r.error).toBe("the monitor reader exited 1");
  expect(r.findings).toEqual([]);
  expect(allRuns().find((e) => e.run.kind === "monitor")!.run).toMatchObject({ condition: "done", cause: "no-answer" });
  expect(reportLine(now.getTime())).toBe("health: the monitor of 2026-10-20 has no reading: the monitor reader exited 1");
});

test("ALEPH_MONITOR=off keeps the tick's step from running", async () => {
  process.env.ALEPH_MONITOR = "off";
  expect(await monitorStep(now)).toBeNull();
  expect(allRuns()).toHaveLength(0);
});

test("the Status panel and the report line show the newest report", async () => {
  expect(monitorPanel()).toBeNull();
  expect(reportLine(now.getTime())).toBeNull();
  await monitorStep(now);
  const p = monitorPanel()!;
  expect(p.day).toBe("2026-10-20");
  expect(p.findings).toHaveLength(2);
  expect(p.headline).toStartWith("Acceptance failures that led to a real fix:");
  expect(p.table).toContain("## Stages");
  expect(reportLine(now.getTime())).toBe("health: the monitor of 2026-10-20 names 2 things that look off; first: Build runs with no usable result rose to 38% from 20%.");
  // A report older than 3 days is no longer said.
  expect(reportLine(new Date("2026-10-25T08:00:00").getTime())).toBeNull();
});

test("the findings are the numbered lines of the reply; NOTHING gives none", () => {
  expect(findingsOf("1. one\n2) two\nnot a finding\n 3. three")).toEqual(["one", "two", "three"]);
  expect(findingsOf("NOTHING: all within the trailing range")).toEqual([]);
  expect(readerPrompt("TABLE")).toEndWith("\nTABLE");
  expect(readerPrompt("TABLE")).toContain("You only read.");
});

