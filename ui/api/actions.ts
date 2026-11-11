/**
 * `POST /api/jobs/:id/land|recheck|drop` and `POST /api/jobs/:id/answer` (`{ answer }`, "Answer and rerun" on a
 * question run: the answer becomes the reason of `aleph drop`, so the next dispatch carries it in the spec). `:id` is a
 * job ID, `a1430#2`. Each action is the `aleph` command of that name on the job's name, run through ui/action.ts. The
 * command acts on the newest job of that name, so an action acts only while the named job is that one: a 409 otherwise.
 */
import { allRuns, isWaiting, loadRegistry, onOf, runOfJob, type Entry } from "../../jobs/lib/records/ledger.ts";
import { latestJob } from "../../jobs/lib/records/job.ts";
import { counting, jobIdOf } from "../../jobs/lib/records/record.ts";
import { may } from "../../jobs/lib/asks/ask.ts";
import * as issues from "../../issues/lib/issues.ts";
import { afterOf } from "../../issues/lib/store.ts";
import { FULL, fullId } from "../../lib/naming.ts";
import { aleph, fail, post } from "../action.ts";
import type { Routes } from "../server.ts";

/** The run of job `id`, while it is the run that counts of the newest job of its name; a 404 or a 409 otherwise. */
function find(id: string): Entry {
  loadRegistry();
  const all = allRuns(), e = runOfJob(id, all) ?? fail(404, `no job ${id}`);
  const now = counting(latestJob(e.run.name)!);
  if (now.id !== e.id) fail(409, `${id} is no longer the job of ${e.run.name}: ${jobIdOf(now)} is`);
  return e;
}

const action = (verb: "land" | "recheck" | "drop") => post(async (body, { id }) => {
  const { run } = find(id);
  const reason = verb === "drop" && typeof body.reason === "string" ? body.reason.trim() : "";
  return aleph([verb, "--", run.name, ...(reason ? [reason] : [])]);
});

const answerAndRerun = post(async (body, { id }) => {
  const { run } = find(id);
  if (!isWaiting(run.condition) || may("chris", "answer", run.ask, { run: true })) fail(409, `${id} is ${run.condition}, not waiting for an answer`);
  const said = typeof body.answer === "string" ? body.answer.trim() : "";
  if (!said) fail(400, "answer is required");
  return aleph(["drop", "--", run.name, `Chris answered the worker's question "${run.ask?.question ?? run.question ?? ""}": ${said}`]);
});

/**
 * "Wait for <repo>-<n>": set the stuck job's issue (a part run's dotted `on` names the issue holding the part) to wait
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
  await edit(on).catch((e) => fail(e.status ?? 500, `set the wait: ${e.message}`));
  try {
    return await aleph(["drop", "--", name, `Chris chose to wait for ${on}: this job cannot succeed until it lands.`]);
  } catch (e: any) {
    const back = await edit(was).then(() => "its wait was put back", () => `it still waits on ${on}`);
    return fail(e.status ?? 500, `drop the job: ${e.message}; ${repo}-${issue} ${back}`);
  }
});

export const routes: Routes = {
  "POST /api/jobs/:id/land": action("land"),
  "POST /api/jobs/:id/recheck": action("recheck"),
  "POST /api/jobs/:id/drop": action("drop"),
  "POST /api/jobs/:id/wait": wait,
  "POST /api/jobs/:id/answer": answerAndRerun,
};
