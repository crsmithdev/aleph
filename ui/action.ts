/**
 * Every UI POST goes through `post`: the same-site check, the body, and one answer shape. A success is 2xx with the
 * result as JSON; a failure is 4xx or 5xx with `{ error }`, so the page always has a reason to show. A POST must carry
 * `X-Aleph-UI: 1` and, when it has an Origin, the server's own, so a web page in the browser cannot post here; the
 * password gate in `ui/auth.ts` is what stops a LAN client.
 *
 * The page offers nothing the CLI does not: an action runs `aleph` (or `vault`) through `aleph()`, in a process of its
 * own. A non-zero exit is a 422 with what the command said, never a 200. Names and texts go after `--`, so the CLI
 * never reads one as a flag.
 */
import { join } from "node:path";
import { cliOverride } from "../jobs/lib/infra/settings.ts";
import { Refusal } from "../lib/refusal.ts";
import { sameSite } from "./http.ts";
import type { Handler } from "./server.ts";

/** A failed action: the status and the reason the page shows. */
class Fail extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Stop the action with `status` and `error`. */
export const fail = (status: number, error: string): never => { throw new Fail(status, error); };

const answer = (status: number, error: string) => Response.json({ error }, { status });

/** A POST route: `f` gets the JSON body (`{}` when there is none) and returns the result, or throws a Fail or a Refusal. */
export const post = (f: (body: any, params: Record<string, string>, url: URL) => unknown): Handler => async (req, params, url) => {
  if (!sameSite(req)) return answer(403, "forbidden");
  const body = await req.json().catch(() => ({}));
  try {
    return Response.json((await f(body ?? {}, params, url)) ?? {});
  } catch (e) {
    if (e instanceof Fail) return answer(e.status, e.message);
    if (e instanceof Refusal) return answer(422, e.message);
    return answer(500, e instanceof Error ? e.message : String(e));
  }
};

/** The argv that runs each CLI: `$ALEPH_CLI` when set (the UI tests' fake), else bun on jobs/cli.ts. */
const CLIS = {
  aleph: () => (cliOverride() ? [cliOverride()!] : [process.execPath, join(import.meta.dir, "..", "jobs", "cli.ts")]),
  vault: () => [process.execPath, join(import.meta.dir, "..", "vault", "cli.ts")],
};

/** Run `<cli> <args>`: its JSON on exit 0 (`{ output }` for text), else a Fail(422) with what it said. */
export async function aleph(args: string[], o: { stdin?: string; cli?: keyof typeof CLIS } = {}): Promise<any> {
  const p = Bun.spawn([...CLIS[o.cli ?? "aleph"](), ...args], { stdin: o.stdin === undefined ? "ignore" : new Blob([o.stdin]), stdout: "pipe", stderr: "pipe", env: { ...process.env, ALEPH_UI_PASSWORD: undefined } });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) fail(422, (stderr || stdout).trim() || `${args[0]} exited ${code}`);
  try { return JSON.parse(stdout); } catch { return { output: stdout.trim() }; }
}
