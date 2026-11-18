// The names, IDs and status words of aleph, as docs/naming.md sets them. No DOM and no I/O, so the factory, the CLI
// and the UI server import it, and the UI server serves it to the page as JS (ui/server.ts). No other file defines an ID pattern or a word set.
//
// Throughout: a full ID is `aleph-1430`, a short ID `a1430`; a code is a project's 1–2 letters; a job's key is `job.<n>`.

export const STATUSES = ["open", "parked", "done", "dropped"] as const;
export const STATES = ["running", "waiting", "passed", "returned", "failed", "landed", "dropped", "done"] as const;
export const HOLDS = ["held", "gpu", "starting", "parent", "parked"] as const;
/** The hold actions of events written before an issue hold was one `held` event: old events carry them and the readers still read them, and no code writes them. */
export const OLD_HOLDS = ["paused", "red", "after", "full", "busy", "looping", "credit"] as const;
const ASKS = ["protected", "question", "incomplete", "capped", "proposal"] as const;
/** The verbs of an Ask card, each pair the verb that goes ahead and then the verb that drops the issue: the only actions an Ask offers, a rule grants or a timeout takes. */
export const ASK_ACTIONS = ["approve", "disapprove", "resolve", "dismiss", "continue", "discontinue"] as const;
export type AskAction = (typeof ASK_ACTIONS)[number];
export const ACTIONS: readonly string[] = [...STATES, ...HOLDS, ...ASKS, "reran", "started", "missed", "skipped", "filed", "escalated", "changed", "answered", "routed", "stalled", "reopened"];
/** Why a run stopped: the closed set of causes (outcome.ts `Cause`). */
export const CAUSES = ["no-commit", "timeout", "stalled", "infra", "locked", "credit", "check", "conflict", "moved", "review", "unanswered", "other"] as const;
/** The subjects that are not a job: code (`gate`, `rule`), Chris and an interactive session. */
const SUBJECTS = ["gate", "rule", "human", "claude"] as const;
/** Role words of events written before jobs had keys; read for old data only. */
const OLD_ROLES = ["worker", "reviewer", "check", "intake", "director", "monitor", "firefighter"] as const;
export const ACTORS: readonly string[] = [...SUBJECTS, ...OLD_ROLES];
/** The kinds of an issue. */
export const ISSUE_KINDS = ["task", "bug", "check", "flake"] as const;
/** The roles of a job: what it does. `review` is the reviewer's job, its `prev` the build it reviews. */
export const ROLES = ["build", "plain", "land", "review", "intake", "recheck", "director", "monitor", "lens", "housekeeper", "maintainer", "title", "judge"] as const;
export type State = (typeof STATES)[number];
export type Role = (typeof ROLES)[number];
/** The roles that one agent call opens (`openRun`): the others start a unit or a command. */
export type AgentRole = Exclude<Role, "build" | "plain" | "land" | "review" | "recheck">;
/** One display name for each pipeline step and agent role. */
export const NAMES: Record<string, string> = {
  lead: "Lead Time", intake: "Intake", queue: "Queue", triage: "Triage", plan: "Plan", build: "Implement",
  review: "Review", recheck: "Recheck", land: "Land", worker: "Worker", planner: "Planner", merge: "Merge", reviewer: "Reviewer",
  director: "Director", monitor: "Monitor", lens: "Lens", housekeeper: "Housekeeper", maintainer: "Maintainer", title: "Rule", judge: "Judge",
};
export const STAGES = ["new", "queued", "held", "working", "waiting", "failed", "landing", "done", "dropped", "parked"] as const;
export type StageName = (typeof STAGES)[number];
export const LANES = ["landed", "waiting", "failed", "other"];
export const SPEEDS = ["landed", "returned", "failed", "reran", "dropped"] as const;

/** Old words, per set, that live code still writes or reads, and the new word each reads as. A word not listed is already new. */
export const OLD: Record<string, Record<string, string>> = {
  ask: {
    "held-path": "protected", "review-held": "returned", "no-commit": "failed", "part-dropped": "incomplete",
    "intake-failed": "failed", rescue: "waiting", "run-cap": "capped",
  },
  actor: { You: "human", Rule: "rule", Gate: "gate", Director: "director", Firefighter: "firefighter", triage: "intake", planner: "intake" },
  act: {
    land: "landed", drop: "dropped", "drop-issue": "dropped", decline: "dropped", rerun: "reran", retry: "reran", add: "filed",
    approve: "filed", answer: "answered", recommended: "answered", close: "done", "edit-goal": "changed",
  },
};

/** The new word for `w` in set `set`; an `ask` reason `proposal-*` is `proposal`. */
export function word(set: string, w: string): string {
  if (set === "ask" && String(w).startsWith("proposal-")) return "proposal";
  return OLD[set]?.[w] ?? w;
}

let codes: Record<string, string> = {};
let keys: Record<string, string> = {};
/** Set the project codes, `{aleph: "a", …}`, from the registry. Throws on a code `p`, `d` or `j`: its issues would show as another kind. */
export function setCodes(map: Record<string, string>): void {
  const bad = Object.entries(map).find(([, c]) => c !== LETTER.issue && Object.values(LETTER).includes(c));
  if (bad) throw new Error(`naming: the code "${bad[1]}" of ${bad[0]} is the letter of another kind`);
  codes = { ...map };
  keys = Object.fromEntries(Object.entries(map).map(([k, c]) => [c, k]));
}

/** The kinds of a stored thing: its key is `<kind>.<n>`. */
const KEY_KINDS = ["project", "issue", "idea", "job"] as const;
type KeyKind = (typeof KEY_KINDS)[number];
/** The lower-case letter that shows a key's kind. A project code is 1–2 letters too, so `setCodes` refuses the codes `p`, `d` and `j`. */
const LETTER: Record<KeyKind, string> = { project: "p", issue: "i", idea: "d", job: "j" };
const KEY = /^(project|issue|idea|job)\.(\d+)$/;
// The dash is the old shown form: a copied `j-06802` still reads.
const SHOWN = /^([a-z]{1,2})-?(\d+)$/;

/** `issue.2072` from a kind and a number. */
export const key = (kind: KeyKind, n: number | string): string => `${kind}.${n}`;
/** What an issue key matches, as a pattern a JSON schema can take. */
export const ISSUE_KEY = /^issue\.\d+$/;
/** `issue.2072` from an issue's number. */
export const issueKey = (n: number | string): string => key("issue", n);
/** `{kind, n}` for a key, or for its shown form: `i2072` and `a2072` (a known project code) read as an issue; or null. */
export function parseKey(s: unknown): { kind: KeyKind; n: number } | null {
  const t = String(s ?? "").trim(), k = KEY.exec(t), sh = k ? null : SHOWN.exec(t);
  if (k) return { kind: k[1] as KeyKind, n: Number(k[2]) };
  const kind = sh && (KEY_KINDS.find((x) => LETTER[x] === sh[1]) ?? (keys[sh[1]] ? "issue" : undefined));
  return sh && kind ? { kind, n: Number(sh[2]) } : null;
}
/** A key as the page and the terminal show it: `j6802`; an issue takes its project's `code` when given (`a1234`). Anything else unchanged. */
export function shownKey(s: unknown, code?: string): string {
  const k = parseKey(s);
  return k ? `${k.kind === "issue" && code ? code : LETTER[k.kind]}${k.n}` : String(s ?? "");
}

export const FULL = /^([a-z0-9][a-z0-9-]*?)-(\d+)(?:\.(\d+))?$/;
const FREE = /(?<![\w.-])[a-z][a-z0-9-]*-\d+(?:\.\d+)?(?![\w-])/g;
const SHORT = /^([a-z]{1,2})(\d+)(?:\.(\d+))?$/;

/** `{repo, n, sub}` for a full or short issue ID, or null. A short ID needs a known code. */
export interface Id { repo: string; n: number; sub?: number }
export function parseId(s: unknown): Id | null {
  const t = String(s ?? "").trim();
  const sh = SHORT.exec(t);
  if (sh && keys[sh[1]]) return { repo: keys[sh[1]], n: Number(sh[2]), sub: sh[3] === undefined ? undefined : Number(sh[3]) };
  const fu = FULL.exec(t);
  return fu ? { repo: fu[1], n: Number(fu[2]), sub: fu[3] === undefined ? undefined : Number(fu[3]) } : null;
}

/** `1430` or `1430.2`: the part of an ID after its repo. */
export const tail = (p: Id) => `${p.n}${p.sub === undefined ? "" : `.${p.sub}`}`;
/** `aleph-1430` for any issue ID; anything else unchanged. */
export const fullId = (s: unknown): string => { const p = parseId(s); return p ? `${p.repo}-${tail(p)}` : String(s ?? ""); };
/** `a1430` for any issue ID of a project with a code; anything else unchanged. */
export const shortId = (s: unknown): string => { const p = parseId(s); return p && codes[p.repo] ? `${codes[p.repo]}${tail(p)}` : String(s ?? ""); };

/** `#/issues/aleph/1430.2`: the page of an issue, from any issue ID; `issue.1430` needs its project `repo` too. "" for anything else. */
export const issueHref = (s: unknown, repo?: string | null): string => {
  const k = parseKey(s), p = parseId(s);
  // A short ID such as `a1430` also reads as a shown key: its code names the repo, so it needs no `repo`.
  if (p && codes[p.repo]) return `#/issues/${encodeURIComponent(p.repo)}/${tail(p)}`;
  if (k) return k.kind === "issue" && repo ? `#/issues/${encodeURIComponent(repo)}/${k.n}` : "";
  return p ? `#/issues/${encodeURIComponent(p.repo)}/${tail(p)}` : "";
};

/** `#/jobs/a1430%232`: the page of the job with ID `id`. */
export const jobHref = (id: string): string => `#/jobs/${encodeURIComponent(id)}`;

/** Every full issue ID in free text, in order. Short IDs are never read from free text. */
export const refs = (text: unknown): string[] => [...String(text ?? "").matchAll(FREE)].map((m) => m[0]);
/** Free text with each full issue ID of a project with a code in its short form. */
export const shortText = (text: unknown): string => String(text ?? "").replace(FREE, shortId);

/** An event: a sentence of 6 fields, and the size of a build's start. `object` is a key (an old issue ID until issues have keys), or `settings`. */
export interface Event { seq?: number; time: string; subject: string; action: string; object: string; detail?: string | null; size?: string | null }
/** An event as `event_rows` gives it: the roles, project and run fields of the jobs it names. */
export interface EventRow extends Event {
  subject_role?: string | null; object_role?: string | null; object_target?: string | null; project?: string | null;
  model?: string | null; cost?: number | null; commit_sha?: string | null; started?: string | null; ended?: string | null;
}
const JOB = /^job\.\d+$/;
/** An event with its words checked; throws on a word outside its set. */
export function event({ time, subject, action, object, detail, size }: Omit<Event, "time"> & { time?: string }): Event {
  if (!JOB.test(subject) && !ACTORS.includes(subject)) throw new Error(`naming: subject "${subject}" is not a job key or in its set`);
  if (!ACTIONS.includes(action)) throw new Error(`naming: action "${action}" is not in its set`);
  return { time: time ?? new Date().toISOString(), subject, action, object, ...(detail ? { detail } : {}), ...(size ? { size } : {}) };
}

/** The past word of each housekeeper edit, which a `changed` event's detail starts with (`retitle: New title`). */
export const EDITS = { close: "closed", drop: "dropped", retitle: "retitled", reprioritize: "reprioritized", note: "commented", unpark: "unparked" } as const;
/** The words a detail can start with, by action: `<word>: <facts>`. A setting is a pause, a credit hold, the live cap, an Always rule or a model entry. */
const WORDS: Record<string, readonly string[]> = {
  held: ["after", "job", "red", "file", "credit", "paused", "gpu", "full", "waiting", "done"],
  changed: ["pause", "credit", "cap", "Always", "small", "medium", "large", "review", "intake", "director", "monitor", "lens", "housekeeper", "maintainer", "title", "judge", ...Object.keys(EDITS)],
  started: ["model"],
  missed: ["start", "land", "intake", "Ask", "rescue", "rerun"],
};
/** The detail `<word>: <facts>` of an event of `action`, or the bare word with no facts; throws on a word outside `words`, the set of `action` by default. The one writer of a detail word: a later `word` column changes only this and `wordOf`. */
export function detailOf(action: string, word: string, facts?: string | number, words: readonly string[] | undefined = WORDS[action]): string {
  if (!words?.includes(word)) throw new Error(`naming: detail word "${word}" is not in the set of action "${action}"`);
  return facts ? `${word}: ${facts}` : word;
}
/** The word of what did not move, by the prefix of a stall key. */
const STEP: Record<string, string> = { issue: "start", goal: "start", land: "land", ingest: "intake", ask: "Ask", rescue: "rescue", edited: "rerun" };
/** The object and detail of the `missed` event of a stall key: the issue or job itself, and the step that did not move. */
export function missedOf(k: string): { object: string; detail: string } {
  const at = k.indexOf(":");
  return { object: k.slice(at + 1), detail: detailOf("missed", STEP[k.slice(0, at)]) };
}
/** The word of a detail: its start up to the first colon and space, or all of it with none. */
export const wordOf = (e: Pick<Event, "detail">): string => (e.detail ?? "").split(": ")[0];
/** The facts of a detail after its word: "" for a bare word. */
export const factsOf = (e: Pick<Event, "detail">): string => (e.detail ?? "").split(": ").slice(1).join(": ");

/** An ID as the page shows it: a key `j6802`, an old issue ID `a1421`; anything else unchanged. */
export const shownId = (s: unknown, repo?: string | null): string => (KEY.test(String(s)) ? shownKey(s, repo ? codes[repo] : undefined) : shortId(s));
/** The detail of an event as text, each issue ID in its short form. */
export const contentText = (e: Partial<Event>): string => shortText(e.detail ?? "");

/**
 * The sentence of each event, by `action`. `{object}` is the thing acted on, `{by}` the subject in words and `{detail}`
 * the detail in place; a sentence with no `{detail}` takes the detail after a colon. `|` ends the verb: the Herald
 * shows what follows it.
 */
const SAY: Record<string, string> = {
  running: "{object} started|", waiting: "{object} waits for| you", passed: "{object} passed its checks|", returned: "{object} returned|", failed: "{object} failed|",
  landed: "{object} landed|", dropped: "{object} dropped|", done: "{object} done|",
  held: "{object} held:| {detail}", paused: "{object} waits:| the factory is paused", red: "{object} waits:| main is red", after: "{object} waits for| {detail}",
  full: "{object} waits:| run slots are full", gpu: "{object} waits for| the GPU", busy: "{object} waits:| {detail}",
  looping: "{object} stopped:| it restarts in a loop", starting: "{object} is| starting", parent: "{object} waits for| its parts",
  parked: "{object} parked|", credit: "{object} waits:| out of credit",
  protected: "{object} asks| to change a protected file", question: "{object} asks| a question", incomplete: "{object} has| a dropped part",
  capped: "{object} hit| its run cap", proposal: "{object} proposes| a change",
  reran: "{object} reran|", started: "{object} picked up|", missed: "{object} missed|", skipped: "{object} skipped|", filed: "{object} filed by| {by}",
  escalated: "{object} escalated to| you", changed: "{object} changed|", answered: "{object} answered by| {by}", routed: "{object} routed|", stalled: "{object} stalled|", reopened: "{object} reopened|",
};
/** What a cause adds as an event's detail: its phrase; "" adds nothing. */
export const BECAUSE: Record<string, string> = {
  "no-commit": "no commit", timeout: "past its time box", stalled: "no output", infra: "a factory step failed", locked: "lock held",
  credit: "out of credit", check: "a check failed", conflict: "merge conflict", moved: "main moved", review: "review held it",
  unanswered: "no answer", other: "", duplicate: "a duplicate", met: "goal met", manual: "by hand", protected: "a protected file",
  question: "a question", intake: "intake", capped: "run cap", override: "over review", error: "an error", rescue: "rescue", local: "", starts: "",
};
/** The phrase for a cause word, or the word itself when it has none. */
export const because = (w: string): string => BECAUSE[w] ?? w;
const WHO: Record<string, string> = { human: "you", rule: "a rule", gate: "the gate", worker: "a worker", reviewer: "review", director: "the director", firefighter: "the firefighter", claude: "Claude Code" };
/** The name of an event's subject: `claude` as "Claude Code", a job as its role. */
export const whoOf = (subject: string, role?: string | null): string => (role ?? WHO[subject] ?? subject);

/** A piece of a sentence: text, or a key the page links. */
type Said = string | { id: string };
const IN_TEXT = new RegExp(`(?:(?<![\\w.-])(?:project|issue|idea|job)\\.\\d+(?![\\w-])|${FREE.source})`, "g");
/** Free text in pieces: each key, and each full issue ID, as a link. */
export function linked(text: string): Said[] {
  const out: Said[] = [];
  let at = 0;
  for (const m of text.matchAll(IN_TEXT)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push({ id: m[0] });
    at = m.index + m[0].length;
  }
  return at < text.length ? [...out, text.slice(at)] : out;
}
/** What an event is about: its job's target, else the object. */
export const targetOf = (e: Partial<EventRow>): string => e.object_target ?? e.object ?? "";

/** An event's sentence in three parts: its ID and verb, the template's words after the verb, and a detail the template does not place. */
function sentence(e: Partial<EventRow>): { verb: Said[]; rest: Said[]; after: Said[] } {
  const review = e.action === "returned" && (e.subject_role === "review" || e.subject === "reviewer");
  const tpl = review ? "{object} returned by| review" : SAY[String(e.action)] ?? `{object} ${e.action}|`, inline = tpl.includes("{detail}");
  // A held event's detail is the hold word, a colon and its facts: the sentence reads `held: after issue.2985`.
  const detail = e.action === "held" ? [wordOf(e), factsOf(e)].filter(Boolean).join(" ") : e.detail ?? "";
  const fill: Record<string, Said[]> = { object: [{ id: e.object ?? "" }], by: [whoOf(e.subject ?? "", e.subject_role)], detail: linked(detail) };
  const [verb, rest] = tpl.split("|").map((t) => t.split(/(\{\w+\})/).filter(Boolean).flatMap((p) => fill[p.slice(1, -1)] ?? [p]));
  return { verb: verb!, rest: rest!, after: !inline && e.detail ? fill.detail : [] };
}
/** The sentence of an event in pieces, as `[{id: "job.6802"}, " landed"]`. */
export function say(e: Partial<EventRow>): Said[] {
  const { verb, rest, after } = sentence(e);
  return [...verb, ...rest, ...(after.length ? [": ", ...after] : [])].reduce<Said[]>((out, p) => (typeof p === "string" && typeof out.at(-1) === "string" ? [...out.slice(0, -1), out.at(-1) + p] : [...out, p]), []);
}
/** What an event's sentence says after its verb, as `["past its time box"]` for `failed: past its time box`. */
export function sayRest(e: Partial<EventRow>): Said[] {
  const { rest, after } = sentence(e);
  return [...rest, ...(rest.length && after.length ? [": "] : []), ...after];
}
/** The sentence of an event as plain text, each ID in its short form. */
export const sayText = (e: Partial<EventRow>): string => say(e).map((p) => (typeof p === "string" ? p : shownId(p.id, p.id === e.object ? e.project : undefined))).join("");

/** The report lane of a job state. */
export const lane = (state: string): string => ({ landed: "landed", waiting: "waiting", failed: "failed", returned: "failed" } as Record<string, string>)[state] ?? "other";

/** Text cut at a word end to at most `max` characters, with `…`; one line. */
export function clip(text: unknown, max: number): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max / 2 ? cut.lastIndexOf(" ") : cut.length)}…`;
}

/** The statuses that close an issue; a parked one is neither open nor closed. */
export const CLOSED = ["done", "dropped"];

/** The four priorities, in rank order. */
export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
/** Who can raise an issue. */
export const SOURCES = ["chris", "worker", "deps", "memory", "agent"] as const;
/** A run kind as a line says it: a build run, once called `worker`, is "implement". */
export const runWord = (kind: string): string => (kind === "build" || kind === "worker" ? NAMES.build.toLowerCase() : kind);
