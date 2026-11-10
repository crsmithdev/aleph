/**
 * `GET /api/diff/:name`, `POST /api/land|recheck|drop/:name` and
 * `POST /api/answer/:name` (`{ answer }`, "Answer and rerun" on a
 * question run: the answer becomes the reason of `aleph drop`, so the next dispatch carries it in the spec). Each action is the `aleph` command of that
 * name, run as a subprocess by the launcher; the page offers nothing the CLI does not. A POST must carry `X-Aleph-UI: 1` and, when it has
 * an Origin, the server's own, so a web page in the browser cannot post here. The password gate in `ui/auth.ts` is what stops a LAN client, so this check is only against other web pages.
 */
import { askOf, isWaiting, loadRegistry, onOf } from "../../jobs/lib/records/ledger.ts";
import { jobDiff, NO_DIFF } from "../../jobs/lib/records/jobdiff.ts";
import { lastReal, latestJob } from "../../jobs/lib/records/job.ts";
import { may } from "../../jobs/lib/asks/ask.ts";
import { runCli } from "../cli.ts";
import { Refusal } from "../../lib/refusal.ts";
import * as issues from "../../issues/lib/issues.ts";
import { afterOf } from "../../issues/lib/store.ts";
import { sameSite, text } from "../http.ts";
import type { Handler, Routes } from "../server.ts";

/** The last run of the job called `name`, or undefined when the ledger has none. */
const find = (name: string) => latestJob(name)?.at(-1);

/** A 409 when the page's `run` is not the job's latest run: a rerun came after the page showed it. */
const stale = (name: string, body: any) => (body?.run === lastReal(latestJob(name)!).id ? null : text(`${name} has a newer run than the page showed`, 409));

const diff: Handler = (_req, { name }) => {
  const runs = latestJob(name);
  if (!runs) return text(`no job named ${name}`, 404);
  const d = jobDiff(runs);
  return d ? text(d.diff, 200) : text(NO_DIFF, 404);
};

const action = (verb: "land" | "recheck" | "drop"): Handler => async (req, { name }) => {
  if (!sameSite(req)) return text("forbidden", 403);
  if (!find(name)) return text(`no job named ${name}`, 404);
  const args = [verb, name];
  const body: any = await req.json().catch(() => ({}));
  const old = stale(name, body);
  if (old) return old;
  if (verb === "drop") {
    if (typeof body?.reason === "string" && body.reason.trim()) args.push(body.reason.trim());
  }
  return Response.json(await runCli(args));
};

const answerAndRerun: Handler = async (req, { name }) => {
  if (!sameSite(req)) return text("forbidden", 403);
  const last = find(name);
  if (!last) return text(`no job named ${name}`, 404);
  if (!isWaiting(last.run.condition) || may("chris", "answer", askOf(last.run), { run: true })) return text("this run is not waiting for an answer", 409);
  const body: any = await req.json().catch(() => ({}));
  const old = stale(name, body);
  if (old) return old;
  const said = typeof body?.answer === "string" ? body.answer.trim() : "";
  if (!said) return text("answer is required", 400);
  return Response.json(await runCli(["drop", name, `Chris answered the worker's question "${askOf(last.run)?.question ?? last.run.question ?? ""}": ${said}`]));
};

/** "Wait for <repo>-<n>": set the stuck job's issue (a part run's dotted `on` names the issue holding the part) to wait on that open issue, then drop the job. */
const wait: Handler = async (req, { name }) => {
  if (!sameSite(req)) return text("forbidden", 403);
  const last = find(name);
  if (!last) return text(`no job named ${name}`, 404);
  const body: any = await req.json().catch(() => ({}));
  const old = stale(name, body);
  if (old) return old;
  const on = typeof body?.on === "string" ? body.on.trim() : "";
  const m = /^(.+)-(\d+(?:\.\d+)?)$/.exec(on);
  const repo = last.run.repo, issue = onOf(last.run);
  if (!m || !repo || issue === undefined) return text("on must name an issue and the job an item", 400);
  // In process, as the firefighter does.
  const place = loadRegistry()[repo];
  if (!place) return text(`no repo named ${repo}`, 400);
  let was: string[];
  try { was = afterOf(issues.show(place, issue)); issues.edit(place, issue, { after: [on] }); } catch (e: any) {
    if (!(e instanceof Refusal)) throw e;
    return Response.json({ error: e.message }, { status: 422 });
  }
  const done = await runCli(["drop", name, `Chris chose to wait for ${on}: this job cannot succeed until it lands.`]);
  // All or none: a failed drop puts the old `after` back.
  if (done.code !== 0) issues.edit(place, issue, { after: was });
  return Response.json(done);
};

export const routes: Routes = {
  "POST /api/wait/:name": wait,
  "GET /api/diff/:name": diff,
  "POST /api/land/:name": action("land"),
  "POST /api/recheck/:name": action("recheck"),
  "POST /api/drop/:name": action("drop"),
  "POST /api/answer/:name": answerAndRerun,
};
