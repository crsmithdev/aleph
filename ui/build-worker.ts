/**
 * The build Worker: it builds the updater's keys off the server's event loop, one at a time (ui/build.ts sends them).
 * A key is a GET route's path and query; its build is that route's handler, and the reply carries the answer and the
 * sources the build touched (jobs/lib/infra/sources.ts). Each message carries the server's environment and the change
 * count of each source, so the build reads what the server would read and shares unchanged reads with earlier builds.
 * It carries the server's clock too: a test that fakes the server's clock gets builds on that clock.
 */
import { join } from "node:path";
import { skipFetches } from "../issues/lib/store.ts";
import { closePass, openPass, setOnLater, touched } from "../jobs/lib/infra/sources.ts";
import { stateSlowMs } from "../jobs/lib/infra/settings.ts";
import { loadRoutes, match } from "./server.ts";

declare const self: Worker;

/** A route's answer: its status and its body, parsed when it is JSON. */
export interface Answer { status: number; body: unknown; text?: boolean }
export interface BuildRequest { id: number; env: Record<string, string | undefined>; clock: number; key: string; gens: Record<string, number> }
export type BuildReply = { id: number; answer: Answer; sources: string[] } | { id: number; error: string; sources: string[] } | { changed: string };

skipFetches();
// A slow read that ended after its build answered: the updater builds the keys that read it again.
setOnLater((source) => self.postMessage({ changed: source } satisfies BuildReply));
const routes = loadRoutes(join(import.meta.dir, "api"));
let queue: Promise<void> = Promise.resolve();

/** The answer of the GET route that `key` names. */
async function answer(key: string): Promise<Answer> {
  const url = new URL(key, "http://localhost");
  const hit = match(await routes, "GET", url.pathname);
  if (!hit) return { status: 404, body: "not found", text: true };
  const res = await hit.route.handler(new Request(url), hit.params, url);
  const json = res.headers.get("content-type")?.includes("application/json");
  return json ? { status: res.status, body: await res.json() } : { status: res.status, body: await res.text(), text: true };
}

/** Set this thread's clock to the server's when they differ by more than a second: only a test fakes it. */
let faked = false;
async function follow(clock: number): Promise<void> {
  const off = Math.abs(clock - (performance.timeOrigin + performance.now())) > 1000;
  if (!off && !faked) return;
  const { setSystemTime } = await import("bun:test");
  setSystemTime(off ? new Date(clock) : undefined);
  faked = off;
}

async function run({ id, env, clock, key, gens }: BuildRequest): Promise<void> {
  for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  await follow(clock);
  openPass(gens, Bun.hash(JSON.stringify(env)).toString(36));
  touched.clear();
  try {
    // A test makes a build slow on purpose, to show that the server keeps answering meanwhile.
    const slow = stateSlowMs();
    if (slow > 0) Bun.sleepSync(slow);
    self.postMessage({ id, answer: await answer(key), sources: [...touched] } satisfies BuildReply);
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err), sources: [...touched] } satisfies BuildReply);
  } finally {
    closePass();
  }
}

self.onmessage = (e: MessageEvent<BuildRequest>) => { queue = queue.then(() => run(e.data)); };
