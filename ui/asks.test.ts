import { describe, expect, test } from "bun:test";
import { attend, asks, clean, issueReason, kindOf, stuckActions, stuckBlocker } from "./asks.ts";
import { ASK_REASONS } from "../jobs/lib/always.ts";
import type { Lesson } from "../jobs/lib/corrections.ts";
import type { Job, NewIssue } from "./state.ts";

const run = (reason: string, extra: Partial<Job> = {}): Job => ({
  name: "aleph-27", repo: "aleph", item: { id: 27, title: "a title" }, state: "awaiting", started: "2026-10-28T00:00:00Z",
  ask: { kind: reason === "held-path" || reason === "review" ? "approval" : "input", reason },
  run: { kind: "build", started: "2026-10-28T00:00:00Z" }, defaults: [], followups: [], ...extra,
} as Job);
const issue = (extra: Partial<NewIssue> = {}): NewIssue => ({ id: "aleph-387", title: "t", status: "open", href: "#/issues/aleph/387", labels: [], notes: 1, created: "", updated: "", ...extra });
const TARGET = { check: "aleph checks", "claude-md": "identity/CLAUDE.md", skill: "skills/tdd/SKILL.md" } as const;
const lesson = (kind: Lesson["kind"]): Lesson => ({ id: "L1", title: "Format first", target: TARGET[kind!], sentence: "Run the formatter before landing", state: "proposed", kind, count: 3, signals: [{ id: "s", source: "chris", at: "2026-10-27", quote: "format it", link: "" }] });
const decision = { question: "Should it be A or B?", options: [{ label: "A", line: "do a" }, { label: "B", line: "do b" }], recommended: "B", kind: "product" as const, why: ["w"] };
const RUN_CAP = "the factory started this goal 3 times in the last hour; it stops starting it until Chris reruns it.";

const ofRuns = (...runs: Job[]) => asks({ runs, issues: [] }, {}, []);
const ofIssues = (...issues: NewIssue[]) => asks({ runs: [], issues }, {}, []);

const CASES: Record<string, () => ReturnType<typeof asks>> = {
  "held-path": () => ofRuns(run("held-path", { reason: "changes hooks/x.ts" })),
  review: () => ofRuns(run("review", { reviewCall: { call: "back", reason: "tests are missing" } })),
  question: () => ofRuns(run("question", { question: "Which port?" })),
  manual: () => ofRuns(run("manual")),
  "no-commit": () => ofIssues(issue({ reason: "no-commit", question: "the last 3 runs of this goal ended with no commit, so the factory stopped starting it; rewrite the goal." })),
  "run-cap": () => ofIssues(issue({ reason: "run-cap", question: RUN_CAP })),
  "triage-failed": () => ofIssues(issue({ reason: "triage-failed", question: "triage: no verdict in 2 runs: failed: its process ended before a verdict" })),
  "part-dropped": () => ofIssues(issue({ reason: "part-dropped", decision: { ...decision, options: [{ label: "Close with what landed", line: "close" }, { label: "Plan the missing part", line: "plan" }], recommended: "Close with what landed" }, question: "A goal was dropped." })),
  "acceptance-failed": () => ofIssues(issue({ reason: "acceptance-failed", question: "acceptance: fail again at abc: x | the Oracle command `bun test` still fails" })),
  rescue: () => ofIssues(issue({ reason: "rescue", decision, question: "Should it be A or B?" })),
  proposal: () => ofIssues(issue({ title: "Update left-pad 1.2.0 to 1.3.0", reason: "proposal", askKind: "approval", question: "Update left-pad 1.2.0 to 1.3.0" })),
  "proposal-check": () => asks({ runs: [], issues: [] }, {}, [lesson("check")]),
  "proposal-claude-md": () => asks({ runs: [], issues: [] }, {}, [lesson("claude-md")]),
  "proposal-skill": () => asks({ runs: [], issues: [] }, {}, [lesson("skill")]),
  "host-check": () => ofIssues(issue({ reason: "host-check", question: "On the host, run `wsl.exe -l -q` and put it in place of `<distro>` at README.md:176." })),
  firefighter: () => ofIssues(issue({ id: "aleph-30", reason: "firefighter", question: "aleph-30 changes hooks/x.ts, a held security path, so it needs your review before it lands." })),
};
const QUESTION_ISSUE = () => ofIssues(issue({ reason: "question", decision, question: "Should it be A or B?" }));

describe("asks", () => {
  test("every reason code has a case", () => expect(Object.keys(CASES).sort()).toEqual(Object.keys(ASK_REASONS).sort()));

  for (const reason of Object.keys(ASK_REASONS)) {
    test(`${reason}: one clean sentence, labelled actions with hints, an Always label, a kind of input or approval`, () => {
      const [it] = CASES[reason]();
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

  test("the kind: approval for review, held-path, proposal and firefighter; input for the rest; an Ask's own kind wins", () => {
    for (const r of ["review", "held-path", "proposal", "firefighter", "proposal-skill"]) expect(kindOf(r), r).toBe("approval");
    for (const r of ["question", "manual", "no-commit", "part-dropped", "triage-failed", "host-check", "rescue", "run-cap", "acceptance-failed"]) expect(kindOf(r), r).toBe("input");
    expect(kindOf("question", "approval")).toBe("approval");
    expect(CASES["held-path"]()[0].kind).toBe("approval");
    expect(CASES.review()[0].kind).toBe("approval");
    expect(CASES.question()[0].kind).toBe("input");
    expect(CASES.proposal()[0].kind).toBe("approval");
    expect(CASES["acceptance-failed"]()[0].kind).toBe("input");
  });

  test("the problems and labels the spec names", () => {
    expect(CASES["held-path"]()[0].problem).toBe("The run for aleph-27 changes a path the repo holds for your review, so the factory did not land it.");
    expect(CASES["held-path"]()[0].actions.map((a) => a.label)).toEqual(["Land it", "Drop the job"]);
    expect(CASES["held-path"]()[0].actions[0].args).toEqual({ name: "aleph-27" });
    expect(CASES.review()[0].problem).toBe("The reviewer sent aleph-27 back twice: tests are missing.");
    expect(ofRuns(run("review", { reason: "the reviewer sent it back twice: tests are missing." }))[0].problem).toBe("The reviewer sent aleph-27 back twice: tests are missing.");
    expect(ofRuns(run("review", { reviewCall: { call: "ask", reason: "a judgement call" } }))[0].problem).toBe("The reviewer left aleph-27 to you: a judgement call.");
    expect(CASES.question()[0].problem).toBe("The worker on aleph-27 asked: Which port?");
    expect(CASES.question()[0].actions.map((a) => a.label)).toEqual(["Answer and rerun", "Drop the job"]);
    expect(CASES["no-commit"]()[0].problem).toBe("The last 3 runs of aleph-387 ended with no commit, so the factory stopped starting it.");
    expect(CASES["no-commit"]()[0].actions.map((a) => a.label)).toEqual(["Run it again", "Close the issue"]);
    expect(CASES["run-cap"]()[0].problem).toBe("The factory started aleph-387 3 times in one hour, so it stopped starting it until you run it again.");
    expect(CASES["triage-failed"]()[0].problem).toBe("Triage of aleph-387 failed twice: its process ended before a verdict, so no one has decided what to do with this issue.");
    expect(CASES["triage-failed"]()[0].actions.map((a) => a.label)).toEqual(["Run triage again", "Close the issue"]);
    expect(CASES["acceptance-failed"]()[0].problem).toBe("The Oracle of aleph-387 still fails on main after a rerun.");
    expect(QUESTION_ISSUE()[0].problem).toBe("Should it be A or B?");
    expect(QUESTION_ISSUE()[0].actions.map((a) => a.label)).toEqual(["Approve B", "Approve A", "Deny"]);
    expect(QUESTION_ISSUE()[0].actions[0].args).toEqual({ repo: "aleph", id: "387", option: "B" });
    expect(CASES["part-dropped"]()[0].problem).toBe("A goal of aleph-387 was dropped and no other goal of it is open.");
    expect(CASES["part-dropped"]()[0].actions.map((a) => a.label)).toEqual(["Approve Close with what landed", "Approve Plan the missing part", "Close the issue"]);
    expect(CASES.manual()[0].problem).toBe("The manual check of aleph-27 must be run by you, on the host.");
    expect(CASES["proposal-check"]()[0].problem).toBe("The correction memory proposes a check for aleph: Run the formatter before landing.");
    expect(CASES["proposal-check"]()[0].title).toBe("Format first");
    expect(CASES["proposal-check"]()[0].actions.map((a) => a.label)).toEqual(["Add a check to aleph", "Add no check"]);
    expect(CASES["proposal-check"]()[0].always).toMatchObject({ label: "Add a check to aleph [auto-yes]", reason: "proposal-check:aleph" });
    const md = CASES["proposal-claude-md"]()[0];
    expect(md.problem).toBe("The correction memory proposes a line in global CLAUDE.md: Run the formatter before landing.");
    expect(md.actions.map((a) => a.label)).toEqual(["Add a line to global CLAUDE.md", "Leave CLAUDE.md unchanged"]);
    expect(md.actions[0].hint).toBe("Files the goal that adds the line to global CLAUDE.md.");
    expect(md.always).toEqual({ label: "Add a line to global CLAUDE.md [auto-yes]", action: "approve", reason: "proposal-claude-md:global", hint: "From now on, the factory files every proposed addition to global CLAUDE.md without asking you. Revoke with `aleph always revoke proposal-claude-md:global`." });
    const sk = CASES["proposal-skill"]()[0];
    expect(sk.actions.map((a) => a.label)).toEqual(["Change the tdd skill", "Leave the tdd skill unchanged"]);
    expect(sk.always!.label).toBe("Change the tdd skill [auto-yes]");
    expect(sk.problem).toContain("a change to the tdd skill:");
    expect(sk.actions[0].hint).toBe("Files the goal that changes the tdd skill.");
    expect(CASES["proposal-check"]()[0].actions[0].args).toEqual({ id: "L1" });
    expect(CASES.firefighter()[0].problem).toBe("The firefighter would land aleph-30, but it changes hooks/x.ts, a held security path, so it needs your review.");
    expect(CASES["held-path"]()[0].always).toMatchObject({ label: "Land it [auto-yes]", action: "firefighter" });
    expect(CASES["triage-failed"]()[0].always!.label).toBe("Run triage again [auto-yes]");
    expect(QUESTION_ISSUE()[0].always).toMatchObject({ label: "Approve B [auto-yes]", action: "recommended" });
    expect(QUESTION_ISSUE()[0].always!.hint).toContain("`aleph always revoke question`");
    expect(CASES.proposal()[0].problem).toBe("This work is a proposal, and it does not start until you approve it.");
    expect(CASES.proposal()[0].actions.map((a) => a.label)).toEqual(["Start the work", "Drop the proposal"]);
    expect(CASES.proposal()[0].actions[0].args).toEqual({ repo: "aleph", id: "387", approve: "true" });
    expect(CASES["host-check"]()[0].problem).toBe("A factory sandbox cannot run this check, so it must run on the host.");
    expect(CASES.proposal()[0].always).toMatchObject({ label: "Start the work [auto-yes]", action: "start" });
    expect(CASES.proposal()[0].always?.hint).toContain("a major version jump still asks");
    expect(CASES["host-check"]()[0].kind).toBe("input");
    expect(CASES["host-check"]()[0].actions.map((a) => a.label)).toEqual(["Mark it checked", "Drop the check"]);
  });

  test("a goal's ask names the issue and goal in its action args", () => {
    const [it] = ofIssues(issue({ id: "aleph-387.2", reason: "question", decision, question: "Should it be A or B?" }));
    expect(it.repo).toBe("aleph");
    expect(it.actions[0].args).toEqual({ repo: "aleph", id: "387.2", option: "B" });
  });

  test("old items get their reason from the last note, in the new names", () => {
    const r = (question: string, d?: typeof decision) => issueReason({ question, decision: d });
    expect(r("triage: no verdict in 2 runs: x")).toBe("triage-failed");
    expect(issueReason({ reason: "triage-no-verdict" })).toBe("triage-failed");
    expect(issueReason({ reason: "held" })).toBe("held-path");
    expect(r("acceptance: fail again at abc: x")).toBe("acceptance-failed");
    expect(r("the last 3 runs of this goal ended with no commit, so the factory stopped starting it")).toBe("no-commit");
    expect(r(RUN_CAP)).toBe("run-cap");
    expect(issueReason({ reason: "run-cap", question: RUN_CAP })).toBe("run-cap");
    expect(r("triage: for Chris: pick one", decision)).toBe("question");
    expect(r("x changes hooks/a.ts, a held security path, so it needs you")).toBe("firefighter");
    expect(r("triage: a live check: run it")).toBe("host-check");
    expect(r("what now?")).toBe("question");
  });

  test("an old note's timestamp is not part of the reason, the detail or the Problem", () => {
    expect(clean("- 2026-10-27 12:34: which helper?")).toBe("which helper?");
    expect(clean("- 2026-10-27 12:34:56: triage: for Chris: pick one")).toBe("pick one");
    expect(issueReason({ question: "- 2026-10-27 12:34: triage: no verdict in 2 runs: failed: x" })).toBe("triage-failed");
    const [f] = ofIssues(issue({ id: "aleph-30", reason: "firefighter", question: "- 2026-10-27 12:34: aleph-30 changes hooks/x.ts, a held security path, so it needs your review." }));
    expect(f.problem).toBe("The firefighter would land aleph-30, but it changes hooks/x.ts, a held security path, so it needs your review.");
    const [t] = ofIssues(issue({ reason: "triage-failed", question: "- 2026-10-27 12:34: triage: no verdict in 2 runs: failed: its process ended before a verdict" }));
    expect(t.problem).toBe("Triage of aleph-387 failed twice: its process ended before a verdict, so no one has decided what to do with this issue.");
  });

  test("a raw task-notification note leaves a problem with no tag", () => {
    const [it] = ofRuns(run("question", { question: "<task-notification><x>junk</x></task-notification> Which port?" }));
    expect(it.problem).not.toContain("<");
    const [d] = ofIssues(issue({ reason: "question", question: "<agent-message>hi</agent-message> Should it be A?" }));
    expect(d.problem).not.toContain("<");
  });

  test("a firefighter Always rule keeps the ask and counts it in handed", () => {
    const s = { runs: [], issues: [issue({ reason: "triage-failed", question: "triage: no verdict in 2 runs: x" }), issue({ id: "aleph-5", reason: "question", decision })] };
    const r = attend(s, { "triage-failed": { action: "firefighter", at: "2026-10-28T00:00:00Z" } }, []);
    expect(r.items.map((i) => i.id)).toEqual(["aleph-387", "aleph-5"]);
    expect(r.items[0].actions.length).toBeGreaterThan(0);
    expect(r.handed).toEqual({ "triage-failed": 1 });
  });

  test("the order is held-path, review, other runs, issues, proposals", () => {
    const items = asks({ runs: [run("question", { name: "q" }), run("review", { name: "r" }), run("held-path", { name: "h" })], issues: [issue({ reason: "question" })] }, {}, [lesson("skill")]);
    expect(items.map((i) => i.reason)).toEqual(["held-path", "review", "question", "question", "proposal-skill"]);
  });
});

describe("stuck rows", () => {
  const stuck = run("held-path", { state: "stuck", reason: "no commit" });
  const open = new Map([["aleph-12", { title: "Land the base", href: "#/issues/aleph/12" }]]);
  test("an item waiting on an open issue gets its id, title and Wait, not Re-check", () => {
    const b = stuckBlocker(stuck, "aleph-12", open);
    expect(b).toEqual({ id: "aleph-12", title: "Land the base", href: "#/issues/aleph/12" });
    const acts = stuckActions(stuck, b);
    expect(acts.map((a) => a.label)).toEqual(["Wait for aleph-12", "Drop"]);
    expect(acts[0].args).toEqual({ name: "aleph-27", on: "aleph-12" });
  });
  test("a last run that names an open issue is the blocker", () => {
    expect(stuckBlocker({ ...stuck, reason: "needs aleph-12 to land first" }, undefined, open)?.id).toBe("aleph-12");
  });
  test("no open blocker keeps Re-check and Drop", () => {
    expect(stuckBlocker(stuck, "aleph-99", open)).toBeNull();
    expect(stuckBlocker({ ...stuck, reason: "aleph-27 again" }, "aleph-27", new Map([["aleph-27", { title: "t", href: "" }]]))).toBeNull();
    expect(stuckActions(stuck, null).map((a) => a.act)).toEqual(["recheck", "drop"]);
  });
});
