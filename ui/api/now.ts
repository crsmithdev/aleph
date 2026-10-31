/** `GET /api/state`: the Now view's data, narrowed to one project by `?project=<key>`. */
import type { Routes } from "../server.ts";
import { proposals } from "../../jobs/lib/corrections.ts";
import { state, type State } from "../state.ts";
import { cachedSpeed } from "./speed.ts";
import { annotate, currentFit, summary } from "../usage.ts";

/** The state with only `project`'s jobs and queued goals; the factory and ticks stay whole. */
export function forProject(s: State, project: string | null): State {
  if (!project) return s;
  const mine = <T extends { repo: string }>(a: T[]) => a.filter((x) => x.repo === project);
  return { ...s, stuck: mine(s.stuck), running: mine(s.running), delivered: mine(s.delivered), planner: mine(s.planner), done: s.done.filter((i) => i.id.startsWith(`${project}-`)), incoming: s.incoming.filter((i) => i.id.startsWith(`${project}-`)), issues: s.issues.filter((i) => i.id.startsWith(`${project}-`)), queued: mine(s.queued), runningIssues: s.runningIssues.filter((i) => i.id.startsWith(`${project}-`)), asks: s.asks.filter((a) => a.repo === undefined || a.repo === project) };
}

export const routes: Routes = {
  "GET /api/state": async (_req, _params, url) => {
    const s = forProject(state(), url.searchParams.get("project"));
    const fit = await currentFit().catch(() => null);
    annotate([...s.stuck, ...s.running, ...s.delivered, ...s.planner], fit);
    return Response.json({ ...s, usage: summary(), speed: cachedSpeed("week", fit), proposals: proposals().map(({ id, kind, title, target, sentence, count, signals }) => ({ id, kind, title, target, sentence, count, signals: signals.map(({ source, at, quote, link }) => ({ source, at, quote, link })) })) });
  },
};
