/** The stall check: the work the factory could move now and does not, which the tick's sweep starts. See docs/factory.md. */
import { issueKey } from "../../../lib/naming.ts";
import { buildableIssues, reader } from "../../../lib/store.ts";
import { allJobs } from "../records/ledger.ts";
import { isLive } from "../infra/process.ts";
import { waitingToLand } from "../land/landing.ts";
import { gates } from "../gates/factory-status.ts";
import { paused } from "../gates/pause.ts";
import { sandboxRepos, liveRuns } from "../gates/gpu.ts";
import { unrouted } from "../gates/start-decision.ts";
import { decider, type Decider } from "../gates/decider.ts";

/**
 * What the factory could move now and does not, as `land:<job>`, `issue:<id>` and `ingest:<id>`: a passed run with no
 * land live; an issue that can start with no agent run live; an issue to take in or plan with no intake run live. The gates that stop each step leave its work out, because each gate has its own line.
 */
export async function stalled(jobs = allJobs(), lists = reader(), at: Decider = decider({ fresh: true, jobs, lists })): Promise<string[]> {
  if (paused()) return [];
  const runs = jobs.flat();
  const live = (kind: string) => runs.some((e) => e.run.role === kind && e.run.state === "running" && isLive(e.folder));
  const out = live("land") ? [] : waitingToLand(jobs).map((name) => `land:${name}`);
  if (!liveRuns(runs)) {
    for (const { repo, item } of buildableIssues(sandboxRepos(), lists)) {
      // No model call: the stall check agrees with the dispatch on all but the router's size.
      if ((await at.decide(repo, item, { jobs, route: unrouted })).kind === "ready") out.push(`issue:${issueKey(item.id)}`);
    }
  }
  if (!live("intake") && !gates({ only: ["full"], jobs })) {
    for (const { item } of at.intakeCandidates()) out.push(`ingest:${issueKey(item.id)}`);
  }
  return out;
}
