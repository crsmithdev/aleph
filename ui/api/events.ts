/**
 * `GET /api/events`: a server-sent stream. It sends a `change` event when a file that `/api/state` reads changes, and the
 * page then loads the view again. The event has no data. The watchers run only while a client is connected.
 */
import { existsSync, watch, type FSWatcher, type WatchOptions } from "node:fs";
import { join } from "node:path";
import { factoryDir } from "../../jobs/lib/factory-status.ts";
import { layout } from "../../jobs/lib/layout.ts";
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

function follow(dir: string, options: WatchOptions, counts: (file: string) => boolean): void {
  if (!existsSync(dir)) return;
  const w = watch(dir, options, (_event, file) => { if (file && counts(String(file))) changed(); });
  w.on("error", (e) => console.error(`ui/api/events: watch of ${dir} failed: ${e.message}`));
  watchers.push(w);
}

function start(): void {
  const { store, ledger } = layout();
  // A run's folder also holds its worker's whole file tree, so only the two files the page reads count.
  follow(ledger, { recursive: true }, (file) => /^[^/]+\/(state\.json|call\.md)$/.test(file));
  // The logs change on every line of output and the page does not show them.
  const notLog = (file: string) => !file.endsWith(".log");
  follow(factoryDir(), {}, notLog);
  // Each issue write moves this ref; the page reads the issues from it.
  follow(join(store, ".git", "refs", "remotes", "origin"), {}, (file) => file === "main");
  ping = setInterval(() => send(PING), PING_MS);
}

function stop(): void {
  for (const w of watchers) w.close();
  watchers = [];
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
