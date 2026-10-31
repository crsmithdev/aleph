/**
 * The planner: before a large goal's first worker run, one read-only
 * `claude -p` run on the planner tier splits the issue into 2 to 6 goals
 * `<repo>-<n>.1 .. .k`, each with its own oracle. The goals are filed in the
 * work store with the issue's `goals`, in one commit. Each run is a job in the
 * ledger, kind `plan`, `on` the issue. See docs/specs/2026-10-26-seed-factory.md, "Planner".
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { vaultDir } from "../../vault/lib/vault.ts";
import * as todos from "../../todo/lib/todo.ts";
import { goalsOf, issueOf, kindOf, readList, note, writeList } from "../../todo/lib/store.ts";
import { allRuns, jobsDir, lock, stamp, updateRun, writeRun, type Repo } from "./ledger.ts";
import { jobsNamed } from "./job.ts";
import type { Tier } from "./route.ts";

export const PLAN_MODEL = "claude-fable-5-1";
/** Planner replies that fail the check, for one goal, before it runs as one worker run. */
export const PLAN_TRIES = 2;
const TIME_BOX_MS = () => Number(process.env.ALEPH_PLAN_TIMEOUT ?? 900) * 1000;
const SECTIONS = ["Goal", "Edit surface", "Oracle", "Time box"] as const;

export type Rate = (spec: string) => Promise<Tier | null>;
export interface Child { title: string; body: string; waits: number[] }

/** The text under `## <name>` in a goal body, up to the next `##` heading; empty when there is none. */
export function section(body: string, name: string): string {
  const parts = body.split(/^##[ \t]+(.+?)[ \t]*$/m);
  for (let i = 1; i < parts.length; i += 2) if (parts[i].toLowerCase().startsWith(name.toLowerCase())) return parts[i + 1].trim();
  return "";
}

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
export function parsePlan(output: string): Child[] | string {
  let raw: any;
  for (const s of [output.trim(), output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)]) {
    try { raw = JSON.parse(s); break; } catch {}
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "no JSON";
  const list = raw.children;
  if (!Array.isArray(list)) return "no children list";
  if (list.length < 2 || list.length > 6) return `${list.length} children, not 2 to 6`;
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
    children.push({ title, body, waits: [...new Set(waits as number[])] });
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

export function prompt(repo: Repo, item: todos.Item, episodes: Episode[] = []): string {
  return `You plan one large goal of the repo ${repo.key}, which is your working directory. You have read-only tools: read the code to plan. Change nothing.

# Goal ${repo.key}-${item.id}: ${item.title}

${item.body.trim() || "(no body)"}
${item.notes.length ? `\nNotes:\n${item.notes.join("\n")}\n` : ""}${episodes.length ? `\n# How similar goals went\n\n${episodes.map(episodeText).join("\n")}` : ""}
Split it into 2 to 6 child goals. Each child is work one factory run can do alone, in one run of under an hour, and the children together do the whole goal. Reply with one JSON object and nothing else:

{"children": [{"title": "<title>", "body": "<child goal body>", "waits_on": [<optional numbers of earlier children, from 1>]}]}

Each "title" is short and descriptive, a noun phrase of at most 60 characters ("Status layout C: metrics left, lanes in a rail"), not a sentence. Each body is in the goal format, with all four sections non-empty:
  ## Goal (what and why, short)
  ## Edit surface (the files the run may change)
  ## Oracle (the checks that tell it is done)
  ## Time box (default: 45 minutes, one run)

The factory runs this repo's checks itself, so the Oracle names only real commands of this repo, as they are typed in a shell (such as \`bun run test\`), or a test file that asserts the end state. There is no \`aleph check\` command: never name one. For one file, name it, as in \`bun test path/to/x.test.ts\`; for the full suite, use \`bun run test\`.

"waits_on" lists the earlier children (by their place in the list, the first is 1) that must land first, because they change the same files or this child builds on them. Children that wait on nothing run at once, side by side, so give a wait whenever two children share a file.
`;
}

/** Make the run folder of a planner run: its own job in the ledger. */
function makeRun(repo: Repo, item: todos.Item): string {
  mkdirSync(jobsDir(), { recursive: true });
  const name = `plan-${repo.key}-${todos.refOf(item)}`;
  const on = `${repo.key}-${todos.refOf(item)}`;
  for (let n = 0; ; n++) {
    const folder = join(jobsDir(), `${stamp()}-${name}${n ? `-${n}` : ""}-plan`);
    try { mkdirSync(folder); } catch (e: any) { if (e.code === "EEXIST") continue; throw e; }
    // `shown`: the dispatch's line reports a plan, so the report has no line for the run.
    writeRun(folder, { kind: "plan", job: folder.split("/").at(-1)!, name, repo: repo.key, on, state: "running", phase: "plan", model: PLAN_MODEL, told: true, shown: true, started: new Date().toISOString(), made: Date.now() });
    writeFileSync(join(folder, "command.txt"), `plan ${repo.key}-${todos.refOf(item)}: ${item.title}\n`);
    return folder;
  }
}

async function ask(repo: Repo, item: todos.Item, folder: string): Promise<string> {
  const input = prompt(repo, item, await recallEpisodes(`${item.title}\n${section(item.body, "Goal")}`));
  writeFileSync(join(folder, "prompt.md"), input);
  const argv = [process.env.ALEPH_PLAN_CMD ?? "claude", "-p", "--model", PLAN_MODEL, "--tools", "Read", "Grep", "Glob"];
  const p = Bun.spawn(argv, { cwd: existsSync(repo.path) ? repo.path : undefined, env: process.env, stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => p.kill(), TIME_BOX_MS());
  try {
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    writeFileSync(join(folder, "output.log"), out + err);
    if (code !== 0) throw new Error(`the planner exited ${code}`);
    return out;
  } finally {
    clearTimeout(timer);
  }
}

const firstGoal = (repo: Repo, id: number | string) => `${repo.key}-${id}.1`;

/**
 * The goal `.1` of an issue when it is the issue's only goal, open, with no run; `null` for an issue with no goal; a
 * string, why the issue cannot be planned, for any other shape.
 */
function planTarget(repo: Repo, doc: todos.Doc, issue: todos.Item): todos.Item | null | string {
  if (kindOf(issue) !== "issue" || todos.status(issue) !== "open") return "not an open issue";
  const goals = goalsOf(issue);
  if (!goals.length) return section(issue.body, "Goal") ? null : "no goal, and the issue's body is not in goal format";
  const g = goals.length === 1 && goals[0] === firstGoal(repo, issue.id) ? todos.find(doc, `${issue.id}.1`) : undefined;
  if (!g || todos.status(g) !== "open") return "already planned";
  if (jobsNamed(goals[0]).length) return "the goal has had a run";
  return g;
}

/**
 * File the goals `<repo>-<id>.1 .. .k` and the issue's `goals` as one commit; goal `.1` of an issue that has one with no
 * run is rewritten as the first. The goals' ids, or null when the issue is no longer one to plan.
 */
export function fileChildren(repo: Repo, id: number | string, children: Child[]): string[] | null {
  const w = writeList(repo, `plan ${repo.key}-${id}: ${children.length} goals`, (doc) => {
    const issue = todos.find(doc, id);
    if (!issue) return null;
    const first = planTarget(repo, doc, issue);
    if (typeof first === "string") return null;
    const refs: string[] = [];
    for (const [i, c] of children.entries()) {
      const after = c.waits.map((w) => refs[w - 1]);
      let g: todos.Item;
      if (i === 0 && first) {
        g = first;
        todos.edit(g, { title: c.title, body: c.body });
        g.fm.after = after;
      } else {
        g = todos.addGoal(doc, issue, { title: c.title, body: c.body, after });
      }
      refs.push(`${repo.key}-${todos.refOf(g)}`);
    }
    todos.note(issue, `planner: split into ${refs.map((r, i) => `${r} (${children[i].title})`).join(", ")}; this issue closes when they are all done`);
    return refs;
  });
  return w?.value ?? null;
}

/** Planner runs of an issue that ended with no children. */
const badPlans = (repo: Repo, id: number | string) =>
  allRuns().filter((e) => e.run.kind === "plan" && e.run.on === `${repo.key}-${id}` && /^(malformed plan|failed):/.test(e.run.reason ?? "")).length;

export type Plan = { plan: true } | { tier: Tier | null };

/**
 * The decision before a goal's worker run, for a caller that holds the goal's
 * lock: a goal that has had no run, whose issue has only that goal, and that is
 * large, and whose issue has had fewer than PLAN_TRIES failed planner runs, is
 * planned (`plan`, on its issue); any other gets a worker run at the rated tier.
 */
export async function needsPlan(repo: Repo, item: todos.Item, spec: string, rate: Rate): Promise<Plan> {
  const tier = await rate(spec);
  if (jobsNamed(`${repo.key}-${todos.refOf(item)}`).length || !isLarge(tier, item.body)) return { tier };
  const issue = /^(.+)-(\d+)$/.exec(issueOf(item) ?? "");
  if (!issue || issue[1] !== repo.key) return { tier };
  const parent = todos.find(readList(repo)!, Number(issue[2]));
  if (!parent || goalsOf(parent).length !== 1 || goalsOf(parent)[0] !== `${repo.key}-${todos.refOf(item)}`) return { tier };
  return badPlans(repo, parent.id) >= PLAN_TRIES ? { tier } : { plan: true };
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
  try {
    for (const e of allRuns()) {
      if (e.run.kind === "plan" && e.run.on === `${repo.key}-${id}` && e.run.state === "running") {
        updateRun(e.folder, { state: "done", phase: undefined, reason: "failed: its process ended before a reply", ended: new Date().toISOString() });
      }
    }
    return false;
  } finally {
    release();
  }
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
    const doc = readList(repo);
    const issue = doc && todos.find(doc, id);
    if (!issue) return { why: "not an open issue" };
    const target = planTarget(repo, doc, issue);
    if (typeof target === "string") return { why: target };
    if (badPlans(repo, id) >= PLAN_TRIES) return { why: `${PLAN_TRIES} plan runs failed already` };
    // The planner reads the goal's body, or the issue's own when it has no goal.
    const item: todos.Item = { ...issue, title: target?.title ?? issue.title, body: target?.body ?? issue.body };
    let why = "";
    while (badPlans(repo, id) < PLAN_TRIES) {
      const folder = makeRun(repo, item);
      const end = (reason: string) => updateRun(folder, { state: "done", reason, phase: undefined, ended: new Date().toISOString() });
      try {
        const plan = parsePlan(await ask(repo, item, folder));
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
  } finally {
    release();
  }
}
