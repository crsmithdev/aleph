/** `GET /api/factory`: the Status view's data, narrowed to one project by `?project=<key>`. */
import type { Routes } from "../server.ts";
import { inProject, known, repoIn, scopeOf } from "./scope.ts";
import { mineOf, state, type State } from "../state.ts";
import { heraldRows } from "../herald.ts";
import { once } from "../../lib/sources.ts";
import { verdict } from "../../lib/status-words.ts";
import { annotate, currentFit, summaryOff } from "../usage.ts";

/** The state with only `project`'s jobs, issues, asks and Herald events (none of a factory-wide job); the factory and ticks stay whole. */
export function forProject(s: State, project: string | null): State {
  if (!project) return s;
  const mine = <T extends { repo?: string }>(a: T[]) => a.filter((x) => repoIn(x.repo, project));
  const ours = <T extends { id: string }>(a: T[]) => a.filter((x) => inProject(x.id, project));
  const herald = s.herald && { ...s.herald, events: mineOf(s.herald.events, project) };
  return { ...s, errored: mine(s.errored), running: mine(s.running), done: ours(s.done), doneStamps: ours(s.doneStamps), queued: mine(s.queued), runningIssues: ours(s.runningIssues), asks: s.asks.filter((a) => a.repo === undefined ? known(project) : repoIn(a.repo, project)), ...(herald ? { herald } : {}) };
}

/** The `/api/factory` body for one project (null for all), with its asks and the Herald as rows. */
async function build(project: string | null) {
  const { doneStamps, herald, ...s } = forProject(state(), project);
  const fit = await currentFit();
  annotate([...s.errored, ...s.running], fit);
  return { ...s, herald: herald && { seq: herald.seq, rows: heraldRows(herald.events, herald) }, usage: await summaryOff(fit) };
}

/** The sources a body of all projects reads (`touched` in the build Worker, and `action`). */
const SOURCES = ["registry", "store", "events", "records", "runs", "usage", "factory", "action"];

/** The `/api/factory` body for one project; the body of all projects is built once per change of its sources, for `/api/status` too. */
export const stateBody = (project: string | null): ReturnType<typeof build> => (project ? build(project) : once("state-body", SOURCES, () => build(null)));

export const routes: Routes = {
  /** `GET /api/status`: the tone of the status sentence over all projects, for the sidebar. It is the verdict the Status page draws. */
  "GET /api/status": async () => Response.json({ tone: verdict(await stateBody(null)).tone }),
  "GET /api/factory": async (_req, _params, url) => {
    const sc = scopeOf(url);
    if (sc instanceof Response) return sc;
    return Response.json(await stateBody(sc.project));
  },
};
