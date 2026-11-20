/** What aleph gives the chat handler of aleph-tools (ui/server.ts mounts it): its prompt, its agent command and the notes of the page. */
import { join } from "node:path";
import { chatCommand } from "../jobs/lib/roles/agent-call.ts";
import { chatIdleMs } from "../jobs/lib/infra/settings.ts";
import { annotationsFile } from "../lib/paths.ts";
import { sameSite } from "./http.ts";
import { dock } from "./dock.ts";

const system = (file: string) => `You are the chat agent of the aleph web UI. Chris writes to you from a panel on the page he is looking at.
- File work with \`aleph issue add <repo> ...\`. Filing an issue starts a factory build, so file only what Chris asks for, and say the issue number.
- Notes that Chris pinned on the page come with his message. When he points at some of them, his message is about those. Answer or resolve one with \`shelf note reply|resolve --file ${file} <id> ...\`.
- Keep replies short: the panel is narrow.`;

/** The notes with an id in `ids`, then the other open notes on `page` and those on no page, as blocks for the prompt; "" when there are none. */
function notesOn(file: string, page: string | undefined, ids: string[]): string {
  const all: any[] = dock!.readNotes(file);
  const pointed = all.filter((n) => ids.includes(n.id));
  const open = page === undefined ? [] : all.filter((n) => n.status === "open" && (n.url === page || n.url === "") && !ids.includes(n.id));
  const line = (n: any) => `- ${n.id}${n.status === "open" ? "" : ` (${n.status})`} on \`${n.selector}\`${n.text ? ` ("${n.text.slice(0, 80)}")` : ""}: ${n.note}${n.replies.map((r: any) => `\n  - ${r.by}: ${r.text}`).join("")}`;
  return (pointed.length ? `\n\nChris points at these annotations:\n${pointed.map(line).join("\n")}` : "") +
    (open.length ? `\n\nOpen annotations on this page (${page}):\n${open.map(line).join("\n")}` : "");
}

/** The hooks, read at each request so a test or a run can move the notes file by its environment variable. */
export const chatHooks = () => {
  const file = annotationsFile();
  return {
    command: chatCommand,
    system: system(file),
    context: (body: Record<string, unknown>) =>
      notesOn(file, typeof body.page === "string" ? body.page : undefined, Array.isArray(body.annotations) ? body.annotations.filter((x): x is string => typeof x === "string") : []),
    allow: sameSite,
    dir: join(import.meta.dir, ".."),
    idleMs: chatIdleMs,
  };
};
