import { describe, expect, test } from "bun:test";
import { attend, attention, issueReason } from "./attention.ts";
import { REASONS } from "../jobs/lib/standing.ts";
import type { Lesson } from "../jobs/lib/corrections.ts";
import type { Job, NewIssue } from "./state.ts";

const run = (needs: string, extra: Partial<Job> = {}): Job => ({
  name: "aleph-27", repo: "aleph", item: { id: 27, title: "a title" }, state: "needs-you", needs, started: "2026-10-28T00:00:00Z",
  run: { kind: "agent", started: "2026-10-28T00:00:00Z" }, defaults: [], followups: [], ...extra,
} as Job);
const issue = (extra: Partial<NewIssue> = {}): NewIssue => ({ id: "aleph-387", title: "t", status: "open", href: "#/issues/aleph/387", labels: ["needs-chris"], notes: 1, created: "", updated: "", ...extra });
const lesson = (kind: Lesson["kind"]): Lesson => ({ id: "L1", sentence: "Run the formatter before landing", state: "proposed", kind, count: 3, signals: [{ id: "s", source: "chris", at: "2026-10-27", quote: "format it", link: "" }] });
const decision = { question: "Should it be A or B?", options: [{ label: "A", line: "do a" }, { label: "B", line: "do b" }], recommended: "B", why: ["w"] };

const CASES: Record<string, () => ReturnType<typeof attention>> = {
  held: () => attention({ needs: [run("held", { reason: "changes hooks/x.ts" })], needsIssues: [] }, {}, []),
  review: () => attention({ needs: [run("review", { review2: { verdict: "back", reason: "tests are missing" } })], needsIssues: [] }, {}, []),
  question: () => attention({ needs: [run("question", { question: "Which port?" })], needsIssues: [] }, {}, []),
  "no-commit": () => attention({ needs: [], needsIssues: [issue({ reason: "no-commit", question: "needs-chris: the last 3 runs of this goal ended with no commit, so the factory stopped starting it; rewrite the goal." })] }, {}, []),
  "triage-no-verdict": () => attention({ needs: [], needsIssues: [issue({ reason: "triage-no-verdict", question: "triage: no verdict in 2 runs: failed: its process ended before a verdict" })] }, {}, []),
  "acceptance-failed": () => attention({ needs: [], needsIssues: [issue({ reason: "acceptance-failed", question: "acceptance: fail again at abc: x | needs-chris: the Oracle command `bun test` still fails" })] }, {}, []),
  decision: () => attention({ needs: [], needsIssues: [issue({ reason: "decision", decision, question: "triage: for Chris: Should it be A or B?" })] }, {}, []),
  rescue: () => attention({ needs: [], needsIssues: [issue({ reason: "rescue", decision, question: "needs-chris: Should it be A or B?" })] }, {}, []),
  "proposal-check": () => attention({ needs: [], needsIssues: [] }, {}, [lesson("check")]),
  "proposal-claude-md": () => attention({ needs: [], needsIssues: [] }, {}, [lesson("claude-md")]),
  "proposal-skill": () => attention({ needs: [], needsIssues: [] }, {}, [lesson("skill")]),
  firefighter: () => attention({ needs: [], needsIssues: [issue({ id: "aleph-30", reason: "firefighter", question: "needs-chris: aleph-30 changes hooks/x.ts, a held security path, so it needs your review before it lands." })] }, {}, []),
};

describe("attention", () => {
  test("every reason code has a case", () => expect(Object.keys(CASES).sort()).toEqual(Object.keys(REASONS).sort()));

  for (const reason of Object.keys(REASONS)) {
    test(`${reason}: one clean sentence, labelled actions with hints, an Always label`, () => {
      const [it] = CASES[reason]();
      expect(it.reason).toBe(reason);
      expect(it.problem).not.toMatch(/<task-notification|<agent-message|needs-chris:|triage: for Chris:|[<]/);
      expect(it.problem.match(/[.?!](\s|$)/g)?.length ?? 0).toBeLessThanOrEqual(1);
      expect(it.actions.length).toBeGreaterThan(0);
      expect(it.actions[0].primary).toBe(true);
      expect(it.actions.slice(1).some((a) => a.primary)).toBe(false);
      for (const a of it.actions) { expect(a.label).toBeTruthy(); expect(a.hint).toBeTruthy(); expect(a.act).toBeTruthy(); }
      expect(it.always.label.startsWith("Always ")).toBe(true);
      expect(it.always.action).toBe(REASONS[reason].always);
    });
  }

  test("the problems and labels the spec names", () => {
    expect(CASES.held()[0].problem).toBe("The run for aleph-27 changes a path the repo holds for your review, so the factory did not land it.");
    expect(CASES.held()[0].actions.map((a) => a.label)).toEqual(["Land it", "Drop the job"]);
    expect(CASES.held()[0].actions[0].args).toEqual({ name: "aleph-27" });
    expect(CASES.review()[0].problem).toBe("The reviewer sent aleph-27 back twice: tests are missing.");
    expect(CASES.question()[0].problem).toBe("The worker on aleph-27 asked: Which port?");
    expect(CASES.question()[0].actions.map((a) => a.label)).toEqual(["Answer and rerun", "Drop the job"]);
    expect(CASES["no-commit"]()[0].problem).toBe("The last 3 runs of aleph-387 ended with no commit, so the factory stopped starting it.");
    expect(CASES["no-commit"]()[0].actions.map((a) => a.label)).toEqual(["Run it again", "Close the issue"]);
    expect(CASES["triage-no-verdict"]()[0].problem).toBe("Triage of aleph-387 failed twice: its process ended before a verdict, so no one has decided what to do with this issue.");
    expect(CASES["triage-no-verdict"]()[0].actions.map((a) => a.label)).toEqual(["Run triage again", "Close the issue"]);
    expect(CASES["acceptance-failed"]()[0].problem).toBe("The Oracle of aleph-387 still fails on main after a rerun.");
    expect(CASES.decision()[0].problem).toBe("Should it be A or B?");
    expect(CASES.decision()[0].actions.map((a) => a.label)).toEqual(["Approve B", "Approve A", "Deny"]);
    expect(CASES.decision()[0].actions[0].args).toEqual({ repo: "aleph", id: "387", option: "B" });
    expect(CASES["proposal-check"]()[0].problem).toBe("The correction memory proposes a check: Run the formatter before landing.");
    expect(CASES["proposal-check"]()[0].actions.map((a) => a.label)).toEqual(["File the goal", "Never propose this"]);
    expect(CASES["proposal-check"]()[0].actions[0].args).toEqual({ id: "L1" });
    expect(CASES.firefighter()[0].problem).toBe("The firefighter would land aleph-30, but it changes hooks/x.ts, a held security path, so it needs your review.");
    expect(CASES.held()[0].always).toEqual({ label: "Always let the firefighter decide", action: "firefighter" });
    expect(CASES["triage-no-verdict"]()[0].always.label).toBe("Always run triage again");
  });

  test("old items get their reason from the last note", () => {
    const r = (question: string, d?: typeof decision) => issueReason({ question, decision: d });
    expect(r("triage: no verdict in 2 runs: x")).toBe("triage-no-verdict");
    expect(r("acceptance: fail again at abc: x")).toBe("acceptance-failed");
    expect(r("needs-chris: the last 3 runs of this goal ended with no commit, so the factory stopped starting it")).toBe("no-commit");
    expect(r("triage: for Chris: pick one", decision)).toBe("decision");
    expect(r("needs-chris: x changes hooks/a.ts, a held security path, so it needs you")).toBe("firefighter");
    expect(r("needs-chris: what now?", decision)).toBe("rescue");
    expect(r("needs-chris: what now?")).toBe("decision");
  });

  test("a raw task-notification note leaves a problem with no tag", () => {
    const [it] = attention({ needs: [run("question", { question: "<task-notification><x>junk</x></task-notification> Which port?" })], needsIssues: [] }, {}, []);
    expect(it.problem).not.toContain("<");
    const [d] = attention({ needs: [], needsIssues: [issue({ reason: "decision", question: "<agent-message>hi</agent-message> Should it be A?" })] }, {}, []);
    expect(d.problem).not.toContain("<");
  });

  test("a firefighter standing leaves the item out and counts it in handed", () => {
    const s = { needs: [], needsIssues: [issue({ reason: "triage-no-verdict", question: "triage: no verdict in 2 runs: x" }), issue({ id: "aleph-5", reason: "decision", decision })] };
    const r = attend(s, { "triage-no-verdict": { action: "firefighter", at: "2026-10-28T00:00:00Z" } }, []);
    expect(r.items.map((i) => i.id)).toEqual(["aleph-5"]);
    expect(r.handed).toEqual({ "triage-no-verdict": 1 });
  });

  test("the order is held, review, question, issues, proposals", () => {
    const items = attention({ needs: [run("question", { name: "q" }), run("review", { name: "r" }), run("held", { name: "h" })], needsIssues: [issue()] }, {}, [lesson("skill")]);
    expect(items.map((i) => i.reason)).toEqual(["held", "review", "question", "decision", "proposal-skill"]);
  });
});
