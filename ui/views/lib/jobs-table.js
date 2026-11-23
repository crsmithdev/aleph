// The jobs list of the Jobs page: its data URL.
import { scope } from "./address.js";

/** The most rows the list asks for: one page of the API holds the whole window. */
const ALL = 2000;
/** The list's data URL: the project, the window and the state and the unusable filter in the hash go to the API. */
export const listUrl = (_params, q = new URLSearchParams()) => {
  const s = scope(q), out = new URLSearchParams();
  if (s.project) out.set("project", s.project);
  if (s.window !== "week") out.set("window", s.window);
  if (q.get("state")) out.set("state", q.get("state"));
  if (q.get("unusable")) out.set("unusable", "1");
  out.set("limit", String(ALL));
  return `/api/jobs?${out}`;
};
