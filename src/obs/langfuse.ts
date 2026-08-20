/**
 * Langfuse attribute mapping and deep links.
 *
 * cockpit-spec-v0.2.md §4.2 F12: traces carry IDs, never URLs. The URL is built
 * at render time from config, so a host migration does not rot immutable traces.
 */
import type { IdTuple } from "../core/envelope.ts";

export interface LangfuseNaming {
  baseUrl: string;
  projectId: string;
  userId?: string;
}

/** Attributes every span carries — docs/design/phase-1.md §6.2. */
export function spanAttributes(name: string, ids: IdTuple, lane: string, naming: LangfuseNaming): Record<string, string | string[]> {
  const tags = [`origin:${ids.origin}`, `lane:${lane}`];
  if (ids.task_id) tags.push(`task:${ids.task_id}`);
  if (ids.run_id) tags.push(`run:${ids.run_id}`);
  if (ids.session_id) tags.push(`session:${ids.session_id}`);

  const attrs: Record<string, string | string[]> = {
    "aleph.origin": ids.origin,
    "aleph.lane": lane,
    "langfuse.trace.name": name,
    "langfuse.trace.tags": tags,
    "langfuse.user.id": naming.userId ?? "chris",
  };
  if (ids.session_id) {
    attrs["aleph.session_id"] = ids.session_id;
    attrs["langfuse.session.id"] = ids.session_id;
  }
  if (ids.task_id) {
    attrs["aleph.task_id"] = ids.task_id;
    attrs["langfuse.trace.metadata.cockpit_task"] = ids.task_id;
  }
  if (ids.run_id) {
    attrs["aleph.run_id"] = ids.run_id;
    attrs["langfuse.trace.metadata.cockpit_run"] = ids.run_id;
  }
  return attrs;
}

export function traceUrl(naming: LangfuseNaming, traceId: string): string {
  const base = naming.baseUrl.replace(/\/+$/, "");
  const project = naming.projectId || "default";
  return `${base}/project/${project}/traces/${traceId}`;
}
