/**
 * The report writer: one episode page per done issue, built from git, the job
 * ledger and Langfuse, and written to `<factoryDir()>/episodes/`. It never
 * reads a run's result.md or any other worker claim. A page older than
 * KEEP_DAYS is deleted, and an issue whose last run ended before then gets no
 * page, so a deleted page is not written again.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { langfuse } from "../../../lib/langfuse.ts";
import { traceIdFor } from "../../../lib/otlp.ts";
import { partsOf, readList } from "../../../issues/lib/store.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { section } from "../../../issues/lib/todo.ts";
import { factoryDir } from "../gates/factory-status.ts";
import { touch } from "../../../lib/sources.ts";
import { fetchOrigin, git } from "../infra/git.ts";
import { allRuns, onOf, type Entry, type Repo } from "../records/ledger.ts";
import { landedCommits, repoStages } from "../records/status.ts";

export const KEEP_DAYS = 14;
export const episodesDir = () => { touch("episodes"); return join(factoryDir(), "episodes"); };
const today = () => new Date().toISOString().slice(0, 10);
const epoch = (t?: string) => Date.parse(t ?? "") || 0;

/** The ledger runs of an item: its own runs, a part's under `on: <repo>-<n>.<k>`. */
const runsOf = (repo: Repo, item: issues.Issue): Entry[] =>
  allRuns().filter((e) => e.run.repo === repo.key && onOf(e.run) === issues.idOf(item));

/** Whether a page exists for the item: under its ref, or for a part, under the old `<repo>-<parent> ` name. */
function written(repo: Repo, item: issues.Issue, pages: string[]): boolean {
  if (pages.some((f) => f.startsWith(`${repo.key}-${issues.refOf(item)} `))) return true;
  return item.sub !== undefined && pages.includes(`${titleUnder(`${repo.key}-${item.id}`, item)}${MD}`);
}

/** The repo's done issues with a ledger run in the last KEEP_DAYS and no episode page yet. */
export function doneIssues(repo: Repo, now = Date.now()): issues.Issue[] {
  const doc = readList(repo);
  if (!doc) return [];
  const specced = doc.items.filter((i) => !!i.spec.trim());
  if (!specced.length) return [];
  const done = new Set(repoStages(repo, { fetch: true, doc, items: specced.map(issues.refOf) }).filter((s) => s.stage === "done").map((s) => s.id));
  const dir = episodesDir();
  const pages = existsSync(dir) ? readdirSync(dir) : [];
  const since = now - KEEP_DAYS * 86400_000;
  const ran = new Set(allRuns().filter((e) => e.run.repo === repo.key && onOf(e.run) !== undefined && (epoch(e.run.ended) || epoch(e.run.started)) >= since).map((e) => onOf(e.run)));
  return specced.filter((i) => done.has(`${repo.key}-${issues.refOf(i)}`) && ran.has(issues.idOf(i)) && !written(repo, i, pages));
}

const NAME_MAX = 255; // bytes one file name may take
const MD = ".md";

/** The longest prefix of `s` that fits in `max` UTF-8 bytes, never splitting a character. */
function cutBytes(s: string, max: number): string {
  let out = "", used = 0;
  for (const ch of s) {
    const n = Buffer.byteLength(ch);
    if (used + n > max) break;
    out += ch;
    used += n;
  }
  return out;
}

/** `<head> <title>` without the characters a vault title forbids, cut to fit a file name. */
function titleUnder(head: string, item: issues.Issue): string {
  const full = `${head} ${item.title}`.replace(/[\/\\:*?"<>|]/g, " ").replace(/ +/g, " ").trim();
  if (Buffer.byteLength(full) + MD.length <= NAME_MAX) return full;
  const room = NAME_MAX - MD.length - Buffer.byteLength(`${head} `);
  const rest = cutBytes(full.slice(head.length + 1), room).replace(/[ .]+$/, "");
  return `${head} ${rest}`;
}

/** `<repo>-<ref> <title>`, the ref of a part being `<n>.<k>`, so the name and the skip filter agree. */
export function episodeTitle(repo: Repo, item: issues.Issue): string {
  return titleUnder(`${repo.key}-${issues.refOf(item)}`, item);
}

export interface Commit { sha: string; subject: string; stat: string }
export type Langfuse = { error: string } | { traces: { id: string; tokens: number | null }[] };

/** The land commits of the issue; a parent has those of its parts. */
function commitsOf(repo: Repo, item: issues.Issue): Commit[] {
  fetchOrigin(repo.path);
  const main = `origin/${repo.main}`;
  const doc = readList(repo);
  const parts = doc ? partsOf(doc, item) : [];
  const refs = parts.length ? parts.map(issues.refOf) : [issues.refOf(item)];
  const shas = [...new Set(refs.flatMap((n) => landedCommits(repo.path, main, repo.key, n)))];
  return shas.map((sha) => ({
    sha,
    subject: git(repo.path, "show", "--no-patch", "--format=%s", sha).out.trim(),
    stat: git(repo.path, "show", "--shortstat", "--format=", sha).out.trim(),
  }));
}

const tokensOf = (trace: any): number | null => {
  let sum = 0, seen = false;
  for (const o of trace?.observations ?? []) {
    const u = o?.usage;
    const n = typeof u?.total === "number" ? u.total : typeof u?.input === "number" && typeof u?.output === "number" ? u.input + u.output : undefined;
    if (n !== undefined) { sum += n; seen = true; }
  }
  return seen ? sum : null;
};

async function langfuseFor(runs: Entry[]): Promise<Langfuse> {
  try {
    const lf = langfuse();
    if (!lf) return { error: "no Langfuse config" };
    const traces: { id: string; tokens: number | null }[] = [];
    for (const e of runs) {
      const id = traceIdFor(e.id);
      traces.push({ id, tokens: tokensOf(await lf.trace(id)) });
    }
    return { traces };
  } catch (e: any) {
    return { error: String(e?.message ?? e) };
  }
}

const minutes = (e: Entry) => Math.max(0, Math.round((epoch(e.run.ended) - epoch(e.run.started)) / 60000)) || 0;

export function episodePage(repo: Repo, item: issues.Issue, runs: Entry[], commits: Commit[], langfuse: Langfuse): string {
  const id = `${repo.key}-${issues.refOf(item)}`;
  const sources = [id, ...commits.map((c) => `commit:${c.sha.slice(0, 7)}`), ...runs.map((e) => `run:${e.id}`)];
  const aim = section(item.spec, "Goal") || item.spec.trim() || item.request.trim();
  const landed = commits.length ? commits.map((c) => `${c.sha.slice(0, 7)} ${c.subject}${c.stat ? `\n${c.stat}` : ""}`).join("\n") : "nothing landed";
  const went = runs.map(({ id: name, run }) => {
    const parts = [`${run.kind} run ${name}: ${run.condition}`];
    if (run.reason) parts.push(run.reason);
    if (run.round) parts.push(`after ${run.round} fix rounds`);
    return parts.join(", ") + `, ${minutes({ id: name, folder: "", run })} min`;
  }).join("\n");
  const cost = runs.reduce((s, e) => s + (e.run.cost ?? 0), 0);
  const total = runs.reduce((s, e) => s + minutes(e), 0);
  const traces = "error" in langfuse
    ? `Langfuse unreachable: ${langfuse.error}`
    : langfuse.traces.map((t) => (t.tokens === null ? `trace ${t.id}: no token total` : `trace ${t.id}: ${t.tokens} tokens`)).join("\n");
  const wrong: string[] = [];
  for (const { id: name, run } of runs) {
    if (run.condition === "dropped") wrong.push(`${run.kind} run ${name} dropped: ${run.reason ?? "no reason"}`);
    else if (run.failed === "review") wrong.push(`${run.kind} run ${name} failed review: ${run.reason ?? "no reason"}`);
    if (run.conflicts?.length) wrong.push(`${run.kind} run ${name} conflicted: ${run.conflicts.join(", ")}`);
  }
  return [
    "---", "kind: episode", `scope: ${repo.key}`, "confidence: measured", `updated: ${today()}`, "supersedes: []",
    `sources: [${sources.join(", ")}]`, "written_by: factory", "tags: [episode]", "---", "",
    "## Goal", aim, "",
    "## What landed", landed, "",
    "## How it went", went, "",
    "## Cost", `$${cost.toFixed(2)} at the API price over ${runs.length} runs, ${total} min`, traces, "",
    "## What went wrong", wrong.length ? wrong.join("\n") : "nothing", "",
  ].join("\n");
}

/** Build the page and write it to the episodes folder. */
export async function writeEpisode(repo: Repo, item: issues.Issue): Promise<{ title: string } | { error: string }> {
  try {
    const title = episodeTitle(repo, item);
    const runs = runsOf(repo, item);
    mkdirSync(episodesDir(), { recursive: true });
    writeFileSync(join(episodesDir(), `${title}${MD}`), episodePage(repo, item, runs, commitsOf(repo, item), await langfuseFor(runs)));
    return { title };
  } catch (e: any) {
    return { error: String(e?.message ?? e) };
  }
}

/** Delete the pages last written more than KEEP_DAYS ago. */
export function pruneEpisodes(now = Date.now()): void {
  const dir = episodesDir();
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).mtimeMs < now - KEEP_DAYS * 86400_000) rmSync(p);
  }
}

/** The done issues of `repos`, the one whose last run ended longest ago first, at most `cap` pages. */
export async function writeEpisodes(repos: Repo[], cap = 10): Promise<{ written: string[]; failed: string[] }> {
  pruneEpisodes();
  const todo: { repo: Repo; item: issues.Issue; at: number }[] = [];
  for (const repo of repos) {
    for (const item of doneIssues(repo)) {
      const last = Math.max(...runsOf(repo, item).map((e) => epoch(e.run.ended) || epoch(e.run.started)));
      todo.push({ repo, item, at: last });
    }
  }
  todo.sort((a, b) => a.at - b.at);
  const written: string[] = [], failed: string[] = [];
  for (const { repo, item } of todo.slice(0, cap)) {
    const r = await writeEpisode(repo, item);
    if ("title" in r) written.push(r.title);
    else failed.push(`${repo.key}-${issues.refOf(item)}: ${r.error}`);
  }
  return { written, failed };
}
