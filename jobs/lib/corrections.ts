/**
 * Correction signals, the procedural memory (docs/specs/2026-10-27-memory.md):
 * Chris's messages that push back on the assistant, the verify-gate's denials
 * and the reviewer's drop reasons of the last 14 days, grouped into lessons by
 * Jev. The store is corrections.json in the factory directory.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { langfuseConfig, type LangfuseConfig } from "../../hooks/lib/env.ts";
import { decide } from "../../hooks/lib/jev.ts";
import { fetchObservations } from "../../hooks/lib/otlp.ts";
import { factoryLog, factoryDir } from "./factory.ts";
import { allRuns, loadRegistry, type Repo } from "./ledger.ts";
import { logStanding, standing } from "./standing.ts";
import { file as fileIssues, type Place } from "../../todo/lib/store.ts";

export const CORRECTION_AT = 0.7;
/** How many signals make a lesson a proposal. */
export const PROPOSE_AT = (): number => {
  const n = Number(process.env.ALEPH_PROPOSE_AT);
  return Number.isFinite(n) && n >= 1 ? n : 3;
};
const WINDOW = 14 * 24 * 3600_000;
const QUOTE = 300;
const SENTENCE = 160;
const TITLE = 60;

export interface Signal { id: string; source: "chris" | "gate" | "drop"; at: string; quote: string; link: string }
export type Kind = "check" | "claude-md" | "skill";
export interface Lesson {
  id: string; sentence: string; state: "open" | "proposed" | "approved" | "declined"; signals: Signal[]; count: number;
  kind?: Kind; title?: string; target?: string; issue?: string; declinedAt?: string;
}
export interface Store { minedAt: string; lessons: Lesson[] }

const file = () => join(factoryDir(), "corrections.json");

/** A missing or bad file is empty. */
export function readStore(): Store {
  try {
    const s = JSON.parse(readFileSync(file(), "utf8"));
    if (s && typeof s === "object" && Array.isArray(s.lessons)) return { minedAt: String(s.minedAt ?? ""), lessons: s.lessons };
  } catch {}
  return { minedAt: "", lessons: [] };
}

function writeStore(s: Store): void {
  mkdirSync(factoryDir(), { recursive: true });
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n");
  renameSync(tmp, file());
}

const text = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
const cut = (s: string) => s.slice(0, QUOTE);

/** Text that is not Chris typing: notifications, subagent hand-backs, bridge relays, slash-command wrappers. */
const NOT_CHRIS = /^\s*(?:<task-notification>|<agent-message|<system-reminder>|\[From the bridge|<command-)/;

/**
 * One line of text from a nested Haiku `claude -p` given a system prompt and an input.
 * Jev answers typed questions and writes no text. "" when it fails or finds nothing.
 */
async function writeLine(system: string, input: string, max: number): Promise<string> {
  const cmd = process.env.ALEPH_RULE_CMD ?? "claude";
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.ANTHROPIC_API_KEY;
  env.MAX_THINKING_TOKENS = "0";
  try {
    const proc = Bun.spawn([cmd, "-p", "--model", "haiku", "--setting-sources", "", "--max-turns", "1", "--tools", "", "--output-format", "json", "--system-prompt", system, input], { env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const timer = setTimeout(() => proc.kill(), 30_000);
    const [stdout] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    clearTimeout(timer);
    if (code !== 0) return "";
    let result = stdout;
    try { result = JSON.parse(stdout).result ?? stdout; } catch { /* plain text */ }
    return String(result).trim().split("\n")[0].trim().slice(0, max);
  } catch {
    return "";
  }
}

const RULE_SYSTEM = "You turn one correction into the rule it teaches. Reply with exactly one sentence in the imperative, under 160 characters, that states how Claude should work across tasks (for example: Run the checks after the last edit before claiming they pass). No quotes, no preamble, nothing about the single task.";
const TITLE_SYSTEM = "You title one rule as an issue title. Reply with exactly one imperative title of at most 60 characters, no final period, no quotes, no preamble.";
const writeRule = (quote: string) => writeLine(RULE_SYSTEM, quote, SENTENCE);

/** The sentence cut to 60 characters at a word boundary. */
function cutTitle(sentence: string): string {
  const t = sentence.trim().replace(/\.$/, "");
  if (t.length <= TITLE) return t;
  const head = t.slice(0, TITLE + 1);
  const i = head.lastIndexOf(" ");
  return (i > 0 ? head.slice(0, i) : head.slice(0, TITLE)).trim();
}

async function writeTitle(sentence: string): Promise<string> {
  const t = (await writeLine(TITLE_SYSTEM, sentence, TITLE)).replace(/\.$/, "").trim();
  return t || cutTitle(sentence);
}

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
    out[name] = fm.match(/^description:\s*(.+)$/m)?.[1].trim() ?? "";
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

async function fetchTraces(cfg: LangfuseConfig, from: Date): Promise<Trace[]> {
  const auth = Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString("base64");
  const page = async (n: number) => {
    const q = new URLSearchParams({ fromTimestamp: from.toISOString(), limit: "100", page: String(n) });
    const res = await fetch(`${cfg.baseUrl}/api/public/traces?${q}`, { headers: { authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`${res.status} on traces`);
    return (await res.json()) as any;
  };
  const first = await page(1);
  const pages = first.meta ? Math.min(Number(first.meta.totalPages) || 1, 499) : 1;
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => page(i + 2)));
  return [first, ...rest].flatMap((b) => b.data ?? []);
}

async function chrisSignals(cfg: LangfuseConfig, from: Date, seen: Set<string>): Promise<Signal[]> {
  const traces = (await fetchTraces(cfg, from))
    .filter((t) => t.id && t.timestamp && Date.parse(t.timestamp) >= from.getTime())
    .sort((a, b) => Date.parse(a.timestamp!) - Date.parse(b.timestamp!));
  const lastBySession = new Map<string, Trace>();
  const out: Signal[] = [];
  // A factory worker's or triage's session id is its run's job or session; its trace is named "factory ...".
  const factory = new Set(allRuns().flatMap((e) => [e.run.job, e.run.session].filter((x): x is string => !!x)));
  for (const t of traces) {
    if (t.name?.startsWith("factory ") || (t.sessionId && factory.has(t.sessionId))) continue;
    const prev = t.sessionId ? lastBySession.get(t.sessionId) : undefined;
    if (t.sessionId) lastBySession.set(t.sessionId, t);
    const message = text(t.input).trim();
    const before = text(prev?.output).trim();
    if (!message || !before || seen.has(t.id) || NOT_CHRIS.test(message)) continue;
    try {
      const d = await decide(
        { message, previous_assistant_message: before },
        {
          correction: { type: "noul", instructions: "Does `message` correct, reject or push back on what `previous_assistant_message` did or said?" },
          general: { type: "noul", instructions: "Does `message` state a rule for how Claude works across tasks, rather than a choice about this task's output?" },
        },
      );
      const a = d.answers.correction;
      const r = d.answers.general;
      if (a.type !== "noul" || !(a.noul >= CORRECTION_AT) || r.type !== "noul" || !(r.noul >= CORRECTION_AT)) continue;
    } catch (e) {
      factoryLog(`corrections: jev failed on trace ${t.id}: ${(e as Error).message}`);
      continue;
    }
    out.push({ id: t.id, source: "chris", at: new Date(t.timestamp!).toISOString(), quote: cut(message), link: `${cfg.baseUrl}/trace/${t.id}` });
  }
  return out;
}

async function gateSignals(cfg: LangfuseConfig, from: Date, now: number, seen: Set<string>): Promise<Signal[]> {
  const obs = await fetchObservations(cfg, from, new Date(now));
  return obs
    .filter((o) => o.id && o.name === "verify-gate" && o.metadata?.verdict === "deny" && !seen.has(o.id) && Date.parse(o.startTime ?? "") >= from.getTime())
    .map((o) => ({
      id: o.id!, source: "gate" as const, at: new Date(o.startTime!).toISOString(),
      quote: cut(text(o.output).replace(/^deny:\s*/, "")),
      link: o.traceId ? `${cfg.baseUrl}/trace/${o.traceId}` : cfg.baseUrl,
    }));
}

/** Only a drop for a fault in the agent's work counts; already-done, no-commit, duplicate, rebase and stale-base drops are dispatch races. */
async function dropSignals(from: Date, seen: Set<string>): Promise<Signal[]> {
  const out: Signal[] = [];
  for (const e of allRuns()) {
    const { run } = e;
    const ended = Date.parse(run.ended ?? "");
    if (run.state !== "dropped" || !run.reason || !(ended >= from.getTime()) || seen.has(e.id)) continue;
    // The run's own fact: it made no commit, so the drop is no fault in work that does not exist.
    if (run.noCommit || run.reason === "no commit") continue;
    try {
      const d = await decide(
        { reason: run.reason },
        { fault: { type: "noul", instructions: "Did the reviewer drop the run for a fault in the agent's own work, rather than because the work is already done or on main, the run made no commit, found nothing to commit or found the goal already met, a duplicate, needs a rebase, or has a stale base?" } },
      );
      const a = d.answers.fault;
      if (a.type !== "noul" || !(a.noul >= CORRECTION_AT)) continue;
    } catch (e2) {
      factoryLog(`corrections: jev failed on drop ${e.id}: ${(e2 as Error).message}`);
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
      factoryLog(`corrections: jev failed on signal ${s.id}: ${(e as Error).message}`);
      return false;
    }
  }
  let lesson = pick === "new" ? undefined : lessons.find((l) => l.id === pick);
  if (!lesson) {
    const sentence = await writeRule(s.quote);
    if (!sentence) {
      factoryLog(`corrections: no rule written for signal ${s.id}`);
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

/** Collect the last 14 days of new signals and group them into lessons; the store is rewritten. */
export async function mine(now = Date.now()): Promise<Store> {
  const store = readStore();
  const from = new Date(now - WINDOW);
  const seen = new Set(store.lessons.flatMap((l) => l.signals.map((s) => s.id)));
  const signals: Signal[] = [];
  const cfg = langfuseConfig();
  if (cfg) {
    for (const f of [() => chrisSignals(cfg, from, seen), () => gateSignals(cfg, from, now, seen)]) {
      try { signals.push(...(await f())); } catch (e) { factoryLog(`corrections: langfuse failed: ${(e as Error).message}`); }
    }
  }
  signals.push(...(await dropSignals(from, seen)));
  signals.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const s of signals) await group(store.lessons, s);
  const proposed = await propose(store.lessons);
  store.minedAt = new Date(now).toISOString();
  writeStore(store);
  standingProposals(proposed);
  return store;
}

/** Every open lesson at PROPOSE_AT() signals becomes a proposal of the kind Jev finds, with a title and a target. A Jev failure leaves it open. */
async function propose(lessons: Lesson[]): Promise<Lesson[]> {
  const made: Lesson[] = [];
  const todo = lessons.filter((l) => (l.state === "open" && l.count >= PROPOSE_AT()) || (l.state === "proposed" && !l.target));
  if (!todo.length) return made;
  // The lesson is about aleph itself: the first registry repo that runs in the sandbox.
  const repo = Object.values(loadRegistry()).find((r) => r.sandbox);
  if (!repo) { factoryLog("corrections: no sandboxed repo in the registry; proposals stay open"); return made; }
  for (const l of todo) {
    try {
      if (l.state === "open") {
        const d = await decide(
          { lesson: l.sentence, signals: l.signals.map((s) => s.quote) },
          {
            check: { type: "noul", instructions: "Can a test or a lint catch this before a run ends?" },
            rule: { type: "noul", instructions: "Is this one rule a CLAUDE.md line can state?" },
          },
        );
        const yes = (id: string) => { const a = d.answers[id]; return a?.type === "noul" && a.noul >= 0.5; };
        const kind: Kind = yes("check") ? "check" : yes("rule") ? "claude-md" : "skill";
        l.target = await targetOf({ ...l, kind }, repo);
        l.kind = kind;
        l.state = "proposed";
        made.push(l);
      } else {
        l.target = await targetOf(l, repo);
      }
      l.title ||= await writeTitle(l.sentence);
    } catch (e) {
      factoryLog(`corrections: jev failed on proposal ${l.id}: ${(e as Error).message}`);
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
function standingProposals(made: Lesson[]): void {
  for (const l of made) {
    const reason = standingKey(l);
    const action = standing(reason)?.action;
    if (action === "approve") {
      // The lesson is about aleph itself: the first registry repo that runs in the sandbox.
      const repo = Object.values(loadRegistry()).find((r) => r.sandbox);
      if (!repo) { factoryLog(`standing: ${reason}: approve on ${l.id} failed: no sandboxed repo in the registry`); continue; }
      const ref = approve(l.id, repo);
      if (ref.startsWith(`${repo.key}-`)) logStanding(reason, "approve", ref);
      else factoryLog(`standing: ${reason}: approve on ${l.id} failed: ${ref}`);
    } else if (action === "decline") {
      const refusal = decline(l.id);
      if (refusal) factoryLog(`standing: ${reason}: decline on ${l.id} failed: ${refusal}`);
      else logStanding(reason, "decline", l.id);
    }
  }
}

/** The lessons waiting for Chris's Yes or No. */
export const proposals = (): Lesson[] => readStore().lessons.filter((l) => l.state === "proposed");

const KIND_TITLE: Record<Kind, string> = { check: "Add a check", "claude-md": "Add a CLAUDE.md line", skill: "Change a skill" };

/** The proposed lesson `id`, or why there is none. */
function pending(store: Store, id: string, verb: string): Lesson | string {
  const l = store.lessons.find((x) => x.id === id);
  if (!l) return `no lesson ${id}`;
  if (l.state !== "proposed") return `lesson ${id} is ${l.state}, not proposed; it cannot be ${verb}`;
  return l;
}

/** Files the goal issue for a proposal; its ref, or a refusal string. Writes no CLAUDE.md, skill or check. */
export function approve(id: string, repo: Place): string {
  const store = readStore();
  const l = pending(store, id, "approved");
  if (typeof l === "string") return l;
  const kind = l.kind ?? "skill";
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
  ].join("\n");
  let ids: number[];
  try {
    ids = fileIssues(repo, `memory: ${KIND_TITLE[kind]}`, [{ title: l.title ?? `${KIND_TITLE[kind]}: ${l.sentence}`, source: "memory", goal: true, body }]);
  } catch (e) {
    return `the work store refused: ${(e as Error).message}`;
  }
  if (ids.length !== 1 || !ids[0]) return "the work store refused the issue";
  l.state = "approved";
  l.issue = `${repo.key}-${ids[0]}`;
  writeStore(store);
  return l.issue;
}

/** Marks a proposal declined for good; "" when done, else a refusal string. */
export function decline(id: string, now = Date.now()): string {
  const store = readStore();
  const l = pending(store, id, "declined");
  if (typeof l === "string") return l;
  l.state = "declined";
  l.declinedAt = new Date(now).toISOString();
  writeStore(store);
  return "";
}
