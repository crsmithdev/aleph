/**
 * The seam to aleph-tools (the shelf and the page kit): the one file that loads it, from the checkout at
 * `$ALEPH_TOOLS`. `kit` is null when the checkout or its `index.ts` is missing, so aleph runs without it.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export const root = process.env.ALEPH_TOOLS ?? join(homedir(), "aleph-tools");
// The build Worker (ui/build-worker.ts) imports server.ts but needs no kit: a Worker that awaits an import here sets its
// `onmessage` too late and loses its first build request.
export const kit = Bun.isMainThread ? await import(join(root, "index.ts")).catch(() => null) : null;
