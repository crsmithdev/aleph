/**
 * The rule for `?project=<key>` on every UI route: what belongs to a project. Each test takes the project as the
 * route reads it: null, undefined or "" is no filter, and everything belongs. A key that is not in the registry
 * is a filter that matches nothing.
 */
import { once } from "../../lib/sources.ts";
import { parseId, parseKey, type EventRow } from "../../lib/naming.ts";
import { itemsDir, projectsAt } from "../../issues/lib/store.ts";
import { DAY, FACTORY, WINDOWS } from "../../lib/windows.ts";
import { loadRegistry } from "../../jobs/lib/records/ledger.ts";
import { allRunRecords } from "../../jobs/lib/records/record.ts";

type Project = string | null | undefined;

/** The scope of a request: its project (null for all) and its window, by name and by length. */
export interface Scope { project: string | null; window: string; ms: number; days: number }

/** The project of `?project=`; null when it is missing or "". */
export const projectOf = (url: URL) => url.searchParams.get("project") || null;

/** The scope of `url`: `?window=` is a name of `names`, `fallback` when missing or "", and any other value is a 400. */
export function scopeOf(url: URL, fallback = "week", names: readonly string[] = FACTORY): Scope | Response {
  const window = url.searchParams.get("window") || fallback;
  if (!names.includes(window)) return Response.json({ error: `window must be one of ${names.join(", ")}` }, { status: 400 });
  return { project: projectOf(url), window, ms: WINDOWS[window], days: WINDOWS[window] / DAY };
}

/** Whether `project` is a registry key. */
export const known = (project: string) => Object.hasOwn(loadRegistry(), project);

/** Whether the registry key `repo` (a job's, a flake's, an ask's) is `project`. */
export const repoIn = (repo: string | undefined, project: Project) => !project || (repo === project && known(project));

/** The repo of each job key and of each issue key that a job targets (the newest job's). */
const ownerOf = (): Map<string, string> => once("owners", ["records"], () => {
  const out = new Map<string, string>();
  for (const r of allRunRecords()) if (r.repo) { out.set(r.id, r.repo); if (r.target) out.set(r.target, r.repo); }
  return out;
});

/** The repo of a subject: the repo of an old `<repo>-<n>` ID, else that of a job key or of an issue key that a job targets. */
const repoOfSubject = (subject: string): string | undefined => parseId(subject)?.repo ?? (parseKey(subject) ? ownerOf().get(subject) : undefined);

/** Whether an issue, job, record, hold or event subject belongs to `project`: a registry key that is its repo. */
export const inProject = (subject: string, project: Project) => !project || (repoOfSubject(subject) === project && known(project));

/** Whether an event belongs to `project`: by its job's `owner` when it has one, else by its object when that is an issue or job ID, else (a reason, a routine, none) to every known project. */
export const eventIn = (object: string | undefined, project: Project, owner?: string | null) => {
  return !project || (owner ? owner === project && known(project) : object !== undefined && repoOfSubject(object) !== undefined ? inProject(object, project) : known(project));
};

/** `rows`, each with the registry key of its issue's project as `project` when its object is an issue key of the items repo and it has no project: one read of the issues for the batch, with no fetch. */
export const withProjects = <T extends EventRow>(rows: T[]): T[] => {
  let projects: Map<number, string> | undefined;
  return rows.map((row) => {
    const key = row.project ? null : parseKey(row.object);
    const project = key?.kind === "issue" ? (projects ??= projectsAt(itemsDir(), "origin/main")).get(key.n) : undefined;
    return project ? { ...row, project } : row;
  });
};

/** Whether a memory item with `scope` belongs to `project`: its own project's, or global or unscoped (a rule section, a skill, a hook) in every known project. */
export const memoryIn = (scope: string, project: Project) => !project || ((!scope || scope === "global" || scope === project) && known(project));

/** The registry key a trace belongs to: its cwd is the key's path or under it, else (no cwd) its `project:` tag is a key; "" for none. */
export function traceProject(cwd: string | undefined, tags: string[] | undefined): string {
  const reg = loadRegistry();
  if (cwd) {
    for (const r of Object.values(reg)) if (cwd === r.path || cwd.startsWith(r.path.replace(/\/+$/, "") + "/")) return r.key;
    return ""; // sandbox and test directories are not projects
  }
  const tag = tags?.find((t) => t.startsWith("project:"))?.slice(8) ?? "";
  return Object.hasOwn(reg, tag) ? tag : "";
}

/** Whether a Langfuse trace belongs to `project`. */
export const traceIn = (t: any, project: Project) => !project || traceProject(t.metadata?.cwd, t.tags) === project;
