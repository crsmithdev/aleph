import { describe, expect, test } from "bun:test";
import { asks, stuckBlocker } from "./asks.ts";
import { ASK_REASONS, type Ask } from "../jobs/lib/asks/ask.ts";
import type { Lesson } from "../jobs/lib/learning/corrections.ts";
import { withEnv } from "./server.testkit.ts";
import { reasonText } from "./asks.ts";
import type { Job, NewIssue } from "./state.ts";

/** Stored case text the fixtures put on their Ask while a test sets it. */
let STORE: Partial<Ask> | undefined;
const run = (reason: string, extra: Partial<Job> = {}): Job => ({
  name: "aleph-27", repo: "aleph", item: { id: 27, title: "a title" }, state: "waiting", started: "2026-10-28T00:00:00Z",
  ask: { reason, ...STORE },
  run: { role: "build", started: "2026-10-28T00:00:00Z" }, defaults: [], followups: [], ...extra,
} as Job);
const issue = (extra: Partial<NewIssue> = {}): NewIssue => ({ id: "aleph-387", title: "t", status: "open", href: "#/issues/aleph/387", labels: [], notes: 1, created: "", updated: "", ...extra,
  ...(STORE ? { ask: { reason: extra.reason ?? "question", question: "q", options: [], why: [], ...STORE } as Ask } : {}) });
const TARGET = { check: "aleph checks", "claude-md": "identity/CLAUDE.md", skill: "skills/write-tests/SKILL.md" } as const;
const lesson = (kind: Lesson["kind"]): Lesson => ({ id: "L1", title: "Format first", target: TARGET[kind!], sentence: "Run the formatter before landing", state: "proposed", kind, count: 3, signals: [{ id: "s", source: "chris", at: "2026-10-27", quote: "format it", link: "" }], ...(STORE && { situation: STORE.situation, effects: STORE.effects, recommend: STORE.recommend }) });
const decision = { question: "Should it be A or B?", options: [{ label: "A", line: "do a" }, { label: "B", line: "do b" }], recommended: "B", reason: "question", why: ["w"] };
const RUN_CAP = "the factory started this goal 3 times in the last hour; it stops starting it until Chris reruns it.";

const ofRuns = (...runs: Job[]) => asks({ runs, issues: [] }, []);
const ofIssues = (...issues: NewIssue[]) => asks({ runs: [], issues }, []);

const CASES: Record<string, () => ReturnType<typeof asks>> = {
  "held-path": () => ofRuns(run("held-path", { reason: "changes hooks/x.ts" })),
  "review-held": () => ofRuns(run("review-held", { reviewCall: { call: "returned", reason: "tests are missing" } })),
  question: () => ofRuns(run("question", { question: "Which port?" })),
  "no-commit": () => ofIssues(issue({ reason: "no-commit", question: "the last 3 runs of this goal ended with no commit, so the factory stopped starting it; rewrite the goal." })),
  "run-cap": () => ofIssues(issue({ reason: "run-cap", question: RUN_CAP })),
  "intake-failed": () => ofIssues(issue({ reason: "intake-failed", question: "Intake failed: no verdict in 2 runs: failed: its process ended before a verdict" })),
  "part-dropped": () => ofIssues(issue({ reason: "part-dropped", decision: { ...decision, options: [{ label: "Close as done", line: "close" }, { label: "Keep open", line: "plan" }], recommended: "Close as done" }, question: "A goal was dropped." })),
  rescue: () => ofIssues(issue({ reason: "rescue", decision, question: "Should it be A or B?" })),
  "blocker-dropped": () => ofIssues(issue({ status: "parked", reason: "blocker-dropped", decision: { ...decision, options: [{ label: "Remove the link", line: "open" }, { label: "Drop the waiter", line: "drop" }], recommended: "Remove the link" }, question: "issue.9 was dropped, so this issue is parked. What now?" })),
  "core-change": () => ofIssues(issue({ reason: "core-change", question: "Apply the archive verdict to the core note X?" })),
  "proposal-check": () => asks({ runs: [], issues: [] }, [lesson("check")]),
  "proposal-claude-md": () => asks({ runs: [], issues: [] }, [lesson("claude-md")]),
  "proposal-skill": () => asks({ runs: [], issues: [] }, [lesson("skill")]),
};

describe("asks", () => {


  const key = (a: { act: string; body: Record<string, unknown> }) => (a.act === "resolve" && a.body.label ? `resolve:${a.body.label}` : a.act);
  for (const reason of Object.keys(ASK_REASONS)) {
    /** The case's first entry once the director escalated it with this case text. */
    const escalated = (text: Partial<Ask>) => { STORE = text; try { return CASES[reason]()[0]; } finally { STORE = undefined; } };
    test(`${reason}: with no case text the Ask is with the director and offers no action; the director's case text brings the actions`, () => {
      const [plain] = CASES[reason]();
      expect(plain.escalated).toBe(false);
      expect(plain).not.toHaveProperty("kind");
      expect(["approve", "decide", "unstick"]).toContain(plain.card);
      expect(escalated({ situation: "Stored situation.", kind: "input" } as Partial<Ask>)).not.toHaveProperty("kind");
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

  test("every escalated item has an Always on the reason's first verb; the risky reasons add a risk line and default to the project, the rest to all", () => {
    STORE = { situation: "Stored situation." };
    try {
      for (const [reason, r] of Object.entries(ASK_REASONS)) {
        const a = CASES[reason]()[0].always!;
        expect([reason, a.action]).toEqual([reason, r.actions[0]]);
        const risky = ["held-path", "review-held", "no-commit", "run-cap"].includes(reason);
        expect([reason, a.scope]).toEqual([reason, risky ? "project" : "all"]);
        expect([reason, a.hint]).toEqual([reason, expect.stringContaining(`Revoke with \`aleph always revoke ${a.reason ?? (risky ? `${reason}:aleph` : reason)}\`.`)]);
        if (risky) expect(a.risk).toMatch(/^[^.]+\.$/);
        else expect(a.risk).toBeUndefined();
      }
      expect(CASES["held-path"]()[0].repo).toBe("aleph");
    } finally { STORE = undefined; }
  });

  test("each action carries the POST its button sends", () => {
    STORE = { situation: "Stored situation." };
    try {
      const req = (reason: string) => CASES[reason]()[0].actions.map(({ act, path, body, confirm, input }) => ({ act, path, body, confirm, input }));
      expect(ofRuns(run("question", { question: "Which port?", id: "a#27" }))[0].actions.map(({ act, path, body, confirm, input }) => ({ act, path, body, confirm, input }))).toEqual([
        { act: "resolve", path: "/api/jobs/a%2327/answer", body: {}, confirm: undefined, input: { name: "answer" } },
        { act: "dismiss", path: "/api/issues/aleph-27/drop", body: { reason: "" }, confirm: undefined, input: { name: "reason" } },
      ]);
      expect(req("rescue")).toEqual([
        { act: "resolve", path: "/api/issues/aleph-387/decide", body: { label: "B" }, confirm: undefined, input: undefined },
        { act: "resolve", path: "/api/issues/aleph-387/decide", body: { label: "A" }, confirm: undefined, input: undefined },
        { act: "dismiss", path: "/api/issues/aleph-387/drop", body: { reason: "" }, confirm: undefined, input: { name: "reason" } },
      ]);
      expect(req("intake-failed").map((a) => [a.act, a.path, a.body])).toEqual([["continue", "/api/issues/aleph-387/retriage", {}], ["discontinue", "/api/issues/aleph-387/drop", { reason: "" }]]);
      expect(req("no-commit").map((a) => [a.act, a.path])).toEqual([["continue", "/api/issues/aleph-387/rerun"], ["discontinue", "/api/issues/aleph-387/drop"]]);
      expect(req("core-change").map(({ act, path, body }) => ({ act, path, body }))).toEqual([
        { act: "approve", path: "/api/issues/aleph-387/approve", body: {} },
        { act: "disapprove", path: "/api/issues/aleph-387/decline", body: { reason: "" } },
      ]);
      expect(req("proposal-check").map((a) => a.path)).toEqual(["/api/proposals/L1/approve", "/api/proposals/L1/decline"]);
      expect(req("proposal-check").map((a) => a.act)).toEqual(["approve", "disapprove"]);
    } finally { STORE = undefined; }
  });

  test("each card offers only the verbs of its pair, and the second verb has a reason box", () => {
    const pairs: Record<string, string[]> = { approve: ["approve", "disapprove"], decide: ["resolve", "dismiss"], unstick: ["continue", "discontinue"] };
    STORE = { situation: "Stored situation." };
    try {
      for (const reason of Object.keys(ASK_REASONS)) {
        const [it] = CASES[reason](), verbs: string[] = ASK_REASONS[reason].actions;
        expect([reason, [...new Set(it.actions.map((a) => a.act))]]).toEqual([reason, verbs]);
        expect(verbs).toEqual(pairs[it.card]);
        for (const a of it.actions.filter((x) => x.act === verbs[1])) expect([reason, a.input?.name]).toEqual([reason, "reason"]);
        for (const a of it.actions.filter((x) => x.act !== verbs[1])) expect([reason, a.input?.name === "reason"]).toEqual([reason, false]);
        if (verbs[0] !== "resolve") expect(it.actions.filter((a) => a.act === verbs[0]).length).toBe(1);
      }
    } finally { STORE = undefined; }
  });

  test("a part-dropped card offers resolve choices labelled Close as done and Keep open", () => {
    STORE = { situation: "Stored situation." };
    try {
      const [it] = CASES["part-dropped"]();
      expect(it.actions.filter((a) => a.act === "resolve").map((a) => [a.label, a.body])).toEqual([["Close as done", { label: "Close as done" }], ["Keep open", { label: "Keep open" }]]);
    } finally { STORE = undefined; }
  });

  test("the part-dropped card reads as a sub-issue, with no goal", () => {
    const [a] = CASES["part-dropped"]();
    expect(a.problem).toBe("A sub-issue of aleph-387 was dropped and no other sub-issue of it is open.");
    expect(a.problem).not.toContain("goal");
  });

  test("an Ask the director still holds is tagged as its call; once escalated it has the reason's tag", () => {
    const held = ofIssues(issue({ reason: "question", question: "what now?", ask: { reason: "question", question: "q", options: [], why: [] } as Ask }))[0];
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
      const continues = [
        ...CASES["no-commit"]()[0].actions.filter((a) => a.act === "continue"),
        ...CASES["run-cap"]()[0].actions.filter((a) => a.act === "continue"),
      ];
      expect(continues.length).toBe(2);
      for (const a of continues) expect(`${a.label} ${a.hint}`).not.toContain("goal");
    } finally { STORE = undefined; }
  });

  test("no action hint says you or your, and the answer-taking hints name the user", () => {
    STORE = { situation: "Stored situation." };
    try {
      const items = [...Object.values(CASES).flatMap((f) => f()), ...ofIssues(issue({ reason: "question", question: "q" }))];
      const hints = items.flatMap((i) => [...i.actions, ...(i.always ? [i.always] : [])]).map((a) => a.hint);
      expect(hints.length).toBeGreaterThan(5);
      for (const h of hints) expect(h).not.toMatch(/\b(you|your)\b/i);
      expect(hints).toContain("Takes the user's answer and starts the job again with it.");
      expect(hints).toContain("Records the user's approval on the issue, and the factory starts it.");
    } finally { STORE = undefined; }
  });

  test("an issue with a reason the table does not name is a question", () => {
    expect(ofIssues(issue({ reason: "nope", question: "what now?" }))[0].reason).toBe("question");
  });

  test("a review hold's Problem names how often the reviewer sent the run back", () => {
    for (const times of ["once", "twice", "3 times"]) {
      const [t] = ofRuns(run("review-held", { reason: `the reviewer sent it back ${times}: no test.` }));
      expect(t.problem).toBe(`The reviewer sent aleph-27 back ${times}: no test.`);
    }
  });

  test("a failed intake's Problem names why it failed", () => {
    const [t] = ofIssues(issue({ reason: "intake-failed", question: "Intake failed: no verdict in 2 runs" }));
    expect(t.problem).toBe("Intake of aleph-387 failed: no verdict in 2 runs, so no one has decided what to do with this issue.");
  });
});

describe("stuck rows", () => {
  const stuck = run("held-path", { state: "failed", reason: "no commit" });
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

test("run-cap and intake-failed texts read the settings", () => {
  const off = withEnv({ ALEPH_RUN_CAP: "5", ALEPH_INTAKE_TRIES: "4" });
  try {
    const card = CASES["run-cap"]()[0];
    expect(reasonText("run-cap").line).toMatch(/5/);
    expect(reasonText("run-cap").line).not.toMatch(/3/);
    expect(card.problem).toMatch(/5/);
    expect(card.problem).toContain("5 times");
    expect(reasonText("intake-failed").line).not.toContain("twice");
  } finally { off(); }
});

test("an Ask carries its date, its start and its part from the run or issue it is built from", () => {
  const part = { n: 2, m: 3, parent: "aleph-386", href: "#/issues/aleph/386" };
  const [i] = ofIssues(issue({ reason: "question", question: "q", updated: "2026-10-29T00:00:00Z", since: "2026-10-28T00:00:00Z", part }));
  expect([i!.at, i!.since, i!.part]).toEqual(["2026-10-29T00:00:00Z", "2026-10-28T00:00:00Z", part]);
  const [r] = ofRuns(run("question", { question: "Which port?", part }));
  expect([r!.at, r!.since, r!.part]).toEqual(["2026-10-28T00:00:00Z", "2026-10-28T00:00:00Z", part]);
});
