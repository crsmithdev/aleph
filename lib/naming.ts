// The names, IDs and status words of aleph, as docs/naming.md sets them. No DOM and no I/O, so the factory, the CLI
// and the UI server import it, and the UI server serves it to the page as JS (ui/server.ts). No other file defines an ID pattern or a word set.
//
// Throughout: a full ID is `aleph-1430`, a short ID `a1430`; a code is a project's 1–2 letters; a job ID is
// `<subject>#<n>`.

// ---------- word sets ----------

export const STATUSES = ["open", "parked", "done", "dropped"];
export const STATES = ["running", "waiting", "passed", "returned", "failed", "landed", "dropped", "done"];
export const HOLDS = ["paused", "red", "after", "full", "gpu", "busy", "looping", "starting", "parent", "parked", "credit"];
export const ASKS = ["protected", "question", "incomplete", "capped", "proposal"];
export const ACTIONS = [...STATES, ...HOLDS, ...ASKS, "reran", "started", "missed", "skipped", "filed", "escalated", "changed", "answered", "routed"];
export const SUBS = [
  "no-commit", "timeout", "stalled", "infra", "locked", "credit", "check", "conflict", "moved", "review", "unanswered",
  "duplicate", "met", "manual", "protected", "question", "intake", "capped", "override", "error", "rescue",
  "local", "starts", "other",
];
export const ACTORS = ["human", "rule", "gate", "worker", "reviewer", "check", "intake", "director", "monitor", "firefighter"];
export const KINDS = ["build", "recheck", "land", "intake", "director", "monitor"];
/** One display name for each pipeline step and agent role. */
export const NAMES: Record<string, string> = {
  lead: "Lead Time", intake: "Intake", queue: "Queue", triage: "Triage", plan: "Plan", "spec-check": "Spec Check", build: "Build",
  review: "Review", recheck: "Recheck", land: "Land", worker: "Worker", planner: "Planner", merge: "Merge", reviewer: "Reviewer",
  director: "Director", monitor: "Monitor", title: "Title", judge: "Judge",
};
export const STAGES = ["new", "queued", "held", "working", "waiting", "failed", "landing", "done", "dropped", "parked"];
export const LANES = ["landed", "waiting", "failed", "other"];
export const SPEEDS = ["landed", "returned", "failed", "reran", "dropped"];
export const ROUTINES = ["monitor"];

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

// ---------- IDs ----------

let codes: Record<string, string> = {};
let keys: Record<string, string> = {};
/** Set the project codes, `{aleph: "a", …}`, from the registry. */
export function setCodes(map: Record<string, string>): void {
  codes = { ...map };
  keys = Object.fromEntries(Object.entries(map).map(([k, c]) => [c, k]));
}

const FULL = /^([a-z0-9][a-z0-9-]*?)-(\d+)(?:\.(\d+))?$/;
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

const tail = (p: Id) => `${p.n}${p.sub === undefined ? "" : `.${p.sub}`}`;
/** `aleph-1430` for any issue ID; anything else unchanged. */
export const fullId = (s: unknown): string => { const p = parseId(s); return p ? `${p.repo}-${tail(p)}` : String(s ?? ""); };
/** `a1430` for any issue ID of a project with a code; anything else unchanged. */
export const shortId = (s: unknown): string => { const p = parseId(s); return p && codes[p.repo] ? `${codes[p.repo]}${tail(p)}` : String(s ?? ""); };

/** `#/issues/aleph/1430.2`: the page of an issue, from any issue ID; "" for anything else. */
export const issueHref = (s: unknown): string => { const p = parseId(s); return p ? `#/issues/${encodeURIComponent(p.repo)}/${tail(p)}` : ""; };

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
export const refs = (text: unknown): string[] => [...String(text ?? "").matchAll(/(?<![\w.-])[a-z][a-z0-9-]*-\d+(?:\.\d+)?(?![\w-])/g)].map((m) => m[0]);
/** Free text with each full issue ID of a project with a code in its short form. */
export const shortText = (text: unknown): string => String(text ?? "").replace(/(?<![\w.-])[a-z][a-z0-9-]*-\d+(?:\.\d+)?(?![\w-])/g, shortId);

// ---------- events ----------

/** An event with its words checked; throws on a word outside its set. */
export interface Event {
  at: string; by: string; subject: string; action: string; sub?: string; on?: string[]; file?: string; count?: string;
  result?: string; to?: string; note?: string; cost?: number; commit?: string;
}
export function event({ at, by, subject, action, sub, on, file, count, result, to, note, cost, commit }: Omit<Event, "at"> & { at?: string }): Event {
  const bad = ([["by", by, ACTORS], ["action", action, ACTIONS], ["sub", sub, SUBS], ["result", result, STATES], ["to", to, ["human", "director"]],
  ] as [string, string | undefined, string[]][]).find(([, v, set]) => v !== undefined && !set.includes(v));
  if (bad) throw new Error(`naming: ${bad[0]} "${bad[1]}" is not in its set`);
  const e = { at: at ?? new Date().toISOString(), by, subject, action, sub, on, file, count, result, to, note, cost, commit };
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

// ---------- derived sets ----------

/** The report lane of a job state. */
export const lane = (state: string): string => ({ landed: "landed", waiting: "waiting", failed: "failed", returned: "failed" } as Record<string, string>)[state] ?? "other";

/** Text cut at a word end to at most `max` characters, with `…`; one line. */
export function clip(text: unknown, max: number): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max / 2 ? cut.lastIndexOf(" ") : cut.length)}…`;
}
