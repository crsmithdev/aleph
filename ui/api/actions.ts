/**
 * `GET /api/diff/:name` and `POST /api/land|recheck|drop|checked/:name`. Each action is
 * the `aleph` command of that name, run as a subprocess; the page offers
 * nothing the CLI does not. A POST must carry `X-Aleph-UI: 1` and, when it has
 * an Origin, the server's own, so a web page in the browser cannot post here.
 */
import { join } from "node:path";
import { loadRegistry } from "../../jobs/lib/ledger.ts";
import { latestJob } from "../../jobs/lib/job.ts";
import type { Handler, Routes } from "../server.ts";

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/** The CLI to run: `ALEPH_CLI`, else bin/aleph of this checkout. */
const cli = () => process.env.ALEPH_CLI || join(import.meta.dir, "..", "..", "bin", "aleph");

/** The last run of the job called `name`, or undefined when the ledger has none. */
const find = (name: string) => latestJob(name)?.at(-1);

function sameSite(req: Request): boolean {
  if (req.headers.get("x-aleph-ui") !== "1") return false;
  const origin = req.headers.get("origin");
  return origin === null || origin === new URL(req.url).origin;
}

const git = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });

const diff: Handler = (_req, { name }) => {
  const last = find(name);
  if (!last) return text(`no job named ${name}`, 404);
  const branch = last.run.branch;
  const repo = last.run.repo ? loadRegistry()[last.run.repo] : undefined;
  if (!branch || !repo || git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${branch}`).exitCode !== 0) return text(`${name} has no branch`, 404);
  const base = [`refs/remotes/origin/${repo.main}`, `refs/heads/${repo.main}`].find((r) => git(repo.path, "rev-parse", "--verify", "-q", r).exitCode === 0);
  const mb = base && git(repo.path, "merge-base", base, `refs/heads/${branch}`);
  if (!mb || mb.exitCode !== 0) return text(`${name} shares no history with ${repo.main}`, 404);
  const d = git(repo.path, "diff", "--no-color", `${mb.stdout.toString().trim()}..refs/heads/${branch}`);
  return d.exitCode === 0 ? text(d.stdout.toString(), 200) : text(d.stderr.toString(), 500);
};

const action = (verb: "land" | "recheck" | "drop" | "checked"): Handler => async (req, { name }) => {
  if (!sameSite(req)) return text("forbidden", 403);
  if (!find(name)) return text(`no job named ${name}`, 404);
  const args = [verb, name];
  if (verb === "drop") {
    const body: any = await req.json().catch(() => ({}));
    if (typeof body?.reason === "string" && body.reason.trim()) args.push(body.reason.trim());
  }
  const p = Bun.spawn([cli(), ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return Response.json({ code, stdout, stderr });
};

export const routes: Routes = {
  "GET /api/diff/:name": diff,
  "POST /api/land/:name": action("land"),
  "POST /api/recheck/:name": action("recheck"),
  "POST /api/drop/:name": action("drop"),
  "POST /api/checked/:name": action("checked"),
};
