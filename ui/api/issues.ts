/**
 * `GET /api/issues`, `GET /api/issues/:repo/:n` and `POST /api/issues`: the
 * Issues and Issue views' data. Every route takes `?project=<key>` and shows
 * only that project. A read is the work store's origin/main; a write runs
 * `aleph todo add`, so the CLI stays the one writer.
 */
import { join } from "node:path";
import { allJobs, loadRegistry, allRuns, type Repo } from "../../jobs/lib/ledger.ts";
import { git } from "../../jobs/lib/git.ts";
import { derive, facts, landedCommits, landedIndex } from "../../jobs/lib/status.ts";
import { readList, readLists } from "../../todo/lib/store.ts";
import * as todos from "../../todo/lib/todo.ts";
import type { Routes } from "../server.ts";
import { githubBase } from "../state.ts";

const DAY = 24 * 3600_000;
const RECENT_DAYS = 7;

const labelsOf = (i: todos.Item): string[] => (Array.isArray(i.fm.labels) ? (i.fm.labels as string[]) : []);
const str = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(v));

export interface Row {
  id: number; repo: string; title: string; status: string; priority: string | null; labels: string[];
  due: string | null; waiting_on: string | null; updated: string | null; notes: number;
  /** Only on an issue labelled `goal`. */
  state?: string; why?: string;
}

function row(repo: string, i: todos.Item): Row {
  return {
    id: i.id, repo, title: i.title, status: todos.status(i), priority: str(i.fm.priority), labels: labelsOf(i),
    due: str(i.fm.due), waiting_on: str(i.fm.waiting_on), updated: str(i.fm.updated), notes: i.notes.length,
  };
}

/** Each goal's state, from the list already read and one pass over main's trailers. */
function derived(repo: Repo, doc: todos.Doc, rows: Row[]): void {
  const goals = rows.filter((r) => r.labels.includes("goal"));
  if (!goals.length) return;
  const main = `refs/remotes/origin/${repo.main}`;
  let f, landed;
  try { f = facts(repo, doc); landed = landedIndex(repo.path, main, repo.key); } catch { return; }
  for (const r of goals) {
    const s = derive(repo.path, main, f, r.id, landed);
    if (s) { r.state = s.state; r.why = s.why; }
  }
}

/** The repos with a ledger run or an item update in the last week, latest first, as `aleph todo list` with no repo. */
function recentRepos(repos: Repo[], docs: (todos.Doc | null)[]): number[] {
  const since = Date.now() - RECENT_DAYS * DAY;
  const last = new Map<string, number>();
  const seen = (k: string, t: number) => { if (t >= since && t > (last.get(k) ?? 0)) last.set(k, t); };
  for (const e of allRuns()) if (e.run.repo) seen(e.run.repo, Date.parse(e.run.started));
  repos.forEach((r, n) => { for (const i of docs[n]?.items ?? []) if (i.fm.updated) seen(r.key, Date.parse(String(i.fm.updated))); });
  return repos.map((_, n) => n).filter((n) => last.has(repos[n].key)).sort((a, b) => last.get(repos[b].key)! - last.get(repos[a].key)!);
}

function list(url: URL): Response {
  const registry = loadRegistry();
  const project = url.searchParams.get("project");
  const wantRepo = url.searchParams.get("repo");
  const status = url.searchParams.get("status");
  const label = url.searchParams.get("label");
  if (status && !todos.STATUSES.includes(status as todos.Status)) return Response.json({ error: `status must be one of ${todos.STATUSES.join(", ")}` }, { status: 400 });
  if (wantRepo && !registry[wantRepo]) return Response.json({ error: `no repo named ${wantRepo}` }, { status: 404 });
  let repos = Object.values(registry).filter((r) => !project || r.key === project);
  if (wantRepo) repos = repos.filter((r) => r.key === wantRepo);
  let docs: (todos.Doc | null)[];
  try { docs = readLists(repos); } catch (e: any) { return Response.json({ error: e?.message ?? String(e) }, { status: 500 }); }
  const order = wantRepo ? repos.map((_, n) => n) : recentRepos(repos, docs);
  const out = [];
  for (const n of order) {
    const doc = docs[n];
    if (!doc) continue;
    const rows = doc.items.map((i) => row(repos[n].key, i));
    derived(repos[n], doc, rows);
    const items = rows.filter((r) => (!status || r.status === status) && (!label || r.labels.includes(label)));
    if (items.length) out.push(...items);
  }
  return Response.json(out);
}

function detail(params: Record<string, string>, url: URL): Response {
  const project = url.searchParams.get("project");
  const repo = loadRegistry()[params.repo];
  const n = Number(params.n);
  if (!repo || !Number.isInteger(n) || (project && project !== repo.key)) return Response.json({ error: "no such issue" }, { status: 404 });
  let doc: todos.Doc | null;
  try { doc = readList(repo); } catch (e: any) { return Response.json({ error: e?.message ?? String(e) }, { status: 500 }); }
  const item = doc && todos.find(doc, n);
  if (!doc || !item) return Response.json({ error: "no such issue" }, { status: 404 });

  const main = `refs/remotes/origin/${repo.main}`;
  let state = null;
  try { state = derive(repo.path, main, facts(repo), n); } catch {}

  const jobs = allJobs()
    .filter((runs) => runs[0].run.repo === repo.key && runs.some((e) => e.run.todo === n))
    .map((runs) => {
      const r = runs.at(-1)!.run;
      const cost = runs.some((e) => e.run.cost !== undefined) ? runs.reduce((a, e) => a + (e.run.cost ?? 0), 0) : undefined;
      return { name: r.name, state: r.state, started: runs[0].run.started, ended: r.ended ?? null, cost: cost ?? null };
    });

  const base = githubBase(git(repo.path, "remote", "get-url", "origin").out);
  const commits = landedCommits(repo.path, main, repo.key, n).map((h) => {
    const [hash, date, subject] = git(repo.path, "show", "-s", "--format=%H%x09%cI%x09%s", h).out.split("\t");
    return { hash, subject: subject ?? "", date, ...(base ? { commitUrl: `${base}/commit/${hash}` } : {}) };
  });

  return Response.json({ ...row(repo.key, item), body: item.body, notes: item.notes, frontmatter: item.fm, derived: state, jobs, commits });
}

/** The command that runs the CLI: `$ALEPH_CLI` when set (the tests' fake), else bun on jobs/cli.ts. */
function cliArgv(): string[] {
  return process.env.ALEPH_CLI ? [process.env.ALEPH_CLI] : [process.execPath, join(import.meta.dir, "..", "..", "jobs", "cli.ts")];
}

async function create(req: Request, url: URL): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.headers.get("x-aleph-ui") !== "1" || (origin !== null && origin !== url.origin)) return Response.json({ error: "forbidden" }, { status: 403 });
  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "send JSON" }, { status: 400 }); }
  const project = url.searchParams.get("project");
  const repo = String(b?.repo ?? b?.project ?? project ?? "");
  const title = String(b?.title ?? "").trim();
  if (!title) return Response.json({ error: "give the issue a title" }, { status: 400 });
  if (!loadRegistry()[repo]) return Response.json({ error: repo ? `no repo named ${repo}` : "name a project" }, { status: 400 });
  if (project && project !== repo) return Response.json({ error: `this view is filtered to ${project}` }, { status: 400 });
  const labels = (Array.isArray(b.labels) ? b.labels : String(b.labels ?? "").split(",")).map((s: unknown) => String(s).trim()).filter(Boolean);
  const args = [...cliArgv(), "todo", "add", repo, title, "--body", "-"];
  if (labels.length) args.push("--labels", labels.join(","));
  const waits = str(b.waitingOn ?? b.waiting_on)?.trim();
  if (waits) args.push("--waiting-on", waits);
  const due = str(b.due)?.trim();
  if (due) args.push("--due", due);
  const p = Bun.spawn(args, { stdin: new Blob([String(b.body ?? "")]), stdout: "pipe", stderr: "pipe", env: process.env });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) return Response.json({ error: (err || out).trim() || `aleph exited ${code}` }, { status: 422 });
  let added: unknown = {};
  try { added = JSON.parse(out); } catch { added = { output: out.trim() }; }
  return Response.json(added);
}

export const routes: Routes = {
  "GET /api/issues": (_req, _p, url) => list(url),
  "GET /api/issues/:repo/:n": (_req, params, url) => detail(params, url),
  "POST /api/issues": (req, _p, url) => create(req, url),
};
