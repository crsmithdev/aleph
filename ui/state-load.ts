/**
 * `/api/state`'s build, off the event loop: a Worker (ui/state-worker.ts) runs `state()`, so the server answers
 * other requests while it builds. Requests share builds, and none gets a state older than itself:
 * a request waits for the next build to start after it arrives. A build in progress may have read the
 * ledger before the request's change, so a request that arrives meanwhile waits for the build after it,
 * which every request arriving during the first one shares.
 */
import { fetchReuse } from "../issues/lib/store.ts";
import type { State } from "./state.ts";
import type { BuildReply, BuildRequest } from "./state-worker.ts";

export interface Built { state: State; /** The build's number in this process, from 1. */ build: number }

interface Waiting { promise: Promise<Built>; resolve: (b: Built) => void; reject: (e: unknown) => void }
const waiting = (): Waiting => {
  let resolve!: Waiting["resolve"], reject!: Waiting["reject"];
  const promise = new Promise<Built>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};

let worker: Worker | null = null;
let builds = 0;
/** The build the worker runs now, if any. */
let running: { id: number; to: Waiting } | null = null;
/** The build that starts once the running one ends: the requests that arrived during that one wait for it. */
let next: Waiting | null = null;


function theWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./state-worker.ts", import.meta.url).href);
  // The server's own handles keep the process up; a test process exits with the worker idle.
  (w as Worker & { unref(): void }).unref();
  w.onmessage = (e: MessageEvent<BuildReply>) => {
    const r = e.data;
    if (!running || running.id !== r.id) return;
    const to = running.to;
    running = null;
    if ("error" in r) to.reject(new Error(`state build failed: ${r.error}`));
    else to.resolve({ state: r.state, build: r.id });
    startNext();
  };
  w.onerror = (e) => {
    // A worker that died is made again for the next build.
    worker = null;
    w.terminate();
    const to = running?.to;
    running = null;
    to?.reject(new Error(`state worker failed: ${e.message}`));
    startNext();
  };
  return (worker = w);
}

function start(to: Waiting): void {
  const id = ++builds;
  running = { id, to };
  const msg: BuildRequest = { id, env: { ...process.env }, reuse: fetchReuse() };
  theWorker().postMessage(msg);
}

function startNext(): void {
  if (running || !next) return;
  const to = next;
  next = null;
  start(to);
}

/** The state from a build that starts after this call. */
export function loadState(): Promise<Built> {
  const first = !next;
  next ??= waiting();
  const mine = next.promise;
  // With no build running, the build starts on the next turn, so the requests that arrive together share it.
  if (first && !running) setTimeout(startNext, 0);
  return mine;
}
