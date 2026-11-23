/**
 * `POST /api/jobs/:id/land|recheck|drop|park|unpark|cancel` and `POST /api/jobs/:id/answer` (`{ answer }`, "Answer and rerun" on a
 * question run: the answer becomes the reason of `aleph drop`, so the next dispatch carries it in the spec). `:id` is a
 * job ID, `a1430#2`. Each action is the `aleph` command of that name on the job's name, run through ui/action.ts. The
 * command acts on the newest job of that name, so an action acts only while the named job is that one: a 409 otherwise.
 */
import { isWaiting, loadRegistry, onOf, runOfJob, type Entry } from "../../jobs/lib/records/ledger.ts";
import { latestJob } from "../../jobs/lib/records/job.ts";
import { counting, allRuns } from "../../jobs/lib/records/record.ts";
import { may } from "../../jobs/lib/asks/ask.ts";
import * as issues from "../../issues/lib/issues.ts";
import { afterOf } from "../../lib/issue-file.ts";
import { FULL, fullId } from "../../lib/naming.ts";
import { aleph, fail, post } from "../action.ts";
import type { Routes } from "../server.ts";
import { errText } from "../../lib/errtext.ts";

/** The HTTP status a failed `aleph` call carries, else 500. */
const statusOf = (e: unknown): number => (e as { status?: number }).status ?? 500;

/** The run of job `id`, while it is the run that counts of the newest job of its name; a 404 or a 409 otherwise. */
function find(id: string): Entry {
  loadRegistry();
  const all = allRuns(), e = runOfJob(id, all) ?? fail(404, `no job ${id}`);
  const now = counting(latestJob(e.run.name)!);
  if (now.id !== e.id) fail(409, `${id} is no longer the job of ${e.run.name}: ${now.id} is`);
  return e;
}

const action = (verb: "land" | "recheck" | "drop") => post(async (body, { id }) => {
  const { run } = find(id);
  const reason = verb === "drop" && typeof body.reason === "string" ? body.reason.trim() : "";
  return aleph([verb, "--", run.name, ...(reason ? [reason] : [])]);
});

const answerAndRerun = post(async (body, { id }) => {
  const { run } = find(id);
  if (!isWaiting(run.state) || may("user", "resolve", run.ask)) fail(409, `${id} is ${run.state}, not waiting for an answer`);
  const said = typeof body.answer === "string" ? body.answer.trim() : "";
  if (!said) fail(400, "answer is required");
  return aleph(["drop", "--answered", "--", run.name, `The user answered the worker's question "${run.ask?.question ?? run.question ?? ""}": ${said}`]);
});

/** Job `id`'s name and its issue as `<repo> <n>`; a 400 for a job with no issue. */
function issueOfJob(id: string): { name: string; issue: [string, string] } {
  const { run } = find(id), n = onOf(run);
  if (!run.repo || n === undefined) fail(400, `${id} works on no issue`);
  return { name: run.name, issue: [run.repo!, String(n)] };
}

/** Park or unpark the job's issue: a parked issue starts no run, and its live run does not land. */
const park = (status: "parked" | "open") => post((_body, { id }) => aleph(["issue", "edit", "--status", status, "--", ...issueOfJob(id).issue]));

/**
 * Cancel: drop the job, and `then` decides the issue. `park` parks it, `drop` drops it, `restart` leaves it open, so the
 * dispatch starts it again. The issue changes first, because the drop starts the dispatch.
 */
const cancel = post(async (body, { id }) => {
  const then = body.then, { name, issue } = issueOfJob(id);
  if (!["park", "restart", "drop"].includes(then)) fail(400, "then must be park, restart or drop");
  if (then === "park") await aleph(["issue", "edit", "--status", "parked", "--", ...issue]);
  if (then === "drop") await aleph(["issue", "drop", "--", ...issue, "The user cancelled its job"]);
  return aleph(["drop", "--", name, "The user cancelled it"]);
});

/**
 * "Wait for <repo>-<n>": set the failed job's issue (a part run's dotted `on` names the issue holding the part) to wait
 * on that open issue, then drop the job. All or none: a failed drop puts the old `after` back, and the error says so.
 */
const wait = post(async (body, { id }) => {
  const last = find(id), name = last.run.name;
  const on = typeof body.on === "string" ? fullId(body.on.trim()) : "";
  const repo = last.run.repo, issue = onOf(last.run);
  if (!FULL.test(on) || !repo || issue === undefined) fail(400, "on must name an issue and the job an item");
  const place = loadRegistry()[repo!] ?? fail(400, `no repo named ${repo}`);
  const was = afterOf(issues.show(place, issue!)).join(",") || "none";
  const edit = (after: string) => aleph(["issue", "edit", "--after", after, "--", repo!, String(issue)]);
  await edit(on).catch((e) => fail(statusOf(e), `set the wait: ${errText(e)}`));
  try {
    return await aleph(["drop", "--", name, `The user chose to wait for ${on}: this job cannot succeed until it lands.`]);
  } catch (e) {
    const back = await edit(was).then(() => "its wait was put back", () => `it still waits on ${on}`);
    return fail(statusOf(e), `drop the job: ${errText(e)}; ${repo}-${issue} ${back}`);
  }
});

export const routes: Routes = {
  "POST /api/jobs/:id/land": action("land"),
  "POST /api/jobs/:id/recheck": action("recheck"),
  "POST /api/jobs/:id/drop": action("drop"),
  "POST /api/jobs/:id/wait": wait,
  "POST /api/jobs/:id/answer": answerAndRerun,
  "POST /api/jobs/:id/park": park("parked"),
  "POST /api/jobs/:id/unpark": park("open"),
  "POST /api/jobs/:id/cancel": cancel,
};
