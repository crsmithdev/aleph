/** `GET /api/factory`: the Status view's data, narrowed to one project by `?project=<key>`. */
import type { Routes } from "../server.ts";
import { proposals } from "../../jobs/lib/learning/corrections.ts";
import { eventIn, factoryWide, inProject, known, repoIn, scopeOf } from "./scope.ts";
import { heraldContext, heraldEvents, state, type State } from "../state.ts";
import { heraldRows } from "../herald.ts";
import { reader } from "../../lib/store.ts";
import { allRuns } from "../../jobs/lib/records/record.ts";
import type { EventRow } from "../../lib/naming.ts";
import { once } from "../../lib/sources.ts";
import { verdict } from "../../lib/status-words.ts";
import { annotate, currentFit, summaryOff } from "../usage.ts";

/** `events` narrowed to `project`'s: none of a factory-wide job. */
const mineOf = (events: EventRow[], project: string | null) => (project ? events.filter((e) => !factoryWide(e) && eventIn(e.object, project, e.project)) : events);

/** The state with only `project`'s jobs, issues, asks and Herald events (none of a factory-wide job, no chat); the factory and ticks stay whole. */
export function forProject(s: State, project: string | null): State {
  if (!project) return s;
  const mine = <T extends { repo?: string }>(a: T[]) => a.filter((x) => repoIn(x.repo, project));
  const ours = <T extends { id: string }>(a: T[]) => a.filter((x) => inProject(x.id, project));
  const herald = s.herald && { ...s.herald, events: mineOf(s.herald.events, project), chats: [] };
  return { ...s, errored: mine(s.errored), running: mine(s.running), done: ours(s.done), doneStamps: ours(s.doneStamps), queued: mine(s.queued), runningIssues: ours(s.runningIssues), asks: s.asks.filter((a) => a.repo === undefined ? known(project) : repoIn(a.repo, project)), ...(herald ? { herald } : {}) };
}

/** The Herald's rows for one project (null for all) as of now, with the `seq` of the newest event: what the `ev` stream sends when an event is added. */
export function heraldNow(project: string | null) {
  const events = heraldEvents(Date.now()), mine = mineOf(events, project);
  return { seq: events.at(-1)?.seq ?? 0, rows: heraldRows(mine, heraldContext(mine, allRuns(), reader())) };
}

/** The `/api/factory` body for one project (null for all), with its asks and the Herald as rows. */
async function build(project: string | null) {
  const { doneStamps, herald, ...s } = forProject(state(new Date(), !project), project);
  const fit = await currentFit();
  annotate([...s.errored, ...s.running], fit);
  return { ...s, herald: herald && { history: herald.history, seq: herald.seq, rows: heraldRows(herald.events, herald), chats: herald.chats }, usage: await summaryOff(fit), proposals: proposals().map(({ id, kind, title, target, sentence, count, signals }) => ({ id, kind, title, target, sentence, count, signals: signals.map(({ source, at, quote, link }) => ({ source, at, quote, link })) })) };
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
