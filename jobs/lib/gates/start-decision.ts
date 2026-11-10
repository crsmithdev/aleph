/**
 * The one answer to "may this issue start now, and on which tier": the dispatch and the stall check both ask it.
 * It asks issueDecision with the factory's gates for the run the issue would start, and rates the issue only when the
 * tier can change the answer: a backend is held and the issue has no run yet, or the live cap binds and a tier on
 * the local backend has room. The caller reads the issue's own facts, and holds the locks and does the writes.
 */
import { issueDecision, type IssueDecision, type IssueFacts } from "./issue-decision.ts";
import { backendHold, factoryGates, heldGoal, nextRun } from "./factory-status.ts";
import { TIER_MODEL, TIERS, type Tier } from "../routing/route.ts";
import type { Job } from "../records/job.ts";
import type { Repo } from "../records/ledger.ts";

/** The tier of the issue's spec, or null for the default model. */
export type Route = () => Promise<Tier | null>;

/** A route with no model call: the default model, which a start also takes when the router gives no tier. */
export const unrouted: Route = async () => null;

/** `tier`: the tier the start runs on, or undefined when no route was asked, so the start rates the spec itself. */
export type StartDecision = IssueDecision & { tier?: Tier | null };

/** The decision for the issue of `f`, with its tier. */
export async function decideStart(repo: Repo, f: IssueFacts, jobs: Job[], route: Route): Promise<StartDecision> {
  const run = nextRun(repo.key, f.name, jobs);
  const on = (tier: Tier | null) => issueDecision({ ...f, ...factoryGates(jobs, tier ? { model: TIER_MODEL[tier] } : {}) });
  let d = issueDecision({ ...f, ...factoryGates(jobs, run ?? undefined), ...(run ? {} : { backend: heldGoal(f.name) }) });
  let tier: Tier | null | undefined;
  // An issue with no run yet starts on its tier's backend: while a backend is held, rate the issue, and check that backend.
  if (!run && d.kind === "ready" && backendHold()) {
    tier = await route();
    d = on(tier);
  }
  // The live cap held the issue, but a tier on the local backend has room: rate the issue, and check its tier's cap.
  if (d.kind === "live-cap" && tier === undefined && TIERS.some((t) => !factoryGates(jobs, { model: TIER_MODEL[t] })["live-cap"])) {
    tier = await route();
    if (tier) d = on(tier);
  }
  return { ...d, tier };
}
