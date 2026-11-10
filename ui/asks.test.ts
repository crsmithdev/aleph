import { describe, expect, test } from "bun:test";
import { asks, stuckBlocker } from "./asks.ts";
import { ASK_REASONS, type Ask } from "../jobs/lib/asks/ask.ts";
import type { Lesson } from "../jobs/lib/learning/corrections.ts";
import type { Job, NewIssue } from "./state.ts";

/** Stored case text the fixtures put on their Ask while a test sets it. */
let STORE: Partial<Ask> | undefined;
const run = (reason: string, extra: Partial<Job> = {}): Job => ({
  name: "aleph-27", repo: "aleph", item: { id: 27, title: "a title" }, condition: "waiting", started: "2026-10-28T00:00:00Z",
  ask: { kind: reason === "held-path" || reason === "review" ? "approval" : "input", reason, ...STORE },
  run: { kind: "build", started: "2026-10-28T00:00:00Z" }, defaults: [], followups: [], ...extra,
} as Job);
const issue = (extra: Partial<NewIssue> = {}): NewIssue => ({ id: "aleph-387", title: "t", status: "open", href: "#/issues/aleph/387", labels: [], notes: 1, created: "", updated: "", ...extra,
  ...(STORE ? { ask: { kind: "input", reason: extra.reason ?? "question", question: "q", options: [], why: [], ...STORE } as Ask } : {}) });
const TARGET = { check: "aleph checks", "claude-md": "identity/CLAUDE.md", skill: "skills/tdd/SKILL.md" } as const;
const lesson = (kind: Lesson["kind"]): Lesson => ({ id: "L1", title: "Format first", target: TARGET[kind!], sentence: "Run the formatter before landing", state: "proposed", kind, count: 3, signals: [{ id: "s", source: "chris", at: "2026-10-27", quote: "format it", link: "" }], ...(STORE && { situation: STORE.situation, effects: STORE.effects, recommend: STORE.recommend }) });
const decision = { question: "Should it be A or B?", options: [{ label: "A", line: "do a" }, { label: "B", line: "do b" }], recommended: "B", kind: "input" as const, reason: "question", why: ["w"] };
const RUN_CAP = "the factory started this goal 3 times in the last hour; it stops starting it until Chris reruns it.";

const ofRuns = (...runs: Job[]) => asks({ runs, issues: [] }, []);
const ofIssues = (...issues: NewIssue[]) => asks({ runs: [], issues }, []);

const CASES: Record<string, () => ReturnType<typeof asks>> = {
  "held-path": () => ofRuns(run("held-path", { reason: "changes hooks/x.ts" })),
  review: () => ofRuns(run("review", { reviewCall: { call: "returned", reason: "tests are missing" } })),
  question: () => ofRuns(run("question", { question: "Which port?" })),
  "no-commit": () => ofIssues(issue({ reason: "no-commit", question: "the last 3 runs of this goal ended with no commit, so the factory stopped starting it; rewrite the goal." })),
  "run-cap": () => ofIssues(issue({ reason: "run-cap", question: RUN_CAP })),
  "intake-failed": () => ofIssues(issue({ reason: "intake-failed", question: "Intake failed: no verdict in 2 runs: failed: its process ended before a verdict" })),
  "part-dropped": () => ofIssues(issue({ reason: "part-dropped", decision: { ...decision, options: [{ label: "Close with what landed", line: "close" }, { label: "Plan the missing part", line: "plan" }], recommended: "Close with what landed" }, question: "A goal was dropped." })),
  rescue: () => ofIssues(issue({ reason: "rescue", decision, question: "Should it be A or B?" })),
  "proposal-check": () => asks({ runs: [], issues: [] }, [lesson("check")]),
  "proposal-claude-md": () => asks({ runs: [], issues: [] }, [lesson("claude-md")]),
  "proposal-skill": () => asks({ runs: [], issues: [] }, [lesson("skill")]),
};

describe("asks", () => {


  const key = (a: { act: string; body: Record<string, unknown> }) => (a.act === "decide" && a.body.label ? `decide:${a.body.label}` : a.act);
  for (const reason of Object.keys(ASK_REASONS)) {
    /** The case's first entry once the director escalated it with this case text. */
    const escalated = (text: Partial<Ask>) => { STORE = text; try { return CASES[reason]()[0]; } finally { STORE = undefined; } };
    test(`${reason}: with no case text the Ask is with the director and offers no action; the director's case text brings the actions`, () => {
      const [plain] = CASES[reason]();
      expect(plain.escalated).toBe(false);
      expect(plain.situation).toBe(plain.problem);
      expect(plain.actions).toEqual([]);
      expect(plain.always).toBeUndefined();
      const bare = escalated({ situation: "Stored situation." });
      expect(bare.actions.length).toBeGreaterThan(0);
      expect(bare.actions.some((a) => a.recommended)).toBe(false);
      STORE = { situation: "Stored situation.", effects: bare.actions.map((a) => ({ action: key(a), text: `Effect of ${key(a)}.` })), recommend: { action: key(bare.actions[0]), why: "it is safest" } };
      try {
        const [it] = CASES[reason]();
        expect(it.situation).toBe("Stored situation.");
        expect(it.escalated).toBe(true);
        expect(it.actions.map((a) => a.act)).toEqual(bare.actions.map((a) => a.act));
        expect(it.actions.filter((a) => a.recommended).length).toBe(1);
        for (const a of it.actions) expect(a.hint).toBe(`Effect of ${key(a)}.`);
        expect(it.more).toContain(`Recommended, ${it.actions.find((a) => a.recommended)!.label}: It is safest.`);
        expect(it.always?.hint).toBe(bare.always?.hint);
      } finally { STORE = undefined; }
    });
  }

  test("each action carries the POST its button sends", () => {
    STORE = { situation: "Stored situation." };
    try {
      const req = (reason: string) => CASES[reason]()[0].actions.map(({ act, path, body, confirm, input }) => ({ act, path, body, confirm, input }));
      expect(ofRuns(run("question", { question: "Which port?", id: "a#27" }))[0].actions.map(({ act, path, body, confirm, input }) => ({ act, path, body, confirm, input }))).toEqual([
        { act: "answer", path: "/api/jobs/a%2327/answer", body: {}, confirm: undefined, input: { name: "answer" } },
        { act: "drop", path: "/api/jobs/a%2327/drop", body: {}, confirm: true, input: undefined },
      ]);
      expect(req("rescue")).toEqual([
        { act: "decide", path: "/api/issues/aleph-387/decide", body: { label: "B" }, confirm: undefined, input: undefined },
        { act: "decide", path: "/api/issues/aleph-387/decide", body: { label: "A" }, confirm: undefined, input: undefined },
        { act: "drop", path: "/api/issues/aleph-387/drop", body: {}, confirm: true, input: undefined },
      ]);
      expect(req("intake-failed").map((a) => [a.path, a.body])).toEqual([["/api/issues/aleph-387/retriage", {}], ["/api/issues/aleph-387/drop", { reason: "Chris closed it" }]]);
      expect(req("proposal-check").map((a) => a.path)).toEqual(["/api/proposals/L1/approve", "/api/proposals/L1/decline"]);
      const deny = ofIssues(issue({ reason: "question", decision, question: "Should it be A or B?" }))[0].actions.find((a) => a.act === "deny");
      expect(deny).toMatchObject({ path: "/api/issues/aleph-387/drop", body: { reason: "Chris denied it" }, input: { name: "reason", lead: "Chris denied: " } });
    } finally { STORE = undefined; }
  });

  test("the part-dropped card reads as a sub-issue, with no goal", () => {
    const [a] = CASES["part-dropped"]();
    expect(a.problem).toBe("A sub-issue of aleph-387 was dropped and no other sub-issue of it is open.");
    expect(a.problem).not.toContain("goal");
  });

  test("an Ask the director still holds is tagged as its call; once escalated it has the reason's tag", () => {
    const held = ofIssues(issue({ reason: "question", question: "what now?", ask: { kind: "input", reason: "question", question: "q", options: [], why: [] } as Ask }))[0];
    expect(held.tag).toBe("director");
    STORE = { situation: "The port is taken, so pick one." };
    try { expect(ofIssues(issue({ reason: "question", question: "what now?" }))[0].tag).toBe("question"); } finally { STORE = undefined; }
  });

  test("the approve of a proposal, with and without a lesson, reopens the issue and says neither File nor goal", () => {
    STORE = { situation: "Stored situation." };
    try {
      const approves = [
        ...CASES["proposal-check"]()[0].actions.filter((a) => a.act === "approve"),
        ...ofIssues(issue({ reason: "proposal-check", question: "q" }))[0].actions.filter((a) => a.act === "approve"),
      ];
      expect(approves.length).toBe(2);
      for (const a of approves) {
        expect(`${a.label} ${a.hint}`).toMatch(/[Rr]eopen/);
        expect(`${a.label} ${a.hint}`).not.toMatch(/File|files|goal/);
      }
      const always = CASES["proposal-check"]()[0].always!;
      expect(always.hint).toMatch(/[Rr]eopen/);
      expect(always.hint).not.toMatch(/File|files|goal/);
      expect(always.hint).toContain("aleph always revoke");
      const reruns = [
        ...CASES["no-commit"]()[0].actions.filter((a) => a.act === "rerun"),
        ...CASES["run-cap"]()[0].actions.filter((a) => a.act === "rerun"),
      ];
      expect(reruns.length).toBe(2);
      for (const a of reruns) expect(`${a.label} ${a.hint}`).not.toContain("goal");
    } finally { STORE = undefined; }
  });

  test("an issue with a reason the table does not name is a question", () => {
    expect(ofIssues(issue({ reason: "nope", question: "what now?" }))[0].reason).toBe("question");
  });

  test("a failed intake's Problem names why it failed", () => {
    const [t] = ofIssues(issue({ reason: "intake-failed", question: "Intake failed: no verdict in 2 runs" }));
    expect(t.problem).toBe("Intake of aleph-387 failed: no verdict in 2 runs, so no one has decided what to do with this issue.");
  });
});

describe("stuck rows", () => {
  const stuck = run("held-path", { condition: "failed", reason: "no commit" });
  const open = new Map([["aleph-12", { title: "Land the base", href: "#/issues/aleph/12" }]]);
  test("an item waiting on an open issue gets its id and title", () => {
    const b = stuckBlocker(stuck, "aleph-12", open);
    expect(b).toEqual({ id: "aleph-12", title: "Land the base", href: "#/issues/aleph/12" });
  });
  test("a last run that names an open issue is the blocker", () => {
    expect(stuckBlocker({ ...stuck, reason: "needs aleph-12 to land first" }, undefined, open)?.id).toBe("aleph-12");
  });
  test("no open blocker gives null", () => {
    expect(stuckBlocker(stuck, "aleph-99", open)).toBeNull();
    expect(stuckBlocker({ ...stuck, reason: "aleph-27 again" }, "aleph-27", new Map([["aleph-27", { title: "t", href: "" }]]))).toBeNull();
  });
  test("a reason that names an open goal's part is the blocker; one that holds only a sha is not", () => {
    const part = new Map([["aleph-12.3", { title: "Land the base", href: "#/issues/aleph/12.3" }]]);
    expect(stuckBlocker({ ...stuck, reason: "needs aleph-12.3 to land first" }, undefined, part)).toEqual({ id: "aleph-12.3", title: "Land the base", href: "#/issues/aleph/12.3" });
    expect(stuckBlocker({ ...stuck, reason: "the fix is in a143077" }, undefined, part)).toBeNull();
  });
});
