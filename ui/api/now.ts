/** `GET /api/state`: the Now view's data, narrowed to one project by `?project=<key>`. */
import type { Routes } from "../server.ts";
import { proposals } from "../../jobs/lib/corrections.ts";
import { state, type State } from "../state.ts";
import { cachedSpeed } from "./speed.ts";
import { annotate, currentFit, summary } from "../usage.ts";

/** The state with only `project`'s jobs and waiting goals; the factory and ticks stay whole. */
export function forProject(s: State, project: string | null): State {
  if (!project) return s;
  const mine = <T extends { repo: string }>(a: T[]) => a.filter((x) => x.repo === project);
  return { ...s, needs: mine(s.needs), stuck: mine(s.stuck), running: mine(s.running), delivered: mine(s.delivered), triage: mine(s.triage), planner: mine(s.planner), done: s.done.filter((i) => i.id.startsWith(`${project}-`)), incoming: s.incoming.filter((i) => i.id.startsWith(`${project}-`)), issues: s.issues.filter((i) => i.id.startsWith(`${project}-`)), waiting: mine(s.waiting), attention: s.attention.filter((a) => a.repo === undefined || a.repo === project) };
}

export const routes: Routes = {
  "GET /api/state": async (_req, _params, url) => {
    const s = forProject(state(), url.searchParams.get("project"));
    annotate([...s.needs, ...s.stuck, ...s.running, ...s.delivered, ...s.triage, ...s.planner], await currentFit().catch(() => null));
    return Response.json({ ...s, usage: summary(), speed: cachedSpeed(7), proposals: proposals().map(({ id, kind, sentence, count, signals }) => ({ id, kind, sentence, count, signals: signals.map(({ source, at, quote, link }) => ({ source, at, quote, link })) })) });
  },
};
