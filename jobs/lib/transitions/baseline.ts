/**
 * Main's baseline: `aleph suite` runs the full checks on origin/<main> of each factory repo, and main's state is
 * what the last suite run recorded. See docs/factory.md.
 */
import { join } from "node:path";
import { fetchOrigin, git } from "../../../lib/git.ts";
import { factoryDir } from "../../../lib/layout.ts";
import { lock } from "../../../lib/locks.ts";
import type { Repo } from "../records/ledger.ts";
import { baselineChecks, type CheckTask, type ChecksStop } from "../gates/checks.ts";
import { paused } from "../gates/pause.ts";
import { sandboxRepos } from "../gates/gpu.ts";
import { appendSuiteHistory, recordRan, type MainState, writeBaseline, baselines, redLine } from "../gates/tables.ts";
import { dispatchDetached } from "./launch.ts";

export type Checks = (repo: Repo, commit: string, logs: string, record?: CheckTask["record"]) => Promise<ChecksStop | null>;

/** Main's baseline as a closed state: `line` is the sentence for logs and skip lines. */

/**
 * Main's state as the last suite run recorded it in the `baseline` row of `state`, or as `b` gives it. A red record stays
 * red until a later suite run is green, also when main has moved since; a repo with no record is unchecked.
 */
export function mainState(repo: Repo, b = baselines()[repo.key]): MainState {
  if (!b) return { state: "unchecked", line: "main is unchecked: no suite run yet" };
  return b.ok ? { state: "green" } : { state: "red", line: redLine(b) };
}

/** What a suite record holds for besides its commit: the setup and checks it ran. A change of either runs the suite again. */
export const baselineConfig = (repo: Repo): string => JSON.stringify([repo.setup, repo.checks]);

/**
 * Whether the repo's checks pass on its current origin/<main>: run once per
 * commit, kept in the `baseline` row of `state`. Returns the closed state with its line.
 * One baseline runs per repo at a time, under a lock; a suite run that finds it
 * taken leaves it. A pass and a failed check are recorded: an error that kept
 * the checks from running (no verdict) is reported, and the next suite run tries again.
 */
export async function baseline(repo: Repo, checks: Checks): Promise<MainState> {
  const unchecked = (line: string): MainState => ({ state: "unchecked", line });
  if (!fetchOrigin(repo.path).ok) return unchecked("main is unchecked: fetch failed");
  const commit = git(repo.path, "rev-parse", `origin/${repo.main}`).out;
  if (!commit) return unchecked(`main is unchecked: no origin/${repo.main}`);
  const config = baselineConfig(repo);
  const known = () => { const b = baselines()[repo.key]; return b && b.commit === commit && b.config === config ? b : undefined; };
  let b = known();
  if (!b) {
    const release = await lock(`baseline-${repo.key}`, 0);
    if (!release) return { state: "running", line: "main baseline running" };
    try {
      // Another dispatch may have recorded this commit between the read and the lock.
      b = known();
      if (!b) {
        const sum = { ran: 0, passed: 0, failed: 0, skipped: 0, rerunPassed: 0 };
        const why = await checks(repo, commit, join(factoryDir(), "baseline", repo.key), (c) => {
          if (!c.tests) return;
          sum.ran += c.tests.ran; sum.passed += c.tests.passed; sum.failed += c.tests.failed; sum.skipped += c.tests.skipped;
          sum.rerunPassed += c.rerunPassed ?? 0;
        });
        if (why && why.cause !== "check") return unchecked(`main is unchecked: ${why.reason}`);
        b = { repo: repo.key, commit, config, ok: !why, ...(why ? { failed: why.checkName ?? "" } : {}) };
        const entry = b;
        writeBaseline(repo.key, () => entry);
        appendSuiteHistory({ repo: repo.key, commit, at: new Date().toISOString(), ...sum });
      }
    } finally {
      release();
    }
  }
  return mainState(repo, b);
}

/**
 * `aleph suite`, from its own timer: the full checks on origin/<main> of each factory repo whose main moved since
 * the last record (`baseline`). While the factory is paused it does nothing. A repo that turns green starts a
 * dispatch, so the issues its red or unchecked main held start at once.
 */
export async function suiteStep(checks: Checks = baselineChecks): Promise<Record<string, string>> {
  if (paused()) return {};
  const out: Record<string, string> = {};
  for (const repo of sandboxRepos()) {
    const was = mainState(repo).state;
    const b = await baseline(repo, checks);
    out[repo.key] = b.state === "green" ? "green" : b.line;
    recordRan(`suite ${repo.key}`, out[repo.key]);
    if (b.state === "green" && was !== "green") dispatchDetached();
  }
  return out;
}
