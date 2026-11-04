// Archived goal tests from ui/asks.test.ts: `bun run accept` runs them, `bun run test` does not.
import { describe, expect, test } from "bun:test";
import { asks,  } from "../../ui/asks.ts";
import { ASK_REASONS, type Ask } from "../../jobs/lib/ask.ts";
import type { Lesson } from "../../jobs/lib/corrections.ts";
import type { Job, NewIssue } from "../../ui/state.ts";

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
  "spec-check": () => ofIssues(issue({ reason: "spec-check", question: "spec check: abc123 hold: the Oracle clause is outside the Edit surface" })),
  "run-cap": () => ofIssues(issue({ reason: "run-cap", question: RUN_CAP })),
  "triage-failed": () => ofIssues(issue({ reason: "triage-failed", question: "triage: no verdict in 2 runs: failed: its process ended before a verdict" })),
  "part-dropped": () => ofIssues(issue({ reason: "part-dropped", decision: { ...decision, options: [{ label: "Close with what landed", line: "close" }, { label: "Plan the missing part", line: "plan" }], recommended: "Close with what landed" }, question: "A goal was dropped." })),
  "acceptance-failed": () => ofIssues(issue({ reason: "acceptance-failed", question: "acceptance: fail again at abc: x | the Oracle command `bun test` still fails" })),
  rescue: () => ofIssues(issue({ reason: "rescue", decision, question: "Should it be A or B?" })),
  proposal: () => ofIssues(issue({ title: "Update left-pad 1.2.0 to 1.3.0", reason: "proposal", askKind: "approval", question: "Update left-pad 1.2.0 to 1.3.0" })),
  "proposal-check": () => asks({ runs: [], issues: [] }, [lesson("check")]),
  "proposal-claude-md": () => asks({ runs: [], issues: [] }, [lesson("claude-md")]),
  "proposal-skill": () => asks({ runs: [], issues: [] }, [lesson("skill")]),
  "host-check": () => ofIssues(issue({ reason: "host-check", question: "On the host, run `wsl.exe -l -q` and put it in place of `<distro>` at README.md:176." })),
};
/** The case's entries once the director escalated it: with case text, the row has its actions. */
const sent = (reason: string) => { STORE = { situation: "Escalated." }; try { return CASES[reason](); } finally { STORE = undefined; } };

describe("asks", () => {
  test("every reason code has a case", () => expect(Object.keys(CASES).sort()).toEqual(Object.keys(ASK_REASONS).sort()));

  for (const reason of Object.keys(ASK_REASONS)) {
    test(`${reason}: one clean sentence, labelled actions with hints, an Always label, a kind of input or approval`, () => {
      const [it] = sent(reason);
      expect(it.reason).toBe(reason);
      expect(it.problem).not.toMatch(/<task-notification|<agent-message|[<]/);
      expect(it.problem.match(/[.?!](\s|$)/g)?.length ?? 0).toBeLessThanOrEqual(1);
      expect(it.actions.length).toBeGreaterThan(0);
      expect(it.actions[0].primary).toBe(true);
      expect(it.actions.slice(1).some((a) => a.primary)).toBe(false);
      for (const a of it.actions) { expect(a.label).toBeTruthy(); expect(a.hint).toBeTruthy(); expect(a.act).toBeTruthy(); }
      expect(it.kind).toMatch(/^(approval|input)$/);
      if (!ASK_REASONS[reason].always) { expect(it.always).toBeUndefined(); return; }
      expect(it.always!.label).toBe(`${it.actions[0].label} [auto-yes]`);
      expect(it.always!.hint).toContain("From now on");
      expect(it.always!.action).toBe(ASK_REASONS[reason].always);
    });
  }

  test("spec-check: the problems of the issue's question, rerun then close with its hint, no auto-yes", () => {
    const items = sent("spec-check");
    expect(items.length).toBe(1);
    const [it] = items;
    expect(it.reason).toBe("spec-check");
    expect(it.kind).toBe("input");
    expect(it.problem).toBe("The spec check found that the spec of aleph-387 cannot be met as written: spec check: abc123 hold: the Oracle clause is outside the Edit surface.");
    expect(it.actions.map((a) => a.act)).toEqual(["rerun", "close"]);
    expect(it.actions[0].label).toBe("Start the goal");
    expect(it.actions[0].hint).toBe("Clears the Ask and starts the goal. If you edited the spec, the spec check reads the new spec first.");
    expect(it.always).toBeUndefined();
  });

  test("a card carries its kind and the tag of its stop, and every reason has both", () => {
    for (const reason of Object.keys(ASK_REASONS)) { const it = CASES[reason]()[0]; expect(["approve", "decide", "unstick", "hand"]).toContain(it.card!); expect(it.tag!.length).toBeGreaterThan(0); }
  });
});
