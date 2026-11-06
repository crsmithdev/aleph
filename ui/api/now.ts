/** `GET /api/state`: the Now view's data, narrowed to one project by `?project=<key>`. */
import type { Routes } from "../server.ts";
import { proposals } from "../../jobs/lib/learning/corrections.ts";
import type { State } from "../state.ts";
import { loadState } from "../state-load.ts";
import { cachedSpeed } from "./speed.ts";
import { annotate, currentFit, summary } from "../usage.ts";

/** The state with only `project`'s jobs and queued issues; the factory and ticks stay whole. */
function forProject(s: State, project: string | null): State {
  if (!project) return s;
  const mine = <T extends { repo: string }>(a: T[]) => a.filter((x) => x.repo === project);
  return { ...s, stuck: mine(s.stuck), running: mine(s.running), done: s.done.filter((i) => i.id.startsWith(`${project}-`)), doneStamps: s.doneStamps.filter((i) => i.id.startsWith(`${project}-`)), queued: mine(s.queued), runningIssues: s.runningIssues.filter((i) => i.id.startsWith(`${project}-`)), asks: s.asks.filter((a) => a.repo === undefined || a.repo === project) };
}

export const routes: Routes = {
  "GET /api/state": async (_req, _params, url) => {
    // Built in the worker, from a build that starts after this request: the server answers others meanwhile.
    // The build is shared with the requests that came with this one, so this request annotates its own copy.
    const { state, build } = await loadState();
    const s = forProject(structuredClone(state), url.searchParams.get("project"));
    const fit = await currentFit().catch(() => null);
    annotate([...s.stuck, ...s.running], fit);
    return Response.json({ ...s, usage: summary(), speed: cachedSpeed("week", fit), proposals: proposals().map(({ id, kind, title, target, sentence, count, signals }) => ({ id, kind, title, target, sentence, count, signals: signals.map(({ source, at, quote, link }) => ({ source, at, quote, link })) })) }, { headers: { "x-aleph-state-build": String(build) } });
  },
};
