/**
 * The planner: before the first worker run of a large goal that did not go through
 * triage, one read-only `claude -p` run on the planner tier splits the issue into 2 to 6
 * parts `<repo>-<n>.1 .. .k`, each with its own oracle. The parts are filed in the
 * work store in one commit. Each run is a job in the ledger, kind `plan`, `on` the
 * issue. Triage writes the parts of the issues it routes `plan` itself, with the same
 * check (`checkParts`) and filing (`addParts`). See docs/specs/2026-10-26-seed-factory.md, "Planner".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vaultDir } from "../../vault/lib/vault.ts";
import * as issues from "../../todo/lib/todo.ts";
import { section } from "../../todo/lib/todo.ts";
import { missingSections, surfacePaths } from "./goal-spec.ts";
import { writePartTitle } from "./title.ts";
import { note, partsOf, readList, writeList } from "../../todo/lib/store.ts";
import { askPartDropped } from "./ask.ts";
import { allRuns, lock, type Repo } from "./ledger.ts";
import { causeOf } from "./outcome.ts";
import { endLost, openRun } from "./agent-run.ts";
import { withMainClone } from "./main-clone.ts";
import { jobsNamed } from "./job.ts";
import type { Tier } from "./route.ts";
import { OPUS_MODEL } from "./agent-call.ts";
import { NO_OUTPUT } from "./structured.ts";

export const PLAN_MODEL = OPUS_MODEL;
/** Planner replies that fail the check, for one goal, before it runs as one worker run. */
export const PLAN_TRIES = 2;

export type Rate = (spec: string) => Promise<Tier | null>;
export interface Part { title: string; spec: string; after: number[] }

/** Top-level folders that hold only docs or tests: an Edit surface that also names one of them is not wider for it. */
const SIDE_FOLDERS = new Set(["docs", "acceptance", "tests", "test", "__tests__"]);
/** A test file, which sits beside the code it tests. */
const TEST_FILE = /\.(test|spec|accept)\.[a-z]+$|(^|\/)test_[\w-]+\.py$|_test\.(go|py)$/;

/**
 * The top-level folders the paths of a goal's Edit surface name. A file at the repo's root names none,
 * and neither does a docs or test folder (SIDE_FOLDERS) or a test file.
 */
export function topFolders(body: string): string[] {
  const found = new Set<string>();
  for (const path of surfacePaths(body)) {
    const top = path.split("/");
    if (top.length < 2 || top[0] === "" || top[0] === "." || top[0] === ".." || SIDE_FOLDERS.has(top[0]) || TEST_FILE.test(path)) continue;
    found.add(top[0]);
  }
  return [...found].sort();
}

/** A goal is large when the router rates it `opus` or its Edit surface spans more than one top-level folder. */
export const isLarge = (tier: Tier | null, body: string): boolean => tier === "opus" || topFolders(body).length > 1;

/** Whether triage routed the issue `build` or `plan`: then triage has judged its size, and the large-goal rating does not plan it. */
export const triaged = (item: issues.Issue): boolean => item.notes.some((n) => /: triage: (build|plan)\b/.test(n));

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

/** The JSON schema of a `parts` list, the planner's and triage's: 1 to 6 parts, each title at most 60 characters. */
export const PARTS_SCHEMA = {
  type: "array", minItems: 1, maxItems: 6,
  items: {
    type: "object", additionalProperties: false, required: ["title", "body", "after"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 60 },
      body: { type: "string", description: "The part's spec: ## Goal, ## Edit surface and ## Oracle, all non-empty." },
      after: { type: "array", items: { type: "integer", minimum: 1 }, description: "The numbers of earlier parts that must land first, from 1." },
    },
  },
};

/** The JSON schema of the planner's reply. */
export const PLAN_SCHEMA = { type: "object", additionalProperties: false, required: ["parts"], properties: { parts: PARTS_SCHEMA } };

/** The parts in the planner's structured output, or why they fail the check. */
export function parsePlan(raw: any, least = 2): Part[] | string {
  if (raw === undefined) return NO_OUTPUT;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "not an object";
  return checkParts(raw.parts, least);
}

/**
 * The check of a `parts` list, from the planner or from triage: `least` to 6 parts, each with a title,
 * a body with the goal's sections and a real Oracle, and an `after` of earlier parts only. The parts, or why they fail.
 * A title that breaks the title rule is kept: `fitTitles` rewrites it before the parts are filed.
 */
export function checkParts(list: unknown, least = 2): Part[] | string {
  if (!Array.isArray(list)) return "no parts list";
  if (list.length < least || list.length > 6) return `${list.length} parts, not ${least} to 6`;
  const parts: Part[] = [];
  for (const [i, c] of list.entries()) {
    const n = i + 1;
    const title = text(c?.title)?.replace(/\s+/g, " "), body = text(c?.body);
    if (!title) return `part ${n} has no title`;
    if (!body) return `part ${n} has no body`;
    const missing = missingSections(body);
    if (missing.length) return `part ${n} has no ${missing[0]}`;
    if (!realOracle(section(body, "Oracle"))) return `part ${n}'s Oracle names no command or test file`;
    const after = c.after ?? [];
    if (!Array.isArray(after) || after.some((w: unknown) => !Number.isInteger(w) || (w as number) < 1 || (w as number) >= n)) return `part ${n} has an after that is not an earlier part`;
    parts.push({ title, spec: body, after: [...new Set(after as number[])] });
  }
  return parts;
}

/** The parts, each title that breaks the title rule rewritten by the title writer, its `[Group] ` kept. */
export const fitTitles = (parts: Part[]): Promise<Part[]> =>
  Promise.all(parts.map(async (c) => (issues.titleProblem(c.title, { part: true }) ? { ...c, title: await writePartTitle(c.title) } : c)));

/** The rules for the parts' titles and `after` lists, in the planner's prompt and in triage's. */
export const PART_RULES = `Each "title" is ${issues.TITLE_RULE}. When the work is part of a larger group, it opens with the group in brackets ("[Status layout] Put the metrics on the left"), and the 60 characters include the brackets. Each part's Goal says only what that part does, not the work of another part: the checks of each part are written from its own Goal.

"after" lists the earlier parts (by their place in the list, the first is 1) that must land first. A part has an earlier part in its "after" only when it changes a file that part changes, or uses what that part adds. Parts with an empty "after" run at once, side by side, so add an entry for each of those two reasons and for no other: do not chain parts in a line by habit. Split the work so that most parts can run side by side.`;

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
${parts.length ? "Plan only what the parts that are done do not cover: 1 to 6 more parts." : "Split it into 2 to 6 parts."} Each part is work one factory run can do alone, in one run of under an hour, and the parts together do the whole goal. Reply with the parts, each with a title, a body and an "after" list (empty when none).

Each body is in the goal format, with all three sections non-empty:
  ## Goal (the behaviour in at most 3 sentences; no implementation design, and no claim about code on main that you did not read)
  ## Edit surface (the files the run may change)
  ## Oracle (the checks that tell it is done)

The Oracle is a check stored on the issue: the worker sees it and can run it. The factory runs this repo's checks itself, so the Oracle names only real commands of this repo, as they are typed in a shell (such as \`bun run test\`). It does not ask for a new committed test. A committed test needs a lasting reason: a bug fix gets one regression test at the lowest layer that shows the bug; new lasting behaviour of a module gets a row in that module's existing test file; a CLI end-to-end test is only for new command wiring. There is no \`aleph check\` command: never name one. For one file, name it, as in \`bun test path/to/x.test.ts\`; for the full suite, use \`bun run test\`.

${PART_RULES}
`;
}

/** Whether the issue's spec has no `## Goal` section: such an issue is never planned, and builds from its spec as one worker run. */
const noGoal = (item: issues.Issue): boolean => !section(item.spec, "Goal");

/** Why the issue cannot be planned, or null. A parent can only when `plan` asks for the rest. */
function planRefusal(repo: Repo, doc: issues.Doc, issue: issues.Issue): string | null {
  if (issue.sub !== undefined || issues.status(issue) !== "open") return "not an open issue";
  if (partsOf(doc, issue).length) return issue.fm.plan === "true" ? null : "already planned";
  if (noGoal(issue)) return "no spec";
  // A rescued time-box run sets `plan` on an issue that has had a run: it is split, not built again.
  if (issue.fm.plan !== "true" && jobsNamed(`${repo.key}-${issue.id}`).length) return "the issue has had a run";
  return null;
}

/**
 * Add the parts `<repo>-<id>.k` to the issue in a write, which clears its `plan` and its spec. Each part's `after` is the
 * earlier parts it names and the issue's own `after`. The note names `who` split it. The parts' refs.
 */
export function addParts(repo: Repo, doc: issues.Doc, issue: issues.Issue, parts: Part[], who: string, after: string[] = []): string[] {
  const refs: string[] = [];
  for (const c of parts) {
    const part = issues.addPart(doc, issue, { title: c.title, spec: c.spec, after: [...after, ...c.after.map((w) => refs[w - 1])] });
    refs.push(`${repo.key}-${issues.refOf(part)}`);
  }
  delete issue.fm.plan;
  issue.spec = "";
  issues.note(issue, `${who}: split into ${refs.map((r, i) => `${r} (${parts[i].title})`).join(", ")}; this issue closes when they are done`);
  return refs;
}

/** File the parts `<repo>-<id>.k` as one commit, which clears `plan` and the issue's spec. The parts' ids, or null when the issue is no longer one to plan. */
export function fileParts(repo: Repo, id: number | string, parts: Part[]): string[] | null {
  const w = writeList(repo, `plan ${repo.key}-${id}: ${parts.length} parts`, (doc) => {
    const issue = issues.find(doc, id);
    if (!issue || planRefusal(repo, doc, issue)) return null;
    return addParts(repo, doc, issue, parts, "planner");
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

/** Planner runs of an issue that ended with no parts. */
const badPlans = (repo: Repo, id: number | string) =>
  allRuns().filter((e) => e.run.kind === "plan" && e.run.on === `${repo.key}-${id}` && causeOf(e.run) === "no-answer").length;

export type Plan = { plan: true } | { tier: Tier | null };

/**
 * The decision before an issue's worker run, for a caller that holds its lock: a
 * top-level issue that triage did not route, that has had no run, that is large, and that has had fewer than
 * PLAN_TRIES failed planner runs, and whose spec has a `## Goal`, is planned; any other gets a worker run at the rated tier.
 */
export async function needsPlan(repo: Repo, item: issues.Issue, spec: string, rate: Rate): Promise<Plan> {
  const tier = await rate(spec);
  // Parts are one level: a part is never planned. Triage's `build` is one run, and its `plan` wrote the parts or failed to.
  if (item.sub !== undefined || noGoal(item) || triaged(item) || jobsNamed(`${repo.key}-${issues.refOf(item)}`).length || !isLarge(tier, item.spec)) return { tier };
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
 * the check, at most PLAN_TRIES. It returns the parts filed, or why it filed
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
      const run = openRun({ role: "plan", who: "the planner", model: PLAN_MODEL, seconds: 900, flags: ["--tools", "Read", "Grep", "Glob"], schema: PLAN_SCHEMA, name: `plan-${on}`, command: `plan ${on}: ${item.title}`, shown: true, repo: repo.key, on });
      const end = (reason: string) => run.end(reason);
      const noAnswer = (reason: string) => run.end(reason, { cause: "no-answer" });
      try {
        const input = prompt(repo, item, await recallEpisodes(`${item.title}\n${section(item.spec, "Goal")}`), parts);
        const plan = parsePlan(await withMainClone(repo, "plan-", (dir) => run.askData(input, dir)), parts.length ? 1 : 2);
        if (typeof plan === "string") { why = `malformed plan: ${plan}`; noAnswer(why); continue; }
        const refs = fileParts(repo, id, await fitTitles(plan));
        if (!refs) { end("the issue changed during the run"); return { why: "the issue changed during the planner run" }; }
        end("planned");
        return { planned: refs };
      } catch (e: any) {
        why = `failed: ${e?.message ?? e}`;
        noAnswer(why);
      }
    }
    const text = `planner: no plan passed the check in ${PLAN_TRIES} runs (last: ${why}); the goal runs as one worker run`;
    const bad = note(repo, id, text);
    return { why: bad ? `${text}; no issue note: ${bad}` : text };
  }
}
