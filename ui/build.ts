/**
 * The one seam between the updater and its builds: `build` runs a key's build in the build Worker
 * (ui/build-worker.ts), off the server's event loop. Each Worker builds one key at a time. The keys that read Langfuse
 * go to a second Worker, because a cold Langfuse read takes up to 2 min and the other keys must not wait behind it.
 * The heavy keys (Hooks and Automation, a month or more of Flow: 3 to 17 s) go to a third, so a 0.1 s key does not wait behind one.
 * A lane sends its Worker one build at a time, and a build that a request waits for goes before the rest: a new key
 * does not wait behind the rebuilds that one event write starts. A Worker that dies fails its builds and is made again.
 */
import type { Answer, BuildReply, BuildRequest } from "./build-worker.ts";

export type { Answer };
/** A build's answer and the sources it read. */
export interface Built { answer: Answer; sources: string[] }

/** The paths whose builds read Langfuse. */
const LANGFUSE = /^\/api\/(sessions|skills)(\/|\?|$)/;
/** The paths whose builds take seconds, not milliseconds (measured 2026-11-22: hooks month 17 s, automation month 3.5 s, flow month 3.1 s). */
const HEAVY = /^\/api\/(hooks|automation)(\/|\?|$)|^\/api\/flow\?.*window=(month|quarter)/;
const lane = (key: string) => (LANGFUSE.test(key) ? "langfuse" : HEAVY.test(key) ? "heavy" : "records");

/** A Worker, the ids of the builds it has in hand (a Worker that dies fails only its own builds), the builds not yet sent, and whether one is sent. */
interface Lane { w: Worker; mine: Map<number, { ok: (b: Built) => void; no: (e: Error) => void }>; queue: { msg: BuildRequest; asked: () => boolean }[]; busy: boolean }
const lanes = new Map<string, Lane>();

/** Told when a Worker's slow read ends (`later` in lib/sources.ts); the updater sets it. */
let later: (source: string) => void = () => {};
export const onLater = (f: (source: string) => void): void => { later = f; };
let ids = 0;

function laneOf(name: string): Lane {
  const had = lanes.get(name);
  if (had) return had;
  const w = new Worker(new URL("./build-worker.ts", import.meta.url).href);
  // The server's own handles keep the process up; a test process exits with the worker idle.
  (w as Worker & { unref(): void }).unref();
  const l: Lane = { w, mine: new Map(), queue: [], busy: false };
  w.onmessage = (e: MessageEvent<BuildReply>) => {
    const r = e.data;
    if ("changed" in r) return later(r.changed);
    const to = l.mine.get(r.id);
    l.mine.delete(r.id);
    l.busy = false;
    send(l);
    if ("error" in r) to?.no(Object.assign(new Error(r.error), { sources: r.sources }));
    else to?.ok({ answer: r.answer, sources: r.sources });
  };
  w.onerror = (e) => {
    lanes.delete(name);
    w.terminate();
    for (const to of l.mine.values()) to.no(new Error(`build worker failed: ${e.message}`));
    l.mine.clear();
  };
  lanes.set(name, l);
  return l;
}

/** Send the lane's next build when its Worker is idle: the first one a request waits for, else the oldest. */
function send(l: Lane): void {
  if (l.busy || !l.queue.length) return;
  const at = Math.max(0, l.queue.findIndex((q) => q.asked()));
  l.busy = true;
  l.w.postMessage(l.queue.splice(at, 1)[0].msg);
}

/** The build of `key`, with each source's change count: the Worker reuses a read whose sources did not change.
 * `asked` says, when the build is sent, whether a request waits for it. */
export function build(key: string, gens: Record<string, number>, asked: () => boolean): Promise<Built> {
  const id = ++ids;
  const msg: BuildRequest = { id, env: { ...process.env }, clock: Date.now(), key, gens };
  return new Promise((ok, no) => {
    const l = laneOf(lane(key));
    l.mine.set(id, { ok, no });
    l.queue.push({ msg, asked });
    send(l);
  });
}
