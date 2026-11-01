/**
 * The Worker that builds `/api/state` off the server's event loop (ui/state-load.ts sends it the builds).
 * Each message carries the server's environment and its fetch setting, so the build reads what the server
 * would read. The worker lives as long as the server, so the caches of the store and of git outlive one build.
 */
import { cacheFetches } from "../todo/lib/store.ts";
import { state } from "./state.ts";

declare const self: Worker;

export interface BuildRequest { id: number; env: Record<string, string | undefined>; reuse: number }
export type BuildReply = { id: number; state: ReturnType<typeof state> } | { id: number; error: string };

self.onmessage = (e: MessageEvent<BuildRequest>) => {
  const { id, env, reuse } = e.data;
  for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  cacheFetches(reuse);
  try {
    // A test makes the build slow on purpose, to show that the server keeps answering meanwhile.
    const slow = Number(process.env.ALEPH_STATE_SLOW_MS ?? 0);
    if (slow > 0) Bun.sleepSync(slow);
    self.postMessage({ id, state: state() } satisfies BuildReply);
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.stack ?? err.message : String(err) } satisfies BuildReply);
  }
};
