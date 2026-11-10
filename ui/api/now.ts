/** `GET /api/factory`: the Status view's data, narrowed to one project by `?project=<key>`, with the Done count of `?window=`. */
import type { Routes } from "../server.ts";
import { proposals } from "../../jobs/lib/learning/corrections.ts";
import { eventIn, inProject, known, repoIn } from "./scope.ts";
import { state, type State } from "../state.ts";
import { annotate, currentFit, summary } from "../usage.ts";

const DAY = 86_400_000;
/** The length of each `?window=` in ms. */
export const WINDOWS: Record<string, number> = { hour: DAY / 24, day: DAY, week: 7 * DAY, month: 30 * DAY };

/** The state with only `project`'s jobs, issues, asks and Herald events; the factory and ticks stay whole. */
export function forProject(s: State, project: string | null): State {
  if (!project) return s;
  const mine = <T extends { repo?: string }>(a: T[]) => a.filter((x) => repoIn(x.repo, project));
  const ours = <T extends { id: string }>(a: T[]) => a.filter((x) => inProject(x.id, project));
  const herald = s.herald && { ...s.herald, events: s.herald.events.filter((e) => eventIn(e.subject, project)) };
  return { ...s, stuck: mine(s.stuck), running: mine(s.running), done: ours(s.done), doneStamps: ours(s.doneStamps), queued: mine(s.queued), runningIssues: ours(s.runningIssues), asks: s.asks.filter((a) => a.repo === undefined ? known(project) : repoIn(a.repo, project)), ...(herald ? { herald } : {}) };
}

/** The `/api/factory` body for one project (null for all): no asks, which `/api/automation` carries, and the count of issues done in the last `ms`. */
export async function stateBody(project: string | null, ms = WINDOWS.week) {
  const { asks: _asks, doneStamps, ...s } = forProject(state(), project);
  const from = Date.now() - ms;
  const fit = await currentFit().catch(() => null);
  annotate([...s.stuck, ...s.running], fit);
  return { ...s, doneCount: doneStamps.filter((d) => d.at >= from).length, usage: summary(), proposals: proposals().map(({ id, kind, title, target, sentence, count, signals }) => ({ id, kind, title, target, sentence, count, signals: signals.map(({ source, at, quote, link }) => ({ source, at, quote, link })) })) };
}

export const routes: Routes = {
  "GET /api/factory": async (_req, _params, url) => {
    const w = url.searchParams.get("window") ?? "week";
    if (!(w in WINDOWS)) return Response.json({ error: `window must be one of ${Object.keys(WINDOWS).join(", ")}` }, { status: 400 });
    return Response.json(await stateBody(url.searchParams.get("project"), WINDOWS[w]));
  },
};
