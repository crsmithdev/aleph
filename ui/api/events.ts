/**
 * `GET /api/events`: a server-sent stream. It sends a `change` event when a file that `/api/state` reads changes, and the
 * page then loads the view again; that event has no data. It sends an `ev` event for each line added to the event log,
 * with the event as JSON, at once. The watchers run only while a client is connected.
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, statSync, watch, type FSWatcher, type WatchOptions } from "node:fs";
import { join } from "node:path";
import { factoryDir } from "../../jobs/lib/gates/factory-status.ts";
import { eventsDir, layout } from "../../jobs/lib/infra/layout.ts";
import { recordsDir } from "../../jobs/lib/records/record.ts";
import type { Routes } from "../server.ts";

/** Changes this close together send one event. */
const SETTLE_MS = 500;
/** Under the server's idle timeout, so that it keeps a quiet stream open. */
const PING_MS = 25_000;

const encoder = new TextEncoder();
const CHANGE = encoder.encode("event: change\ndata: \n\n");
const PING = encoder.encode(": ping\n\n");

const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
let watchers: FSWatcher[] = [];
let ping: Timer | undefined, settle: Timer | undefined;

function send(bytes: Uint8Array): void {
  for (const c of clients) {
    try { c.enqueue(bytes); } catch { clients.delete(c); }
  }
}

function changed(): void {
  settle ??= setTimeout(() => { settle = undefined; send(CHANGE); }, SETTLE_MS);
}

/** How far into each day file of the event log the stream has sent, by file name. */
const sent = new Map<string, number>();

/** Send the whole lines a day file gained since the last send, each as an `ev` event. */
function tail(file: string): void {
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
  for (const line of text.slice(0, end).split("\n")) if (line) send(encoder.encode(`event: ev\ndata: ${line}\n\n`));
}

function follow(dir: string, options: WatchOptions, counts: (file: string) => boolean): void {
  if (!existsSync(dir)) return;
  const w = watch(dir, options, (_event, file) => { if (file && counts(String(file))) changed(); });
  w.on("error", (e) => console.error(`ui/api/events: watch of ${dir} failed: ${e.message}`));
  watchers.push(w);
}

/** A job record counts; its temporary file does not, as the rename that puts it in place does. */
export const countsInRecords = (file: string): boolean => file.endsWith(".json");
/** The logs change on every line of output and the page does not show them. */
export const countsInFactory = (file: string): boolean => !file.endsWith(".log");

function start(): void {
  const { store } = layout();
  mkdirSync(recordsDir(), { recursive: true });
  follow(recordsDir(), {}, countsInRecords);
  follow(factoryDir(), {}, countsInFactory);
  // Each issue write moves this ref; the page reads the issues from it.
  follow(join(store, ".git", "refs", "remotes", "origin"), {}, (file) => file === "main");
  // The stream sends only what is added after it starts: the page has the earlier events from /api/state.
  mkdirSync(eventsDir(), { recursive: true });
  for (const f of readdirSync(eventsDir())) sent.set(f, statSync(join(eventsDir(), f)).size);
  const w = watch(eventsDir(), {}, (_event, file) => { if (file && String(file).endsWith(".jsonl")) tail(String(file)); });
  w.on("error", (e) => console.error(`ui/api/events: watch of ${eventsDir()} failed: ${e.message}`));
  watchers.push(w);
  ping = setInterval(() => send(PING), PING_MS);
}

function stop(): void {
  for (const w of watchers) w.close();
  watchers = [];
  sent.clear();
  clearInterval(ping);
  clearTimeout(settle);
  settle = undefined;
}

export const routes: Routes = {
  "GET /api/events": () => {
    let mine: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        mine = c;
        if (!clients.size) start();
        clients.add(c);
        c.enqueue(PING);
      },
      cancel() {
        clients.delete(mine);
        if (!clients.size) stop();
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  },
};
