/**
 * `POST /api/standing/:reason` (`{ "action": "<action>" }`):
 * `aleph always grant`, run as a subprocess, under the same header and Origin rule as controls.ts. The password gate in `ui/auth.ts` is what stops a LAN client, so this check is only against other web pages.
 */
import { runCli } from "../cli.ts";
import { sameSite, text } from "../http.ts";
import type { Handler, Routes } from "../server.ts";

async function run(args: string[]): Promise<Response> {
  const { stdout, stderr, code } = await runCli(args);
  if (code !== 0) return Response.json({ error: (stderr || stdout).trim() || `aleph exited ${code}` }, { status: 422 });
  try { return Response.json(JSON.parse(stdout)); } catch { return Response.json({ output: stdout.trim() }); }
}

const grant: Handler = async (req, params) => {
  if (!sameSite(req)) return text("forbidden", 403);
  const body: any = await req.json().catch(() => ({}));
  if (typeof body?.action !== "string" || !body.action) return text("send an action", 400);
  return run(["always", "grant", params.reason, body.action]);
};

export const routes: Routes = {
  "POST /api/standing/:reason": grant,
};
