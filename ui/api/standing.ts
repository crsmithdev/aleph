/**
 * `POST /api/standing/:reason` (`{ "action": "<action>" }`) and `POST /api/standing/:reason/revoke`:
 * `aleph standing grant` and `aleph standing revoke`, run as subprocesses, under the same header and Origin rule as controls.ts.
 */
import { runCli } from "../../jobs/lib/launch.ts";
import type { Handler, Routes } from "../server.ts";

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

function sameSite(req: Request): boolean {
  if (req.headers.get("x-aleph-ui") !== "1") return false;
  const origin = req.headers.get("origin");
  return origin === null || origin === new URL(req.url).origin;
}

async function run(args: string[]): Promise<Response> {
  const { stdout, stderr, code } = await runCli(args);
  if (code !== 0) return Response.json({ error: (stderr || stdout).trim() || `aleph exited ${code}` }, { status: 422 });
  try { return Response.json(JSON.parse(stdout)); } catch { return Response.json({ output: stdout.trim() }); }
}

const grant: Handler = async (req, params) => {
  if (!sameSite(req)) return text("forbidden", 403);
  const body: any = await req.json().catch(() => ({}));
  if (typeof body?.action !== "string" || !body.action) return text("send an action", 400);
  return run(["standing", "grant", params.reason, body.action]);
};

const revoke: Handler = async (req, params) => (sameSite(req) ? run(["standing", "revoke", params.reason]) : text("forbidden", 403));

export const routes: Routes = {
  "POST /api/standing/:reason": grant,
  "POST /api/standing/:reason/revoke": revoke,
};
