/**
 * Correction signals, the procedural memory (docs/vault.md):
 * Chris's messages that push back on the assistant, the verify-gate's denials
 * and the reviewer's drop reasons of the last 14 days, grouped into lessons by
 * Jev. The store is corrections.json in the factory directory.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { langfuse, type Langfuse } from "../../../lib/langfuse.ts";
import { decide, nouls } from "../../../lib/jev.ts";
import type { Observation } from "../../../lib/otlp.ts";
import { factoryDir } from "../gates/factory-status.ts";
import { readJsonOr, writeJson } from "../infra/json.ts";
import { logEvent } from "../../../lib/layout.ts";

const fail = (subject: string, note: string) => logEvent({ by: "rule", subject, action: "failed", note });
import { allRuns, loadRegistry, type Repo } from "../records/ledger.ts";
import { always, logAlways, type Ask } from "../asks/ask.ts";
import { causeOf } from "../records/outcome.ts";
import { fileIssue, writeList, type Effects, type Place } from "../../../issues/lib/store.ts";
import { PROPOSE_AT } from "../infra/settings.ts";
import { cutTitle, writeLine, writeTitle } from "../roles/title.ts";
import { specText } from "../roles/issue-spec.ts";
import { edit, find, parseIssueRef, setStatus, titleProblem } from "../../../issues/lib/todo.ts";

const CORRECTION_AT = 0.7;
const WINDOW = 14 * 24 * 3600_000;
const QUOTE = 300;
const SENTENCE = 160;

interface Signal { id: string; source: "chris" | "gate" | "drop"; at: string; quote: string; link: string }
export type Kind = "check" | "claude-md" | "skill";
export type Lesson = {
  id: string; sentence: string; state: "open" | "proposed" | "approved" | "declined"; signals: Signal[]; count: number;
  kind?: Kind; title?: string; target?: string; issue?: string; declinedAt?: string;
} & Partial<Pick<Ask, "headline" | "situation" | "details" | "effects" | "recommend">>;
export interface Store { minedAt: string; lessons: Lesson[] }

const file = () => join(factoryDir(), "corrections.json");

/** A missing file is empty. */
export const readStore = (): Store => readJsonOr(file(), { minedAt: "", lessons: [] });

const writeStore = (s: Store): void => writeJson(file(), s);

const text = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
const cut = (s: string) => s.slice(0, QUOTE);

/** Text that is not Chris typing: notifications, subagent hand-backs, bridge relays, slash-command wrappers. */
const NOT_CHRIS = /^\s*(?:<task-notification>|<agent-message|<system-reminder>|\[From the bridge|<command-)/;

const RULE_SYSTEM = "You turn one correction into the rule it teaches. Reply with exactly one sentence in the imperative, under 160 characters, that states how Claude should work across tasks (for example: Run the checks after the last edit before claiming they pass). No quotes, no preamble, nothing about the single task.";
const writeRule = (quote: string) => writeLine(RULE_SYSTEM, quote, SENTENCE);

/** The skills under `<repo.path>/skills/*\/SKILL.md`: name to description. */
function repoSkills(repo: Repo): Record<string, string> {
  const out: Record<string, string> = {};
  const dir = join(repo.path, "skills");
  let names: string[] = [];
  try { names = readdirSync(dir).sort(); } catch { return out; }
  for (const n of names) {
    const f = join(dir, n, "SKILL.md");
    if (!existsSync(f)) continue;
    const fm = readFileSync(f, "utf8").match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    const name = fm.match(/^name:\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "") || n;
    const block = fm.match(/^description:\s*[>|]-?\s*\n((?:[ \t]+.+\n?)+)/m)?.[1];
    out[name] = block ? block.trim().replace(/\s*\n\s*/g, " ") : fm.match(/^description:\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "") ?? "";
  }
  return out;
}

/** The exact place the change goes; throws when Jev fails or there is no skill to pick. */
async function targetOf(l: Lesson, repo: Repo): Promise<string> {
  const kind = l.kind ?? "skill";
  if (kind === "check") return `${repo.key} checks`;
  const input = { lesson: l.sentence, signals: l.signals.map((s) => s.quote) };
  if (kind === "claude-md") {
    const d = await decide(input, { scope: { type: "choice", instructions: "Where does this rule belong?", criteria: { global: "The rule holds in every repo and task", repo: "The rule is about this repo's code or workflow" } } });
    const a = d.answers.scope;
    if (a?.type !== "choice" || (a.choice !== "global" && a.choice !== "repo")) throw new Error("no scope chosen");
    return a.choice === "global" ? "identity/CLAUDE.md" : `${repo.key}/CLAUDE.md`;
  }
  const skills = repoSkills(repo);
  if (!Object.keys(skills).length) throw new Error(`no skills under ${repo.path}/skills`);
  const d = await decide(input, { skill: { type: "choice", instructions: "Which skill should this lesson change?", criteria: skills } });
  const a = d.answers.skill;
  if (a?.type !== "choice" || !skills[a.choice]) throw new Error("no skill chosen");
  return `skills/${a.choice}/SKILL.md`;
}

const lessonId = (sentence: string) => "l-" + createHash("sha256").update(sentence).digest("hex").slice(0, 8);

interface Trace { id: string; name?: string; sessionId?: string; timestamp?: string; input?: unknown; output?: unknown }

async function chrisSignals(lf: Langfuse, from: Date, seen: Set<string>): Promise<Signal[]> {
  const traces = ((await lf.traces({ from })).rows as Trace[])
    .filter((t) => t.id && t.timestamp && Date.parse(t.timestamp) >= from.getTime())
    .sort((a, b) => Date.parse(a.timestamp!) - Date.parse(b.timestamp!));
  const lastBySession = new Map<string, Trace>();
  const out: Signal[] = [];
  // A factory worker's or intake's session id is its run's job or session; its trace is named "factory ...".
  const factory = new Set(allRuns().flatMap((e) => [e.run.job, e.run.session].filter((x): x is string => !!x)));
  for (const t of traces) {
    if (t.name?.startsWith("factory ") || (t.sessionId && factory.has(t.sessionId))) continue;
    const prev = t.sessionId ? lastBySession.get(t.sessionId) : undefined;
    if (t.sessionId) lastBySession.set(t.sessionId, t);
    const message = text(t.input).trim();
    const before = text(prev?.output).trim();
    if (!message || !before || seen.has(t.id) || NOT_CHRIS.test(message)) continue;
    try {
      const { p } = await nouls(
        { message, previous_assistant_message: before },
        {
          correction: { type: "noul", instructions: "Does `message` correct, reject or push back on what `previous_assistant_message` did or said?" },
          general: { type: "noul", instructions: "Does `message` state a rule for how Claude works across tasks, rather than a choice about this task's output?" },
        },
      );
      if (!(p.correction >= CORRECTION_AT) || !(p.general >= CORRECTION_AT)) continue;
    } catch (e) {
      fail(t.id, `jev failed on the trace: ${(e as Error).message}`);
      continue;
    }
    out.push({ id: t.id, source: "chris", at: new Date(t.timestamp!).toISOString(), quote: cut(message), link: `${lf.base}/trace/${t.id}` });
  }
  return out;
}

async function gateSignals(lf: Langfuse, from: Date, now: number, seen: Set<string>): Promise<Signal[]> {
  const obs: Observation[] = (await lf.observations({ from, to: new Date(now) })).rows;
  return obs
    .filter((o) => o.id && o.name === "verify-gate" && o.metadata?.verdict === "deny" && !seen.has(o.id) && Date.parse(o.startTime ?? "") >= from.getTime())
    .map((o) => ({
      id: o.id!, source: "gate" as const, at: new Date(o.startTime!).toISOString(),
      quote: cut(text(o.output).replace(/^deny:\s*/, "")),
      link: o.traceId ? `${lf.base}/trace/${o.traceId}` : lf.base,
    }));
}

/** Only a drop for a fault in the agent's work counts; already-done, no-commit, duplicate, rebase and stale-base drops are dispatch races. */
async function dropSignals(from: Date, seen: Set<string>): Promise<Signal[]> {
  const out: Signal[] = [];
  for (const e of allRuns()) {
    const { run } = e;
    const ended = Date.parse(run.ended ?? "");
    if (run.condition !== "dropped" || !run.reason || !(ended >= from.getTime()) || seen.has(e.id)) continue;
    // The run's own fact: it made no commit, so the drop is no fault in work that does not exist.
    if (causeOf(run) === "no-commit") continue;
    try {
      const { p } = await nouls(
        { reason: run.reason },
        { fault: { type: "noul", instructions: "Did the reviewer drop the run for a fault in the agent's own work, rather than because the work is already done or on main, the run made no commit, found nothing to commit or found the goal already met, a duplicate, needs a rebase, or has a stale base?" } },
      );
      if (!(p.fault >= CORRECTION_AT)) continue;
    } catch (e2) {
      fail(e.id, `jev failed on the drop: ${(e2 as Error).message}`);
      continue;
    }
    out.push({ id: e.id, source: "drop", at: new Date(ended).toISOString(), quote: cut(run.reason), link: run.job });
  }
  return out;
}

/** Put the signal in the lesson Jev picks, else in a new one. A Jev failure leaves the signal out. */
async function group(lessons: Lesson[], s: Signal): Promise<boolean> {
  let pick = "new";
  if (lessons.length) {
    try {
      const criteria: Record<string, string> = { new: "The signal is a lesson not listed" };
      const listed: Record<string, string> = {};
      for (const l of lessons) { criteria[l.id] = l.sentence; listed[l.id] = l.sentence; }
      const d = await decide(
        { signal: s.quote, lessons: listed },
        { lesson: { type: "choice", instructions: "Which lesson does `signal` teach?", criteria: Object.fromEntries(Object.entries(criteria).sort(([a], [b]) => (a === "new" ? 1 : b === "new" ? -1 : 0))) } },
      );
      const a = d.answers.lesson;
      if (a.type === "choice" && criteria[a.choice]) pick = a.choice;
    } catch (e) {
      fail(s.id, `jev failed on the signal: ${(e as Error).message}`);
      return false;
    }
  }
  let lesson = pick === "new" ? undefined : lessons.find((l) => l.id === pick);
  if (!lesson) {
    const sentence = await writeRule(s.quote);
    if (!sentence) {
      fail(s.id, "no rule written for the signal");
      return false;
    }
    lesson = lessons.find((l) => l.id === lessonId(sentence));
    if (!lesson) {
      lesson = { id: lessonId(sentence), sentence, state: "open", signals: [], count: 0 };
      lessons.push(lesson);
    }
  }
  lesson.signals.push(s);
  lesson.count = lesson.signals.length;
  return true;
}

/** Collect the last 14 days of new signals and group them into lessons; the store is rewritten. `effects` is what a filed proposal starts. */
export async function mine(now: number, effects: Effects): Promise<Store> {
  const store = readStore();
  const from = new Date(now - WINDOW);
  const seen = new Set(store.lessons.flatMap((l) => l.signals.map((s) => s.id)));
  const signals: Signal[] = [];
  const lf = langfuse();
  if (lf) {
    for (const f of [() => chrisSignals(lf, from, seen), () => gateSignals(lf, from, now, seen)]) {
      try { signals.push(...(await f())); } catch (e) { fail("corrections", `langfuse failed: ${(e as Error).message}`); }
    }
  }
  signals.push(...(await dropSignals(from, seen)));
  signals.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const s of signals) await group(store.lessons, s);
  const proposed = await propose(store.lessons, effects);
  store.minedAt = new Date(now).toISOString();
  writeStore(store);
  standingProposals(proposed, effects);
  return store;
}

/** Every open lesson at PROPOSE_AT() signals becomes a proposal of the kind Jev finds, with a title, a target and its own parked issue. A Jev failure leaves it open. */
async function propose(lessons: Lesson[], effects: Effects): Promise<Lesson[]> {
  const made: Lesson[] = [];
  const todo = lessons.filter((l) => (l.state === "open" && l.count >= PROPOSE_AT()) || (l.state === "proposed" && (!l.target || !l.issue)));
  if (!todo.length) return made;
  // The lesson is about aleph itself: the first registry repo that runs in the sandbox.
  const repo = Object.values(loadRegistry()).find((r) => r.sandbox);
  if (!repo) { fail("corrections", "no sandboxed repo in the registry; proposals stay open"); return made; }
  for (const l of todo) {
    try {
      if (l.state === "open") {
        const { p } = await nouls(
          { lesson: l.sentence, signals: l.signals.map((s) => s.quote) },
          {
            check: { type: "noul", instructions: "Can a test or a lint catch this before a run ends?" },
            rule: { type: "noul", instructions: "Is this one rule a CLAUDE.md line can state?" },
          },
        );
        const kind: Kind = p.check >= 0.5 ? "check" : p.rule >= 0.5 ? "claude-md" : "skill";
        l.target = await targetOf({ ...l, kind }, repo);
        l.kind = kind;
        l.state = "proposed";
        made.push(l);
      } else {
        l.target ||= await targetOf(l, repo);
      }
      l.title ||= await writeTitle(l.sentence);
      if (!l.issue) {
        const n = fileLesson(l, repo, effects);
        if (n !== undefined) l.issue = `${repo.key}-${n}`;
      }
    } catch (e) {
      fail(l.id, `jev failed on the proposal: ${(e as Error).message}`);
    }
  }
  return made;
}

/** The short name of a proposal's target: global, the repo key, or the skill name. */
export function place(kind: Kind, target = ""): string {
  if (kind === "check") return target.replace(/ checks$/, "");
  if (kind === "skill") return target.match(/^skills\/([^/]+)\/SKILL\.md$/)?.[1] ?? target;
  return target === "identity/CLAUDE.md" ? "global" : target.replace(/\/CLAUDE\.md$/, "");
}

/** The standing key for a lesson: `proposal-<kind>:<place>`. */
export const standingKey = (l: Lesson): string => `proposal-${l.kind ?? "skill"}:${place(l.kind ?? "skill", l.target)}`;

/** A proposal with a standing approve or decline is answered at once, as the route would. */
function standingProposals(made: Lesson[], effects: Effects): void {
  for (const l of made) {
    const reason = standingKey(l);
    const action = always(reason)?.action;
    if (action === "approve") {
      // The lesson is about aleph itself: the first registry repo that runs in the sandbox.
      const repo = Object.values(loadRegistry()).find((r) => r.sandbox);
      if (!repo) { fail(l.id, `${reason}: approve failed: no sandboxed repo in the registry`); continue; }
      const ref = approve(l.id, repo, effects);
      // The issue's filing logged `filed`; the standing approve answers its proposal.
      if (ref.startsWith(`${repo.key}-`)) logAlways(reason, ref, "answered", { note: `${reason}: approved ${l.id}` });
      else fail(l.id, `${reason}: approve failed: ${ref}`);
    } else if (action === "decline") {
      const refusal = decline(l.id);
      if (refusal) fail(l.id, `${reason}: decline failed: ${refusal}`);
      else logAlways(reason, l.id, "dropped", { note: `${reason}: declined` });
    }
  }
}

/** The lessons waiting for Chris's Yes or No. */
export const proposals = (): Lesson[] => readStore().lessons.filter((l) => l.state === "proposed");

const KIND_TITLE: Record<Kind, string> = { check: "Add a check", "claude-md": "Add a CLAUDE.md line", skill: "Change a skill" };

/** Files the lesson as a parked `task` issue in `repo`: its number, or undefined when the store refused. It holds no spec until Chris approves it. */
function fileLesson(l: Lesson, repo: Place, effects: Effects): number | undefined {
  const title = l.title && !titleProblem(l.title) ? l.title : cutTitle(l.sentence);
  try {
    return fileIssue(repo, { title, kind: "task", source: "memory", parked: true }, "rule", effects).id;
  } catch (e) {
    fail(l.id, `filing the proposal failed: ${(e as Error).message}`);
    return undefined;
  }
}

/** The proposed lesson `id`, or why there is none. */
function pending(store: Store, id: string, verb: string): Lesson | string {
  const l = store.lessons.find((x) => x.id === id);
  if (!l) return `no lesson ${id}`;
  if (l.state !== "proposed") return `lesson ${id} is ${l.state}, not proposed; it cannot be ${verb}`;
  return l;
}

/** Reopens the proposal's own issue with the issue spec; its ref, or a refusal string. Writes no CLAUDE.md, skill or check. */
export function approve(id: string, repo: Place, effects: Effects): string {
  const store = readStore();
  const l = pending(store, id, "approved");
  if (typeof l === "string") return l;
  const kind = l.kind ?? "skill";
  // A claude-md issue names its line, its file in the filing repo and a command that proves the line is there.
  const path = l.target === "identity/CLAUDE.md" ? l.target : "CLAUDE.md";
  const sections = kind !== "claude-md" ? [] : [specText({
    goal: `Add this line to ${path}: ${l.sentence}`,
    surface: [{ path, new: false }],
    oracle: [`\`grep -F '${l.sentence.replace(/'/g, "'\\''")}' ${path}\` exits 0.`, "`bun run test` passes."],
  }), ""];
  const body = [
    `Chris approved a proposal from the correction memory: ${KIND_TITLE[kind]}.`,
    "",
    `Kind: ${kind}`,
    ...(l.target ? [`Target: ${l.target}`] : []),
    `Lesson: ${l.sentence}`,
    "",
    "Signals:",
    ...l.signals.map((s) => `- ${s.at} ${s.source}: "${s.quote}" (${s.link})`),
    "",
    ...sections,
  ].join("\n");
  // A lesson the mine filed no issue for, because it was proposed before this or its filing failed, gets its issue now.
  const n = l.issue ? parseIssueRef(l.issue)?.id : fileLesson(l, repo, effects);
  if (n === undefined) return "the work store refused the issue";
  try {
    const w = writeList(repo, `memory: approved ${repo.key}-${n}`, (doc) => {
      const item = find(doc, n);
      if (!item) return null;
      setStatus(item, "open");
      edit(item, { spec: body });
      return true;
    });
    if (!w) return `no issue ${repo.key}-${n} to approve`;
  } catch (e) {
    return `the work store refused: ${(e as Error).message}`;
  }
  l.state = "approved";
  l.issue = `${repo.key}-${n}`;
  writeStore(store);
  return l.issue;
}

/** Marks a proposal declined for good and drops its issue; "" when done, else a refusal string. */
export function decline(id: string, now = Date.now()): string {
  const store = readStore();
  const l = pending(store, id, "declined");
  if (typeof l === "string") return l;
  const ref = l.issue ? parseIssueRef(l.issue) : null;
  if (ref) {
    try {
      const w = writeList({ key: ref.repo }, `memory: declined ${l.issue}`, (doc) => {
        const item = find(doc, ref.id);
        if (!item) return null;
        setStatus(item, "dropped", undefined, "the memory proposal was declined");
        return true;
      });
      if (!w) return `no issue ${l.issue} to drop`;
    } catch (e) {
      return `the work store refused: ${(e as Error).message}`;
    }
  }
  l.state = "declined";
  l.declinedAt = new Date(now).toISOString();
  writeStore(store);
  return "";
}

/** Stores the case text of a proposal, only while it is still proposed and still says `sentence`; true when it wrote. */
export function explainLesson(id: string, sentence: string, text: Pick<Lesson, "headline" | "situation" | "details" | "effects" | "recommend">): boolean {
  const store = readStore();
  const l = pending(store, id, "explained");
  if (typeof l === "string" || l.sentence !== sentence) return false;
  if (text.headline) l.headline = text.headline;
  l.situation = text.situation;
  l.details = text.details;
  l.effects = text.effects;
  l.recommend = text.recommend;
  writeStore(store);
  return true;
}
