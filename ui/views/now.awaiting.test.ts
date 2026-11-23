import { afterEach, expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./now.js";
import { attend } from "../asks.ts";
import { setCodes } from "../../lib/naming.ts";
import { job, state } from "../fixtures/status-state.ts";
import { asksOf, withAttn, issue, full, rows, problem } from "../now.testkit.ts";

afterEach(() => setCodes({}));

const NOW = "2026-10-27T17:00:00Z";
const calm = { ...state, now: NOW, asks: [], errored: [], factory: { ...state.factory, health: [], paused: false } };

test("issues that wait for triage are not rows and not in the status line: triage is the factory's", () => {
  const s = { ...full, asks: [], errored: [], factory: { ...full.factory, health: [], paused: false } };
  expect(rows(withAttn(s)).length).toBe(0);
  expect(withAttn(s)).toContain('class="empty"');
  expect(view.renderLede(s)).not.toContain("triage");
});

test("an Ask is a compact alert: its kind, id and headline on one line, its wait, and its buttons with a reason posted without one", () => {
  const note = "triage: for the user: Should `ui/x.ts` use A or B?\nA is simpler.";
  const s = { ...calm, asks: asksOf([], [{ ...issue(152), title: "Which?", question: note, at: "2026-10-27T16:00:00Z", ask: { reason: "question", question: note, options: [], why: [], situation: "Should ui/x.ts use A or B?" } }]) };
  const [row] = rows(withAttn(s));
  expect(row).toContain('data-label="Approve it"');
  expect(row).toContain('data-label="Drop the issue"');
  expect(row).not.toContain("<input");
  expect(row).not.toContain("<details");
  expect(row).toMatch(/<span class="num">\d+h \d+m<\/span><\/div>/);
  expect(row).toContain('href="#/issues/aleph/152"');
});

test("an Ask's Always button is the second button, and grants the project's rule by default", () => {
  const a = { key: "issue:aleph-3", reason: "run-cap", id: "aleph-3", href: "#/issues/aleph/3", repo: "aleph", card: "unstick", label: "Unstick", headline: "H", title: "H", tag: "capped", situation: "s", escalated: true, at: NOW,
    actions: [{ act: "continue", label: "Run again", path: "/p", body: {}, primary: true }, { act: "discontinue", label: "Drop", path: "/d", body: {} }],
    always: { label: "Always run again", action: "continue", hint: "h", scope: "project" } };
  const buttons = rows(withAttn({ ...calm, asks: [a] }))[0].match(/data-label="[^"]+"/g);
  expect(buttons).toEqual(['data-label="Run again"', 'data-label="Always run again"', 'data-label="Drop"']);
  expect(withAttn({ ...calm, asks: [a] })).toContain('data-reason="run-cap:aleph"');
});

/** The one errored alert of a state whose only errored job is `j`. */
const errorCard = (j: object): string => rows(withAttn({ ...calm, errored: [job(j)] }))[0];

test("an errored job's detail is a sentence of its cause", () => {
  expect(problem(errorCard({ name: "aleph-30", state: "failed", cause: "timeout", limit: 2400 }))).toBe("The worker ran past its 40-minute time box and was stopped.");
  expect(problem(errorCard({ name: "aleph-31", state: "failed", cause: "stalled", limit: 600 }))).toBe("The worker gave no output for 10 minutes and was stopped.");
  expect(problem(errorCard({ name: "aleph-30", state: "failed", cause: "check", checkName: "tests" }))).toBe("The check tests failed.");
  expect(problem(errorCard({ name: "aleph-30", state: "failed", cause: "no-commit" }))).toBe("The worker made no commit.");
  expect(problem(errorCard({ name: "aleph-30", state: "failed" }))).toBe("The run failed.");
});

test("an errored job offers Re-check and Drop; with a blocker, Wait for it first", () => {
  setCodes({ aleph: "a" });
  expect(errorCard({ name: "aleph-30", state: "failed", cause: "check" }).match(/data-label="[^"]+"/g)).toEqual(['data-label="Re-check"', 'data-label="Drop"']);
  const card = errorCard({ name: "aleph-30", state: "failed", item: { id: 30, title: "T" }, blocker: { id: "aleph-9", title: "Old work", href: "#/issues/aleph/9" } });
  expect(card.match(/data-label="[^"]+"/g)).toEqual(['data-label="Wait for a9"', 'data-label="Drop"']);
  expect(problem(card)).toBe("Waits on a9: Old work");
});

test("the factory's alerts, a backend hold and an Ask are alerts in that order", () => {
  const s = { ...calm, factory: { ...calm.factory, health: [{ text: "health: aleph CI on main failed 2 runs in a row", kind: "alert", key: "red-ci" }], backend: { via: "OpenRouter", why: "API Error: 402 Insufficient credits. Add more at https://openrouter.ai/settings/credits" } },
    asks: attend({ runs: [], issues: [{ ...issue(7), title: "T", ask: { reason: "no-commit", question: "q", options: [], why: [], situation: "s" } }] }).items };
  const kinds = rows(withAttn(s)).map((r) => r.match(/<b class="ask-kind">([^<]+):<\/b>/)![1]);
  expect(kinds).toHaveLength(3);
  expect([kinds[0], kinds[2]]).toEqual(["Alert", "Backend"]);
  expect(withAttn(s)).toContain('href="https://openrouter.ai/settings/credits"');
});

test("a full start context is no alert: a write demotes the oldest core line", () => {
  expect(withAttn({ ...calm, memory: { start: { aleph: { bytes: 5990, budget: 6000, core: Array(40).fill("x") } } } })).not.toContain("Memory:");
});

test("an Ask alert and a Waiting row show an issue key in the short form of its project", () => {
  setCodes({ aleph: "a" });
  const ask = { key: "run:issue.3461", reason: "protected", id: "issue.3461", href: "#/jobs/job.1", repo: "aleph", card: "approve", label: "Approve", headline: "Land issue.3461", situation: "s", at: NOW, actions: [] };
  const h = withAttn({ ...calm, asks: [ask] });
  expect(h).toContain('href="#/jobs/job.1">a3461</a> Land a3461');
  const waiting = view.renderWaiting({ ...calm, queued: [{ repo: "aleph", id: 3462, title: "T", kind: "after", waits: [{ id: "issue.3461", href: "" }] }] });
  expect(waiting).toContain("<td>a3461</td>");
});

