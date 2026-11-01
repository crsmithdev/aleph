/**
 * `GET /api/agents?days=7&project=<key>`: the Agents view's data over one window: the tools, hooks and denials of `/api/activity`,
 * the skills of `/api/skills`, the sessions of `/api/sessions`, and `toolSessions`, the sessions each tool ran in.
 * A part that fails gives its own error, so the other parts still show.
 */
import type { Routes } from "../server.ts";
import { activity } from "./activity.ts";
import { routes as sessionRoutes, windowTraces } from "./sessions.ts";
import { routes as skillRoutes } from "./skills.ts";

const WINDOWS = [7, 30, 90];

const partOf = async (res: Response | Promise<Response>) => {
  const r = await res;
  return r.ok ? await r.json() as any : { error: ((await r.json().catch(() => ({}))) as any).error ?? `answered ${r.status}` };
};

/** Each tool's sessions: its traces read through the window's trace to session map. */
async function toolSessions(toolTraces: Record<string, string[]>, days: number, project: string | null): Promise<Record<string, string[]>> {
  const session = new Map((await windowTraces(days, project)).map((t) => [t.id, t.sessionId]));
  return Object.fromEntries(Object.entries(toolTraces).map(([tool, ids]) => [tool, [...new Set(ids.map((id) => session.get(id)).filter(Boolean))]]));
}

export const routes: Routes = {
  "GET /api/agents": async (req, _p, url) => {
    const asked = Number(url.searchParams.get("days"));
    const days = WINDOWS.includes(asked) ? asked : 7;
    const project = url.searchParams.get("project") || null;
    const inner = new URL(url);
    inner.searchParams.set("days", String(days));
    const [act, skills, sessions] = await Promise.all([
      activity(days, project),
      partOf(skillRoutes["GET /api/skills"](req, {}, inner)),
      partOf(sessionRoutes["GET /api/sessions"](req, {}, inner)),
    ]);
    const { toolTraces = {}, ...rest } = act;
    const links = sessions.error ? {} : await toolSessions(toolTraces, days, project).catch(() => ({}));
    return Response.json({ window: days, project, activity: rest, skills, sessions, toolSessions: links });
  },
};
