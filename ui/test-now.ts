import { attend } from "./asks.ts";
import { state } from "./fixtures/status-state.ts";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
// @ts-ignore
export { trailerLine } from "./views/cards.js";

/** Fixtures and helpers shared by the ui/now-*.test.ts files, after ui/test-browser.ts. */

// The asks the server builds from the awaiting runs, the issues and goals with an Ask, and the proposals.
export const asksOf = (runs: any[] = [], issues: any[] = [], lessons: any[] = []) => attend({ runs, issues }, {}, lessons).items;
export const withAttn = (s: any) => view.renderNeeds(s) + view.renderLanes(s);
export const issue = (n: number) => ({ id: `aleph-${n}`, title: `Issue ${n}`, status: "open", href: `#/issues/aleph/${n}`, labels: [], notes: 0, created: "2026-10-27", updated: "2026-10-27" });
export const full: any = { ...state, issues: [issue(1), issue(2)], queued: [{ repo: "aleph", id: 9, title: "w" }] };
export const section = (h: string, id: string) => h.match(new RegExp(`<section id="${id}"[^]*?</section>`))![0];
export const withFactory = (o: object) => ({ ...state, factory: { ...state.factory, health: [], ...o } });
export const rows = (h: string) => h.split('<article class="job-card small issue-row ').slice(1);
export const problem = (row: string) => row.match(/<p class="problem">([^<]*)<\/p>/)![1];
export const prop = { id: "l-1234abcd", kind: "check", title: "No db mocks", target: "aleph checks", sentence: "Do not mock the db.", count: 3, signals: [
  { source: "chris", at: "2026-10-27T10:00:00Z", quote: "No, <script>alert(1)</script>", link: "https://lf/trace/t2" },
  { source: "gate", at: "2026-10-27T11:00:00Z", quote: "deny", link: "" },
] };
