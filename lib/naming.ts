// The names, IDs and status words of aleph, as docs/naming.md sets them. No DOM and no I/O, so the factory, the CLI
// and the UI server import it, and the UI server serves it to the page as JS (ui/server.ts). No other file defines an ID pattern or a word set.
//
// Throughout: a full ID is `aleph-1430`, a short ID `a1430`; a code is a project's 1–2 letters; a job ID is
// `<subject>#<n>`.

export const STATUSES = ["open", "parked", "done", "dropped"] as const;
export const STATES = ["running", "waiting", "passed", "returned", "failed", "landed", "dropped", "done"];
const HOLDS = ["paused", "red", "after", "full", "gpu", "busy", "looping", "starting", "parent", "parked", "credit"];
const ASKS = ["protected", "question", "incomplete", "capped", "proposal"];
export const ACTIONS = [...STATES, ...HOLDS, ...ASKS, "reran", "started", "missed", "skipped", "filed", "escalated", "changed", "answered", "routed", "refused"];
/** Why a run stopped: the closed set of causes (outcome.ts `Cause`). */
export const CAUSES = ["no-commit", "timeout", "stalled", "infra", "locked", "credit", "check", "conflict", "moved", "review", "unanswered", "other"] as const;
export const SUBS = [
  ...CAUSES,
  "duplicate", "met", "manual", "protected", "question", "intake", "capped", "override", "error", "rescue",
  "local", "starts", "contradiction",
];
export const ACTORS = ["human", "rule", "gate", "worker", "reviewer", "check", "intake", "director", "monitor", "firefighter", "claude"];
/** The kinds of an issue. */
export const ISSUE_KINDS = ["task", "bug", "check", "flake", "acceptance"] as const;
export const KINDS = ["build", "recheck", "land", "intake", "director", "monitor", "chat", "lens", "housekeeper", "maintainer"];
/** One display name for each pipeline step and agent role. */
export const NAMES: Record<string, string> = {
  lead: "Lead Time", intake: "Intake", queue: "Queue", triage: "Triage", plan: "Plan", "spec-check": "Spec Check", build: "Implement",
  review: "Review", recheck: "Recheck", land: "Land", worker: "Worker", planner: "Planner", merge: "Merge", reviewer: "Reviewer",
  director: "Director", monitor: "Monitor", chat: "Chat", lens: "Lens", housekeeper: "Housekeeper", maintainer: "Maintainer", title: "Title", judge: "Judge",
};
export const STAGES = ["new", "queued", "held", "working", "waiting", "failed", "landing", "done", "dropped", "parked"];
export const LANES = ["landed", "waiting", "failed", "other"];
export const SPEEDS = ["landed", "returned", "failed", "reran", "dropped"] as const;
const ROUTINES = ["monitor", "chat", "lens", "housekeeper", "maintainer"];

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

/** `#/issues/aleph/1430.2`: the page of an issue, from any issue ID; "" for anything else. */
export const issueHref = (s: unknown): string => { const p = parseId(s); return p ? `#/issues/${encodeURIComponent(p.repo)}/${tail(p)}` : ""; };

/** `#/jobs/a1430%232`: the page of the job with ID `id`. */
export const jobHref = (id: string): string => `#/jobs/${encodeURIComponent(id)}`;

/** What a run works on: its issue, else its routine (`monitor`), else its name. */
export const subjectOf = (run: { on?: string; kind: string; name: string }): string => run.on ?? (ROUTINES.includes(run.kind) ? run.kind : run.name);

/** `a1430#2`: the job ID of the `n`th job on a subject (an issue ID or a routine). */
export const jobId = (subject: string, n: number): string => `${ROUTINES.includes(subject) ? subject : shortId(subject)}#${n}`;
/** `{subject, n}` for `a1430#2`, `aleph-1430#2`, `a1430-2` or `monitor#14`, with the subject as a full ID; or null. */
export function parseJob(s: unknown): { subject: string; n: number } | null {
  const m = /^(.+?)[#-](\d+)$/.exec(String(s ?? "").trim());
  if (!m) return null;
  if (ROUTINES.includes(m[1])) return { subject: m[1], n: Number(m[2]) };
  const p = parseId(m[1]);
  return p ? { subject: fullId(m[1]), n: Number(m[2]) } : null;
}
/** The job ID in a file or unit name: `a1430-2`. */
export const fileSafe = (job: string): string => String(job).replace("#", "-");

/** Every full issue ID in free text, in order. Short IDs are never read from free text. */
export const refs = (text: unknown): string[] => [...String(text ?? "").matchAll(FREE)].map((m) => m[0]);
/** Free text with each full issue ID of a project with a code in its short form. */
export const shortText = (text: unknown): string => String(text ?? "").replace(FREE, shortId);

/** An event with its words checked; throws on a word outside its set. */
export interface Event {
  at: string; by: string; subject: string; action: string; sub?: string; on?: string[]; file?: string; count?: string;
  result?: string; to?: string; note?: string; cost?: number; commit?: string; tier?: string; model?: string; p?: number; tally?: Record<string, number>; changes?: { id: string; do: string }[];
}
export function event({ at, by, subject, action, sub, on, file, count, result, to, note, cost, commit, tier, model, p, tally, changes }: Omit<Event, "at"> & { at?: string }): Event {
  const bad = ([["by", by, ACTORS], ["action", action, ACTIONS], ["sub", sub, SUBS], ["result", result, STATES], ["to", to, ["human", "director"]],
  ] as [string, string | undefined, string[]][]).find(([, v, set]) => v !== undefined && !set.includes(v));
  if (bad) throw new Error(`naming: ${bad[0]} "${bad[1]}" is not in its set`);
  const e = { at: at ?? new Date().toISOString(), by, subject, action, sub, on, file, count, result, to, note, cost, commit, tier, model, p, tally, changes };
  return Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))) as unknown as Event;
}

const base = (p: string) => String(p).split("/").at(-1);
/** An ID as the page shows it: a job ID `a1421#6`, an issue ID `a1421`; anything else unchanged. */
export const shownId = (s: unknown): string => {
  const j = String(s ?? "").includes("#") ? parseJob(s) : null;
  return j ? jobId(j.subject, j.n) : shortId(s);
};
/**
 * The content of an event as text: `a1372 → issues.js`, `a1421#6 → dropped`, `→ tests`, `3 / 1h`,
 * `docclaims.ts → human`. The arrow comes before a file also when no other field comes first; a file that a `to`
 * follows takes the `to`'s arrow, and none of its own.
 */
export function contentText(e: Partial<Event>): string {
  const on = [e.on ?? []].flat().map(shownId).join(" ");
  return [on, e.count, e.result && `→ ${e.result}`, e.file && `${on || !e.to ? "→ " : ""}${base(e.file)}`, e.to && `→ ${e.to}`]
    .filter(Boolean).join(" ");
}

/**
 * The sentence of each event, by `action` or `action.sub`. `{id}` is the job when the event names one, else the
 * subject; `{issue}` the subject; `{on}` the first ID it is on; `{by}` and `{to}` the actor in words.
 */
const SAY: Record<string, string> = {
  running: "{id} started", waiting: "{id} waits", "waiting.review": "{id} waits for review", "waiting.rescue": "{id} waits for {to}", "waiting.to": "{id} waits for {to}",
  passed: "{id} passed its checks", returned: "{id} returned", "returned.review": "{id} returned by review", failed: "{id} failed",
  landed: "{id} landed", "landed.override": "{id} landed over review", dropped: "{id} dropped", done: "{issue} done",
  paused: "{issue} waits: the factory is paused", red: "{issue} waits: main is red at {on}", after: "{issue} waits for {on}",
  full: "{issue} waits: run slots are full", gpu: "{issue} waits for the GPU", busy: "{issue} waits: {on} holds {file}",
  looping: "{issue} stopped: it restarts in a loop", starting: "{issue} is starting", parent: "{issue} waits for its parts",
  parked: "{issue} parked", credit: "{issue} waits: out of credit",
  protected: "{issue} asks to change a protected file", question: "{issue} asks a question", incomplete: "{issue} has a dropped part",
  capped: "{issue} hit its run cap", proposal: "{issue} proposes a change",
  reran: "{id} reran", started: "{issue} picked up", missed: "{issue} missed", skipped: "{issue} skipped", filed: "{issue} filed by {by}",
  escalated: "{issue} escalated to you", changed: "{issue} changed", answered: "{issue} answered by {by}", routed: "{issue} routed",
};
/** What a `sub` adds after a colon when no `action.sub` sentence exists; "" adds nothing. */
const BECAUSE: Record<string, string> = {
  "no-commit": "no commit", timeout: "past its time box", stalled: "no output", infra: "a factory step failed", locked: "lock held",
  credit: "out of credit", check: "a check failed", conflict: "merge conflict", moved: "main moved", review: "review held it",
  unanswered: "no answer", other: "", duplicate: "a duplicate", met: "goal met", manual: "by hand", protected: "a protected file",
  question: "a question", intake: "intake", capped: "run cap", override: "override", error: "an error", rescue: "rescue", local: "", starts: "",
};
const WHO: Record<string, string> = { human: "you", rule: "a rule", gate: "the gate", worker: "a worker", reviewer: "review", director: "the director", firefighter: "the firefighter", claude: "Claude Code" };
/** The name of an event's actor, `claude` as "Claude Code". */
export const whoOf = (by: string): string => WHO[by] ?? by;

/** A piece of a sentence: text, or an ID the page links. */
export type Said = string | { id: string };
/** The sentence of an event in pieces, as `[{id: "a1868#2"}, " landed"]`. */
export function say(e: Partial<Event>): Said[] {
  const on = [e.on ?? []].flat(), job = on.find((x) => x.includes("#"));
  const key = e.sub && `${e.action}.${e.sub}` in SAY ? `${e.action}.${e.sub}` : e.to && `${e.action}.to` in SAY ? `${e.action}.to` : String(e.action);
  const why = e.sub && key !== `${e.action}.${e.sub}` ? BECAUSE[e.sub] ?? e.sub : "";
  const fill: Record<string, Said> = {
    id: { id: job ?? e.subject ?? "" }, issue: { id: e.subject ?? "" }, on: { id: on[0] ?? "" },
    by: String(WHO[e.by ?? ""] ?? e.by ?? ""), to: String(WHO[e.to ?? ""] ?? e.to ?? ""), file: base(e.file ?? "") ?? "",
  };
  const out = (SAY[key] ?? `{id} ${e.action}`).split(/(\{\w+\})/).filter(Boolean).map((p) => fill[p.slice(1, -1)] ?? p);
  return why ? [...out, `: ${why}`] : out;
}
/** The sentence of an event as plain text, each ID in its short form. */
export const sayText = (e: Partial<Event>): string => say(e).map((p) => (typeof p === "string" ? p : shownId(p.id))).join("");

/** The report lane of a job state. */
export const lane = (state: string): string => ({ landed: "landed", waiting: "waiting", failed: "failed", returned: "failed" } as Record<string, string>)[state] ?? "other";

/** Text cut at a word end to at most `max` characters, with `…`; one line. */
export function clip(text: unknown, max: number): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max / 2 ? cut.lastIndexOf(" ") : cut.length)}…`;
}
