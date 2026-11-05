import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { attend } from "./asks.ts";
import { job, state } from "./fixtures/status-state.ts";
import { asksOf, withAttn, issue, full, rows, problem, prop } from "./test-now.ts";

test("issues that wait for triage are not rows and not in the status line: triage is the factory's", () => {
  const s = { ...full, asks: [], stuck: [], factory: { ...full.factory, health: [], paused: false } };
  expect(rows(withAttn(s)).length).toBe(0);
  expect(view.renderLede(s)).not.toContain("Awaiting");
  expect(view.renderLede(s)).not.toContain("triage");
});

test("an old prose note gets a Problem with no tag or lead, Approve recommendation and Deny", () => {
  const note = "triage: for Chris: Should `ui/x.ts` use A or B?\nA is simpler. My recommendation is A, because it is simpler. Then more words.";
  const s = { ...state, asks: asksOf([], [{ ...issue(152), title: "Which?", question: note, ask: { kind: "input", reason: "question", question: note, options: [], why: [], situation: "Should ui/x.ts use A or B?" } }]), stuck: [], issues: [], factory: { ...state.factory, health: [] } };
  const [row] = rows(withAttn(s));
  expect(problem(row)).not.toContain("triage: for Chris");
  expect(row).toContain('data-label="Approve recommendation"');
  expect(row).toContain('data-recommendation="true"');
  expect(row).toContain('data-label="Deny"');
  expect(row).toContain('class="reason"');
  expect(row.match(/<details class="more"/g)?.length).toBe(1);
});

/** The case text the director writes when it escalates: until then, the row offers no action. */
const CASE = { situation: "The director sent it to you." };
const sample = (reason: string): { runs: any[]; issues: any[]; lessons: any[] } => {
  const run = (why: string, o: object = {}) => ({ runs: [job({ name: "aleph-27", condition: "awaiting", ask: { kind: why === "held-path" || why === "review" ? "approval" : "input", reason: why, ...CASE }, reason: "<task-notification>x</task-notification> y", item: { id: 27, title: "T" }, ...o })], issues: [] as any[], lessons: [] as any[] });
  const iss = (o: any) => ({ runs: [] as any[], issues: [{ ...issue(7), title: "T", ...o, ask: { kind: "input", reason: o.reason, question: o.question, options: [], why: [], ...CASE } }], lessons: [] as any[] });
  if (["held-path", "review"].includes(reason)) return run(reason, reason === "review" ? { reviewCall: { call: "ask", reason: "r" } } : {});
  if (reason === "question") return run("question", { question: "<agent-message>q</agent-message> Which?" });
  if (reason.startsWith("proposal-")) return { runs: [] as any[], issues: [] as any[], lessons: [{ ...prop, kind: reason.slice(9), target: { check: "aleph checks", "claude-md": "aleph/CLAUDE.md", skill: "skills/aleph/SKILL.md" }[reason.slice(9)] }] };
  const q: Record<string, object> = {
    "no-commit": { reason: "no-commit", question: "ended with no commit, so the factory stopped" },
    "run-cap": { reason: "run-cap", question: "the factory started this goal 3 times in the last hour; it stops starting it until Chris reruns it." },
    "intake-failed": { reason: "intake-failed", question: "Intake failed: the spec: the Oracle is empty" },
    "part-dropped": { reason: "part-dropped", question: "A goal was dropped." },
    rescue: { reason: "rescue", question: "Which one?", decision: { question: "Which?", options: [{ label: "A", line: "a" }], recommended: "A", kind: "input" as const, reason: "question", why: [] } },
  };
  return iss(q[reason]);
};

test("the deny and answer inputs render hidden", () => {
  for (const reason of ["question"]) {
    const sm = sample(reason);
    const row = withAttn({ ...state, stuck: [], factory: { ...state.factory, health: [] }, asks: attend(sm, sm.lessons).items }).match(/<article [^]*?<\/article>/)![0];
    const inputs = row.match(/<input [^>]*>/g) ?? [];
    expect(inputs.length).toBeGreaterThan(0);
    for (const i of inputs) expect(i).toMatch(/\shidden/);
  }
});

test("an ask and a stuck run are one Alerts section, and the stuck card has the Ask card structure in the red tone", () => {
  const s = { ...state, asks: asksOf([], [{ ...issue(152), title: "Which?", question: "q", ask: { kind: "input", reason: "question", question: "q", options: [], why: [], situation: "s" } }], []), stuck: [job({ name: "aleph-30", condition: "stuck", reason: "types failed" })], factory: { ...state.factory, health: [], paused: false } };
  const h = view.renderNeeds(s);
  expect(h).toContain('<h2 id="h-needs">Alerts</h2><span class="count">2</span>');
  expect(h).not.toContain("Stuck or failed");
  const stuck = h.match(/<article[^>]*data-kind="stuck"[^]*?<\/article>/)![0];
  expect(stuck).toContain('data-card="unstick"');
  expect(stuck).toMatch(/<div class="ask-box"><div class="ih">[^]*<details class="ask-fold"/);
});
