/**
 * `POST /api/chat`: one turn of the chat agent that aleph-tools chat.js talks to. The body is
 * `{ text, session?, page?, annotations?, idea?, images? }`. `images` are `{ name, data }`, `data` in base64: the server saves
 * each in `~/.aleph/sessions/<session>/images/` and the prompt names its path, so the agent reads it.
 * A conversation is a Claude Code session, not a job: the server keeps one `claude -p --input-format stream-json` process
 * per open conversation, keyed by the session ID, and writes each turn to its stdin. A turn with no `session` starts a
 * conversation with a new ID. After `chatIdleMs()` with no turn the process ends, and a turn on that session (also after a server
 * restart) starts a new process with `--resume`. The agent is `claude -p` in this checkout
 * like a terminal session of Chris: his own ~/.claude/CLAUDE.md with its Git rules, his skills, and no `ALEPH_AGENT`, so it files issues with `aleph issue` and answers notes with `aleph annotation`. The annotations Chris points at (`annotations`, ids) go with the text first, then
 * the other open annotations of `page` and those with no page.
 *
 * The answer is a server-sent stream: each line of the process's stream-json output as it comes until the turn's `result`,
 * then `end` with `{ error? }`. A comment line every 20 s keeps the stream open under the server's idle timeout while a tool runs.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { MEDIA_BYTES, MEDIA_TYPES } from "../../issues/lib/store.ts";
import { startChat } from "../../jobs/lib/roles/agent-call.ts";
import { chatIdleMs } from "../../jobs/lib/infra/settings.ts";
import { read, type Note } from "../../lib/annotations.ts";
import { alephPath } from "../../lib/paths.ts";
import { find } from "../../lib/transcripts.ts";
import { clip } from "../../lib/naming.ts";
import { file as ideaFile } from "../../ideas/ideas.ts";
import { sameSite } from "../http.ts";
import type { Routes } from "../server.ts";
import { errText } from "../../lib/errtext.ts";

const ROOT = join(import.meta.dir, "..", "..");
const KEEP_MS = 20_000;
/** A turn that runs longer than this ends its process. */
const TURN_MS = 3600_000;

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

/** The folder of each conversation the server ran, named by its session ID: a turn makes it, so the conversations are known when the process is gone. */
const sessions = () => alephPath("ALEPH_SESSIONS_DIR", "sessions");

/** One conversation as the Herald lists it: the session, when it started and had its last turn, and its latest prompt. */
export interface Chat { id: string; start: string; last: string; title: string }

/** The conversations with a turn at or after `since` (ms), oldest first, each read from its Claude Code transcript; one with no transcript is left out. */
export function chats(since: number): Chat[] {
  if (!existsSync(sessions())) return [];
  const out: Chat[] = [];
  for (const id of readdirSync(sessions())) {
    const file = find(id);
    if (!file) continue;
    const records = readFileSync(file, "utf8").split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }).filter((r) => r?.timestamp);
    const latest = records.findLast((r) => r.type === "user" && !r.isMeta && !r.isSidechain && typeof r.message?.content === "string");
    if (records.length && records.at(-1).timestamp >= new Date(since).toISOString()) out.push({ id, start: records[0].timestamp, last: records.at(-1).timestamp, title: clip(String(latest?.message.content ?? "").split("\n")[0], 80) });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** The part of the system prompt for the idea `slug`: its file, the idea commands and the steps to build it. */
const building = (slug: string) => `

Chris is on the idea \`${slug}\`; its write-up is ${ideaFile(slug)}, and the lens results are in the same folder.
- \`aleph idea show ${slug}\` prints it with its lens results; \`aleph idea note ${slug} <text>\` adds a line to its log; \`aleph idea edit ${slug} --writeup <text>\` replaces the write-up; \`aleph idea lens ${slug} <name>\` runs a lens.
- To build the idea (Chris presses Build or says "build it"): read the write-up and the lens results, and ask Chris about each gap you find. Then show the drafted issues as a list with the title, kind, priority and order of each.
- File nothing before Chris says yes to that list. When he says yes, file each issue open in the target repo with \`aleph issue add <repo> ...\`, each \`--after\` the one before, and then run \`aleph idea built ${slug} <ref>...\` with the filed refs.`;

/** The image types the panel sends, by extension. */
const IMAGES = Object.keys(MEDIA_TYPES).filter((x) => MEDIA_TYPES[x].startsWith("image/"));

/** Save `images` in the images folder of `session` and return the part of the prompt that names them; "" when there are none. */
function attached(session: string, images: { ext: string; bytes: Buffer }[]): string {
  if (!images.length) return "";
  const dir = join(sessions(), session, "images");
  mkdirSync(dir, { recursive: true });
  // The turns of a session share the folder, so a name carries the time.
  const at = Date.now();
  const paths = images.map((m, i) => { const p = join(dir, `${at}-${i + 1}.${m.ext}`); writeFileSync(p, m.bytes); return p; });
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

const enc = new TextEncoder(), dec = new TextDecoder();

/** One process of an open conversation. `turn` is set while a turn runs: it takes each output line, and null when the process ends. */
interface Agent { session: string; p: ReturnType<typeof Bun.spawn>; turn?: (line: string | null) => void; idle?: Timer; err: string }
const agents = new Map<string, Agent>();

/** The lines of a stream, as they complete. */
async function* linesOf(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  let rest = "";
  for await (const chunk of stream) {
    const lines = (rest + dec.decode(chunk, { stream: true })).split("\n");
    rest = lines.pop()!;
    for (const l of lines) if (l.trim()) yield l;
  }
  if (rest.trim()) yield rest;
}

/** The process of `session`: the one that is open, else a new one that resumes it, or starts it when `fresh`. */
function agentOf(session: string, fresh: boolean): Agent {
  const open = agents.get(session);
  if (open) return open;
  const p = startChat(session, fresh, SYSTEM, ROOT);
  const a: Agent = { session, p, err: "" };
  agents.set(session, a);
  (async () => { for await (const l of linesOf(p.stderr as ReadableStream<Uint8Array>)) a.err = l.slice(0, 300); })();
  (async () => {
    for await (const l of linesOf(p.stdout as ReadableStream<Uint8Array>)) a.turn?.(l);
    await p.exited;
    clearTimeout(a.idle);
    if (agents.get(session) === a) agents.delete(session);
    a.turn?.(null);
  })();
  return a;
}

/** End the process of `a`: it leaves the open list at once, so the next turn on its session starts a new one. */
function stop(a: Agent): void {
  if (agents.get(a.session) === a) agents.delete(a.session);
  a.p.kill();
}

/** Write `prompt` to the process as one turn; `send` gets each output line until the turn's `result`. Resolves with the error, or undefined. */
function ask(a: Agent, prompt: string, send: (line: string) => void): Promise<string | undefined> {
  clearTimeout(a.idle);
  return new Promise((done) => {
    const limit = setTimeout(() => stop(a), TURN_MS);
    const end = (error?: string) => {
      clearTimeout(limit);
      a.turn = undefined;
      a.idle = setTimeout(() => stop(a), chatIdleMs());
      a.idle.unref();
      done(error);
    };
    a.turn = (line) => {
      if (line === null) return end(`the chat agent exited${a.err ? `: ${a.err}` : ""}`);
      send(line);
      let ev: { type?: string } | undefined;
      try { ev = JSON.parse(line); } catch { /* not an event */ }
      if (ev?.type === "result") end();
    };
    const stdin = a.p.stdin as import("bun").FileSink;
    stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: prompt } })}\n`);
    stdin.flush();
  });
}

export const routes: Routes = {
  "POST /api/chat": async (req) => {
    if (!sameSite(req)) return Response.json({ error: "forbidden" }, { status: 403 });
    const { text, session, page, annotations, idea, images } = await req.json().catch(() => ({}));
    if (typeof text !== "string" || !text.trim()) return Response.json({ error: "text must be a non-empty string" }, { status: 400 });
    if (idea !== undefined && (typeof idea !== "string" || !existsSync(ideaFile(idea)))) return Response.json({ error: `no idea named ${idea}` }, { status: 400 });
    const shots = imagesOf(images);
    if (typeof shots === "string") return Response.json({ error: shots }, { status: 400 });
    const resumed = typeof session === "string" && session !== "";
    const id = resumed ? session : randomUUID();
    if (agents.get(id)?.turn) return Response.json({ error: "this conversation has a turn running" }, { status: 409 });
    mkdirSync(join(sessions(), id), { recursive: true });
    try {
      const ids = Array.isArray(annotations) ? annotations.filter((x): x is string => typeof x === "string") : [];
      // The idea's steps go with the turn, not the process, because a conversation can move to another idea.
      const prompt = text + (idea ? building(idea) : "") + notesOn(typeof page === "string" ? page : undefined, ids) + attached(id, shots);
      const agent = agentOf(id, !resumed);
      // The turn starts here, not when the client reads the body, so a second request on the session sees it running.
      const { readable, writable } = new TransformStream<Uint8Array>();
      const out = writable.getWriter();
      const send = (s: string) => { out.write(enc.encode(s)).catch(() => {}); };
      // A first comment line sends the response head now.
      send(":\n\n");
      const keep = setInterval(() => send(":\n\n"), KEEP_MS);
      ask(agent, prompt, (l) => send(`data: ${l}\n\n`)).then((error) => {
        clearInterval(keep);
        send(`event: end\ndata: ${JSON.stringify(error ? { error } : {})}\n\n`);
        out.close().catch(() => {});
      });
      return new Response(readable, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
    } catch (e) {
      return Response.json({ error: errText(e) }, { status: 500 });
    }
  },
};
