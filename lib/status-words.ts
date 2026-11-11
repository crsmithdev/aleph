// The status sentence: its words and the one verdict that says it. The server records the verdict in the Herald history (ui/state.ts) and the Now view draws it (ui/views/now.js); both call `verdict` here. The page gets this module as JS from the server (ui/server.ts, SHARED).
import { shortText } from "./naming.ts";

/** The sentence when nothing is wrong and nothing asks for Chris. */
const FINE = "Everything is fine";
/** The start of the sentence when something is wrong. */
const ALERT = "Alert: ";
/** The parts of the sentence. A part that leads the sentence starts with a capital: see `lead`. */
const ASK = "your attention is needed";
const PAUSED = "the factory is paused";
const TICK_STOPPED = "the factory tick has stopped";
const JOBS_UNHEALTHY = "jobs are unhealthy";

/** The weekly usage, in percent, from which the sentence says how high it is. The raw value is compared, so 89.6 is not yet. */
const WEEKLY_WARN = 90;
const weekly = (week: number) => `weekly usage is at ${Math.round(week)}%`;

/** A part as the first words of the sentence. */
const lead = (t: string) => t[0].toUpperCase() + t.slice(1);

/** The Herald label of a status sentence: its tone and its text decide it. */
export const labelOf = (tone: string, text: string) =>
  tone === "alert" ? "Alert"
  : text.startsWith(lead(ASK)) ? "Ask"
  : tone !== "warning" ? "Fine"
  : text.startsWith(lead(PAUSED)) ? "Wait" : "Warn";

/** The most parts the sentence says. The Alerts cards list everything. */
const MAX_SAID = 3;
/** How long past due a next tick may be before the tick counts as dead: covers an old state and a late timer. */
const TICK_GRACE_MS = 5 * 60_000;

/** What the sentence says for an error line, by its key, most serious first. A line with no entry is said as it is, after these. */
const ALERTS = [
  ["red-ci", "GitHub CI is broken"],
  ["red-main", "the build is failing on main"],
  ["tick", TICK_STOPPED],
  // No line says this one: a stuck job adds it. It is here for its rank.
  ["jobs", JOBS_UNHEALTHY],
  ["lands-stuck", "lands are stuck"],
  ["queue-stuck", "queued jobs are not starting"],
  ["issues-stuck", "new issues are not becoming jobs"],
];
const rank = (t: string) => { const k = ALERTS.findIndex(([, said]) => said === t); return k < 0 ? ALERTS.length : k; };

/** The facts of a state the verdict reads: the /api/factory state with its asks and usage. */
export interface Facts {
  now: string;
  factory: { paused: boolean; nextTick?: string | null; tickInProgress?: boolean; health?: { text: string; kind: string; key?: string }[] };
  stuck: unknown[];
  /** An Ask with `escalated: false` is still with the director. */
  asks?: { escalated?: boolean }[];
  usage?: { now?: { seven_day?: number } | null } | null;
}

/** An error line: the factory's own trouble, in full, and the key of its alert. */
interface ErrorLine { text: string; key?: string }

/** A part of the sentence and the anchor of the card it links to; "" for a plain part. */
interface Part { text: string; href: string }

export interface Verdict {
  /** `ask` when an Ask leads the sentence. */
  tone: "alert" | "warning" | "ask" | "fine";
  label: string;
  /** The words before the parts, with their separator. */
  head: string;
  parts: Part[];
  /** The whole sentence, with its final period. */
  text: string;
  errors: ErrorLine[];
}

/** The error lines of a state: the alert health lines and a stopped tick, each once. */
function errorLines(s: Facts): ErrorLine[] {
  const f = s.factory;
  const out: ErrorLine[] = (f.health ?? []).filter((l) => l.kind === "alert").map((l) => ({ text: shortText(l.text.replace(/^health:\s*/, "")), key: l.key }));
  if (f.nextTick !== undefined && f.tickInProgress !== true) {
    if (f.nextTick === null) out.push({ text: `${TICK_STOPPED}: aleph-tick.timer has no next run`, key: "tick" });
    else if (Date.parse(s.now) - Date.parse(f.nextTick) > TICK_GRACE_MS) out.push({ text: `${TICK_STOPPED}: aleph-tick.timer was due at ${f.nextTick}`, key: "tick" });
  }
  return out.filter((l, i) => out.findIndex((o) => o.text === l.text) === i);
}

/**
 * The status of a state: "Alert: " and what is wrong; otherwise what asks for Chris, which leads, or the fine
 * sentence; then a weekly usage of WEEKLY_WARN or more and the warning health lines. At most MAX_SAID parts. A
 * `stale` state says first that it is out of date.
 */
export function verdict(s: Facts, stale = false): Verdict {
  const f = s.factory, errors = errorLines(s);
  const alerts = new Set(errors.map((l) => ALERTS.find(([key]) => key === l.key)?.[1] ?? l.text.replace(/\.$/, "")));
  if (s.stuck.length) alerts.add(JOBS_UNHEALTHY);
  const said: Part[] = [...alerts].sort((a, b) => rank(a) - rank(b)).map((t) => ({ text: t, href: t === JOBS_UNHEALTHY ? "#jobs-stuck" : "#awaiting" }));
  // An Ask still with the director does not need Chris yet.
  const asks = (s.asks ?? []).filter((a) => a.escalated !== false);
  if (asks.length) said.push({ text: alerts.size || f.paused || stale ? ASK : lead(ASK), href: "#awaiting" });
  if (f.paused && alerts.size) said.push({ text: PAUSED, href: "" });
  const week = s.usage?.now?.seven_day ?? 0;
  if (week >= WEEKLY_WARN) said.push({ text: weekly(week), href: "" });
  for (const l of f.health ?? []) if (l.kind === "warn") said.push({ text: shortText(l.text.replace(/^health:\s*/, "")), href: "" });
  const parts = said.slice(0, MAX_SAID), more = parts.length ? "; " : "";
  const [tone, head]: [Verdict["tone"], string] = stale ? ["alert", `${ALERT}this status is out of date${more}`]
    : alerts.size ? ["alert", ALERT]
    : asks.length && !f.paused ? ["ask", ""]
    : [parts.length || f.paused ? "warning" : "fine", `${f.paused ? lead(PAUSED) : FINE}${more}`];
  const text = `${head}${parts.map((p) => p.text).join("; ")}.`;
  return { tone, label: labelOf(tone, text), head, parts, text, errors };
}
