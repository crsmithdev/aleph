/** `/api/context`, `/api/context/:id`, `/api/context/:id/calls/:call`: the Context view's data, from the Claude Code transcripts under `~/.claude/projects/<project>/<session>.jsonl`. */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { claudeProjects } from "../../lib/paths.ts";
import { window } from "../../hooks/lib/context.ts";
import { call, parseExact } from "../context.ts";
import type { Routes } from "../server.ts";

const root = claudeProjects;
const transcripts = () => existsSync(root()) ? [...new Bun.Glob("*/*.jsonl").scanSync({ cwd: root() })] : [];

/** The transcript of session `id`: one lookup in each project folder, not a scan of every transcript. */
const file = (id: string) => {
  if (!existsSync(root())) return undefined;
  for (const p of readdirSync(root())) { const f = join(root(), p, `${id}.jsonl`); if (existsSync(f)) return f; }
};
const missing = (what: string) => Response.json({ error: `no such ${what}` }, { status: 404 });

export const routes: Routes = {
  "GET /api/context": () => Response.json({
    sessions: transcripts()
      .map((f) => ({ id: f.slice(f.indexOf("/") + 1, -6), project: f.slice(0, f.indexOf("/")), updated: statSync(join(root(), f)).mtime.toISOString() }))
      .sort((a, b) => b.updated.localeCompare(a.updated)),
  }),
  "GET /api/context/:id": async (_req, params) => {
    const f = file(params.id);
    return f ? Response.json({ id: params.id, window: window(), ...await parseExact(readFileSync(f, "utf8")) }) : missing("session");
  },
  "GET /api/context/:id/calls/:call": (_req, params) => {
    const f = file(params.id), c = f && call(readFileSync(f, "utf8"), params.call);
    return c ? Response.json(c) : missing(f ? "call" : "session");
  },
};
