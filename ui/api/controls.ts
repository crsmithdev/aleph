/**
 * `POST /api/pause`, `POST /api/resume` and `POST /api/judge` (`{ "judge": "jev" | "haiku" }`).
 * Each is the `aleph` command of that name, run as a subprocess by the launcher, under the same
 * header and Origin rule as the job actions.
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
  return Response.json(await runCli(args));
}

const simple = (verb: "pause" | "resume"): Handler => async (req) => (sameSite(req) ? run([verb]) : text("forbidden", 403));

const judge: Handler = async (req) => {
  if (!sameSite(req)) return text("forbidden", 403);
  const body: any = await req.json().catch(() => ({}));
  if (body?.judge !== "jev" && body?.judge !== "haiku") return text('judge must be "jev" or "haiku"', 400);
  return run(["judge", body.judge]);
};

export const routes: Routes = {
  "POST /api/pause": simple("pause"),
  "POST /api/resume": simple("resume"),
  "POST /api/judge": judge,
};
