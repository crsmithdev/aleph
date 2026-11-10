/**
 * `GET /api/events`: a server-sent stream. It sends `change` with `{ keys }` when the updater (ui/updater.ts) has
 * built those keys again and their answers changed; a page then loads again the keys it reads. It sends an `ev`
 * event for each line added to the event log, with the event as JSON, at once, and a `ping` every 25 s, so that the
 * page can tell a quiet stream from a dead one. With `?project=<key>` the `ev` events are only those of an issue or
 * job of that project and those whose subject names no project (a routine), and none for a key that is not in the
 * registry; `change` and `ping` go to every client.
 */
import { existsSync, closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { eventsDir } from "../../jobs/lib/infra/layout.ts";
import { eventIn } from "./scope.ts";
import { cookieToken, gateOn, onLogout } from "../auth.ts";
import type { Routes } from "../server.ts";
import { eventFiles, updater } from "../updater.ts";

/** Under the server's idle timeout, so that it keeps a quiet stream open. */
const PING_MS = 25_000;

const encoder = new TextEncoder();
const event = (name: string, data: string) => encoder.encode(`event: ${name}\ndata: ${data}\n\n`);

/** The open streams, each with the project it follows ("" for all). */
const clients = new Map<ReadableStreamDefaultController<Uint8Array>, string>();
/** The session token of each client that opened its stream with the gate on. */
const tokens = new Map<ReadableStreamDefaultController<Uint8Array>, string>();
let ping: Timer | undefined;

function send(bytes: Uint8Array, subject?: string): void {
  for (const [c, project] of clients) {
    if (subject !== undefined && !eventIn(subject, project)) continue;
    try { c.enqueue(bytes); } catch { clients.delete(c); }
  }
}

updater.onChange((keys) => send(event("change", JSON.stringify({ keys }))));

/** How far into each day file of the event log the stream has sent, by file name. */
const sent = new Map<string, number>();

/** Send the whole lines a day file gained since the last send, each as an `ev` event. */
function tail(file: string): void {
  if (!clients.size) return;
  const path = join(eventsDir(), file);
  let size: number;
  try { size = statSync(path).size; } catch { return; }
  const from = sent.get(file) ?? 0;
  if (size <= from) return;
  const buf = Buffer.alloc(size - from), fd = openSync(path, "r");
  try { readSync(fd, buf, 0, buf.length, from); } finally { closeSync(fd); }
  const text = buf.toString("utf8"), end = text.lastIndexOf("\n");
  if (end < 0) return;
  sent.set(file, from + Buffer.byteLength(text.slice(0, end + 1)));
  for (const line of text.slice(0, end).split("\n")) {
    if (!line) continue;
    let subject = "";
    try { subject = String(JSON.parse(line).subject ?? ""); } catch {}
    send(encoder.encode(`event: ev\ndata: ${line}\n\n`), subject);
  }
}

eventFiles.push(tail);

/** The stream sends only what is added after it starts: the page has the earlier events from /api/factory. */
function start(): void {
  const dir = eventsDir();
  for (const f of existsSync(dir) ? readdirSync(dir) : []) sent.set(f, statSync(join(dir, f)).size);
  ping = setInterval(() => send(event("ping", JSON.stringify({ at: Date.now() }))), PING_MS);
}

/** A session that logs out loses its streams. */
onLogout.push((token) => {
  for (const [c, t] of tokens) {
    if (t !== token) continue;
    tokens.delete(c);
    clients.delete(c);
    c.close();
  }
  if (!clients.size) stop();
});

function stop(): void {
  sent.clear();
  clearInterval(ping);
}

export const routes: Routes = {
  "GET /api/events": (req) => {
    const project = new URL(req.url).searchParams.get("project") || "";
    let mine: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        mine = c;
        if (!clients.size) start();
        clients.set(c, project);
        const t = gateOn() ? cookieToken(req) : null;
        if (t) tokens.set(c, t);
        c.enqueue(event("ping", JSON.stringify({ at: Date.now() })));
      },
      cancel() {
        clients.delete(mine);
        tokens.delete(mine);
        if (!clients.size) stop();
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  },
};
