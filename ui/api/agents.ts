/**
 * `GET /api/sessions?window=week&project=<key>&limit=&before=` (week, month or quarter; the paging is of the session list): the Agents view's data over one window: the tools, hooks and denials of `ui/activity.ts`,
 * its skills, its sessions, and `toolSessions`, the sessions each tool ran in.
 * A part that fails gives its own error, so the other parts still show.
 */
import type { Routes } from "../server.ts";
import { activity } from "../activity.ts";
import { listSessions, windowTraces } from "./sessions.ts";
import { listSkills } from "./skills.ts";
import { scopeOf } from "./scope.ts";
import { SESSIONS } from "../../lib/windows.ts";

const partOf = async (res: Response | Promise<Response>) => {
  const r = await res;
  return r.ok ? await r.json() as any : { error: ((await r.json().catch(() => ({}))) as any).error ?? `answered ${r.status}` };
};

/** Each tool's sessions: its traces read through the window's trace to session map. */
async function toolSessions(toolTraces: Record<string, string[]>, days: number, project: string | null): Promise<Record<string, string[]>> {
  const session = new Map((await windowTraces(days, project)).rows.map((t) => [t.id, t.sessionId]));
  return Object.fromEntries(Object.entries(toolTraces).map(([tool, ids]) => [tool, [...new Set(ids.map((id) => session.get(id)).filter(Boolean))]]));
}

/** The response of `GET /api/sessions` for `url`. */
async function load(req: Request, url: URL): Promise<Response> {
    const sc = scopeOf(url, "week", SESSIONS);
    if (sc instanceof Response) return sc;
    const { days, project } = sc;
    const inner = new URL(url);
    inner.searchParams.set("window", sc.window);
    const innerReq = new Request(inner, req);
    const [act, skills, sessions] = await Promise.all([
      activity(days, project),
      partOf(listSkills(innerReq)),
      partOf(listSessions(innerReq)),
    ]);
    const { toolTraces = {}, ...rest } = act;
    const links = sessions.error ? {} : await toolSessions(toolTraces, days, project).catch(() => ({}));
    // Langfuse held more pages than a read takes: the counts or the list cover part of the window.
    const partial = !!rest.partial || !!sessions.partial;
    return Response.json({ window: days, project, partial, activity: rest, skills, sessions, toolSessions: links });
}

export const routes: Routes = { "GET /api/sessions": (req, _p, url) => load(req, url) };

