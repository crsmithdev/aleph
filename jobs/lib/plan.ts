/**
 * The planner: before a large goal's first worker run, one read-only
 * `claude -p` run on the planner tier splits the issue into 2 to 6 goals
 * `<repo>-<n>.1 .. .k`, each with its own oracle. The goals are filed in the
 * work store with the issue's `goals`, in one commit. Each run is a job in the
 * ledger, kind `plan`, `on` the issue. See docs/specs/2026-10-26-seed-factory.md, "Planner".
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { vaultDir } from "../../vault/lib/vault.ts";
import * as issues from "../../todo/lib/todo.ts";
import { section } from "../../todo/lib/todo.ts";
import { askPartDropped, note, partsOf, readList, writeList } from "../../todo/lib/store.ts";
import { allRuns, lock, type Repo } from "./ledger.ts";
import { endLost, openRun } from "./agent-run.ts";
import { jobsNamed } from "./job.ts";
import type { Tier } from "./route.ts";

export const PLAN_MODEL = "claude-fable-5-1";
/** Planner replies that fail the check, for one goal, before it runs as one worker run. */
export const PLAN_TRIES = 2;
const SECTIONS = ["Goal", "Edit surface", "Oracle", "Time box"] as const;

export type Rate = (spec: string) => Promise<Tier | null>;
export interface Child { title: string; spec: string; waits: number[] }

/** The top-level folders the paths of a goal's Edit surface name. A file at the repo's root names none. */
export function topFolders(body: string): string[] {
  const found = new Set<string>();
  for (const m of section(body, "Edit surface").matchAll(/(?:^|[\s`(,*])([A-Za-z0-9_.@-]+)\/[^\s`),]*/g)) {
    if (m[1] !== "." && m[1] !== "..") found.add(m[1]);
  }
  return [...found].sort();
}

/** A goal is large when the router rates it `opus` or its Edit surface spans more than one top-level folder. */
export const isLarge = (tier: Tier | null, body: string): boolean => tier === "opus" || topFolders(body).length > 1;

const COMMANDS = new Set(["bun", "bunx", "npm", "npx", "pnpm", "yarn", "node", "deno", "make", "pytest", "python", "python3", "cargo", "go", "bash", "sh", "git", "tsc", "jest", "vitest", "ruby", "rake", "mvn", "gradle"]);

/** Whether an Oracle names a test file or a command a shell runs. `aleph check` is not one. */
export function realOracle(text: string): boolean {
  if (/\baleph check\b/.test(text)) return false;
  if (/[\w./-]+\.(test|spec)\.[a-z]+\b|(^|[\s`/])(tests?|__tests__)\/[\w./-]+|\btest_[\w-]+\.py\b|_test\.(go|py)\b/m.test(text)) return true;
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    const word = m[1].trim().split(/\s+/)[0];
    if (COMMANDS.has(word) || word.startsWith("./") || (word && Bun.which(word))) return true;
  }
  return false;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The children in the planner's output (the whole output, or its outermost braces), or why they fail the check. */
export function parsePlan(output: string, least = 2): Child[] | string {
  let raw: any;
  for (const s of [output.trim(), output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)]) {
    try { raw = JSON.parse(s); break; } catch {}
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "no JSON";
  const list = raw.children;
  if (!Array.isArray(list)) return "no children list";
  if (list.length < least || list.length > 6) return `${list.length} children, not ${least} to 6`;
  const children: Child[] = [];
  for (const [i, c] of list.entries()) {
    const n = i + 1;
    const title = text(c?.title), body = text(c?.body);
    if (!title) return `child ${n} has no title`;
    if (title.length > 60) return `child ${n}'s title is over 60 characters`;
    if (!body) return `child ${n} has no body`;
    for (const s of SECTIONS) if (!section(body, s)) return `child ${n} has no ${s}`;
    if (!realOracle(section(body, "Oracle"))) return `child ${n}'s Oracle names no command or test file`;
    const waits = c.waits_on ?? [];
    if (!Array.isArray(waits) || waits.some((w: unknown) => !Number.isInteger(w) || (w as number) < 1 || (w as number) >= n)) return `child ${n} waits on something that is not an earlier child`;
    children.push({ title, spec: body, waits: [...new Set(waits as number[])] });
  }
  return children;
}

export interface Episode { title: string; body: string }

const REPO_ROOT = join(import.meta.dir, "..", "..");

/**
 * The 3 episodes most like a goal, from the vault's `recall --episodes`. Any
 * failure (no vault, a bad exit, bad JSON, a missing page) gives `[]`.
 */
export async function recallEpisodes(query: string): Promise<Episode[]> {
  try {
    const p = Bun.spawn(["bun", join(REPO_ROOT, "vault", "cli.ts"), "recall", "--episodes", query], { env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [out, , code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    if (code !== 0) return [];
    const hits = JSON.parse(out);
    if (!Array.isArray(hits)) return [];
    const found: Episode[] = [];
    for (const h of hits.slice(0, 3)) {
      try {
        if (typeof h?.title !== "string" || typeof h?.path !== "string") continue;
        found.push({ title: h.title, body: readFileSync(join(vaultDir(), h.path), "utf8") });
      } catch {}
    }
    return found;
  } catch {
    return [];
  }
}

/** The part of an episode page the planner reads: how it went and what went wrong. */
function episodeText(e: Episode): string {
  const parts = ["How it went", "What went wrong"].map((n) => [n, section(e.body, n)] as const).filter(([, t]) => t);
  return `## ${e.title}\n${parts.map(([n, t]) => `\n### ${n}\n${t}\n`).join("")}`;
}

export function prompt(repo: Repo, item: issues.Issue, episodes: Episode[] = [], parts: issues.Issue[] = []): string {
  return `You plan one large goal of the repo ${repo.key}, which is your working directory. You have read-only tools: read the code to plan. Change nothing.

# Goal ${repo.key}-${item.id}: ${item.title}

${[item.request, item.spec].map((t) => t.trim()).filter(Boolean).join("\n\n") || "(no text)"}
${item.notes.length ? `\nNotes:\n${item.notes.join("\n")}\n` : ""}${parts.length ? `\n# Its parts so far\n\n${parts.map((p) => `- ${repo.key}-${issues.refOf(p)} (${issues.status(p)}): ${p.title}`).join("\n")}\n` : ""}${episodes.length ? `\n# How similar goals went\n\n${episodes.map(episodeText).join("\n")}` : ""}
${parts.length ? "Plan only what the parts that are done do not cover: 1 to 6 more child goals." : "Split it into 2 to 6 child goals."} Each child is work one factory run can do alone, in one run of under an hour, and the children together do the whole goal. Reply with one JSON object and nothing else:

{"children": [{"title": "<title>", "body": "<child goal body>", "waits_on": [<optional numbers of earlier children, from 1>]}]}

Each "title" is a grammatically correct phrase or sentence of at most 60 characters. When the work is part of a larger group, it opens with the group in brackets ("[Status layout] Put the metrics on the left"). Each body is in the goal format, with all four sections non-empty:
  ## Goal (what and why, short)
  ## Edit surface (the files the run may change)
  ## Oracle (the checks that tell it is done)
  ## Time box (default: 45 minutes, one run)

The factory runs this repo's checks itself, so the Oracle names only real commands of this repo, as they are typed in a shell (such as \`bun run test\`), or a test file that asserts the end state. There is no \`aleph check\` command: never name one. For one file, name it, as in \`bun test path/to/x.test.ts\`; for the full suite, use \`bun run test\`.

"waits_on" lists the earlier children (by their place in the list, the first is 1) that must land first, because they change the same files or this child builds on them. Children that wait on nothing run at once, side by side, so give a wait whenever two children share a file.
`;
}

/** Whether the issue's spec has no `## Goal` section: such an issue is never planned, and builds from its spec as one worker run. */
const noGoal = (item: issues.Issue): boolean => !section(item.spec, "Goal");

/** Why the issue cannot be planned, or null. A parent can only when `plan` asks for the rest. */
function planRefusal(repo: Repo, doc: issues.Doc, issue: issues.Issue): string | null {
  if (issue.sub !== undefined || issues.status(issue) !== "open") return "not an open issue";
  if (partsOf(doc, issue).length) return issue.fm.plan === "true" ? null : "already planned";
  if (noGoal(issue)) return "no spec";
  if (jobsNamed(`${repo.key}-${issue.id}`).length) return "the issue has had a run";
  return null;
}

/** File the parts `<repo>-<id>.k` as one commit, which clears `plan` and the issue's spec. The parts' ids, or null when the issue is no longer one to plan. */
export function fileChildren(repo: Repo, id: number | string, children: Child[]): string[] | null {
  const w = writeList(repo, `plan ${repo.key}-${id}: ${children.length} parts`, (doc) => {
    const issue = issues.find(doc, id);
    if (!issue || planRefusal(repo, doc, issue)) return null;
    const refs: string[] = [];
    for (const c of children) {
      const part = issues.addPart(doc, issue, { title: c.title, spec: c.spec, after: c.waits.map((w) => refs[w - 1]) });
      refs.push(`${repo.key}-${issues.refOf(part)}`);
    }
    delete issue.fm.plan;
    issue.spec = "";
    issues.note(issue, `planner: split into ${refs.map((r, i) => `${r} (${children[i].title})`).join(", ")}; this issue closes when they are done`);
    return refs;
  });
  return w?.value ?? null;
}

/** A plan that filed no parts clears `plan`, in its write, so the flag cannot stick: the issue builds from its spec, or goes back to triage. A parent asks Chris again. */
function endPlan(repo: Repo, id: number | string, why: string): string | null {
  try {
    writeList(repo, `plan ${repo.key}-${id}: no parts`, (doc) => {
      const issue = issues.find(doc, id);
      if (!issue) return null;
      if (issue.fm.plan === undefined) return null;
      const parent = partsOf(doc, issue).length > 0;
      delete issue.fm.plan;
      if (parent) askPartDropped(issue, `Planning the rest of ${repo.key}-${id} failed: ${why}. What now?`);
      return issues.note(issue, `planner: ${why}`);
    });
    return null;
  } catch (e: any) {
    return e?.message ?? String(e);
  }
}

/** Planner runs of an issue that ended with no children. */
const badPlans = (repo: Repo, id: number | string) =>
  allRuns().filter((e) => e.run.kind === "plan" && e.run.on === `${repo.key}-${id}` && /^(malformed plan|failed):/.test(e.run.reason ?? "")).length;

export type Plan = { plan: true } | { tier: Tier | null };

/**
 * The decision before an issue's worker run, for a caller that holds its lock: a
 * top-level issue that has had no run, that is large, and that has had fewer than
 * PLAN_TRIES failed planner runs, and whose spec has a `## Goal`, is planned; any other gets a worker run at the rated tier.
 */
export async function needsPlan(repo: Repo, item: issues.Issue, spec: string, rate: Rate): Promise<Plan> {
  const tier = await rate(spec);
  // Parts are one level: a part is never planned.
  if (item.sub !== undefined || noGoal(item) || jobsNamed(`${repo.key}-${issues.refOf(item)}`).length || !isLarge(tier, item.spec)) return { tier };
  return badPlans(repo, item.id) >= PLAN_TRIES ? { tier } : { plan: true };
}

const planLock = (repo: Repo, id: number | string) => lock(`plan-${repo.key}-${id}`, 0);

/**
 * Whether a plan run of the goal is going. A plan process holds the goal's plan
 * lock for the whole run, so a lock taken with no wait means no process is
 * planning it: a plan run left `running` is then ended as failed, and the goal
 * is planned again.
 */
export async function planning(repo: Repo, id: number | string): Promise<boolean> {
  const release = await planLock(repo, id);
  if (!release) return true;
  release();
  await endLost("plan", (run) => (run.on === `${repo.key}-${id}` ? `plan-${run.on}` : null));
  return false;
}

export type Planned = { planned: string[] } | { why: string };

/**
 * Plan one goal now, as `aleph plan` does: planner runs until one reply passes
 * the check, at most PLAN_TRIES. It returns the children filed, or why it filed
 * none (then the goal runs as one worker run).
 */
export async function runPlan(repo: Repo, id: number): Promise<Planned> {
  const release = await planLock(repo, id);
  if (!release) return { why: "another plan run holds the goal" };
  try {
    const r = await plan(repo, id);
    if ("why" in r) {
      const bad = endPlan(repo, id, r.why);
      if (bad) return { why: `${r.why}; plan not cleared: ${bad}` };
    }
    return r;
  } finally {
    release();
  }
}

async function plan(repo: Repo, id: number): Promise<Planned> {
  {
    const doc = readList(repo);
    const issue = doc && issues.find(doc, id);
    if (!doc || !issue) return { why: "not an open issue" };
    const refused = planRefusal(repo, doc, issue);
    if (refused) return { why: refused };
    const parts = partsOf(doc, issue);
    // Planning the rest counts only its own failures.
    const earlier = parts.length ? badPlans(repo, id) : 0;
    if (badPlans(repo, id) - earlier >= PLAN_TRIES) return { why: `${PLAN_TRIES} plan runs failed already` };
    const item = issue;
    let why = "";
    while (badPlans(repo, id) - earlier < PLAN_TRIES) {
      const on = `${repo.key}-${issues.refOf(item)}`;
      // `shown`: the dispatch's line reports a plan, so the report has no line for the run.
      const run = openRun({ role: "plan", who: "the planner", model: PLAN_MODEL, seconds: 900, flags: ["--tools", "Read", "Grep", "Glob"], cwd: existsSync(repo.path) ? repo.path : undefined, name: `plan-${on}`, command: `plan ${on}: ${item.title}`, shown: true, repo: repo.key, on });
      const end = (reason: string) => run.end(reason);
      try {
        const input = prompt(repo, item, await recallEpisodes(`${item.title}\n${section(item.spec, "Goal")}`), parts);
        const plan = parsePlan(await run.ask(input), parts.length ? 1 : 2);
        if (typeof plan === "string") { why = `malformed plan: ${plan}`; end(why); continue; }
        const refs = fileChildren(repo, id, plan);
        if (!refs) { end("the issue changed during the run"); return { why: "the issue changed during the planner run" }; }
        end("planned");
        return { planned: refs };
      } catch (e: any) {
        why = `failed: ${e?.message ?? e}`;
        end(why);
      }
    }
    const text = `planner: no plan passed the check in ${PLAN_TRIES} runs (last: ${why}); the goal runs as one worker run`;
    const bad = note(repo, id, text);
    return { why: bad ? `${text}; no issue note: ${bad}` : text };
  }
}
