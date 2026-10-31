/**
 * The firefighter: on each tick, code takes a snapshot of what needs watching (held, stuck and
 * failed runs, a goal that loops, a red main, issues with an Ask, runs whose process is gone),
 * and only when it has an event the last snapshot lacked does one read-only `claude -p` run
 * judge them. It returns typed actions; code checks each against the rules below and applies it
 * through the existing transitions and the work store, in order. Each run is a job in the
 * ledger, kind `firefighter`. See docs/specs/2026-10-26-seed-factory.md, "Firefighter".
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import * as store from "../../todo/lib/store.ts";
import * as verbs from "../../todo/lib/issues.ts";
import { allRuns, askOf, isAwaiting, isBuild, isLost, runsDir, loadRegistry, lock, onOf, readRun, reviewOf, stamp, tell, updateRun, writeRun, type Entry, type Repo } from "./ledger.ts";
import { allJobs, isOpen, issue as issueOf, lastReal, markAsked, openJob, readFile, type Job } from "./job.ts";
import { replyOf, SECURITY_PATHS, securityChange, verdict as reviewVerdict } from "./gate.ts";
import { git } from "./git.ts";
import { factoryDir, factoryLog, factoryRepos, redBaselines, writeRerun } from "./factory.ts";
import { ciLine, redCi } from "./ci.ts";
import { drop as dropJob, land as landJob, refusal } from "./transitions.ts";
import { always, handed, logAlways, readAlways } from "./always.ts";

export const FIREFIGHTER_MODEL = "claude-opus-5-5";
/** The most actions one run may take; the rest are refused. */
export const MAX_ACTIONS = 10;
/** A goal with more than LOOP_RUNS agent runs started in LOOP_MS loops. */
const LOOP_RUNS = 3;
const LOOP_MS = 30 * 60_000;
const TIME_BOX_MS = () => Number(process.env.ALEPH_FIREFIGHTER_TIMEOUT ?? 900) * 1000;
const stateFile = () => join(factoryDir(), "firefighter.json");

export type EventKind = "awaiting" | "stuck" | "failed" | "loop" | "red" | "ask" | "lost";
/**
 * One thing the snapshot found. `key` is what makes it new: it changes when the thing does.
 * `reason` is the reason code it waits for; `handed` marks one whose reason Chris handed to the firefighter (always.json).
 */
export interface Event { key: string; kind: EventKind; repo: string; job?: string; item?: number | string; line: string; reason?: string; handed?: boolean }

/** Marks an event whose reason Chris handed to the firefighter, and says so on its line. */
const hand = (e: Event): Event => (e.reason && handed(e.reason) ? { ...e, handed: true, line: `${e.line} (handed to you by Chris)` } : e);

/** What the snapshot sees now, in factory repos. */
export function snapshot(now = Date.now()): Event[] {
  const repos = factoryRepos();
  const keys = new Set(repos.map((r) => r.key));
  const events: Event[] = [];
  for (const j of allJobs()) {
    const last = lastReal(j);
    const r = last.run;
    if (!r.repo || !keys.has(r.repo) || !isOpen(j)) continue;
    const item = issueOf(j);
    const at = { repo: r.repo, job: r.name, ...(item !== undefined ? { item } : {}) };
    if (isAwaiting(r.state) || r.state === "stuck" || r.state === "failed") {
      const reason = isAwaiting(r.state) ? askOf(r)?.reason : undefined;
      events.push(hand({ key: `${r.state}:${r.repo}/${last.id}`, kind: isAwaiting(r.state) ? "awaiting" : r.state as "stuck" | "failed", ...at, ...(reason ? { reason } : {}), line: `${r.name} is ${r.state}${reason ? ` (${reason})` : ""}${r.reason ? `: ${r.reason}` : ""}` }));
    } else if (r.state === "running" && isLost(last.folder)) {
      events.push({ key: `lost:${r.repo}/${last.id}`, kind: "lost", ...at, line: `${r.name}: its ${r.kind} run ${last.id} is running, but its process is gone` });
    }
  }
  const byGoal = new Map<string, Entry[]>();
  for (const e of allRuns()) {
    if (!isBuild(e.run.kind) || !e.run.repo || !keys.has(e.run.repo) || now - Date.parse(e.run.started) > LOOP_MS) continue;
    const k = `${e.run.repo}/${e.run.name}`;
    byGoal.set(k, [...(byGoal.get(k) ?? []), e]);
  }
  for (const [k, runs] of byGoal) {
    if (runs.length <= LOOP_RUNS) continue;
    const r = runs.at(-1)!.run;
    events.push({ key: `loop:${k}:${runs.at(-1)!.id}`, kind: "loop", repo: r.repo!, job: r.name, ...(onOf(r) !== undefined ? { item: onOf(r)! } : {}),
      line: `${r.name} started ${runs.length} runs in 30 minutes: ${runs.map((e) => e.run.reason ?? e.run.state).join("; ")}` });
  }
  for (const b of redBaselines()) if (keys.has(b.repo)) events.push({ key: `red:${b.repo}:${b.commit}`, kind: "red", repo: b.repo, line: `${b.repo} main is red at ${b.commit.slice(0, 7)}: ${b.failed}` });
  // GitHub CI: one event per red streak, keyed by its first failed commit.
  for (const c of redCi()) if (keys.has(c.repo)) events.push({ key: `ci:${c.repo}:${c.sinceSha}`, kind: "red", repo: c.repo, line: ciLine(c) });
  const lists = store.reader();
  for (const repo of repos) {
    for (const item of lists.list(repo.key)?.items ?? []) {
      const ask = store.askOf(item);
      if (issues.status(item) !== "open" || !ask) continue;
      events.push(hand({ key: `ask:${repo.key}-${item.id}:${item.notes.length}`, kind: "ask", repo: repo.key, item: item.id, reason: ask.reason, line: `${repo.key}-${item.id} ${item.title} waits for Chris (${ask.reason}): ${ask.question || item.notes.at(-1) || ""}` }));
    }
  }
  return events;
}

interface Saved { at: string; keys: string[] }
const lastSnapshot = (): Saved | null => { try { return JSON.parse(readFileSync(stateFile(), "utf8")); } catch { return null; } };
function saveSnapshot(events: Event[]): void {
  mkdirSync(factoryDir(), { recursive: true });
  writeFileSync(stateFile(), JSON.stringify({ at: new Date().toISOString(), keys: events.map((e) => e.key) }, null, 2) + "\n");
}

export type Action =
  | { do: "land"; job: string }
  | { do: "drop"; job: string; reason: string; after?: string[] }
  | { do: "close"; repo: string; n: number; note: string }
  | { do: "note"; repo: string; n: number; text: string }
  | { do: "add"; repo: string; title: string; body: string }
  | { do: "flake"; repo: string; text: string }
  | { do: "answer"; repo: string; n: number; note: string; after?: string[] }
  | { do: "edit-goal"; repo: string; n: number; body?: string; after?: string[] }
  | { do: "tell"; text: string };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
/** The goal ids (`<repo>-<n>.<k>`) in a string, a comma list or an array: any other value is ignored, as triage's verdict ignores it. */
const refs = (v: unknown): string[] | undefined => {
  const all = (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((x) => text(x)).filter((x): x is string => !!x);
  const ok = all.filter((x) => /^[a-z0-9-]+-\d+\.\d+$/.test(x));
  return ok.length ? ok : undefined;
};

/** One action from the reply's JSON, or why it is none. */
function parseAction(raw: any): Action | string {
  if (!raw || typeof raw !== "object") return "not an object";
  const f = (k: string) => text(raw[k]);
  const n = num(raw.n);
  const after = refs(raw.after);
  switch (raw.do) {
    case "land": return f("job") ? { do: "land", job: f("job")! } : "land without a job";
    case "drop": return f("job") && f("reason") ? { do: "drop", job: f("job")!, reason: f("reason")!, ...(after ? { after } : {}) } : "drop without a job and a reason";
    case "close": return f("repo") && n && f("note") ? { do: "close", repo: f("repo")!, n, note: f("note")! } : "close without a repo, n and note";
    case "note": return f("repo") && n && f("text") ? { do: "note", repo: f("repo")!, n, text: f("text")! } : "note without a repo, n and text";
    case "add": return f("repo") && f("title") ? { do: "add", repo: f("repo")!, title: f("title")!, body: f("body") ?? "" } : "add without a repo and a title";
    case "flake": return f("repo") && f("text") ? { do: "flake", repo: f("repo")!, text: f("text")! } : "flake without a repo and text";
    case "answer": return f("repo") && n && f("note") ? { do: "answer", repo: f("repo")!, n, note: f("note")!, ...(after ? { after } : {}) } : "answer without a repo, n and note";
    case "edit-goal": return f("repo") && n && (f("body") || after) ? { do: "edit-goal", repo: f("repo")!, n, ...(f("body") ? { body: f("body")! } : {}), ...(after ? { after } : {}) } : "edit-goal without a repo, n, and a body or after";
    case "tell": return f("text") ? { do: "tell", text: f("text")! } : "tell without text";
    default: return `unknown action ${JSON.stringify(raw.do)}`;
  }
}

/** The actions in the command's output (the whole output, or its outermost braces), each parsed or why not; a string when there is no list. */
export function parseReply(output: string): (Action | string)[] | string {
  let raw: any;
  for (const s of [output.trim(), output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)]) {
    try { raw = JSON.parse(s); break; } catch {}
  }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.actions)) return "no JSON object with an actions list";
  return raw.actions.map(parseAction);
}

export const describe = (a: Action): string =>
  a.do === "land" ? `land ${a.job}` : a.do === "drop" ? `drop ${a.job}: ${a.reason}${a.after ? ` (after ${a.after.join(", ")})` : ""}` : a.do === "close" ? `close ${a.repo}-${a.n}: ${a.note}` : a.do === "note" ? `note ${a.repo}-${a.n}: ${a.text}`
  : a.do === "add" ? `add ${a.repo}: ${a.title}` : a.do === "flake" ? `flake ${a.repo}: ${a.text}` : a.do === "answer" ? `answer ${a.repo}-${a.n}: ${a.note}${a.after ? ` (after ${a.after.join(", ")})` : ""}`
  : a.do === "edit-goal" ? `edit-goal ${a.repo}-${a.n}${a.after ? ` (after ${a.after.join(", ")})` : ""}` : `tell: ${a.text}`;

const MAX_FILE = 4000;
const clip = (s: string) => (s.length > MAX_FILE ? `…${s.slice(-MAX_FILE)}` : s);
const RUN_FILES = ["review.md", "call.md", "browser/report.md", "result.md"];

/** The run folders and issue bodies an event needs, as prompt text. */
function context(e: Event, jobs: Job[]): string {
  const parts: string[] = [];
  const j = e.job ? jobs.findLast((x) => x[0].run.repo === e.repo && x[0].run.name === e.job) : undefined;
  if (j) {
    const last = lastReal(j);
    const agent = j.findLast((x) => isBuild(x.run.kind) || x.run.kind === "recheck") ?? last;
    parts.push(`Run folder: ${last.folder}${agent !== last ? ` (agent run: ${agent.folder})` : ""}`);
    if (last.run.stat) parts.push(`Diff stat:\n${last.run.stat}`);
    for (const f of RUN_FILES) {
      const p = join(agent.folder, f);
      if (existsSync(p)) parts.push(`### ${f}\n${clip(readFileSync(p, "utf8").trim())}`);
    }
  }
  if (e.item !== undefined) {
    const item = store.reader().item(e.repo, e.item);
    if (item) parts.push(`### Issue ${e.repo}-${item.id}: ${item.title} [${store.areasOf(item).join(", ")}]\n${item.body.trim() || "(no body)"}${item.notes.length ? `\n\nNotes:\n${item.notes.join("\n")}` : ""}`);
  }
  return parts.join("\n\n");
}

export function prompt(events: Event[], jobs = allJobs()): string {
  const handedReasons = Object.keys(readAlways()).filter((r) => handed(r));
  const handedRule = handedReasons.length
    ? `\n- Chris has handed these reasons to you: ${handedReasons.join(", ")}. Decide every event marked handed yourself: land, drop, answer, edit-goal or close, by the rules above; do not send it back to Chris.`
    : "";
  return `You are the factory's firefighter. You read what went wrong and say what to do; the code does it. You have read-only tools (Read, Grep, Glob, and Bash for \`aleph jobs\`, \`aleph issue show|list\`, \`aleph report\`, \`git log|show|diff\`). Change nothing yourself.

# The rules

- Land a held run once both reviews have a verdict and say land, unless its diff changes a held security path (${SECURITY_PATHS.join(", ")}). The code refuses those and sends them to Chris${always("firefighter")?.action === "land" ? ", except that Chris has let you land them" : ""}.
- Drop a run a reviewer sent back, with the reviewer's reason as the drop's reason: it becomes the next run's note.
- A land with a merge conflict, a run that loops with no commit, or a goal that is already met on main is fixed without Chris: drop the first two; for a goal already met on main use close (it drops the open job and marks the issue done), never sent to Chris.
- A how-to-build question (code structure, which module, naming, test shape, whether to wait for an issue) is yours to decide: answer with the decision. A product choice (what the product does for Chris, what he sees, what it costs, what comes first) stays with Chris, unless Chris has handed its reason to you.
- File a follow-up as an issue with add, except a flaky, slow or timing-out test that is not the run's own goal: that is a \`flake\` action, never an \`add\`. The code adds it as a note on the repo's flake tracker; Chris picks from that issue which flakes get a goal.
- When a run cannot pass until another open goal lands, drop it with \`after\` set to that goal, or use edit-goal with \`after\`. A note or a drop reason alone does not stop a rerun.
- When you answer an Ask on an item whose \`after\` is done or wrong, set \`after\` to the open goals that really block it.
- At most ${MAX_ACTIONS} actions. No action is a fine answer when nothing needs doing.${handedRule}

# What is new since the last look

${events.map((e) => `## ${e.kind}: ${e.line}\n\n${context(e, jobs)}`).join("\n\n")}

Reply with one JSON object and nothing else: {"actions": [ ... ]}, each action one of
- {"do": "land", "job": "<job name>"}
- {"do": "drop", "job": "<job name>", "reason": "<why; the next run reads it>", "after": ["<repo>-<n>.<k>", "optional: the open goals this waits for"]}
- {"do": "close", "repo": "<repo>", "n": <issue number>, "note": "<why the goal is already met>"}
- {"do": "note", "repo": "<repo>", "n": <issue number>, "text": "<note>"}
- {"do": "add", "repo": "<repo>", "title": "<title>", "body": "<body>"}
- {"do": "flake", "repo": "<repo>", "text": "<test file> > <test name>: <what was seen>"}
- {"do": "answer", "repo": "<repo>", "n": <issue number>, "note": "<the decision>", "after": ["<optional <repo>-<n>.<k>: the open goals it really waits for>"]}
- {"do": "edit-goal", "repo": "<repo>", "n": <issue number>, "body": "<the new goal body, optional>", "after": ["<repo>-<n>.<k>", "optional: the open goals this waits for"]}
- {"do": "tell", "text": "<one sentence for Chris>"}
`;
}

/** A held security path the branch changes, or null; "unknown" when there is no branch to read. */
export function securityPath(repo: Repo, branch: string | undefined): string | null | "unknown" {
  if (!branch || !git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${branch}`).ok) return "unknown";
  const main = git(repo.path, "rev-parse", "--verify", "-q", `origin/${repo.main}`).ok ? `origin/${repo.main}` : repo.main;
  const fork = git(repo.path, "merge-base", main, `refs/heads/${branch}`);
  return fork.ok ? securityChange(repo.path, fork.out, `refs/heads/${branch}`) : "unknown";
}

/** Whether an item's Ask is a product choice: it offers options to pick from (triage's `chris` verdict and the rescue write them). A plain question has none. */
export const isProductChoice = (item: issues.Issue): boolean => (store.askOf(item)?.options.length ?? 0) > 0;

/** The reason code an item's Ask waits for, or null when it has none. */
export const reasonOf = (item: issues.Issue): string | null => store.askOf(item)?.reason ?? null;

/** How actions reach the factory; each returns the refusal, or null. Tests replace land and drop. */
export interface Ports {
  land: (name: string) => Promise<string | null>;
  drop: (name: string, reason: string) => Promise<string | null>;
  tell: (line: string) => Promise<boolean>;
}
export const defaultPorts: Ports = {
  land: (name) => refusal(async () => { await (await landJob(name, { lander: "firefighter" }, { output: "ignore" })).child?.exited; }),
  drop: (name, reason) => refusal(() => dropJob(name, { reason, quiet: true })),
  tell,
};

/** The result of one action: applied, refused (a line for Chris), or sent to Chris as an Ask. */
type Outcome = { applied: string } | { refused: string } | { chris: string };

const log = (line: string) => factoryLog(`firefighter: ${line}`);

/** Check one action against the rules and apply it. */
async function applyOne(a: Action, ports: Ports): Promise<Outcome> {
  const reg = loadRegistry();
  const repoOf = (key: string): Repo | null => (reg[key]?.sandbox ? reg[key] : null);
  if (a.do === "land" || a.do === "drop") {
    const runs = openJob(a.job);
    const last = runs && lastReal(runs);
    const repo = last?.run.repo ? repoOf(last.run.repo) : null;
    if (!runs || !last || !repo) return { refused: `${describe(a)}: no open factory job named ${a.job}` };
    const issue = issueOf(runs);
    if (a.do === "drop") {
      const why = await ports.drop(a.job, a.reason);
      if (why) return { refused: `${describe(a)}: ${why}` };
      writeRerun(a.job, `The last run was dropped by the firefighter: ${a.reason}`);
      // A run that cannot pass until another goal lands waits on it: the dispatch reads the goal's after and starts nothing until it is done.
      const waits = a.after && typeof issue === "number" ? await refusal(async () => verbs.edit(repo, issue, { after: a.after })) : null;
      if (issue !== undefined) store.note(repo, issue, `firefighter: dropped ${a.job}: ${a.reason}${a.after ? `; after ${a.after.join(", ")}` : ""}`);
      return waits ? { refused: `${describe(a)}: dropped, but after not set: ${waits}` } : { applied: describe(a) };
    }
    const agent = runs.findLast((e) => isBuild(e.run.kind) || e.run.kind === "recheck") ?? last;
    if (!reviewVerdict(readFile(agent, "review.md") ?? "")) return { refused: `${describe(a)}: the reviewer has no verdict yet` };
    const r2 = reviewOf(agent);
    if (!r2 || r2.call === "pending" || r2.call === "error") return { refused: `${describe(a)}: review has no verdict yet` };
    if (r2.call !== "land") return { refused: `${describe(a)}: review says ${r2.call}${r2.reason ? ` (${r2.reason})` : ""}` };
    const held = securityPath(repo, agent.run.branch);
    // Chris let the firefighter land held security paths: the check is skipped, and the land is logged. An unknown branch still goes to Chris.
    const granted = held !== null && held !== "unknown" && always("firefighter")?.action === "land";
    if (held && granted) logAlways("firefighter", "land", a.job);
    if (held && !granted) {
      const sentence = held === "unknown"
        ? `${a.job} cannot be checked for held security paths, as its branch is gone, so it needs you to land or drop it.`
        : `${a.job} changes ${held}, a held security path, so it needs your review before it lands.`;
      markAsked(last, sentence);
      if (issue !== undefined) store.note(repo, issue, `asks Chris: ${sentence}`, { ask: { kind: "approval", reason: "held-path", question: sentence, options: [], why: [] } });
      await ports.tell(`${repo.key}/${a.job}: asks Chris: ${sentence}`);
      return { chris: sentence };
    }
    const why = await ports.land(a.job);
    return why ? { refused: `${describe(a)}: ${why}` } : { applied: describe(a) };
  }
  if (a.do === "tell") return { applied: describe(a) };
  const repo = repoOf(a.repo);
  if (!repo) return { refused: `${describe(a)}: ${a.repo} is not a factory repo` };
  // Chris turned this off until the inbox of aleph-826: the firefighter files no issue.
  if (a.do === "add") return { refused: `${describe(a)}: the firefighter files no issues; use tell` };
  if (a.do === "flake") {
    const r = store.noteFlake(repo, `firefighter: ${a.text}`);
    return typeof r === "string" ? { refused: `${describe(a)}: ${r}` } : { applied: `${describe(a)} (${repo.key}-${r.id})` };
  }
  const item = store.reader().item(repo.key, a.n);
  if (!item || issues.status(item) !== "open") return { refused: `${describe(a)}: no open issue ${repo.key}-${a.n}` };
  if (a.do === "close") {
    const open = allJobs().find((j) => isOpen(j) && j[0].run.repo === repo.key && issueOf(j) === a.n);
    if (open) {
      const why = await ports.drop(open[0].run.name, `closed by the firefighter: ${a.note}`);
      if (why) return { refused: `${describe(a)}: ${why}` };
    }
    const why = store.note(repo, a.n, `firefighter: closed: ${a.note}`, { done: true });
    return why ? { refused: `${describe(a)}: ${why}` } : { applied: describe(a) };
  }
  if (a.do === "note") {
    const why = store.note(repo, a.n, `firefighter: ${a.text}`);
    return why ? { refused: `${describe(a)}: ${why}` } : { applied: describe(a) };
  }
  if (a.do === "answer") {
    const ask = store.askOf(item);
    if (!ask) return { refused: `${describe(a)}: it has no Ask` };
    // A question that offers options is a product choice: it is Chris's unless he handed its reason to the firefighter.
    if (isProductChoice(item) && !handed(ask.reason)) return { refused: `${describe(a)}: its question is a product choice, which is Chris's` };
    const why = await refusal(async () => verbs.decide(repo, a.n, `firefighter decided: ${a.note}`, a.after ? { after: a.after } : {}));
    return why ? { refused: `${describe(a)}: ${why}` } : { applied: describe(a) };
  }
  if (store.kindOf(item) !== "goal") return { refused: `${describe(a)}: it is not a goal` };
  const why = await refusal(async () => verbs.edit(repo, a.n, { ...(a.body !== undefined ? { body: a.body } : {}), ...(a.after ? { after: a.after } : {}) }));
  return why ? { refused: `${describe(a)}: ${why}` } : { applied: describe(a) };
}

/** Apply the reply's actions in order, at most MAX_ACTIONS; every outcome is a factory log line. */
export async function applyActions(actions: (Action | string)[], ports: Ports = defaultPorts): Promise<{ applied: string[]; refused: string[]; chris: string[] }> {
  const out = { applied: [] as string[], refused: [] as string[], chris: [] as string[] };
  for (const [i, a] of actions.entries()) {
    let o: Outcome;
    if (i >= MAX_ACTIONS) o = { refused: `${typeof a === "string" ? a : describe(a)}: more than ${MAX_ACTIONS} actions in one run` };
    else if (typeof a === "string") o = { refused: `a malformed action: ${a}` };
    else {
      try { o = await applyOne(a, ports); } catch (e: any) { o = { refused: `${describe(a)}: ${e?.message ?? e}` }; }
    }
    if ("applied" in o) { out.applied.push(o.applied); log(o.applied.startsWith("tell: ") ? o.applied : `did ${o.applied}`); }
    else if ("chris" in o) { out.chris.push(o.chris); log(`asks Chris: ${o.chris}`); }
    else { out.refused.push(o.refused); log(`tell: refused ${o.refused}`); }
  }
  return out;
}

/** Make the run folder of a firefighter run: its own job in the ledger. */
function makeRun(events: Event[]): string {
  mkdirSync(runsDir(), { recursive: true });
  for (let n = 0; ; n++) {
    const folder = join(runsDir(), `${stamp()}-firefighter${n ? `-${n}` : ""}-firefighter`);
    try { mkdirSync(folder); } catch (e: any) { if (e.code === "EEXIST") continue; throw e; }
    writeRun(folder, { kind: "firefighter", job: folder.split("/").at(-1)!, name: "firefighter", state: "running", phase: "firefighter", model: FIREFIGHTER_MODEL, told: true, shown: true, started: new Date().toISOString(), made: Date.now() });
    writeFileSync(join(folder, "command.txt"), `firefighter: ${events.length} new event${events.length > 1 ? "s" : ""}\n`);
    return folder;
  }
}

const READ_ONLY = ["Read", "Grep", "Glob", "Bash(aleph jobs:*)", "Bash(aleph issue show:*)", "Bash(aleph issue list:*)", "Bash(aleph report:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git diff:*)"];

async function ask(input: string, folder: string): Promise<string> {
  writeFileSync(join(folder, "prompt.md"), input);
  const dirs = factoryRepos().flatMap((r) => ["--add-dir", r.path]);
  const argv = [process.env.ALEPH_FIREFIGHTER_CMD ?? "claude", "-p", "--output-format", "stream-json", "--verbose", "--model", FIREFIGHTER_MODEL, "--tools", "Read", "Grep", "Glob", "Bash", "--allowedTools", ...READ_ONLY, ...dirs];
  const p = Bun.spawn(argv, { cwd: runsDir(), env: process.env, stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => p.kill(), TIME_BOX_MS());
  try {
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    writeFileSync(join(folder, "output.log"), out + err);
    const { text, cost } = replyOf(out);
    if (cost !== undefined) updateRun(folder, { cost });
    if (code !== 0) throw new Error(`firefighter exited ${code}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export interface Fired { events: string[]; run?: string; applied: string[]; refused: string[]; chris: string[]; skipped?: string }

/**
 * One look: the snapshot, and one firefighter run when it holds an event the last one lacked.
 * The snapshot is saved either way, so an event is judged once; one that clears and comes back is new again.
 */
export async function firefight(ports: Ports = defaultPorts, now = Date.now()): Promise<Fired> {
  const release = await lock("firefighter", 0);
  if (!release) return { events: [], applied: [], refused: [], chris: [], skipped: "another firefighter is running" };
  try {
    endLost();
    const events = snapshot(now);
    const seen = new Set(lastSnapshot()?.keys ?? []);
    const fresh = events.filter((e) => !seen.has(e.key));
    saveSnapshot(events);
    if (!fresh.length) return { events: [], applied: [], refused: [], chris: [] };
    const folder = makeRun(fresh);
    const end = (reason: string) => updateRun(folder, { state: "done", reason, phase: undefined, ended: new Date().toISOString() });
    const base = { events: fresh.map((e) => e.line), run: folder.split("/").at(-1)! };
    let reply: (Action | string)[] | string;
    try { reply = parseReply(await ask(prompt(fresh), folder)); } catch (e: any) {
      end(`failed: ${e?.message ?? e}`);
      log(`failed: ${e?.message ?? e}`);
      return { ...base, applied: [], refused: [], chris: [] };
    }
    if (typeof reply === "string") { end(`malformed reply: ${reply}`); log(`malformed reply: ${reply}`); return { ...base, applied: [], refused: [], chris: [] }; }
    const r = await applyActions(reply, ports);
    end(`${r.applied.length} applied, ${r.refused.length} refused, ${r.chris.length} to Chris`);
    return { ...base, ...r };
  } finally {
    release();
  }
}

/** End the firefighter runs left `running` by a process that died: the caller holds the firefighter lock, so none is live. */
function endLost(): void {
  for (const { folder, run } of allRuns()) {
    if (run.kind !== "firefighter" || run.state !== "running") continue;
    if (readRun(folder)?.state === "running") updateRun(folder, { state: "done", phase: undefined, reason: "failed: its process ended before a reply", ended: new Date().toISOString() });
  }
}
