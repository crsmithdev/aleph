/**
 * `GET /api/live?window=hour|day|week|month[&project=<repo>]`: a server-sent stream of the chart rows of that
 * window. On connect, and again half a second after a change to the run records, it sends one `row` event per
 * chart panel: JSON of the panel's key and the newest row of its frame, so the newest point of the chart grows
 * with no page reload. The watcher runs only while a client is connected.
 */
import { mkdirSync, watch, type FSWatcher } from "node:fs";
import { recordsDir } from "../../jobs/lib/records/record.ts";
import type { Routes } from "../server.ts";
// @ts-ignore plain JS, shared with the page
import { costFrame, liveFrame } from "../views/factory-agents.js";
import { countsInRecords } from "./events.ts";
import { speed, WINDOWS, type Window } from "./speed.ts";

/** Changes this close together send one set of rows. */
const SETTLE_MS = 500;
/** Under the server's idle timeout, so that it keeps a quiet stream open. */
const PING_MS = 25_000;

/** The frame of each chart panel, by the key of the panel that draws it. */
const FRAMES = { "factory/agents/live": liveFrame, "factory/agents/cost": costFrame };

const encoder = new TextEncoder();
const PING = encoder.encode(": ping\n\n");

/** One connected stream and the window and project it asked for. */
interface Client { window: Window; project?: string }

const clients = new Map<ReadableStreamDefaultController<Uint8Array>, Client>();
let watcher: FSWatcher | undefined, ping: Timer | undefined, settle: Timer | undefined;

/** The `row` events of a window: the newest row of each panel's frame. */
function rows({ window, project }: Client): Uint8Array[] {
  const d = speed(window, new Date(), null, project);
  return Object.entries(FRAMES).map(([key, frame]) => encoder.encode(`event: row\ndata: ${JSON.stringify({ key, row: frame(d).rows.at(-1) })}\n\n`));
}

/** Send each client the rows of its own query; the clients of one query share the one computation. */
function send(): void {
  const sent = new Map<string, Uint8Array[]>();
  for (const [c, q] of clients) {
    const id = `${q.window}\0${q.project ?? ""}`;
    if (!sent.has(id)) sent.set(id, rows(q));
    for (const b of sent.get(id)!) {
      try { c.enqueue(b); } catch { clients.delete(c); }
    }
  }
}

function tell(bytes: Uint8Array): void {
  for (const c of clients.keys()) {
    try { c.enqueue(bytes); } catch { clients.delete(c); }
  }
}

function changed(): void {
  settle ??= setTimeout(() => { settle = undefined; send(); }, SETTLE_MS);
}

function start(): void {
  mkdirSync(recordsDir(), { recursive: true });
  watcher = watch(recordsDir(), {}, (_event, file) => { if (file && countsInRecords(String(file))) changed(); });
  watcher.on("error", (e) => console.error(`ui/api/live: watch of ${recordsDir()} failed: ${e.message}`));
  ping = setInterval(() => tell(PING), PING_MS);
}

function stop(): void {
  watcher?.close();
  watcher = undefined;
  clearInterval(ping);
  clearTimeout(settle);
  settle = undefined;
}

export const routes: Routes = {
  "GET /api/live": (_req, _params, url) => {
    const w = url.searchParams.get("window") ?? "week";
    if (!(WINDOWS as readonly string[]).includes(w)) return Response.json({ error: "window must be hour, day, week or month" }, { status: 400 });
    const q: Client = { window: w as Window, project: url.searchParams.get("project") || undefined };
    let mine: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        mine = c;
        if (!clients.size) start();
        clients.set(c, q);
        c.enqueue(PING);
        for (const b of rows(q)) c.enqueue(b);
      },
      cancel() {
        clients.delete(mine);
        if (!clients.size) stop();
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  },
};
