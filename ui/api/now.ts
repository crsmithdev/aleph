/** `GET /api/state`: the Now view's data, narrowed to one project by `?project=<key>`. */
import type { Routes } from "../server.ts";
import { state, type State } from "../state.ts";

/** The state with only `project`'s jobs and waiting goals; the factory and ticks stay whole. */
export function forProject(s: State, project: string | null): State {
  if (!project) return s;
  const mine = <T extends { repo: string }>(a: T[]) => a.filter((x) => x.repo === project);
  return { ...s, needs: mine(s.needs), stuck: mine(s.stuck), running: mine(s.running), delivered: mine(s.delivered), waiting: mine(s.waiting) };
}

export const routes: Routes = {
  "GET /api/state": (_req, _params, url) => Response.json(forProject(state(), url.searchParams.get("project"))),
};
