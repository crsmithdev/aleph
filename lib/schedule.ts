/** When the tick runs the memory steps: its due rules, and the Memory page read it. */

/** The local hour from which the daily maintainer is due. */
export const DAILY_HOUR = 3;

/** The daily steps' schedule as the Memory page says it. */
export const DAILY_TEXT = `daily after ${String(DAILY_HOUR).padStart(2, "0")}:00`;
