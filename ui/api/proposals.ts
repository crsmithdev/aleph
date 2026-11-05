/**
 * `POST /api/approve/:id` and `POST /api/decline/:id`: Chris's Yes or No on a correction-memory
 * proposal. Under the same header and Origin rule as ui/api/controls.ts. The password gate in `ui/auth.ts` is what stops a LAN client, so this check is only against other web pages. The answer is the
 * `{ code, stdout, stderr }` the page's click handler shows.
 */
import { approve, decline } from "../../jobs/lib/learning/corrections.ts";
import { loadRegistry } from "../../jobs/lib/records/ledger.ts";
import { sameSite, text } from "../http.ts";
import type { Handler, Routes } from "../server.ts";

/** `{ code: 0, stdout }` when `done` is not a refusal, else 422 with the refusal in stderr. */
const answer = (ok: boolean, stdout: string, refusal: string) =>
  ok ? Response.json({ code: 0, stdout, stderr: "" }) : Response.json({ code: 1, stdout: "", stderr: refusal }, { status: 422 });

const approveHandler: Handler = (req, params) => {
  if (!sameSite(req)) return text("forbidden", 403);
  // The lesson is about aleph itself: the first registry repo that runs in the sandbox.
  const repo = Object.values(loadRegistry()).find((r) => r.sandbox);
  if (!repo) return answer(false, "", "no sandboxed repo in the registry to file the goal in");
  const ref = approve(params.id, repo);
  return answer(/^[\w.-]+-\d+$/.test(ref) && ref.startsWith(`${repo.key}-`), ref, ref);
};

const declineHandler: Handler = (req, params) => {
  if (!sameSite(req)) return text("forbidden", 403);
  const refusal = decline(params.id);
  return answer(!refusal, "declined", refusal);
};

export const routes: Routes = {
  "POST /api/approve/:id": approveHandler,
  "POST /api/decline/:id": declineHandler,
};
