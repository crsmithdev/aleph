/** `/api/context`, `/api/context/:id`: the Context view's data, from the Claude Code transcripts under `~/.claude/projects/<project>/<session>.jsonl`. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "../context.ts";
import type { Routes } from "../server.ts";

const root = () => process.env.ALEPH_CLAUDE_PROJECTS ?? join(homedir(), ".claude", "projects");
const transcripts = () => existsSync(root()) ? [...new Bun.Glob("*/*.jsonl").scanSync({ cwd: root() })] : [];

export const routes: Routes = {
  "GET /api/context": () => Response.json({
    sessions: transcripts()
      .map((f) => ({ id: f.slice(f.indexOf("/") + 1, -6), project: f.slice(0, f.indexOf("/")), updated: statSync(join(root(), f)).mtime.toISOString() }))
      .sort((a, b) => b.updated.localeCompare(a.updated)),
  }),
  "GET /api/context/:id": (_req, params) => {
    const f = transcripts().find((t) => t.endsWith(`/${params.id}.jsonl`));
    return f ? Response.json({ id: params.id, requests: parse(readFileSync(join(root(), f), "utf8")) }) : Response.json({ error: "no such session" }, { status: 404 });
  },
};
