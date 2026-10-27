/**
 * `POST /api/pause`, `POST /api/resume` and `POST /api/judge` (`{ "judge": "jev" | "haiku" }`).
 * Each is the `aleph` command of that name, run as a subprocess, under the same
 * header and Origin rule as the job actions.
 */
import { join } from "node:path";
import type { Handler, Routes } from "../server.ts";

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const cli = () => process.env.ALEPH_CLI || join(import.meta.dir, "..", "..", "bin", "aleph");

function sameSite(req: Request): boolean {
  if (req.headers.get("x-aleph-ui") !== "1") return false;
  const origin = req.headers.get("origin");
  return origin === null || origin === new URL(req.url).origin;
}

async function run(args: string[]): Promise<Response> {
  const p = Bun.spawn([cli(), ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return Response.json({ code, stdout, stderr });
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
