/**
 * The one seam between the updater and its builds: `build` runs a key's build in the build Worker
 * (ui/build-worker.ts), off the server's event loop. Today every key goes to the one Worker; moving a kind
 * of key to a Worker of its own is a change here only. A Worker that dies fails its builds and is made again.
 */
import type { Answer, BuildReply, BuildRequest } from "./build-worker.ts";

export type { Answer };
/** A build's answer and the sources it read. */
export interface Built { answer: Answer; sources: string[] }

let worker: Worker | null = null;
let ids = 0;
const waiting = new Map<number, { ok: (b: Built) => void; no: (e: Error) => void }>();

function theWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./build-worker.ts", import.meta.url).href);
  // The server's own handles keep the process up; a test process exits with the worker idle.
  (w as Worker & { unref(): void }).unref();
  w.onmessage = (e: MessageEvent<BuildReply>) => {
    const r = e.data, to = waiting.get(r.id);
    waiting.delete(r.id);
    if ("error" in r) to?.no(Object.assign(new Error(r.error), { sources: r.sources }));
    else to?.ok({ answer: r.answer, sources: r.sources });
  };
  w.onerror = (e) => {
    worker = null;
    w.terminate();
    for (const to of waiting.values()) to.no(new Error(`build worker failed: ${e.message}`));
    waiting.clear();
  };
  return (worker = w);
}

/** The build of `key`, with each source's change count: the Worker reuses a read whose sources did not change. */
export function build(key: string, gens: Record<string, number>): Promise<Built> {
  const id = ++ids;
  const msg: BuildRequest = { id, env: { ...process.env }, clock: Date.now(), key, gens };
  return new Promise((ok, no) => {
    waiting.set(id, { ok, no });
    theWorker().postMessage(msg);
  });
}
