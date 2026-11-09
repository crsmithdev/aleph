/**
 * `GET /api/events`: a server-sent stream. It sends `change` when a file that the live pages read changes (a run
 * record, a file of the factory folder, the issue store's ref); the page then loads its view again. Changes 500 ms
 * apart send one `change`, and two `change` events are at least 2 s apart, with the last change always sent. It sends
 * an `ev` event for each line added to the event log, with the event as JSON, at once, and a `ping` every 25 s, so
 * that the page can tell a quiet stream from a dead one. With `?project=<key>` the `ev` events are only those of an issue
 * or job of that project and those whose subject names no project (a routine); `change` and `ping` go to every client. The watchers run only while a client is connected.
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, statSync, watch, type FSWatcher, type WatchOptions } from "node:fs";
import { join } from "node:path";
import { factoryDir } from "../../jobs/lib/gates/factory-status.ts";
import { eventsDir, layout } from "../../jobs/lib/infra/layout.ts";
import { recordsDir } from "../../jobs/lib/records/record.ts";
import { parseId } from "../../lib/naming.ts";
import { cookieToken, gateOn, onLogout } from "../auth.ts";
import type { Routes } from "../server.ts";
import { clearCache } from "./speed.ts";

/** Changes this close together send one event. */
const SETTLE_MS = 500;
/** The least time between two `change` events: each one makes every open page fetch and the server build. */
const GAP_MS = 2_000;
/** Under the server's idle timeout, so that it keeps a quiet stream open. */
const PING_MS = 25_000;

const encoder = new TextEncoder();
const event = (name: string, data: string) => encoder.encode(`event: ${name}\ndata: ${data}\n\n`);

/** The open streams, each with the project it follows ("" for all). */
const clients = new Map<ReadableStreamDefaultController<Uint8Array>, string>();
/** The session token of each client that opened its stream with the gate on. */
const tokens = new Map<ReadableStreamDefaultController<Uint8Array>, string>();
let watchers: FSWatcher[] = [];
let ping: Timer | undefined, settle: Timer | undefined, sentAt = 0;

function send(bytes: Uint8Array, subject?: string): void {
  for (const [c, project] of clients) {
    const repo = parseId(subject)?.repo;
    if (project && repo && repo !== project) continue;
    try { c.enqueue(bytes); } catch { clients.delete(c); }
  }
}

/** The kept speed answers are from before the change; the fetch that `change` brings builds them again. */
function changed(): void {
  settle ??= setTimeout(() => {
    settle = undefined;
    sentAt = Date.now();
    clearCache();
    send(event("change", JSON.stringify({ at: sentAt })));
  }, Math.max(SETTLE_MS, sentAt + GAP_MS - Date.now()));
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
  for (const line of text.slice(0, end).split("\n")) {
    if (!line) continue;
    let subject = "";
    try { subject = String(JSON.parse(line).subject ?? ""); } catch {}
    send(encoder.encode(`event: ev\ndata: ${line}\n\n`), subject);
  }
}

function follow(dir: string, options: WatchOptions, counts: (file: string) => boolean): void {
  if (!existsSync(dir)) return;
  const w = watch(dir, options, (_event, file) => { if (file && counts(String(file))) changed(); });
  w.on("error", (e) => console.error(`ui/api/events: watch of ${dir} failed: ${e.message}`));
  watchers.push(w);
}

/** A job record counts; its temporary file does not, as the rename that puts it in place does. */
export const countsInRecords = (file: string): boolean => file.endsWith(".json");
/** The logs change on every line of output and the page does not show them; a temporary file is renamed into place, and the rename counts. */
export const countsInFactory = (file: string): boolean => !file.endsWith(".log") && !file.endsWith(".tmp");

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
  for (const w of watchers) w.close();
  watchers = [];
  sent.clear();
  clearInterval(ping);
  clearTimeout(settle);
  settle = undefined;
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
