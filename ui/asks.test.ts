import { describe, expect, test } from "bun:test";
import { asks, clean, stuckBlocker } from "./asks.ts";
import { ASK_REASONS, type Ask } from "../jobs/lib/ask.ts";
import type { Lesson } from "../jobs/lib/corrections.ts";
import type { Job, NewIssue } from "./state.ts";

/** Stored case text the fixtures put on their Ask while a test sets it. */
let STORE: Partial<Ask> | undefined;
const run = (reason: string, extra: Partial<Job> = {}): Job => ({
  name: "aleph-27", repo: "aleph", item: { id: 27, title: "a title" }, condition: "awaiting", started: "2026-10-28T00:00:00Z",
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
  review: () => ofRuns(run("review", { reviewCall: { call: "back", reason: "tests are missing" } })),
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


  const key = (a: { act: string; args: Record<string, string> }) => (a.act === "decide" && a.args.option ? `decide:${a.args.option}` : a.act);
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

  test("an Ask the director still holds is tagged as its call; once escalated it has the reason's tag", () => {
    const held = ofIssues(issue({ reason: "question", question: "what now?", ask: { kind: "input", reason: "question", question: "q", options: [], why: [] } as Ask }))[0];
    expect(held.tag).toBe("Director's call");
    STORE = { situation: "The port is taken, so pick one." };
    try { expect(ofIssues(issue({ reason: "question", question: "what now?" }))[0].tag).toBe("Your choice"); } finally { STORE = undefined; }
  });

  test("an issue with a reason the table does not name is a question", () => {
    expect(ofIssues(issue({ reason: "nope", question: "what now?" }))[0].reason).toBe("question");
  });

  test("an old note's timestamp is not part of the detail or the Problem", () => {
    expect(clean("- 2026-10-27 12:34: which helper?")).toBe("which helper?");
    expect(clean("- 2026-10-27 12:34:56: triage: for Chris: pick one")).toBe("pick one");
    const [t] = ofIssues(issue({ reason: "intake-failed", question: "- 2026-10-27 12:34: Intake failed: no verdict in 2 runs" }));
    expect(t.problem).toBe("Intake of aleph-387 failed: no verdict in 2 runs, so no one has decided what to do with this issue.");
  });
});

describe("stuck rows", () => {
  const stuck = run("held-path", { condition: "stuck", reason: "no commit" });
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
});
