/**
 * `POST /api/chat`: one turn of the chat agent that ui/vendor/kit/chat.js talks to. The body is
 * `{ text, session?, page?, annotations?, idea?, images? }`. `images` are `{ name, data }`, `data` in base64: the server saves
 * each in the run's folder and the prompt names its path, so the agent reads it.
 * The turn is a `chat` run in the ledger, so it has a folder, a log and a cost. The agent is `claude -p` in this checkout
 * with Chris's own setup, so it files issues with `aleph issue` and answers notes with `aleph annotation`; `session`
 * resumes the last turn's conversation. The annotations Chris points at (`annotations`, ids) go with the text first, then
 * the other open annotations of `page` and those with no page.
 *
 * The answer is a server-sent stream: each line of the run's stream-json output as it comes, then `end` with `{ error? }`.
 * A comment line every 20 s keeps the stream open under the server's idle timeout while a tool runs.
 */
import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MEDIA_BYTES, MEDIA_TYPES } from "../../issues/lib/store.ts";
import { OPUS_MODEL } from "../../jobs/lib/routing/models.ts";
import { chatLock, openRun } from "../../jobs/lib/roles/agent-run.ts";
import { runFile } from "../../jobs/lib/records/run-files.ts";
import { read, type Note } from "../../lib/annotations.ts";
import { file as ideaFile } from "../../ideas/ideas.ts";
import { sameSite } from "../http.ts";
import type { Routes } from "../server.ts";

const ROOT = join(import.meta.dir, "..", "..");
const KEEP_MS = 20_000;
const POLL_MS = 100;

const SYSTEM = `You are the chat agent of the aleph web UI. Chris writes to you from a panel on the page he is looking at.
- File work with \`aleph issue add <repo> ...\`. Filing an issue starts a factory build, so file only what Chris asks for, and say the issue number.
- Notes that Chris pinned on the page come with his message. When he points at some of them, his message is about those. Answer or resolve one with \`aleph annotation reply|resolve <id>\`.
- Keep replies short: the panel is narrow.`;

/** The notes with an id in `ids`, then the other open notes on `page` and those on no page, as blocks for the prompt; "" when there are none. */
function notesOn(page: string | undefined, ids: string[]): string {
  const all = read();
  const pointed = all.filter((n: Note) => ids.includes(n.id));
  const open = page === undefined ? [] : all.filter((n: Note) => n.status === "open" && (n.url === page || n.url === "") && !ids.includes(n.id));
  const line = (n: Note) => `- ${n.id}${n.status === "open" ? "" : ` (${n.status})`} on \`${n.selector}\`${n.text ? ` ("${n.text.slice(0, 80)}")` : ""}: ${n.note}${n.replies.map((r) => `\n  - ${r.by}: ${r.text}`).join("")}`;
  return (pointed.length ? `\n\nChris points at these annotations:\n${pointed.map(line).join("\n")}` : "") +
    (open.length ? `\n\nOpen annotations on this page (${page}):\n${open.map(line).join("\n")}` : "");
}

/** The part of the system prompt for the idea `slug`: its file, the idea commands and the steps to build it. */
const building = (slug: string) => `

Chris is on the idea \`${slug}\`; its write-up is ${ideaFile(slug)}, and the lens results are in the same folder.
- \`aleph idea show ${slug}\` prints it with its lens results; \`aleph idea note ${slug} <text>\` adds a line to its log; \`aleph idea edit ${slug} --writeup <text>\` replaces the write-up; \`aleph idea lens ${slug} <name>\` runs a lens.
- To build the idea (Chris presses Build or says "build it"): read the write-up and the lens results, and ask Chris about each gap you find. Then show the drafted issues as a list with the title, kind, priority and order of each.
- File nothing before Chris says yes to that list. When he says yes, file each issue open in the target repo with \`aleph issue add <repo> ...\`, each \`--after\` the one before, and then run \`aleph idea built ${slug} <ref>...\` with the filed refs.`;

/** The image types the panel sends, by extension. */
const IMAGES = Object.keys(MEDIA_TYPES).filter((x) => MEDIA_TYPES[x].startsWith("image/"));

/** Save `images` in `folder` and return the part of the prompt that names them; "" when there are none. */
function attached(folder: string, images: { ext: string; bytes: Buffer }[]): string {
  if (!images.length) return "";
  const dir = join(folder, "images");
  mkdirSync(dir, { recursive: true });
  const paths = images.map((m, i) => { const p = join(dir, `${i + 1}.${m.ext}`); writeFileSync(p, m.bytes); return p; });
  return `\n\nChris attached these screenshots. Read each one with the Read tool:\n${paths.map((p) => `- ${p}`).join("\n")}`;
}

/** The images of the body as `{ ext, bytes }`, or an error. */
function imagesOf(given: unknown): { ext: string; bytes: Buffer }[] | string {
  if (given === undefined) return [];
  if (!Array.isArray(given)) return "images must be a list";
  const out = [];
  for (const m of given) {
    const ext = String(m?.name ?? "").split(".").pop()!.toLowerCase();
    if (!IMAGES.includes(ext) || typeof m?.data !== "string") return `an image must be ${IMAGES.join(", ")} in base64`;
    const bytes = Buffer.from(m.data, "base64");
    if (bytes.length > MEDIA_BYTES) return `an image must be at most ${MEDIA_BYTES / 1024 / 1024} MB`;
    out.push({ ext, bytes });
  }
  return out;
}

const enc = new TextEncoder();

export const routes: Routes = {
  "POST /api/chat": async (req) => {
    if (!sameSite(req)) return Response.json({ error: "forbidden" }, { status: 403 });
    const { text, session, page, annotations, idea, images } = await req.json().catch(() => ({}));
    if (typeof text !== "string" || !text.trim()) return Response.json({ error: "text must be a non-empty string" }, { status: 400 });
    if (idea !== undefined && (typeof idea !== "string" || !existsSync(ideaFile(idea)))) return Response.json({ error: `no idea named ${idea}` }, { status: 400 });
    const shots = imagesOf(images);
    if (typeof shots === "string") return Response.json({ error: shots }, { status: 400 });
    const run = openRun({
      role: "chat", who: "the chat agent", model: OPUS_MODEL, seconds: 3600, cwd: ROOT, name: "chat", command: `chat: ${text.slice(0, 120)}`, shown: true, lock: chatLock,
      flags: ["--permission-mode", "bypassPermissions", "--append-system-prompt", SYSTEM + (idea ? building(idea) : ""), ...(typeof session === "string" && session ? ["--resume", session] : [])],
    });
    const ids = Array.isArray(annotations) ? annotations.filter((x): x is string => typeof x === "string") : [];
    const prompt = text + notesOn(typeof page === "string" ? page : undefined, ids) + attached(run.folder, shots);
    const turn = run.ask(prompt).then(() => undefined, (e: Error) => e.message);
    const log = runFile(run.folder, "output.log");
    let open = true, from = 0, rest = "";
    const body = new ReadableStream<Uint8Array>({
      async start(c) {
        const send = (s: string) => { if (open) try { c.enqueue(enc.encode(s)); } catch { open = false; } };
        const drain = () => {
          const size = statSync(log, { throwIfNoEntry: false })?.size ?? 0;
          if (size <= from) return;
          const buf = Buffer.alloc(size - from), fd = openSync(log, "r");
          try { readSync(fd, buf, 0, buf.length, from); } finally { closeSync(fd); }
          from = size;
          const lines = (rest + buf.toString("utf8")).split("\n");
          rest = lines.pop()!;
          for (const l of lines) if (l.trim()) send(`data: ${l}\n\n`);
        };
        const poll = setInterval(drain, POLL_MS);
        const keep = setInterval(() => send(":\n\n"), KEEP_MS);
        const error = await turn;
        clearInterval(poll);
        clearInterval(keep);
        drain();
        run.end(error ? `failed: ${error}` : "answered");
        send(`event: end\ndata: ${JSON.stringify(error ? { error } : {})}\n\n`);
        if (open) c.close();
      },
      cancel() { open = false; },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  },
};
