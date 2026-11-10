/**
 * `GET /api/diff/:name`, `POST /api/land|recheck|drop/:name` and
 * `POST /api/answer/:name` (`{ answer }`, "Answer and rerun" on a
 * question run: the answer becomes the reason of `aleph drop`, so the next dispatch carries it in the spec). Each action is the `aleph` command of that
 * name, run through ui/action.ts. Each acts on the named job only, and only while its latest run is the `run` the page showed.
 */
import { askOf, isWaiting, loadRegistry, onOf } from "../../jobs/lib/records/ledger.ts";
import { jobDiff, NO_DIFF } from "../../jobs/lib/records/jobdiff.ts";
import { lastReal, latestJob } from "../../jobs/lib/records/job.ts";
import { may } from "../../jobs/lib/asks/ask.ts";
import * as issues from "../../issues/lib/issues.ts";
import { afterOf } from "../../issues/lib/store.ts";
import { aleph, fail, post } from "../action.ts";
import { text } from "../http.ts";
import type { Handler, Routes } from "../server.ts";

/** The last run of the job called `name`; a 404 when the ledger has none. */
const find = (name: string) => latestJob(name)?.at(-1) ?? fail(404, `no job named ${name}`);

/** A 409 when the page's `run` is not the job's latest run: a rerun came after the page showed it. */
const fresh = (name: string, body: any) => {
  if (body.run !== lastReal(latestJob(name)!).id) fail(409, `${name} has a newer run than the page showed`);
};

const diff: Handler = (_req, { name }) => {
  const runs = latestJob(name);
  if (!runs) return text(`no job named ${name}`, 404);
  const d = jobDiff(runs);
  return d ? text(d.diff, 200) : text(NO_DIFF, 404);
};

const action = (verb: "land" | "recheck" | "drop") => post(async (body, { name }) => {
  find(name);
  fresh(name, body);
  const reason = verb === "drop" && typeof body.reason === "string" ? body.reason.trim() : "";
  return aleph([verb, "--", name, ...(reason ? [reason] : [])]);
});

const answerAndRerun = post(async (body, { name }) => {
  const last = find(name);
  if (!isWaiting(last.run.condition) || may("chris", "answer", askOf(last.run), { run: true })) fail(409, "this run is not waiting for an answer");
  fresh(name, body);
  const said = typeof body.answer === "string" ? body.answer.trim() : "";
  if (!said) fail(400, "answer is required");
  return aleph(["drop", "--", name, `Chris answered the worker's question "${askOf(last.run)?.question ?? last.run.question ?? ""}": ${said}`]);
});

/**
 * "Wait for <repo>-<n>": set the stuck job's issue (a part run's dotted `on` names the issue holding the part) to wait
 * on that open issue, then drop the job. All or none: a failed drop puts the old `after` back, and the error says so.
 */
const wait = post(async (body, { name }) => {
  const last = find(name);
  fresh(name, body);
  const on = typeof body.on === "string" ? body.on.trim() : "";
  const repo = last.run.repo, issue = onOf(last.run);
  if (!/^(.+)-(\d+(?:\.\d+)?)$/.test(on) || !repo || issue === undefined) fail(400, "on must name an issue and the job an item");
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
  "POST /api/wait/:name": wait,
  "GET /api/diff/:name": diff,
  "POST /api/land/:name": action("land"),
  "POST /api/recheck/:name": action("recheck"),
  "POST /api/drop/:name": action("drop"),
  "POST /api/answer/:name": answerAndRerun,
};
