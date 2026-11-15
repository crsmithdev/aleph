// The names, IDs and status words of aleph, as docs/naming.md sets them. No DOM and no I/O, so the factory, the CLI
// and the UI server import it, and the UI server serves it to the page as JS (ui/server.ts). No other file defines an ID pattern or a word set.
//
// Throughout: a full ID is `aleph-1430`, a short ID `a1430`; a code is a project's 1–2 letters; a job's key is `job.<n>`.

export const STATUSES = ["open", "parked", "done", "dropped"] as const;
export const STATES = ["running", "waiting", "passed", "returned", "failed", "landed", "dropped", "done"] as const;
const HOLDS = ["paused", "red", "after", "full", "gpu", "busy", "looping", "starting", "parent", "parked", "credit"] as const;
const ASKS = ["protected", "question", "incomplete", "capped", "proposal"] as const;
export const ACTIONS: readonly string[] = [...STATES, ...HOLDS, ...ASKS, "reran", "started", "missed", "skipped", "filed", "escalated", "changed", "answered", "routed", "stalled"];
/** Why a run stopped: the closed set of causes (outcome.ts `Cause`). */
export const CAUSES = ["no-commit", "timeout", "stalled", "infra", "locked", "credit", "check", "conflict", "moved", "review", "unanswered", "other"] as const;
/** The subjects that are not a job: code (`gate`, `rule`), Chris and an interactive session. */
export const SUBJECTS = ["gate", "rule", "human", "claude"] as const;
/** Role words of events written before jobs had keys; read for old data only. */
const OLD_ROLES = ["worker", "reviewer", "check", "intake", "director", "monitor", "firefighter"] as const;
export const ACTORS: readonly string[] = [...SUBJECTS, ...OLD_ROLES];
/** The kinds of an issue. */
export const ISSUE_KINDS = ["task", "bug", "check", "flake"] as const;
/** The roles of a job: what it does. `review` is the reviewer's job, its `prev` the build it reviews. */
export const ROLES = ["build", "plain", "land", "review", "intake", "recheck", "director", "monitor", "lens", "housekeeper", "maintainer"] as const;
export type State = (typeof STATES)[number];
export type Role = (typeof ROLES)[number];
/** The roles that one agent call opens (`openRun`): the others start a unit or a command. */
export type AgentRole = Exclude<Role, "build" | "plain" | "land" | "review" | "recheck">;
/** One display name for each pipeline step and agent role. */
export const NAMES: Record<string, string> = {
  lead: "Lead Time", intake: "Intake", queue: "Queue", triage: "Triage", plan: "Plan", "spec-check": "Spec Check", build: "Implement",
  review: "Review", recheck: "Recheck", land: "Land", worker: "Worker", planner: "Planner", merge: "Merge", reviewer: "Reviewer",
  director: "Director", monitor: "Monitor", lens: "Lens", housekeeper: "Housekeeper", maintainer: "Maintainer", title: "Title", judge: "Judge",
};
export const STAGES = ["new", "queued", "held", "working", "waiting", "failed", "landing", "done", "dropped", "parked"] as const;
export type StageName = (typeof STAGES)[number];
export const LANES = ["landed", "waiting", "failed", "other"];
export const SPEEDS = ["landed", "returned", "failed", "reran", "dropped"] as const;

/** Old words, per set, that live code still writes or reads, and the new word each reads as. A word not listed is already new. */
export const OLD: Record<string, Record<string, string>> = {
  ask: {
    "held-path": "protected", review: "returned", "no-commit": "failed", "part-dropped": "incomplete",
    "intake-failed": "failed", rescue: "waiting", "run-cap": "capped",
  },
  gate: { pause: "paused", baseline: "red", "live-cap": "full", "busy-file": "busy", "loop-guard": "looping", "credit-wait": "credit" },
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
/** Set the project codes, `{aleph: "a", …}`, from the registry. */
export function setCodes(map: Record<string, string>): void {
  codes = { ...map };
  keys = Object.fromEntries(Object.entries(map).map(([k, c]) => [c, k]));
}

/** The kinds of a stored thing: its key is `<kind>.<n>`. */
export const KEY_KINDS = ["project", "issue", "idea", "job"] as const;
export type KeyKind = (typeof KEY_KINDS)[number];
/** The upper-case letter that shows a key's kind; a project code is lower-case, so the two never clash; the letters are placeholders until the Herald redesign decides them. */
const LETTER: Record<KeyKind, string> = { project: "P", issue: "I", idea: "D", job: "J" };
const KEY = /^(project|issue|idea|job)\.(\d+)$/;
const SHOWN = /^([A-Za-z]{1,2})-(\d+)$/;

/** `issue.2072` from a kind and a number. */
export const key = (kind: KeyKind, n: number): string => `${kind}.${n}`;
/** `{kind, n}` for a key, or for its shown form: `I-02072` and `a-02072` (a known project code) read as an issue; or null. */
export function parseKey(s: unknown): { kind: KeyKind; n: number } | null {
  const t = String(s ?? "").trim(), k = KEY.exec(t), sh = k ? null : SHOWN.exec(t);
  if (k) return { kind: k[1] as KeyKind, n: Number(k[2]) };
  const kind = sh && (KEY_KINDS.find((x) => LETTER[x] === sh[1]) ?? (keys[sh[1]] ? "issue" : undefined));
  return sh && kind ? { kind, n: Number(sh[2]) } : null;
}
/** A key as the page and the terminal show it: `J-06802`, number padded to 5 digits; an issue takes its project's `code` when given (`a-01234`). Anything else unchanged. */
export function shownKey(s: unknown, code?: string): string {
  const k = parseKey(s);
  return k ? `${k.kind === "issue" && code ? code : LETTER[k.kind]}-${String(k.n).padStart(5, "0")}` : String(s ?? "");
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
  if (k) return k.kind === "issue" && repo ? `#/issues/${encodeURIComponent(repo)}/${k.n}` : "";
  return p ? `#/issues/${encodeURIComponent(p.repo)}/${tail(p)}` : "";
};

/** `#/jobs/a1430%232`: the page of the job with ID `id`. */
export const jobHref = (id: string): string => `#/jobs/${encodeURIComponent(id)}`;

/** Every full issue ID in free text, in order. Short IDs are never read from free text. */
export const refs = (text: unknown): string[] => [...String(text ?? "").matchAll(FREE)].map((m) => m[0]);
/** Free text with each full issue ID of a project with a code in its short form. */
export const shortText = (text: unknown): string => String(text ?? "").replace(FREE, shortId);

/** An event: a sentence of 6 fields, and the tier of a start. `object` is a key (an old issue ID until issues have keys), or `settings`. */
export interface Event { seq?: number; time: string; subject: string; action: string; object: string; detail?: string | null; tier?: string | null }
/** An event as `event_rows` gives it: the roles, project and run fields of the jobs it names. */
export interface EventRow extends Event {
  subject_role?: string | null; object_role?: string | null; object_target?: string | null; project?: string | null;
  model?: string | null; cost?: number | null; commit_sha?: string | null; started?: string | null; ended?: string | null;
}
const JOB = /^job\.\d+$/;
/** An event with its words checked; throws on a word outside its set. */
export function event({ time, subject, action, object, detail, tier }: Omit<Event, "time"> & { time?: string }): Event {
  if (!JOB.test(subject) && !ACTORS.includes(subject)) throw new Error(`naming: subject "${subject}" is not a job key or in its set`);
  if (!ACTIONS.includes(action)) throw new Error(`naming: action "${action}" is not in its set`);
  return { time: time ?? new Date().toISOString(), subject, action, object, ...(detail ? { detail } : {}), ...(tier ? { tier } : {}) };
}

/** An ID as the page shows it: a key `J-06802`, an old issue ID `a1421`; anything else unchanged. */
export const shownId = (s: unknown, repo?: string | null): string => (KEY.test(String(s)) ? shownKey(s, repo ? codes[repo] : undefined) : shortId(s));
/** The detail of an event as text, each issue ID in its short form. */
export const contentText = (e: Partial<Event>): string => shortText(e.detail ?? "");

/**
 * The sentence of each event, by `action`. `{object}` is the thing acted on, `{by}` the subject in words and `{detail}`
 * the detail in place; a sentence with no `{detail}` takes the detail after a colon.
 */
const SAY: Record<string, string> = {
  running: "{object} started", waiting: "{object} waits for you", passed: "{object} passed its checks", returned: "{object} returned", failed: "{object} failed",
  landed: "{object} landed", dropped: "{object} dropped", done: "{object} done",
  paused: "{object} waits: the factory is paused", red: "{object} waits: main is red", after: "{object} waits for {detail}",
  full: "{object} waits: run slots are full", gpu: "{object} waits for the GPU", busy: "{object} waits: {detail}",
  looping: "{object} stopped: it restarts in a loop", starting: "{object} is starting", parent: "{object} waits for its parts",
  parked: "{object} parked", credit: "{object} waits: out of credit",
  protected: "{object} asks to change a protected file", question: "{object} asks a question", incomplete: "{object} has a dropped part",
  capped: "{object} hit its run cap", proposal: "{object} proposes a change",
  reran: "{object} reran", started: "{object} picked up", missed: "{object} missed", skipped: "{object} skipped", filed: "{object} filed by {by}",
  escalated: "{object} escalated to you", changed: "{object} changed", answered: "{object} answered by {by}", routed: "{object} routed", stalled: "{object} stalled",
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
export type Said = string | { id: string };
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

/** The sentence of an event in pieces, as `[{id: "job.6802"}, " landed"]`. */
export function say(e: Partial<EventRow>): Said[] {
  const tpl = SAY[String(e.action)] ?? `{object} ${e.action}`, inline = tpl.includes("{detail}");
  const fill: Record<string, Said[]> = { object: [{ id: e.object ?? "" }], by: [whoOf(e.subject ?? "", e.subject_role)], detail: linked(e.detail ?? "") };
  const out = tpl.split(/(\{\w+\})/).filter(Boolean).flatMap((p) => fill[p.slice(1, -1)] ?? [p]);
  if (e.action === "returned" && (e.subject_role === "review" || e.subject === "reviewer")) out.push(" by review");
  return !inline && e.detail ? [...out, ": ", ...fill.detail] : out;
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
