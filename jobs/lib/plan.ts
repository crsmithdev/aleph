/**
 * The planner: before a large goal's first worker run, one read-only
 * `claude -p` run on the planner tier splits it into 2 to 6 child goals, each
 * with its own oracle. The children are filed in the work store, the parent
 * waits on them and is labelled `planned`. Each run is a job in the ledger,
 * kind `plan`. See docs/specs/2026-10-26-seed-factory.md, "Planner".
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as todos from "../../todo/lib/todo.ts";
import { GOAL, NEEDS_CHRIS, hasLabel, isGoal, label, labels as labelsOf, note, writeList } from "../../todo/lib/store.ts";
import { allRuns, jobsDir, stamp, updateRun, writeRun, type Repo } from "./ledger.ts";
import { jobsNamed } from "./job.ts";
import type { Tier } from "./route.ts";

export const PLANNED = "planned";
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
    if (!body) return `child ${n} has no body`;
    for (const s of SECTIONS) if (!section(body, s)) return `child ${n} has no ${s}`;
    if (!realOracle(section(body, "Oracle"))) return `child ${n}'s Oracle names no command or test file`;
    const waits = c.waits_on ?? [];
    if (!Array.isArray(waits) || waits.some((w: unknown) => !Number.isInteger(w) || (w as number) < 1 || (w as number) >= n)) return `child ${n} waits on something that is not an earlier child`;
    children.push({ title, body, waits: [...new Set(waits as number[])] });
  }
  return children;
}

export function prompt(repo: Repo, item: todos.Item): string {
  return `You plan one large goal of the repo ${repo.key}, which is your working directory. You have read-only tools: read the code to plan. Change nothing.

# Goal ${repo.key}-${item.id}: ${item.title}

${item.body.trim() || "(no body)"}
${item.notes.length ? `\nNotes:\n${item.notes.join("\n")}\n` : ""}
Split it into 2 to 6 child goals. Each child is work one factory run can do alone, in one run of under an hour, and the children together do the whole goal. Reply with one JSON object and nothing else:

{"children": [{"title": "<short title>", "body": "<child goal body>", "waits_on": [<optional numbers of earlier children, from 1>]}]}

Each body is in the goal format, with all four sections non-empty:
  ## Goal (what and why, short)
  ## Edit surface (the files the run may change)
  ## Oracle (the checks that tell it is done)
  ## Time box (default: 45 minutes, one run)

The factory runs this repo's checks itself, so the Oracle names only real commands of this repo, as they are typed in a shell (such as \`bun test\`), or a test file that asserts the end state. There is no \`aleph check\` command: never name one.

"waits_on" lists the earlier children (by their place in the list, the first is 1) that must land first, because they change the same files or this child builds on them. Children that wait on nothing run at once, side by side, so give a wait whenever two children share a file.
`;
}

/** Make the run folder of a planner run: its own job in the ledger. */
function makeRun(repo: Repo, item: todos.Item): string {
  mkdirSync(jobsDir(), { recursive: true });
  const name = `plan-${repo.key}-${item.id}`;
  for (let n = 0; ; n++) {
    const folder = join(jobsDir(), `${stamp()}-${name}${n ? `-${n}` : ""}-plan`);
    try { mkdirSync(folder); } catch (e: any) { if (e.code === "EEXIST") continue; throw e; }
    // `shown`: the dispatch's line reports a plan, so the report has no line for the run.
    writeRun(folder, { kind: "plan", job: folder.split("/").at(-1)!, name, repo: repo.key, todo: item.id, state: "running", phase: "plan", model: PLAN_MODEL, told: true, shown: true, started: new Date().toISOString(), made: Date.now() });
    writeFileSync(join(folder, "command.txt"), `plan ${repo.key}-${item.id}: ${item.title}\n`);
    return folder;
  }
}

async function ask(repo: Repo, item: todos.Item, folder: string): Promise<string> {
  const input = prompt(repo, item);
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

/**
 * File the children and mark the parent `planned`, waiting on them all, as one
 * commit. The children's refs, or null when the parent is no longer an open,
 * unplanned goal.
 */
export function fileChildren(repo: Repo, id: number, children: Child[]): string[] | null {
  const w = writeList(repo, `plan ${repo.key}-${id}: ${children.length} children`, (doc) => {
    const parent = todos.find(doc, id);
    if (!parent || !isGoal(parent) || hasLabel(parent, PLANNED)) return null;
    const own = labelsOf(parent).filter((l) => l !== GOAL && l !== NEEDS_CHRIS && l !== PLANNED);
    const refs: string[] = [];
    for (const c of children) {
      const waits = c.waits.map((w) => refs[w - 1]).join(",");
      const child = todos.add(doc, c.title, {
        labels: [GOAL, ...own], body: `Part of ${repo.key}-${id}.\n\n${c.body}`, priority: typeof parent.fm.priority === "string" ? parent.fm.priority : undefined,
        ...(waits ? { waitingOn: waits } : {}),
      });
      refs.push(`${repo.key}-${child.id}`);
    }
    todos.edit(parent, { waitingOn: refs.join(",") });
    label(parent, [PLANNED]);
    todos.note(parent, `planner: split into ${refs.map((r, i) => `${r} (${children[i].title})`).join(", ")}; this goal closes when they are all done`);
    return refs;
  });
  return w?.value ?? null;
}

/** A child a planner filed: its body starts with "Part of <repo>-<n>.". It is never planned again. */
export const isChild = (item: todos.Item): boolean => /^Part of [a-z0-9-]+-\d+\./.test(item.body.trim());

/** Planner runs of a goal that ended with no children. */
const badPlans = (repo: Repo, id: number) =>
  allRuns().filter((e) => e.run.kind === "plan" && e.run.repo === repo.key && e.run.todo === id && /^(malformed plan|failed):/.test(e.run.reason ?? "")).length;

export type Plan = { planned: string[] } | { tier: Tier | null; why?: string };

/**
 * The decision before a goal's worker run, for a caller that holds the goal's
 * lock: a goal that has had no run, is not a planner's child and is large gets
 * planner runs until one reply passes the check, at most PLAN_TRIES. It returns
 * the children filed, or the tier for the worker run (with why it was not
 * planned when the planner failed).
 */
export async function planGoal(repo: Repo, item: todos.Item, spec: string, rate: Rate): Promise<Plan> {
  const name = `${repo.key}-${item.id}`;
  const tier = await rate(spec);
  if (jobsNamed(name).length || isChild(item) || hasLabel(item, PLANNED) || !isLarge(tier, item.body)) return { tier };
  // The caller holds the goal's lock, so a plan run of this goal still running was left by a process that died.
  for (const e of allRuns()) {
    if (e.run.kind === "plan" && e.run.repo === repo.key && e.run.todo === item.id && e.run.state === "running") {
      updateRun(e.folder, { state: "done", phase: undefined, reason: "failed: its process ended before a reply", ended: new Date().toISOString() });
    }
  }
  if (badPlans(repo, item.id) >= PLAN_TRIES) return { tier };
  let why = "";
  while (badPlans(repo, item.id) < PLAN_TRIES) {
    const folder = makeRun(repo, item);
    const end = (reason: string) => updateRun(folder, { state: "done", reason, phase: undefined, ended: new Date().toISOString() });
    try {
      const plan = parsePlan(await ask(repo, item, folder));
      if (typeof plan === "string") { why = `malformed plan: ${plan}`; end(why); continue; }
      const refs = fileChildren(repo, item.id, plan);
      if (!refs) { end("the goal changed during the run"); return { tier, why: "the goal changed during the planner run" }; }
      end("planned");
      return { planned: refs };
    } catch (e: any) {
      why = `failed: ${e?.message ?? e}`;
      end(why);
    }
  }
  const text = `planner: no plan passed the check in ${PLAN_TRIES} runs (last: ${why}); the goal runs as one worker run`;
  const bad = note(repo, item.id, text);
  return { tier, why: bad ? `${text}; no issue note: ${bad}` : text };
}
