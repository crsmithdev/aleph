/**
 * The explainer: a sweep that writes the case text (`situation`, `effects`, `recommend`) on every Ask that has none.
 * An Ask is raised in many places, but each one ends on an open store item (`awaitsChris`) or on an awaiting run's
 * `ask` in the ledger, so the sweep reads those two places and misses no reason. Each Ask gets one read-only
 * `claude -p` run, kind `explain`, in the repo's checkout on the host. A failed run leaves the Ask as it is; after
 * `ALEPH_EXPLAIN_TRIES` failed runs for the same Ask (its `on` and its question) the sweep stops trying it.
 *
 * An explain run is not a build and is not on an item for the status: it carries `on` but no `repo`, so `onOf` gives
 * nothing, `liveEntries` and `runsToday` do not count it, and the item is not "touched".
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { awaitsChris, reader, writeList } from "../../todo/lib/store.ts";
import { ASK_REASONS, actionsOn, askOf, reasonOf, setAsk, type Ask } from "./ask.ts";
import { allRuns, loadRegistry, lock, readRun, updateRun, type Entry, type Repo, type Run } from "./ledger.ts";
import { endLost, openRun } from "./agent-run.ts";
import { git } from "./git.ts";
import { explainLesson, proposals, type Lesson } from "./corrections.ts";
import { factoryLog } from "./layout.ts";
import { EXPLAIN_CAP, EXPLAIN_TRIES } from "./settings.ts";

export const EXPLAIN_MODEL = "claude-opus-5-5";
const SECONDS = 300;
const TAIL = 40;

/** Read-only: Read, Grep, Glob, git's read commands and `ls`. */
const ALLOWED = ["Read", "Grep", "Glob", ...["status", "log", "show", "diff", "ls-files"].map((c) => `Bash(git ${c}:*)`), "Bash(ls:*)"];

/** One Ask with no case text: on a store item, or on an awaiting run. `on` is the item's ref or the run's folder name. */
export type Case =
  | { at: "item"; on: string; repo: Repo; item: issues.Issue; ask: Ask }
  | { at: "run"; on: string; repo?: Repo; entry: Entry; ask: Ask; item?: issues.Issue }
  | { at: "lesson"; on: string; repo?: Repo; lesson: Lesson };

export type Text = Pick<Ask, "situation" | "effects" | "recommend">;

const factoryRepos = (): Repo[] => Object.values(loadRegistry()).filter((r) => r.sandbox);
const empty = (ask: Ask | null | undefined): ask is Ask => !!ask && !ask.situation?.trim();

/** Every Ask that has no situation: open items that await Chris, then awaiting runs, oldest run first. */
export function pendingCases(repos: Repo[] = factoryRepos(), runs: Entry[] = allRuns()): Case[] {
  const out: Case[] = [];
  const lists = reader();
  for (const repo of repos) {
    for (const item of lists.list(repo.key)?.items ?? []) {
      if (issues.status(item) !== "open" || !awaitsChris(item)) continue;
      const ask = askOf(item);
      if (empty(ask)) out.push({ at: "item", on: `${repo.key}-${issues.refOf(item)}`, repo, item, ask });
    }
  }
  const byKey = new Map(repos.map((r) => [r.key, r]));
  for (const entry of runs) {
    const r = entry.run;
    if (r.condition !== "awaiting" || !empty(r.ask)) continue;
    const repo = r.repo ? byKey.get(r.repo) : undefined;
    if (r.repo && !repo) continue;
    const m = repo && r.on?.match(/^(.+)-(\d+(?:\.\d+)?)$/);
    const item = m && m[1] === repo!.key ? lists.item(repo!.key, m[2].includes(".") ? m[2] : Number(m[2])) ?? undefined : undefined;
    out.push({ at: "run", on: entry.id, repo, entry, ask: r.ask!, ...(item ? { item } : {}) });
  }
  for (const lesson of proposals()) {
    if (lesson.state !== "proposed" || !lesson.kind || lesson.situation?.trim()) continue;
    out.push({ at: "lesson", on: lesson.id, repo: repos[0], lesson });
  }
  return out;
}

/** What the case asks: an Ask's question, a lesson's sentence. */
const questionOf = (c: Case): string => (c.at === "lesson" ? c.lesson.sentence : c.ask.question);
const reasonName = (c: Case): string => (c.at === "lesson" ? `proposal-${c.lesson.kind}` : c.ask.reason);

/** The actions an effect is owed for: the reason's actions, with `decide` as one `decide:<label>` per option. */
export function actionsOf(c: Case): string[] {
  if (c.at === "lesson") return ["approve", "decline"];
  const reason = reasonOf(c.ask.reason);
  const acts = actionsOn(reason, { run: c.at === "run", decision: c.ask.options.length > 0 });
  return acts.flatMap((a) => (a === "decide" && c.ask.options.length ? c.ask.options.map((o) => `decide:${o.label}`) : [a]));
}

const tail = (folder: string, file: string): string | null => {
  try {
    const s = readFileSync(join(folder, file), "utf8").trimEnd();
    return s ? s.split("\n").slice(-TAIL).join("\n") : null;
  } catch { return null; }
};

/** `git diff --stat` of the run's branch against its repo's main, or why there is none. */
function diffStat(repo: Repo | undefined, run: Run): string {
  if (!repo || !run.branch) return "(no branch)";
  if (!existsSync(repo.path)) return "(the repo is not readable)";
  const main = [`origin/${repo.main}`, repo.main].find((ref) => git(repo.path, "rev-parse", "--verify", "-q", `${ref}^{commit}`).ok);
  const r = main && git(repo.path, "diff", "--stat", `${main}...${run.branch}`);
  return r && r.ok ? r.out.trim() || "(no change)" : "(the branch is not readable)";
}

const section = (title: string, body: string | null | undefined): string => (body && body.trim() ? `\n## ${title}\n\n${body.trim()}\n` : "");

function lessonPrompt(c: Extract<Case, { at: "lesson" }>): string {
  const l = c.lesson;
  const acts = actionsOf(c);
  return `You explain one proposed lesson: a stop where the factory waits for Chris on the proposal ${c.on}. Chris reads your text on the proposal's row before he presses a button. Your working directory is the repo${c.repo ? ` ${c.repo.key}` : ""}. You have read-only tools: Read, Grep, Glob, and Bash for \`git status\`, \`git log\`, \`git show\`, \`git diff\`, \`git ls-files\` and \`ls\`. Change nothing. Read the files the case names before you write about them.

# The proposal

Reason: proposal-${l.kind}
Actions on the card: ${acts.join(", ")}
Kind: ${l.kind}
Target: ${l.target || "(none)"}
Title: ${l.title || "(none)"}
Sentence: ${l.sentence}
Approve only files a goal for the factory; it writes no CLAUDE.md line, skill or check itself. Decline marks the lesson declined for good.
Signals:
${l.signals.map((s) => `- source: ${s.source}; at: ${s.at}; quote: ${s.quote}; link: ${s.link}`).join("\n") || "(none)"}

${REPLY(acts, false)}`;
}

const REPLY = (acts: string[], decision: boolean): string => `# Your reply

Reply with one JSON object and nothing else:

{"situation": "<2 to 5 plain sentences naming the files, what they are for, and what the run did>", "effects": [{"action": "<an action, or decide:<option label>>", "text": "<what happens in this case: to the named things, downstream, what stays undone, what it unblocks, and whether it does the work or only records a claim>"}], "recommend": {"action": "<an action>", "why": "<one sentence>"} | null}

Rules:
- Give one effect for each of these actions, with exactly this "action": ${acts.join(", ")}. No action${decision ? " and no option" : ""} is left without an effect.
- State only what you read. Where you did not read something, say "I did not check X".
- Do not repeat the button's label or what the store does (an Ask cleared, a note added); say what happens to the named things in this case.
- For "checked" on a host check or a manual check, say that the click records a claim and runs nothing, and name what was to be done.
- "recommend" is null when you cannot tell from what you read.
`;

export function explainPrompt(c: Case): string {
  if (c.at === "lesson") return lessonPrompt(c);
  const reason = reasonOf(c.ask.reason);
  const r = ASK_REASONS[reason];
  const acts = actionsOf(c);
  const item = c.item;
  const run = c.at === "run" ? c.entry : undefined;
  const where = c.at === "item" ? `the item ${c.on}` : `the run ${c.on}${run!.run.on ? ` on ${run!.run.on}` : ""}`;
  return `You explain one Ask: a stop where the factory waits for Chris on ${where}. Chris reads your text on the Ask's card before he presses a button. Your working directory is the repo${c.repo ? ` ${c.repo.key}` : ""}. You have read-only tools: Read, Grep, Glob, and Bash for \`git status\`, \`git log\`, \`git show\`, \`git diff\`, \`git ls-files\` and \`ls\`. Change nothing. Read the files the case names before you write about them.

# The Ask

Reason: ${reason} (${r.kind}${r.needs ? `, a ${r.needs} wait` : ""})
On: ${c.at === "run" ? "a run" : "an issue"}${c.ask.options.length ? ", a decision with options" : ""}
Actions on the card: ${acts.join(", ")}
Question: ${c.ask.question || "(none)"}
${c.ask.options.length ? `Options:\n${c.ask.options.map((o) => `- ${o.label}: ${o.line}${o.after ? ` (waits for ${o.after})` : ""}`).join("\n")}\n` : ""}${c.ask.recommended ? `Recommended option: ${c.ask.recommended}\n` : ""}${c.ask.why.length ? `Why:\n${c.ask.why.map((w) => `- ${w}`).join("\n")}\n` : ""}${item ? `
# Item ${c.at === "item" ? c.on : run!.run.on}: ${item.title}
${section("Request", item.request)}${section("Spec", item.spec)}${section("Notes", item.notes.join("\n"))}` : ""}${run ? `
# The run ${c.on}
${run.run.branch ? `\nBranch: ${run.run.branch}\n` : ""}${run.run.reason ? `Reason it stopped: ${run.run.reason}\n` : ""}${section("Tail of prompt.md", tail(run.folder, "prompt.md"))}${section("Tail of result.md", tail(run.folder, "result.md"))}${section("Tail of checks.log", tail(run.folder, "checks.log"))}${section("git diff --stat of its branch", diffStat(c.repo, run.run))}` : ""}
${REPLY(acts, c.ask.options.length > 0)}`;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The case text in the reply (the whole reply, or its outermost braces), or why it does not do. */
export function parseExplain(output: string, actions: string[]): Text | string {
  let raw: any;
  for (const s of [output.trim(), output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)]) {
    try { raw = JSON.parse(s); break; } catch {}
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "no JSON";
  const situation = str(raw.situation);
  if (!situation) return "no situation";
  if (!Array.isArray(raw.effects)) return "no effects list";
  const effects: { action: string; text: string }[] = [];
  for (const e of raw.effects) {
    const action = str(e?.action), text = str(e?.text);
    if (actions.includes(action) && text && !effects.some((x) => x.action === action)) effects.push({ action, text });
  }
  const missing = actions.filter((a) => !effects.some((e) => e.action === a));
  if (missing.length) return `no effect for ${missing.join(", ")}`;
  const rec = raw.recommend && typeof raw.recommend === "object" ? { action: str(raw.recommend.action), why: str(raw.recommend.why) } : null;
  const recommend = rec && rec.action && actions.includes(rec.action) ? rec : undefined;
  return { situation, effects: actions.map((a) => effects.find((e) => e.action === a)!), ...(recommend ? { recommend } : {}) };
}

const sameAsk = (a: Ask | null | undefined, b: Ask): boolean => !!a && reasonOf(a.reason) === reasonOf(b.reason) && a.question === b.question && !a.situation?.trim();

/** Write the text on the Ask, when the Ask is still the same one. Whether it was written. */
function store(c: Case, t: Text): boolean {
  if (c.at === "item") {
    const ref = issues.refOf(c.item);
    const w = writeList(c.repo, `explain ${c.on}`, (doc) => {
      const item = issues.find(doc, ref);
      if (!item || issues.status(item) !== "open" || !awaitsChris(item) || !sameAsk(askOf(item), c.ask)) return null;
      setAsk(item, { ...askOf(item)!, ...t });
      return true;
    });
    return w?.value === true;
  }
  if (c.at === "lesson") return explainLesson(c.lesson.id, c.lesson.sentence, t);
  const now = readRun(c.entry.folder);
  if (!now || now.condition !== "awaiting" || !sameAsk(now.ask, c.ask)) return false;
  updateRun(c.entry.folder, { ask: { ...now.ask!, ...t } });
  return true;
}

/** The failed explain runs for this Ask. */
const failures = (c: Case, runs: Entry[]): number =>
  runs.filter((e) => e.run.kind === "explain" && e.run.on === c.on && e.run.question === questionOf(c) && /^failed:/.test(e.run.reason ?? "")).length;

const lockName = (on: string) => `explain-${on}`;
const lockOf = (run: Run): string | null => (run.on ? lockName(run.on) : null);

/** One explain run on one Ask. The line to log. */
async function explainOne(c: Case): Promise<string> {
  const release = await lock(lockName(c.on), 0);
  if (!release) return `${c.on}: another explain is running`;
  try {
    // Read again under the lock: another sweep may have tried it since.
    if (failures(c, allRuns()) >= EXPLAIN_TRIES()) return `${c.on}: gave up after ${EXPLAIN_TRIES()} failed explains`;
    const cwd = c.repo && existsSync(c.repo.path) ? c.repo.path : undefined;
    const run = openRun({
      role: "explain", who: "the explainer", model: EXPLAIN_MODEL, seconds: SECONDS,
      flags: ["--tools", "Read,Grep,Glob,Bash", "--allowedTools", ALLOWED.join(",")],
      cwd, name: `explain-${c.on}`, command: `explain ${c.on}: ${reasonName(c)}: ${questionOf(c)}`, shown: true, on: c.on,
    });
    updateRun(run.folder, { question: questionOf(c) });
    try {
      const t = parseExplain(await run.ask(explainPrompt(c)), actionsOf(c));
      if (typeof t === "string") { run.end(`failed: bad JSON: ${t}`); return `${c.on}: explain failed: ${t}`; }
      if (!store(c, t)) { run.end("the ask changed during the run"); return `${c.on}: the ask changed during the explain`; }
      run.end("explained");
      return `${c.on}: explained`;
    } catch (e: any) {
      run.end(`failed: ${e?.message ?? e}`);
      return `${c.on}: explain failed: ${e?.message ?? e}`;
    }
  } finally {
    release();
  }
}

/**
 * The tick's sweep: an explain run for each Ask with no situation, at most `ALEPH_EXPLAIN_CAP`, one after another.
 * The Asks whose explains failed `ALEPH_EXPLAIN_TRIES` times are left out. An error is logged, never thrown.
 */
export async function explainStep(repos: Repo[] = factoryRepos()): Promise<string[]> {
  const lines: string[] = [];
  try {
    await endLost("explain", lockOf, "its text");
    const runs = allRuns();
    const todo = pendingCases(repos, runs).filter((c) => failures(c, runs) < EXPLAIN_TRIES()).slice(0, Math.max(0, EXPLAIN_CAP()));
    for (const c of todo) lines.push(await explainOne(c));
  } catch (e: any) {
    lines.push(`explain: failed: ${e?.message ?? e}`);
  }
  if (lines.length) factoryLog(`explain: ${lines.join("; ")}`);
  return lines;
}
