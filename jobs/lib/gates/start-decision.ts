/**
 * The one answer to "may this issue start now, and on which size": the dispatch and the stall check both ask it.
 * It asks issueDecision with the factory's gates for the run the issue would start, and rates the issue only when the
 * size can change the answer: a backend is held and the issue has no run yet, or the live cap binds and a size on
 * the local backend has room. The caller reads the issue's own facts, and holds the locks and does the writes.
 */
import { issueDecision, type IssueDecision, type IssueFacts } from "./issue-decision.ts";
import { factoryGates, nextRun } from "./factory-status.ts";
import { backendHold, heldGoal } from "./holds.ts";
import { SIZES, type Size } from "../routing/route.ts";
import { isRedMain } from "../../../issues/lib/store.ts";
import type { Job } from "../records/job.ts";
import type { Repo } from "../records/ledger.ts";

/** The size of the issue's spec, or null for the default model. */
export type Route = () => Promise<Size | null>;

/** A route with no model call: the default model, which a start also takes when the router gives no size. */
export const unrouted: Route = async () => null;

/** `size`: the size the start runs on, or undefined when no route was asked, so the start rates the spec itself. */
export type StartDecision = IssueDecision & { size?: Size | null };

/** The decision for the issue of `f`, with its size. A red-main fix issue has the fixed size medium, and `route` is not asked. */
export async function decideStart(repo: Repo, f: IssueFacts, jobs: Job[], route: Route): Promise<StartDecision> {
  const fixed = isRedMain(f.item);
  if (fixed) route = async () => "medium";
  const run = nextRun(repo.key, f.name, jobs);
  const on = (size: Size | null) => issueDecision({ ...f, ...factoryGates(jobs, size ? { model: size } : {}) });
  let d = issueDecision({ ...f, ...factoryGates(jobs, run ?? undefined), ...(run ? {} : { waiting: heldGoal(f.name) }) });
  let size: Size | null | undefined;
  // An issue with no run yet starts on its size's backend: while a backend is held, rate the issue, and check that backend.
  if (!run && d.kind === "ready" && backendHold()) {
    size = await route();
    d = on(size);
  }
  // The live cap held the issue, but a size on the local backend has room: rate the issue, and check its size's cap.
  if (d.kind === "full" && size === undefined && SIZES.some((s) => !factoryGates(jobs, { model: s }).full)) {
    size = await route();
    if (size) d = on(size);
  }
  return { ...d, size: fixed ? "medium" : size };
}
