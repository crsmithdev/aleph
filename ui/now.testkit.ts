import { attend } from "./asks.ts";
import { state } from "./fixtures/status-state.ts";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";

/** Fixtures and helpers shared by the ui/now-*.test.ts files, after ui/browser.testkit.ts. */

// The asks the server builds from the awaiting runsand the issues with an Ask.
export const asksOf = (runs: any[] = [], issues: any[] = []) => attend({ runs, issues }).items;
/** The Problems card: the factory's alerts, the asks, the errored jobs, a backend hold and a full start context. */
export const withAttn = (s: any) => view.renderProblems(s);
export const issue = (n: number) => ({ id: `aleph-${n}`, title: `Issue ${n}`, status: "open", href: `#/issues/aleph/${n}`, labels: [], notes: 0, created: "2026-10-27", updated: "2026-10-27" });
export const full: any = { ...state, queued: [{ repo: "aleph", id: 9, title: "w" }] };
export const withFactory = (o: object) => ({ ...state, factory: { ...state.factory, health: [], ...o } });
/** The alert cards of the Problems card. */
export const rows = (h: string) => h.split('<article class="alert" ').slice(1);
/** The muted detail of an alert card. */
export const problem = (row: string) => row.match(/<span class="pdetail">([^<]*)<\/span>/)![1].trim();

/** An event row, `event_rows` as the stream and the state send it, from `at`, `by`, the issue or job it is on and the detail. A hold takes its key from `on` as its detail. */
export const row = (e: { at: string; by: string; subject: string; action: string; on?: string[]; file?: string; note?: string; cost?: number; commit?: string; size?: string; model?: string }) => {
  const hold = ["busy", "after", "red"].includes(e.action);
  const detail = hold ? [e.on?.[0], e.action === "busy" ? "holds" : "", e.file, e.note].filter(Boolean).join(" ") : e.note;
  return { time: e.at, subject: e.by, action: e.action, object: !hold && e.on?.[0] ? e.on[0] : e.subject, object_target: !hold && e.on?.[0] ? e.subject : null, ...(detail ? { detail } : {}), size: e.size ?? null, model: e.model ?? null, cost: e.cost ?? null, commit_sha: e.commit ?? null };
};
