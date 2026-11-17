/** When the tick runs the memory steps: its due rules, the corrections gate and the Memory page read it. */

/** The local hour from which the daily maintainer and the corrections mining are due. */
export const DAILY_HOUR = 3;
/** How often the episodes step runs, in ms. */
export const EPISODES_MS = 30 * 60_000;

/** The daily steps' schedule as the Memory page says it. */
export const DAILY_TEXT = `daily after ${String(DAILY_HOUR).padStart(2, "0")}:00`;
/** The episodes step's schedule as the Memory page says it. */
export const EPISODES_TEXT = `every ${EPISODES_MS / 60_000} min`;
