// #/memory/<title>: one vault note. The page reads one `view` per file, so the
// note route is its own file; the render function lives in memory.js.
import { renderNote } from "./memory.js";

export const view = {
  path: "/memory/:title",
  title: "Note",
  group: "memory",
  order: 1,
  api: (params) => `/api/memory/note?title=${encodeURIComponent(params.title)}`,
  render: (n) => renderNote(n),
};
