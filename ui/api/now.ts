/** `GET /api/state`: the Now view's data, narrowed to one project by `?project=<key>`. */
import type { Routes } from "../server.ts";
import { proposals } from "../../jobs/lib/learning/corrections.ts";
import { eventIn, inProject, known, repoIn } from "./scope.ts";
import type { State } from "../state.ts";
import { loadState } from "../state-load.ts";
import { annotate, currentFit, summary } from "../usage.ts";
import { FINE, labelOf, WEEKLY_WARN, weekly } from "../../lib/status-words.ts";

/** The state with only `project`'s jobs, issues, asks and Herald events; the factory and ticks stay whole. */
export function forProject(s: State, project: string | null): State {
  if (!project) return s;
  const mine = <T extends { repo?: string }>(a: T[]) => a.filter((x) => repoIn(x.repo, project));
  const ours = <T extends { id: string }>(a: T[]) => a.filter((x) => inProject(x.id, project));
  const herald = s.herald && { ...s.herald, events: s.herald.events.filter((e) => eventIn(e.subject, project)) };
  return { ...s, stuck: mine(s.stuck), running: mine(s.running), done: ours(s.done), doneStamps: ours(s.doneStamps), queued: mine(s.queued), runningIssues: ours(s.runningIssues), asks: s.asks.filter((a) => a.repo === undefined ? known(project) : repoIn(a.repo, project)), ...(herald ? { herald } : {}) };
}

/** The `/api/state` body for one project (null for all) and the number of the build it came from. */
export async function stateBody(project: string | null) {
  // Built in the worker, from a build that starts after this request: the server answers others meanwhile.
  // The build is shared with the requests that came with this one, so this request annotates its own copy.
  const { state, build } = await loadState();
  const s = forProject(structuredClone(state), project);
  const fit = await currentFit().catch(() => null);
  annotate([...s.stuck, ...s.running], fit);
  const u = summary();
  const week = u?.now?.seven_day;
  if (week !== undefined && week >= WEEKLY_WARN && s.herald?.history?.[0]?.tone === "fine") {
    s.herald.history[0] = {
      ...s.herald.history[0],
      tone: "warning",
      label: labelOf("warning", `${FINE}; ${weekly(week)}.`),
      text: `${FINE}; ${weekly(week)}.`,
    };
  }
  return { body: { ...s, usage: u, proposals: proposals().map(({ id, kind, title, target, sentence, count, signals }) => ({ id, kind, title, target, sentence, count, signals: signals.map(({ source, at, quote, link }) => ({ source, at, quote, link })) })) }, build };
}

export const routes: Routes = {
  "GET /api/state": async (_req, _params, url) => {
    const { body, build } = await stateBody(url.searchParams.get("project"));
    return Response.json(body, { headers: { "x-aleph-state-build": String(build) } });
  },
};
