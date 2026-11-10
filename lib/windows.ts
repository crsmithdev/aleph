// The windows that a page's `?window=` names: each name and its length. The server reads `?window=` through `scopeOf` (ui/api/scope.ts) and the page through `scope` (ui/lib.js); the page gets this module as JS from the server (ui/server.ts, SHARED).

export const DAY = 86_400_000;
/** The length of each window in ms. */
export const WINDOWS: Record<string, number> = { hour: DAY / 24, day: DAY, week: 7 * DAY, month: 30 * DAY, quarter: 90 * DAY };
/** The windows of the Factory pages. */
export const FACTORY = ["hour", "day", "week", "month"] as const;
export type Window = (typeof FACTORY)[number];
/** The windows of the Sessions page, and of the skills it reads. */
export const SESSIONS = ["week", "month", "quarter"];
