/**
 * `GET /api/diff/:name`, `POST /api/land|recheck|drop/:name` and
 * `POST /api/answer/:name` (`{ answer }`, "Answer and rerun" on a
 * question run: the answer becomes the reason of `aleph drop`, so the next dispatch carries it in the spec). Each action is the `aleph` command of that
 * name, run as a subprocess by the launcher; the page offers nothing the CLI does not. A POST must carry `X-Aleph-UI: 1` and, when it has
 * an Origin, the server's own, so a web page in the browser cannot post here. The password gate in `ui/auth.ts` is what stops a LAN client, so this check is only against other web pages.
 */
import { askOf, isAwaiting, loadRegistry, onOf } from "../../jobs/lib/ledger.ts";
import { jobDiff, NO_DIFF } from "../../jobs/lib/jobdiff.ts";
import { latestJob } from "../../jobs/lib/job.ts";
import { runCli } from "../cli.ts";
import { Refusal } from "../../jobs/lib/refusal.ts";
import * as issues from "../../todo/lib/issues.ts";
import type { Handler, Routes } from "../server.ts";

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/** The last run of the job called `name`, or undefined when the ledger has none. */
const find = (name: string) => latestJob(name)?.at(-1);

function sameSite(req: Request): boolean {
  if (req.headers.get("x-aleph-ui") !== "1") return false;
  const origin = req.headers.get("origin");
  return origin === null || origin === new URL(req.url).origin;
}

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
  if (verb === "drop") {
    const body: any = await req.json().catch(() => ({}));
    if (typeof body?.reason === "string" && body.reason.trim()) args.push(body.reason.trim());
  }
  return Response.json(await runCli(args));
};

const answerAndRerun: Handler = async (req, { name }) => {
  if (!sameSite(req)) return text("forbidden", 403);
  const last = find(name);
  if (!last) return text(`no job named ${name}`, 404);
  if (!isAwaiting(last.run.condition) || askOf(last.run)?.reason !== "question") return text("this run is not waiting for an answer", 409);
  const body: any = await req.json().catch(() => ({}));
  const said = typeof body?.answer === "string" ? body.answer.trim() : "";
  if (!said) return text("answer is required", 400);
  return Response.json(await runCli(["drop", name, `Chris answered the worker's question "${askOf(last.run)?.question ?? last.run.question ?? ""}": ${said}`]));
};

/** "Wait for <repo>-<n>": set the stuck job's issue (a goal run's dotted `on` names the issue holding the goal) to wait on that open issue, then drop the job. */
const wait: Handler = async (req, { name }) => {
  if (!sameSite(req)) return text("forbidden", 403);
  const last = find(name);
  if (!last) return text(`no job named ${name}`, 404);
  const body: any = await req.json().catch(() => ({}));
  const on = typeof body?.on === "string" ? body.on.trim() : "";
  const m = /^(.+)-(\d+(?:\.\d+)?)$/.exec(on);
  const repo = last.run.repo, issue = onOf(last.run);
  if (!m || !repo || issue === undefined) return text("on must name an issue and the job an item", 400);
  // In process, as the firefighter does.
  const place = loadRegistry()[repo];
  if (!place) return text(`no repo named ${repo}`, 400);
  try { issues.edit(place, issue, { after: [on] }); } catch (e: any) {
    if (!(e instanceof Refusal)) throw e;
    return Response.json({ error: e.message }, { status: 422 });
  }
  return Response.json(await runCli(["drop", name, `Chris chose to wait for ${on}: this job cannot succeed until it lands.`]));
};

export const routes: Routes = {
  "POST /api/wait/:name": wait,
  "GET /api/diff/:name": diff,
  "POST /api/land/:name": action("land"),
  "POST /api/recheck/:name": action("recheck"),
  "POST /api/drop/:name": action("drop"),
  "POST /api/answer/:name": answerAndRerun,
};
