/**
 * `POST /api/pause` and `POST /api/resume`.
 * Each is the `aleph` command of that name, run as a subprocess by the launcher, under the same
 * header and Origin rule as the job actions. The password gate in `ui/auth.ts` is what stops a LAN client, so this check is only against other web pages.
 */
import { runCli } from "../cli.ts";
import type { Handler, Routes } from "../server.ts";

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

function sameSite(req: Request): boolean {
  if (req.headers.get("x-aleph-ui") !== "1") return false;
  const origin = req.headers.get("origin");
  return origin === null || origin === new URL(req.url).origin;
}

async function run(args: string[]): Promise<Response> {
  return Response.json(await runCli(args));
}

const simple = (verb: "pause" | "resume"): Handler => async (req) => (sameSite(req) ? run([verb]) : text("forbidden", 403));

export const routes: Routes = {
  "POST /api/pause": simple("pause"),
  "POST /api/resume": simple("resume"),
};
