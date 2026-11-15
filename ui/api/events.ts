/**
 * `GET /api/events`: a server-sent stream. It sends `change` with `{ keys }` when the updater (ui/updater.ts) has
 * built those keys again and their answers changed; a page then loads again the keys it reads. It sends an `ev`
 * event for each event added to the event table, with the row as JSON, at once, and a `ping` every 25 s, so that the
 * page can tell a quiet stream from a dead one. With `?project=<key>` the `ev` events are only those of an issue or
 * job of that project and those whose subject names no project (a routine), and none for a key that is not in the
 * registry; `change` and `ping` go to every client.
 */
import { eventsAfter, lastSeq } from "../../lib/layout.ts";
import type { EventRow } from "../../lib/naming.ts";
import { eventIn, projectOf, withProjects } from "./scope.ts";
import { cookieToken, gateOn, onLogout } from "../auth.ts";
import type { Routes } from "../server.ts";
import { eventTails, updater } from "../updater.ts";

/** Under the server's idle timeout, so that it keeps a quiet stream open. */
const PING_MS = 25_000;

const encoder = new TextEncoder();
const event = (name: string, data: string) => encoder.encode(`event: ${name}\ndata: ${data}\n\n`);

/** The open streams, each with the project it follows ("" for all). */
const clients = new Map<ReadableStreamDefaultController<Uint8Array>, string>();
/** The session token of each client that opened its stream with the gate on. */
const tokens = new Map<ReadableStreamDefaultController<Uint8Array>, string>();
let ping: Timer | undefined;

function send(bytes: Uint8Array, row?: EventRow): void {
  for (const [c, project] of clients) {
    if (row && !eventIn(row.object, project, row.project)) continue;
    try { c.enqueue(bytes); } catch { clients.delete(c); }
  }
}

updater.onChange((keys) => send(event("change", JSON.stringify({ keys }))));

/** The `seq` of the last event the stream sent. */
let sent = 0;

/** Send the events added since the last send, each as an `ev` event. */
function tail(): void {
  if (!clients.size) return;
  for (const row of withProjects(eventsAfter(sent))) {
    sent = row.seq!;
    send(encoder.encode(`event: ev\ndata: ${JSON.stringify(row)}\n\n`), row);
  }
}

eventTails.push(tail);

/** The stream sends only what is added after it starts: the page has the earlier events from /api/factory. */
function start(): void {
  sent = lastSeq();
  // The sidebar reads /api/status on every page: asking it at each ping keeps its key built, so `change` names it.
  ping = setInterval(() => { send(event("ping", JSON.stringify({ at: Date.now() }))); void updater.get("/api/status"); }, PING_MS);
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
  clearInterval(ping);
}

export const routes: Routes = {
  "GET /api/events": (req) => {
    const project = projectOf(new URL(req.url)) ?? "";
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
