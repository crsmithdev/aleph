/**
 * `POST /api/proposals/:id/approve` and `POST /api/proposals/:id/decline`: Chris's Yes or No on a correction-memory proposal, run in
 * process (no `aleph` command does this) through `post` in ui/action.ts.
 */
import { approve, decline } from "../../jobs/lib/learning/corrections.ts";
import { loadRegistry } from "../../jobs/lib/records/ledger.ts";
import { fail, post } from "../action.ts";
import type { Routes } from "../server.ts";

export const routes: Routes = {
  "POST /api/proposals/:id/approve": post((_body, { id }) => {
    // The lesson is about aleph itself: the first registry repo that runs in the sandbox.
    const repo = Object.values(loadRegistry()).find((r) => r.sandbox) ?? fail(422, "no sandboxed repo in the registry to reopen the issue in");
    const ref = approve(id, repo);
    if (!/^[\w.-]+-\d+$/.test(ref) || !ref.startsWith(`${repo.key}-`)) fail(422, ref);
    return { issue: ref };
  }),
  "POST /api/proposals/:id/decline": post((_body, { id }) => {
    const refusal = decline(id);
    if (refusal) fail(422, refusal);
    return { declined: id };
  }),
};
