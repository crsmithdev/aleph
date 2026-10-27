/** `/api/list?set=jobs|issues|projects|sessions`: the four lists in one row shape, from their own route handlers. */
import { routes as issueRoutes } from "./issues.ts";
import { routes as jobRoutes } from "./jobs.ts";
import { routes as projectRoutes } from "./projects.ts";
import { routes as sessionRoutes } from "./sessions.ts";
import type { Routes } from "../server.ts";

export const SETS = ["jobs", "issues", "projects", "sessions"] as const;
export type SetName = (typeof SETS)[number];

/** The shared columns, then `details`: the set's own fields as key/value pairs. */
export interface ListRow {
  set: SetName; when: string; project: string; id: string; title: string; state: string;
  cost: number | null; details: [string, string][]; href: string;
}

/** An unknown or missing set is the jobs set. */
export const pickSet = (s: string | null | undefined): SetName => (SETS as readonly string[]).includes(s ?? "") ? (s as SetName) : "jobs";

const pairs = (...kv: [string, unknown][]): [string, string][] =>
  kv.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]);
const took = (a?: string, b?: string) => {
  const ms = Date.parse(b ?? "") - Date.parse(a ?? "");
  if (!(ms >= 0)) return "";
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
};
const enc = encodeURIComponent;

const MAP: Record<SetName, (d: any) => ListRow[]> = {
  jobs: (jobs: any[]) => jobs.map((j: any) => ({
    set: "jobs", when: j.started ?? "", project: j.repo ?? "", id: j.name, title: j.item?.title || j.name, state: j.state,
    cost: j.cost ?? null, details: pairs(["took", j.ended ? took(j.started, j.ended) : ""], ["model", j.model]), href: `#/jobs/${enc(j.name)}`,
  })),
  issues: (rows: any[]) => rows.map((r: any) => ({
    set: "issues", when: r.updated ?? "", project: r.repo, id: `${r.repo}#${r.id}`, title: r.title, state: r.status,
    cost: null, details: pairs(["labels", (r.labels ?? []).join(",")], ["notes", r.notes || ""]), href: `#/issues/${enc(r.repo)}/${r.id}`,
  })),
  projects: (cards: any[]) => cards.map((p: any) => ({
    set: "projects", when: p.lastLanded?.at ?? p.activity ?? "", project: p.key, id: p.key, title: p.path,
    state: p.factory ? "factory" : "plain", cost: null,
    details: pairs(["open issues", p.openItems], ["last land", p.lastLanded?.name], ["behind", p.behind]), href: `#/projects/${enc(p.key)}`,
  })),
  sessions: (d) => d.sessions.map((s: any) => ({
    set: "sessions", when: s.last ?? s.start ?? "", project: s.project, id: String(s.id).slice(0, 8), title: s.firstPrompt, state: "",
    cost: s.cost ?? null, details: pairs(["turns", s.turns], ["kinds", (s.taskTypes ?? []).join(",")]), href: `#/sessions/${enc(s.id)}`,
  })),
};

type Source = (req: Request, params: Record<string, string>, url: URL) => Response | Promise<Response>;
/** The four existing handlers; a test swaps them. */
export const sources: Record<SetName, Source> = {
  jobs: jobRoutes["GET /api/jobs"], issues: issueRoutes["GET /api/issues"],
  projects: projectRoutes["GET /api/projects"], sessions: sessionRoutes["GET /api/sessions"],
};

export const routes: Routes = {
  "GET /api/list": async (req, params, url) => {
    const set = pickSet(url.searchParams.get("set"));
    const inner = new URL(url);
    inner.pathname = `/api/${set}`;
    inner.searchParams.delete("set");
    const res = await sources[set](req, params, inner);
    const body: any = await res.json();
    if (!res.ok) return Response.json({ set, rows: [], error: body?.error ?? `${set} failed (${res.status})` });
    const rows = MAP[set](body).sort((a, b) => b.when.localeCompare(a.when));
    return Response.json({ set, rows });
  },
};
