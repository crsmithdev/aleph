/** `/api/context`, `/api/context/:id`, `/api/context/:id/calls/:call`: the Context view's data, from the Claude Code transcripts under `~/.claude/projects/<project>/<session>.jsonl`. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { touch } from "../../lib/sources.ts";
import { threshold, window } from "../../lib/session-context.ts";
import { find, list } from "../../lib/transcripts.ts";
import { call, parseExact } from "../context.ts";
import type { Routes } from "../server.ts";


/** The last transcript read: the click on a call reads the one the click on its session just read, until the file is written again. */
let held: { id: string; f: string; at: number; text: string } | undefined;
const transcript = (id: string) => {
  const f = held?.id === id && existsSync(held.f) ? held.f : find(id);
  if (!f) return undefined;
  const at = statSync(f).mtimeMs;
  if (held?.f !== f || held.at !== at) held = { id, f, at, text: readFileSync(f, "utf8") };
  return held.text;
};
const missing = (what: string) => Response.json({ error: `no such ${what}` }, { status: 404 });

export const routes: Routes = {
  /** The sessions, built in the updater's Worker and kept: the scan of every transcript is not on the server's loop, nor per request. */
  "GET /api/context": () => {
    touch("transcripts");
    return Response.json({
      sessions: list()
        .map((t) => ({ id: t.id, project: t.project, updated: new Date(t.at).toISOString() }))
        .sort((a, b) => b.updated.localeCompare(a.updated)),
    });
  },
  "GET /api/context/:id": async (_req, params) => {
    const text = transcript(params.id);
    return text === undefined ? missing("session") : Response.json({ id: params.id, window: window(), trigger: threshold(), ...await parseExact(text) });
  },
  "GET /api/context/:id/calls/:call": (_req, params) => {
    const text = transcript(params.id), c = text !== undefined && call(text, params.call);
    return c ? Response.json(c) : missing(text === undefined ? "session" : "call");
  },
};
