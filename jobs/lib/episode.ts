/**
 * The report writer: one episode page per done goal, built from git, the job
 * ledger and Langfuse, and written to the vault through `vault write`. It
 * never reads a run's result.md or any other worker claim.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { langfuseConfig } from "../../hooks/lib/env.ts";
import { fetchTrace, traceIdFor } from "../../hooks/lib/otlp.ts";
import { partsOf, readList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { section } from "../../todo/lib/todo.ts";
import { vaultDir } from "../../vault/lib/vault.ts";
import { fetchOrigin, git } from "./git.ts";
import { allRuns, onOf, type Entry, type Repo } from "./ledger.ts";
import { landedCommits, repoStages } from "./status.ts";

const VAULT_CLI = join(import.meta.dir, "..", "..", "vault", "cli.ts");
const today = () => new Date().toISOString().slice(0, 10);
const epoch = (t?: string) => Date.parse(t ?? "") || 0;

/** The ledger runs of an item: its own runs, a part's under `on: <repo>-<n>.<k>`. */
const runsOf = (repo: Repo, item: issues.Issue): Entry[] =>
  allRuns().filter((e) => e.run.repo === repo.key && onOf(e.run) === issues.idOf(item)).sort((a, b) => epoch(a.run.started) - epoch(b.run.started));

/** Whether a page exists for the item: under its ref, or for a part, under the old `<repo>-<parent> ` name. */
function written(repo: Repo, item: issues.Issue, pages: string[]): boolean {
  if (pages.some((f) => f.startsWith(`${repo.key}-${issues.refOf(item)} `))) return true;
  return item.sub !== undefined && pages.includes(`${titleUnder(`${repo.key}-${item.id}`, item)}${MD}`);
}

/** The repo's done goals with a ledger run and no episode page yet. */
export function doneGoals(repo: Repo): issues.Issue[] {
  const doc = readList(repo);
  if (!doc) return [];
  const goals = doc.items.filter((i) => !!i.spec.trim());
  if (!goals.length) return [];
  const done = new Set(repoStages(repo, { fetch: true, doc, items: goals.map(issues.refOf) }).filter((s) => s.stage === "done").map((s) => s.id));
  const dir = join(vaultDir(), "wiki", "episodes");
  const pages = existsSync(dir) ? readdirSync(dir) : [];
  const ran = new Set(allRuns().filter((e) => e.run.repo === repo.key && onOf(e.run) !== undefined).map((e) => onOf(e.run)));
  return goals.filter((i) => done.has(`${repo.key}-${issues.refOf(i)}`) && ran.has(issues.idOf(i)) && !written(repo, i, pages));
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

/** The land commits of the goal; a parent has those of its parts. */
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
    const cfg = langfuseConfig();
    if (!cfg) return { error: "no Langfuse config" };
    const traces: { id: string; tokens: number | null }[] = [];
    for (const e of runs) {
      const id = traceIdFor(e.id);
      traces.push({ id, tokens: tokensOf(await fetchTrace(cfg, id)) });
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
  const goal = section(item.spec, "Goal") || item.spec.trim() || item.request.trim();
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
    "## Goal", goal, "",
    "## What landed", landed, "",
    "## How it went", went, "",
    "## Cost", `$${cost.toFixed(2)} at the API price over ${runs.length} runs, ${total} min`, traces, "",
    "## What went wrong", wrong.length ? wrong.join("\n") : "nothing", "",
  ].join("\n");
}

/** Build the page and write it through the vault CLI. */
export async function writeEpisode(repo: Repo, item: issues.Issue): Promise<{ title: string } | { error: string }> {
  const dir = mkdtempSync(join(tmpdir(), "aleph-episode-"));
  try {
    const title = episodeTitle(repo, item);
    const runs = runsOf(repo, item);
    const draft = join(dir, `${title}.md`);
    writeFileSync(draft, episodePage(repo, item, runs, commitsOf(repo, item), await langfuseFor(runs)));
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.CLAUDE_CODE_SESSION_ID;
    const p = Bun.spawnSync(["bun", VAULT_CLI, "write", draft, "--why", `episode of ${repo.key}-${issues.refOf(item)}`], { env, stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) return { error: p.stderr.toString().trim() || `vault write exited ${p.exitCode}` };
    return { title };
  } catch (e: any) {
    return { error: String(e?.message ?? e) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The done goals of `repos`, the one whose last run ended longest ago first, at most `cap` pages. */
export async function writeEpisodes(repos: Repo[], cap = 10): Promise<{ written: string[]; failed: string[] }> {
  const todo: { repo: Repo; item: issues.Issue; at: number }[] = [];
  for (const repo of repos) {
    for (const item of doneGoals(repo)) {
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
