/**
 * `GET /api/events`: a server-sent stream. It sends `change` with `{ keys }` when the updater (ui/updater.ts) has
 * built those keys again and their answers changed; a page then loads again the keys it reads. It sends a
 * `ping` every 25 s, so that the page can tell a quiet stream from a dead one. With `?stream=<id>` the keys the page
 * asks for with the header `x-aleph-stream: <id>` stay built while the stream is open (ui/updater.ts).
 */
import type { Routes } from "../server.ts";
import { updater } from "../updater.ts";

/** The time between pings (ms): under the server's idle timeout, so that it keeps a quiet stream open. A test sets less to read a quiet stream. */
export const pings = { ms: 25_000 };

const encoder = new TextEncoder();
const event = (name: string, data: string) => encoder.encode(`event: ${name}\ndata: ${data}\n\n`);

/** The open streams, each with the page's stream id. */
const clients = new Map<ReadableStreamDefaultController<Uint8Array>, string | null>();
let ping: Timer | undefined;

/** Forget a stream that closed: its page shows no key now. */
function drop(c: ReadableStreamDefaultController<Uint8Array>): void {
  const stream = clients.get(c);
  clients.delete(c);
  if (stream) updater.closed(stream);
  if (!clients.size) stop();
}

function send(bytes: Uint8Array): void {
  for (const c of clients.keys()) try { c.enqueue(bytes); } catch { drop(c); }
}

updater.onChange((keys) => send(event("change", JSON.stringify({ keys }))));

function start(): void {
  // The sidebar reads /api/status on every page: asking it at each ping keeps its key built, so `change` names it.
  ping = setInterval(() => { send(event("ping", JSON.stringify({ at: Date.now() }))); void updater.get("/api/status"); }, pings.ms);
}

function stop(): void {
  clearInterval(ping);
}

export const routes: Routes = {
  "GET /api/events": (req) => {
    const stream = new URL(req.url).searchParams.get("stream");
    let mine: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        mine = c;
        if (!clients.size) start();
        clients.set(c, stream);
        if (stream) updater.opened(stream);
        c.enqueue(event("ping", JSON.stringify({ at: Date.now() })));
      },
      cancel() {
        drop(mine);
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  },
};
