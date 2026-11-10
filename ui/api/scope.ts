/**
 * The rule for `?project=<key>` on every UI route: what belongs to a project. Each test takes the project as the
 * route reads it: null, undefined or "" is no filter, and everything belongs. A key that is not in the registry
 * is a filter that matches nothing.
 */
import { parseId } from "../../lib/naming.ts";
import { loadRegistry } from "../../jobs/lib/records/ledger.ts";

type Project = string | null | undefined;

/** Whether `project` is a registry key. */
export const known = (project: string) => Object.hasOwn(loadRegistry(), project);

/** Whether the registry key `repo` (a job's, a flake's, an ask's) is `project`. */
export const repoIn = (repo: string | undefined, project: Project) => !project || (repo === project && known(project));

/** Whether an issue, job, record, hold or event subject belongs to `project`: a registry key that parseId gives as its repo. */
export const inProject = (subject: string, project: Project) => !project || (parseId(subject)?.repo === project && known(project));

/** Whether an event belongs to `project`: by its subject when that is an issue or job, else (a reason, a routine, none) to every known project. */
export const eventIn = (subject: string | undefined, project: Project) =>
  !project || (subject !== undefined && parseId(subject) ? inProject(subject, project) : known(project));

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
