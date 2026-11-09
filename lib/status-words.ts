// The words of the status sentence and the rules that sort health lines. The server records the sentence (ui/state.ts, ui/api/now.ts) and the Now view draws it (ui/views/now.js); both read them here. The page gets this module as JS from the server (ui/server.ts, SHARED).

/** The sentence when nothing is wrong and nothing asks for Chris. */
export const FINE = "Everything is fine";
/** The start of the sentence when something is wrong. */
export const ALERT = "Alert: ";
/** The parts of the sentence. A part that leads the sentence starts with a capital: see `lead`. */
export const ASK = "your attention is needed";
export const PAUSED = "the factory is paused";
export const TICK_STOPPED = "the factory tick has stopped";
export const JOBS_UNHEALTHY = "jobs are unhealthy";

/** The weekly usage, in percent, from which the sentence says how high it is. The raw value is compared, so 89.6 is not yet. */
export const WEEKLY_WARN = 90;
export const weekly = (week: number) => `weekly usage is at ${Math.round(week)}%`;

/** A part as the first words of the sentence. */
export const lead = (t: string) => t[0].toUpperCase() + t.slice(1);

/** Health lines that are counts for later, not problems: they stay off the sentence and the cards. */
export const QUIET_HEALTH = /passed on rerun|holds \d+ flake notes?/;
/** A red main or a red CI of a repo other than aleph: that repo's trouble, not the factory's, so a warning. */
export const OTHER_REPO_RED = /^(?!aleph )\S+ (main is red|CI on main has failed)/;
/** Health lines that are warnings, not alerts: the sentence says them in the warning colour, and they make no card. */
export const isWarn = (l: string) => /full suite took/.test(l) || OTHER_REPO_RED.test(l.replace(/^health:\s*/, ""));
/** A health line that is an alert. */
export const isAlert = (l: string) => !QUIET_HEALTH.test(l) && !isWarn(l);

/** The Herald label of a status sentence: its tone and its text decide it. */
export const labelOf = (tone: string, text: string) =>
  tone === "alert" ? "Alert"
  : text.startsWith(lead(ASK)) ? "Ask"
  : tone !== "warning" ? "Fine"
  : text.startsWith(lead(PAUSED)) ? "Wait" : "Warn";
