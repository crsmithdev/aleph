/**
 * The firefighter: on each tick, code takes a snapshot of what needs watching (stuck and failed
 * runs, a goal that loops, a red main, runs whose process is gone). Asks are the director's
 * (director.ts), not the firefighter's,
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
import { missingSections } from "./goal-spec.ts";
import { allRuns, isAgentRun, isBuild, runsDir, loadRegistry, lock, onOf, type Entry, type Repo } from "./ledger.ts";
import { isLost } from "./process.ts";
import { endLost, openRun } from "./agent-run.ts";
import { allJobs, isOpen, issue as issueOf, lastReal, openJob, type Job } from "./job.ts";
import { itemOnMain, onMain } from "./status.ts";
import { sealedNote, writeRerun } from "./continuation.ts";
import { sealedVerdict, type Sealed } from "./acceptance.ts";
import { factoryDir, factoryRepos, redMains } from "./factory-status.ts";
import { factoryLog } from "./layout.ts";
import type { Fate } from "./outcome.ts";
import { drop as dropJob, refusal } from "./transitions.ts";
import { OPUS_MODEL } from "./agent-call.ts";
import { writeTitle } from "./title.ts";

export const FIREFIGHTER_MODEL = OPUS_MODEL;
/** The most actions one run may take; the rest are refused. */
export const MAX_ACTIONS = 10;
/** A goal with more than LOOP_RUNS agent runs started in LOOP_MS loops. */
const LOOP_RUNS = 3;
const LOOP_MS = 30 * 60_000;
const stateFile = () => join(factoryDir(), "firefighter.json");

export type EventKind = "stuck" | "failed" | "loop" | "red" | "lost";
/** One thing the snapshot found. `key` is what makes it new: it changes when the thing does. */
export interface Event { key: string; kind: EventKind; repo: string; job?: string; item?: number | string; line: string }

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
    // An awaiting run holds an Ask: the director's.
    if (r.condition === "stuck" || r.condition === "failed") {
      events.push({ key: `${r.condition}:${r.repo}/${last.id}`, kind: r.condition, ...at, line: `${r.name} is ${r.condition}${r.reason ? `: ${r.reason}` : ""}` });
    } else if (r.condition === "running" && isLost(last.folder)) {
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
      line: `${r.name} started ${runs.length} runs in 30 minutes: ${runs.map((e) => e.run.reason ?? e.run.condition).join("; ")}` });
  }
  const lists = store.reader();
  // GitHub CI: while the repo has an open red-main issue (its marker is an area, as `add` files it, or a label), its red main gives no event, as the fix is open. Otherwise one event per red head:
  // the key holds the streak's first failed commit and the head of the last red run, so a new head after a fix is a new event.
  const fixOpen = (repo: string) => (lists.list(repo)?.items ?? []).some((i) => issues.status(i) === "open" && (store.labels(i).includes("red-main") || store.areasOf(i).includes("red-main")));
  for (const r of redMains()) if (keys.has(r.repo) && (r.source === "baseline" || !fixOpen(r.repo))) events.push({ key: r.id, kind: "red", repo: r.repo, line: r.line });
  return events;
}

interface Saved { at: string; keys: string[] }
const lastSnapshot = (): Saved | null => { try { return JSON.parse(readFileSync(stateFile(), "utf8")); } catch { return null; } };
function saveSnapshot(events: Event[]): void {
  mkdirSync(factoryDir(), { recursive: true });
  writeFileSync(stateFile(), JSON.stringify({ at: new Date().toISOString(), keys: events.map((e) => e.key) }, null, 2) + "\n");
}

export type Action =
  | { do: "drop"; job: string; reason: string; after?: string[]; fate?: Fate }
  | { do: "close"; repo: string; n: number | string; note: string }
  | { do: "note"; repo: string; n: number | string; text: string }
  | { do: "add"; repo: string; title: string; body: string }
  | { do: "flake"; repo: string; text: string }
  | { do: "edit-goal"; repo: string; n: number | string; body?: string; after?: string[] }
  | { do: "tell"; text: string };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
/** An issue number: a whole `n` as a number, a plan child's `"<n>.<k>"` as that string (so `"1102.10"` stays apart from `"1102.1"`). */
const num = (v: unknown): number | string | null => {
  if (typeof v === "string" && /^\s*[1-9]\d*\.[1-9]\d*\s*$/.test(v)) return v.trim();
  return Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;
};
/** The issue ids (`<repo>-<n>` or `<repo>-<n>.<k>`) in a string, a comma list or an array: any other value is ignored, as triage's verdict ignores it. */
const refs = (v: unknown): string[] | undefined => {
  const all = (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((x) => text(x)).filter((x): x is string => !!x);
  const ok = all.filter((x) => /^[a-z0-9-]+-\d+(\.\d+)?$/.test(x));
  return ok.length ? ok : undefined;
};

/** One action from the reply's JSON, or why it is none. */
function parseAction(raw: any): Action | string {
  if (!raw || typeof raw !== "object") return "not an object";
  const f = (k: string) => text(raw[k]);
  const n = num(raw.n);
  const after = refs(raw.after);
  const fate = (["duplicate", "already-met", "by-hand"] as const).find((x) => x === raw.fate);
  switch (raw.do) {
    case "drop": return f("job") && f("reason") ? { do: "drop", job: f("job")!, reason: f("reason")!, ...(after ? { after } : {}), ...(fate ? { fate } : {}) } : "drop without a job and a reason";
    case "close": return f("repo") && n && f("note") ? { do: "close", repo: f("repo")!, n, note: f("note")! } : "close without a repo, n and note";
    case "note": return f("repo") && n && f("text") ? { do: "note", repo: f("repo")!, n, text: f("text")! } : "note without a repo, n and text";
    case "add": return f("repo") && f("title") ? { do: "add", repo: f("repo")!, title: f("title")!, body: f("body") ?? "" } : "add without a repo and a title";
    case "flake": return f("repo") && f("text") ? { do: "flake", repo: f("repo")!, text: f("text")! } : "flake without a repo and text";
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
  a.do === "drop" ? `drop ${a.job}: ${a.reason}${a.after ? ` (after ${a.after.join(", ")})` : ""}` : a.do === "close" ? `close ${a.repo}-${a.n}: ${a.note}` : a.do === "note" ? `note ${a.repo}-${a.n}: ${a.text}`
  : a.do === "add" ? `add ${a.repo}: ${a.title}` : a.do === "flake" ? `flake ${a.repo}: ${a.text}`
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
    const agent = j.findLast((x) => isAgentRun(x.run.kind)) ?? last;
    parts.push(`Run folder: ${last.folder}${agent !== last ? ` (agent run: ${agent.folder})` : ""}`);
    if (last.run.stat) parts.push(`Diff stat:\n${last.run.stat}`);
    for (const f of RUN_FILES) {
      const p = join(agent.folder, f);
      if (existsSync(p)) parts.push(`### ${f}\n${clip(readFileSync(p, "utf8").trim())}`);
    }
  }
  if (e.item !== undefined) {
    const item = store.reader().item(e.repo, e.item);
    if (item) parts.push(`### Issue ${e.repo}-${item.id}: ${item.title} [${store.areasOf(item).join(", ")}]\n${[item.request, item.spec].map((t) => t.trim()).filter(Boolean).join("\n\n") || "(no text)"}${item.notes.length ? `\n\nNotes:\n${item.notes.join("\n")}` : ""}`);
  }
  return parts.join("\n\n");
}

export function prompt(events: Event[], jobs = allJobs()): string {
  const red = events.some((e) => e.kind === "red");
  return `You are the factory's firefighter. You read what went wrong and say what to do; the code does it. You have read-only tools (Read, Grep, Glob, and Bash for \`aleph jobs\`, \`aleph issue show|list\`, \`aleph report\`, \`git log|show|diff\`). Change nothing yourself.

# The rules

- Asks (runs and issues that wait for Chris) are the director's, not yours: you see none.
- A land with a merge conflict, a run that loops with no commit, or a goal that is already met on main is fixed without Chris: drop the first two; for a goal already met on main use close (it drops the open job and marks the issue done), never sent to Chris.
- The firefighter files no follow-up issues. A flaky, slow or timing-out test that is not the run's own goal is a \`flake\` action: the code adds it as a note on the repo's flake tracker; Chris picks from that issue which flakes get a goal.${red ? `
- A red main is the one case for an issue: name the cause (the commit and the test or check that fails and why) in an \`add\` for that repo, with a title (${issues.TITLE_RULE}) and a body that says what to change. The body is the issue's spec and must have these three sections, or the code refuses the add and files nothing:
\`\`\`
## Goal
<the behaviour that holds once main is green, in at most 3 sentences>

## Edit surface
- <file>: <what changes there>

## Oracle
- <an observable clause, such as the test or check that passes>
\`\`\`
  The code files it as a high priority issue; the event is not looked at again, so without it the red stays unfixed. Use \`tell\` only to add words to it.` : ""}
- The \`## Goal\` of a spec you write (in an \`add\` or an \`edit-goal\` body) is the behaviour in at most 3 sentences, with no implementation design and no claim about code on main that you did not read. Oracle and Edit surface keep their detail.
- On a drop, set \`fate\` to already-met when the goal is met on main, and to duplicate when another goal did the work.
- When a run cannot pass until another open goal lands, drop it with \`after\` set to that goal, or use edit-goal with \`after\`. A note or a drop reason alone does not stop a rerun.
- At most ${MAX_ACTIONS} actions. No action is a fine answer when nothing needs doing.

# What is new since the last look

${events.map((e) => `## ${e.kind}: ${e.line}\n\n${context(e, jobs)}`).join("\n\n")}

Reply with one JSON object and nothing else: {"actions": [ ... ]}, each action one of
- {"do": "drop", "job": "<job name>", "reason": "<why; the next run reads it>", "after": ["<repo>-<n>.<k>", "optional: the open goals this waits for"], "fate": "optional: already-met when the goal is met on main, duplicate when another goal did the work"}
- {"do": "close", "repo": "<repo>", "n": <n> or "<n>.<k>", "note": "<why the goal is already met>"}
- {"do": "note", "repo": "<repo>", "n": <n> or "<n>.<k>", "text": "<note>"}
${red ? `- {"do": "add", "repo": "<repo>", "title": "<title>", "body": "<body>"}\n` : ""}- {"do": "flake", "repo": "<repo>", "text": "<test file> > <test name>: <what was seen>"}
- {"do": "edit-goal", "repo": "<repo>", "n": <n> or "<n>.<k>", "body": "<the new goal body, optional>", "after": ["<repo>-<n>.<k>", "optional: the open goals this waits for"]}
- {"do": "tell", "text": "<one sentence for Chris>"}
`;
}

/** How actions reach the factory; each returns the refusal, or null. Tests replace them. */
export interface Ports {
  drop: (name: string, reason: string, fate?: Fate) => Promise<string | null>;
  /** The item's sealed scenarios, checked against origin/<main>. */
  scenarios: (repo: Repo, name: string) => Promise<Sealed>;
}
export const defaultPorts: Ports = {
  drop: (name, reason, fate) => refusal(() => dropJob(name, { reason, quiet: true, fate })),
  scenarios: (repo, name) => sealedVerdict(repo, name),
};

/** The result of one action: applied, or refused (a line for Chris). */
type Outcome = { applied: string } | { refused: string };

const log = (line: string) => factoryLog(`firefighter: ${line}`);

/** Check one action against the rules and apply it. */
async function applyOne(a: Action, ports: Ports): Promise<Outcome> {
  const reg = loadRegistry();
  const repoOf = (key: string): Repo | null => (reg[key]?.sandbox ? reg[key] : null);
  if (a.do === "drop") {
    const runs = openJob(a.job);
    const last = runs && lastReal(runs);
    const repo = last?.run.repo ? repoOf(last.run.repo) : null;
    if (!runs || !last || !repo) return { refused: `${describe(a)}: no open factory job named ${a.job}` };
    const issue = issueOf(runs);
    // The reply may leave the fate off. A goal whose own commit (its Job or its Issue trailer) is on origin/main is met on main; a reason that names another goal of the repo already on main is work that goal did.
    const other = a.reason.match(new RegExp(`\\b${repo.key}-(\\d+)\\b`, "g"))?.map((r) => r.slice(repo.key.length + 1)).find((n) => Number(n) !== issue && itemOnMain(repo, Number(n)));
    const fate = a.fate ?? (onMain(repo, { job: last.run.job, item: issue, fetch: false }) ? "already-met" : other ? "duplicate" : undefined);
    const why = await ports.drop(a.job, a.reason, fate);
    if (why) return { refused: `${describe(a)}: ${why}` };
    writeRerun(a.job, `The last run was dropped by the firefighter: ${a.reason}`);
    // A run that cannot pass until another goal lands waits on it: the dispatch reads the goal's after and starts nothing until it is done.
    const waits = a.after && typeof issue === "number" ? await refusal(async () => verbs.edit(repo, issue, { after: a.after })) : null;
    if (issue !== undefined) store.note(repo, issue, `firefighter: dropped ${a.job}: ${a.reason}${a.after ? `; after ${a.after.join(", ")}` : ""}`);
    return waits ? { refused: `${describe(a)}: dropped, but after not set: ${waits}` } : { applied: describe(a) };
  }
  if (a.do === "tell") return { applied: describe(a) };
  const repo = repoOf(a.repo);
  if (!repo) return { refused: `${describe(a)}: ${a.repo} is not a factory repo` };
  // Chris turned off follow-up issues until the inbox of aleph-826, but a red main must reach a fix: an add is filed only for a repo whose main is red now.
  if (a.do === "add") {
    const red = redMains().some((r) => r.repo === repo.key);
    if (!red) return { refused: `${describe(a)}: the firefighter files no issues except for a red main; use tell` };
    const missing = missingSections(a.body ?? "");
    if (missing.length) return { refused: `${describe(a)}: the body lacks ${missing.map((h) => `## ${h}`).join(", ")}; the spec check needs ## Goal, ## Edit surface and ## Oracle` };
    // A title that already keeps the rule is kept, so the same red main finds its open issue again.
    const title = issues.titleProblem(a.title) ? await writeTitle(a.title) : a.title;
    const w = store.writeList(repo, "todo: red main", (doc) => {
      const same = doc.items.find((i) => i.title === title && issues.status(i) === "open");
      if (same) { issues.note(same, `firefighter: still red: ${a.body}`); return same.id; }
      return issues.add(doc, title, { kind: "bug", priority: "high", labels: ["red-main"], spec: a.body || a.title }).id;
    }, true);
    return w ? { applied: `${describe(a)} (${repo.key}-${w.value})` } : { refused: `${describe(a)}: no issue written` };
  }
  if (a.do === "flake") {
    const r = store.noteFlake(repo, `firefighter: ${a.text}`);
    return typeof r === "string" ? { refused: `${describe(a)}: ${r}` } : { applied: `${describe(a)} (${repo.key}-${r.id})` };
  }
  const item = store.reader().item(repo.key, a.n);
  if (!item || issues.status(item) !== "open") return { refused: `${describe(a)}: no open issue ${repo.key}-${a.n}` };
  if (a.do === "close") {
    // The sealed scenarios, if any, pass on origin/<main> before the item closes as already met.
    const sealed = await ports.scenarios(repo, `${repo.key}-${a.n}`);
    if (sealed.state === "infra") return { refused: `${describe(a)}: the sealed scenario check failed: ${sealed.fault}; the issue stays open` };
    const open0 = allJobs().find((j) => isOpen(j) && j[0].run.repo === repo.key && issueOf(j) === a.n);
    if (sealed.state === "fail") {
      const text = sealedNote(sealed.failed, repo.main);
      if (open0) {
        const why = await ports.drop(open0[0].run.name, text);
        if (why) return { refused: `${describe(a)}: sealed scenarios ${sealed.failed.join(", ")} fail: ${why}` };
        writeRerun(open0[0].run.name, text);
      }
      const bad = open0 ? null : store.note(repo, a.n, `firefighter: close refused: ${text}`);
      return { refused: `${describe(a)}: sealed scenario${sealed.failed.length > 1 ? "s" : ""} ${sealed.failed.join(", ")} fail${sealed.failed.length > 1 ? "" : "s"}; ${open0 ? "dropped the job with a rerun note" : "noted on the issue"}${bad ? ` (no issue note: ${bad})` : ""}` };
    }
    const open = allJobs().find((j) => isOpen(j) && j[0].run.repo === repo.key && issueOf(j) === a.n);
    if (open) {
      const why = await ports.drop(open[0].run.name, `closed by the firefighter: ${a.note}`, "already-met");
      if (why) return { refused: `${describe(a)}: ${why}` };
    }
    const why = store.note(repo, a.n, `firefighter: closed: ${a.note}`, { done: true });
    return why ? { refused: `${describe(a)}: ${why}` } : { applied: describe(a) };
  }
  if (a.do === "note") {
    const why = store.note(repo, a.n, `firefighter: ${a.text}`);
    return why ? { refused: `${describe(a)}: ${why}` } : { applied: describe(a) };
  }
  const list = store.reader().list(repo.key);
  if (list && store.partsOf(list, item).length) return { refused: `${describe(a)}: it has parts` };
  const why = await refusal(async () => verbs.edit(repo, a.n, { ...(a.body !== undefined ? { spec: a.body } : {}), ...(a.after ? { after: a.after } : {}) }));
  return why ? { refused: `${describe(a)}: ${why}` } : { applied: describe(a) };
}

/** Apply the reply's actions in order, at most MAX_ACTIONS; every outcome is a factory log line. */
export async function applyActions(actions: (Action | string)[], ports: Ports = defaultPorts): Promise<{ applied: string[]; refused: string[] }> {
  const out = { applied: [] as string[], refused: [] as string[] };
  for (const [i, a] of actions.entries()) {
    let o: Outcome;
    if (i >= MAX_ACTIONS) o = { refused: `${typeof a === "string" ? a : describe(a)}: more than ${MAX_ACTIONS} actions in one run` };
    else if (typeof a === "string") o = { refused: `a malformed action: ${a}` };
    else {
      try { o = await applyOne(a, ports); } catch (e: any) { o = { refused: `${describe(a)}: ${e?.message ?? e}` }; }
    }
    if ("applied" in o) { out.applied.push(o.applied); log(o.applied.startsWith("tell: ") ? o.applied : `did ${o.applied}`); }
    else { out.refused.push(o.refused); log(`tell: refused ${o.refused}`); }
  }
  return out;
}

const READ_ONLY = ["Read", "Grep", "Glob", "Bash(aleph jobs:*)", "Bash(aleph issue show:*)", "Bash(aleph issue list:*)", "Bash(aleph report:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git diff:*)"];

export interface Fired { events: string[]; run?: string; applied: string[]; refused: string[]; skipped?: string }

/**
 * One look: the snapshot, and one firefighter run when it holds an event the last one lacked.
 * The snapshot is saved either way, so an event is judged once; one that clears and comes back is new again.
 */
export async function firefight(ports: Ports = defaultPorts, now = Date.now()): Promise<Fired> {
  await endLost("firefighter", () => "firefighter");
  const release = await lock("firefighter", 0);
  if (!release) return { events: [], applied: [], refused: [], skipped: "another firefighter is running" };
  try {
    const events = snapshot(now);
    const seen = new Set(lastSnapshot()?.keys ?? []);
    const fresh = events.filter((e) => !seen.has(e.key));
    saveSnapshot(events);
    if (!fresh.length) return { events: [], applied: [], refused: [] };
    const dirs = factoryRepos().flatMap((r) => ["--add-dir", r.path]);
    const run = openRun({ role: "firefighter", who: "firefighter", model: FIREFIGHTER_MODEL, seconds: 900, flags: ["--tools", "Read", "Grep", "Glob", "Bash", "--allowedTools", ...READ_ONLY, ...dirs], cwd: runsDir(), name: "firefighter", command: `firefighter: ${fresh.length} new event${fresh.length > 1 ? "s" : ""}`, shown: true });
    const end = (reason: string) => run.end(reason);
    const base = { events: fresh.map((e) => e.line), run: run.folder.split("/").at(-1)! };
    let reply: (Action | string)[] | string;
    try { reply = parseReply(await run.ask(prompt(fresh))); } catch (e: any) {
      end(`failed: ${e?.message ?? e}`);
      log(`failed: ${e?.message ?? e}`);
      return { ...base, applied: [], refused: [] };
    }
    if (typeof reply === "string") { end(`malformed reply: ${reply}`); log(`malformed reply: ${reply}`); return { ...base, applied: [], refused: [] }; }
    const r = await applyActions(reply, ports);
    end(`${r.applied.length} applied, ${r.refused.length} refused`);
    return { ...base, ...r };
  } finally {
    release();
  }
}
