// Archived goal tests from ui/now-awaiting.test.ts: `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "../../ui/views/now.js";
import { job, state } from "../../ui/fixtures/status-state.ts";
import { withAttn, issue, full, prop } from "../../ui/test-now.ts";
import { sentAsks } from "./escalated.ts";

test("Needs you groups needs you, then stuck or failed; the lanes hold running and queued; every card is compact", () => {
  const h = view.renderNeeds(full);
  const at = (id: string) => h.indexOf(`id="${id}"`);
  expect(at("awaiting")).toBeGreaterThan(-1);
  expect(at("awaiting")).toBeLessThan(at("jobs-stuck"));
  expect(h).not.toContain("jobs-running");
  const q = view.renderLanes(full);
  expect(q).toMatch(/<h2 id="h-queued">Queued<\/h2><span class="count">1<\/span>/);
  expect(h).not.toContain("job-card big");
  expect(h.match(/class="job-card small[ "]/g)?.length).toBe(h.match(/<article /g)?.length);
  expect(q.match(/class="job-card small lane-card/g)?.length).toBe(1 + 1); // 1 queued, 1 running
});

const sample = (reason: string): { runs: any[]; issues: any[]; lessons: any[] } => {
  const run = (why: string, o: object = {}) => ({ runs: [job({ name: "aleph-27", condition: "awaiting", ask: { kind: why === "held-path" || why === "review" ? "approval" : "input", reason: why }, reason: "<task-notification>x</task-notification> y", item: { id: 27, title: "T" }, ...o })], issues: [] as any[], lessons: [] as any[] });
  const iss = (o: object) => ({ runs: [] as any[], issues: [{ ...issue(7), title: "T", ...o }], lessons: [] as any[] });
  if (["held-path", "review"].includes(reason)) return run(reason, reason === "review" ? { reviewCall: { call: "ask", reason: "r" } } : {});
  if (reason === "question") return run("question", { question: "<agent-message>q</agent-message> Which?" });
  if (reason.startsWith("proposal-")) return { runs: [] as any[], issues: [] as any[], lessons: [{ ...prop, kind: reason.slice(9), target: { check: "aleph checks", "claude-md": "aleph/CLAUDE.md", skill: "skills/aleph/SKILL.md" }[reason.slice(9)] }] };
  const q: Record<string, object> = {
    proposal: { reason: "proposal", question: "T" },
    "host-check": { reason: "host-check", question: "triage: a live check: run it" },
    "no-commit": { reason: "no-commit", question: "ended with no commit, so the factory stopped" },
    "run-cap": { reason: "run-cap", question: "the factory started this goal 3 times in the last hour; it stops starting it until Chris reruns it." },
    "spec-check": { reason: "spec-check", question: "spec check: abc123 hold: the Oracle clause is outside the Edit surface" },
    "triage-failed": { reason: "triage-failed", question: "triage: no verdict in 2 runs: failed: x" },
    "part-dropped": { reason: "part-dropped", question: "A goal was dropped." },
    "acceptance-failed": { reason: "acceptance-failed", question: "acceptance: fail again" },
    rescue: { reason: "rescue", question: "Which one?", decision: { question: "Which?", options: [{ label: "A", line: "a" }], recommended: "A", kind: "input" as const, reason: "question", why: [] } },
    firefighter: { reason: "firefighter", question: "x changes y.ts, a held security path" },
  };
  return iss(q[reason]);
};


test("a question ask renders the Answer button with a text input in the same row", () => {
  const sm = sample("question");
  const items = sentAsks(sm.runs, sm.issues, sm.lessons);
  const h = withAttn({ ...state, stuck: [], factory: { ...state.factory, health: [] }, asks: items });
  const row = h.match(/<article class="job-card small issue-row question"[^]*?<\/article>/)![0];
  expect(row).toMatch(/data-act="answer"[^>]*data-name="aleph-27"|data-name="aleph-27"[^>]*data-act="answer"/);
  expect(row).toMatch(/<input [^>]*type="text"[^>]*name="answer"/);
});
