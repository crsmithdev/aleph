/**
 * The rule for `?project=<key>` on every UI route: what belongs to a project. Each test takes the project as the
 * route reads it: null, undefined or "" is no filter, and everything belongs. A key that is not in the registry
 * is a filter that matches nothing.
 */
import { scopeOfCwd } from "../../lib/paths.ts";
import { once } from "../../lib/sources.ts";
import { parseId, parseKey, type EventRow } from "../../lib/naming.ts";
import { projectsOnMain } from "../../lib/store.ts";
import { DAY, FACTORY, WINDOWS } from "../../lib/windows.ts";
import { loadRegistry } from "../../jobs/lib/records/ledger.ts";
import { allRuns } from "../../jobs/lib/records/record.ts";

type Project = string | null | undefined;

/** The scope of a request: its project (null for all) and its window, by name and by length. */
export interface Scope { project: string | null; window: string; ms: number; days: number }

/** The project of `?project=`; null when it is missing or "". */
export const projectOf = (url: URL) => url.searchParams.get("project") || null;

/** The scope of `url`: `?window=` is a name of `names`, `fallback` when missing or "", and any other value is an error text. */
export function parseScope(url: URL, fallback = "week", names: readonly string[] = FACTORY): Scope | { error: string } {
  const window = url.searchParams.get("window") || fallback;
  if (!names.includes(window)) return { error: `window must be one of ${names.join(", ")}` };
  return { project: projectOf(url), window, ms: WINDOWS[window], days: WINDOWS[window] / DAY };
}

/** The scope of `url` as `parseScope` reads it, or a 400 for a window that is not in `names`. */
export function scopeOf(url: URL, fallback = "week", names: readonly string[] = FACTORY): Scope | Response {
  const sc = parseScope(url, fallback, names);
  return "error" in sc ? Response.json(sc, { status: 400 }) : sc;
}

/** Whether `project` is a registry key. */
export const known = (project: string) => Object.hasOwn(loadRegistry(), project);

/** Whether the registry key `repo` (a job's, a flake's, an ask's) is `project`. */
export const repoIn = (repo: string | undefined, project: Project) => !project || (repo === project && known(project));

/** The repo of each job key and of each issue key that a job targets (the newest job's). */
const ownerOf = (): Map<string, string> => once("owners", ["records"], () => {
  const out = new Map<string, string>();
  for (const { id, run } of allRuns()) if (run.repo) { out.set(id, run.repo); if (run.target) out.set(run.target, run.repo); }
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

/** Whether an event is of a factory-wide job (director, monitor, maintainer): it names a job and has no project. It shows only with no project filter. */
export const factoryWide = (e: EventRow) => !e.project && !!(e.subject_role || e.object_role);

/** `rows`, each with the registry key of its issue's project as `project` when its object is an issue key of the items repo and it has no project: one read of the issues for the batch, with no fetch. */
export const withProjects = <T extends EventRow>(rows: T[]): T[] => {
  let projects: Map<number, string> | undefined;
  return rows.map((row) => {
    const key = row.project ? null : parseKey(row.object);
    const project = key?.kind === "issue" ? (projects ??= projectsOnMain()).get(key.n) : undefined;
    return project ? { ...row, project } : row;
  });
};

/** Whether a memory item with `scope` belongs to `project`: its own project's, or global or unscoped (a rule section, a skill, a hook) in every known project. */
export const memoryIn = (scope: string, project: Project) => !project || ((!scope || scope === "global" || scope === project) && known(project));

/** The registry key a trace belongs to: the key of its cwd, else (no cwd) its `project:` tag; "" for none, also for a sandbox or test directory. */
export function traceProject(cwd: string | undefined, tags: string[] | undefined): string {
  const key = cwd ? scopeOfCwd(cwd, false) : tags?.find((t) => t.startsWith("project:"))?.slice(8) ?? "";
  return known(key) ? key : "";
}

/** Whether a Langfuse trace belongs to `project`. */
export const traceIn = (t: any, project: Project) => !project || traceProject(t.metadata?.cwd, t.tags) === project;
