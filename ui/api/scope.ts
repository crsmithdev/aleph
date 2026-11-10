/** The rule for `?project=<key>` on every UI route: what belongs to a project. */
import { parseId } from "../../lib/naming.ts";
import { loadRegistry } from "../../jobs/lib/records/ledger.ts";

/** Whether `project` is a registry key; a key that is not one is a filter that matches nothing. */
export const known = (project: string) => Object.hasOwn(loadRegistry(), project);

/** Whether an issue, job, record, hold or event subject belongs to `project`: a registry key that parseId gives as its repo. */
export const inProject = (subject: string, project: string) => parseId(subject)?.repo === project && known(project);

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
export const traceIn = (t: any, project: string) => traceProject(t.metadata?.cwd, t.tags) === project;
