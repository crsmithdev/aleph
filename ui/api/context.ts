/** `/api/context`, `/api/context/:id`, `/api/context/:id/calls/:call`: the Context view's data, from the Claude Code transcripts under `~/.claude/projects/<project>/<session>.jsonl`. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { call, parseExact } from "../context.ts";
import type { Routes } from "../server.ts";

const root = () => process.env.ALEPH_CLAUDE_PROJECTS ?? join(homedir(), ".claude", "projects");
const transcripts = () => existsSync(root()) ? [...new Bun.Glob("*/*.jsonl").scanSync({ cwd: root() })] : [];

const file = (id: string) => { const f = transcripts().find((t) => t.endsWith(`/${id}.jsonl`)); return f && join(root(), f); };
const missing = (what: string) => Response.json({ error: `no such ${what}` }, { status: 404 });

export const routes: Routes = {
  "GET /api/context": () => Response.json({
    sessions: transcripts()
      .map((f) => ({ id: f.slice(f.indexOf("/") + 1, -6), project: f.slice(0, f.indexOf("/")), updated: statSync(join(root(), f)).mtime.toISOString() }))
      .sort((a, b) => b.updated.localeCompare(a.updated)),
  }),
  "GET /api/context/:id": async (_req, params) => {
    const f = file(params.id);
    return f ? Response.json({ id: params.id, ...await parseExact(readFileSync(f, "utf8")) }) : missing("session");
  },
  "GET /api/context/:id/calls/:call": (_req, params) => {
    const f = file(params.id), c = f && call(readFileSync(f, "utf8"), params.call);
    return c ? Response.json(c) : missing(f ? "call" : "session");
  },
};
