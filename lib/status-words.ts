// The words of the status sentence. The server records the sentence (ui/state.ts, ui/api/now.ts) and the Now view draws it (ui/views/now.js); both read them here. The page gets this module as JS from the server (ui/server.ts, SHARED).

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

/** The Herald label of a status sentence: its tone and its text decide it. */
export const labelOf = (tone: string, text: string) =>
  tone === "alert" ? "Alert"
  : text.startsWith(lead(ASK)) ? "Ask"
  : tone !== "warning" ? "Fine"
  : text.startsWith(lead(PAUSED)) ? "Wait" : "Warn";
