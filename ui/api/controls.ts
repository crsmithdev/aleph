/**
 * `POST /api/pause` and `POST /api/resume`.
 * Each is the `aleph` command of that name, run as a subprocess by the launcher, under the same
 * header and Origin rule as the job actions. The password gate in `ui/auth.ts` is what stops a LAN client, so this check is only against other web pages.
 */
import { runCli } from "../cli.ts";
import { sameSite, text } from "../http.ts";
import type { Handler, Routes } from "../server.ts";

async function run(args: string[]): Promise<Response> {
  return Response.json(await runCli(args));
}

const simple = (verb: "pause" | "resume"): Handler => async (req) => (sameSite(req) ? run([verb]) : text("forbidden", 403));

export const routes: Routes = {
  "POST /api/pause": simple("pause"),
  "POST /api/resume": simple("resume"),
};
