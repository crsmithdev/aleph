/**
 * `GET /api/events`: a server-sent stream. It sends `change` with `{ keys }` when the updater (ui/updater.ts) has
 * built those keys again and their answers changed; a page then loads again the keys it reads. It sends an `ev`
 * event for the events added to the event table, with the Herald's rows as JSON, at once, and a `ping` every 25 s, so that the
 * page can tell a quiet stream from a dead one. The `ev` data is `{ seq, rows }`: all of the Herald's rows as of the newest event, not
 * the rows of the new event only, so a group the event changed or ended is whole and a row that left is gone. With `?project=<key>` the
 * `ev` events follow only the events of an issue or job of that project and those whose subject names no project (a routine), and
 * none for a key that is not in the registry; `change` and `ping` go to every client. With `?stream=<id>` the keys the page
 * asks for with the header `x-aleph-stream: <id>` stay built while the stream is open (ui/updater.ts).
 */
import { eventsAfter, lastSeq } from "../../lib/layout.ts";
import { eventIn, projectOf, withProjects } from "./scope.ts";
import { heraldNow } from "../state.ts";
import type { Routes } from "../server.ts";
import { eventTails, updater } from "../updater.ts";

/** The time between pings (ms): under the server's idle timeout, so that it keeps a quiet stream open. A test sets less to read a quiet stream. */
export const pings = { ms: 25_000 };

const encoder = new TextEncoder();
const event = (name: string, data: string) => encoder.encode(`event: ${name}\ndata: ${data}\n\n`);

/** The open streams, each with the project it follows ("" for all) and the page's stream id. */
const clients = new Map<ReadableStreamDefaultController<Uint8Array>, { project: string; stream: string | null }>();
let ping: Timer | undefined;

/** Forget a stream that closed: its page shows no key now. */
function drop(c: ReadableStreamDefaultController<Uint8Array>): void {
  const stream = clients.get(c)?.stream;
  clients.delete(c);
  if (stream) updater.closed(stream);
  if (!clients.size) stop();
}

function send(bytes: Uint8Array): void {
  for (const c of clients.keys()) try { c.enqueue(bytes); } catch { drop(c); }
}

updater.onChange((keys) => send(event("change", JSON.stringify({ keys }))));

/** The `seq` of the last event the stream sent. */
let sent = 0;

/** Send the Herald's rows to each client whose project has an event added since the last send; the rows of a project are built once. */
function tail(): void {
  if (!clients.size) return;
  const added = withProjects(eventsAfter(sent));
  if (!added.length) return;
  sent = added.at(-1)!.seq!;
  const built = new Map<string, Uint8Array>();
  for (const [c, { project }] of clients) {
    if (!added.some((row) => eventIn(row.object, project, row.project))) continue;
    if (!built.has(project)) built.set(project, event("ev", JSON.stringify(heraldNow(project || null))));
    try { c.enqueue(built.get(project)!); } catch { drop(c); }
  }
}

eventTails.push(tail);

/** The stream sends only what is added after it starts: the page has the earlier events from /api/factory. */
function start(): void {
  sent = lastSeq();
  // The sidebar reads /api/status on every page: asking it at each ping keeps its key built, so `change` names it.
  ping = setInterval(() => { send(event("ping", JSON.stringify({ at: Date.now() }))); void updater.get("/api/status"); }, pings.ms);
}

function stop(): void {
  clearInterval(ping);
}

export const routes: Routes = {
  "GET /api/events": (req) => {
    const url = new URL(req.url), project = projectOf(url) ?? "", stream = url.searchParams.get("stream");
    let mine: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        mine = c;
        if (!clients.size) start();
        clients.set(c, { project, stream });
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
