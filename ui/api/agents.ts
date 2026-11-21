/**
 * `GET /api/sessions?window=week&project=<key>&limit=&before=` (week, month or quarter; the paging is of the session list): the Agents view's data over one window: the tools, hooks and denials of `ui/activity.ts`,
 * its skills, its sessions, and `toolSessions`, the sessions each tool ran in.
 * A part that fails gives its own error, so the other parts still show.
 */
import type { Routes } from "../server.ts";
import { activity } from "../activity.ts";
import { listSessions, windowTraces } from "./session-list.ts";
import { listSkills } from "./skills.ts";
import { scopeOf } from "./scope.ts";
import { SESSIONS } from "../../lib/windows.ts";
import { errText } from "../../lib/errtext.ts";

/** The value of `part`, or `{ error }` when it throws, so the other parts still show. */
const partOf = (part: Promise<any>) => part.catch((e: Error) => ({ error: e.message }));

/** Each tool's sessions: its traces read through the window's trace to session map. */
async function toolSessions(toolTraces: Record<string, string[]>, days: number, project: string | null): Promise<Record<string, string[]>> {
  const session = new Map((await windowTraces(days, project)).rows.map((t) => [t.id, t.sessionId]));
  return Object.fromEntries(Object.entries(toolTraces).map(([tool, ids]) => [tool, [...new Set(ids.flatMap((id) => session.get(id) ?? []))]]));
}

/** The response of `GET /api/sessions` for `url`. */
async function load(url: URL): Promise<Response> {
    const sc = scopeOf(url, "week", SESSIONS);
    if (sc instanceof Response) return sc;
    const { days, project } = sc;
    const limit = url.searchParams.get("limit"), before = url.searchParams.get("before");
    const [act, skills, sessions] = await Promise.all([
      activity(days, project),
      partOf(listSkills(sc)),
      partOf(listSessions(sc, { limit: limit === null ? undefined : Number(limit), before })),
    ]);
    const { toolTraces = {}, ...rest } = act;
    const links = sessions.error ? {} : await toolSessions(toolTraces, days, project).catch((e) => { console.error(`ui/agents: no tool sessions: ${errText(e)}`); return {}; });
    // Langfuse held more pages than a read takes: the counts or the list cover part of the window.
    const partial = !!rest.partial || !!sessions.partial;
    return Response.json({ window: days, project, partial, activity: rest, skills, sessions, toolSessions: links });
}

export const routes: Routes = { "GET /api/sessions": (_req, _p, url) => load(url) };

