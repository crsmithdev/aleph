// Archived goal tests from ui/asks.test.ts: `bun run accept` runs them, `bun run test` does not.
import { describe, expect, test } from "bun:test";
import { attend, asks } from "../../ui/asks.ts";
import { kindOf, type Ask } from "../../jobs/lib/ask.ts";
import type { Lesson } from "../../jobs/lib/corrections.ts";
import type { Job, NewIssue } from "../../ui/state.ts";

/** Stored case text the fixtures put on their Ask while a test sets it; by default the director's escalation text, so the row has its actions. `{}` is an Ask still with the director. */
const SENT: Partial<Ask> = { situation: "Escalated." };
let STORE: Partial<Ask> | undefined;
const run = (reason: string, extra: Partial<Job> = {}): Job => ({
  name: "aleph-27", repo: "aleph", item: { id: 27, title: "a title" }, condition: "awaiting", started: "2026-10-28T00:00:00Z",
  ask: { kind: reason === "held-path" || reason === "review" ? "approval" : "input", reason, ...(STORE ?? SENT) },
  run: { kind: "build", started: "2026-10-28T00:00:00Z" }, defaults: [], followups: [], ...extra,
} as Job);
const issue = (extra: Partial<NewIssue> = {}): NewIssue => ({ id: "aleph-387", title: "t", status: "open", href: "#/issues/aleph/387", labels: [], notes: 1, created: "", updated: "", ...extra,
  ask: { kind: "input", reason: extra.reason ?? "question", question: "q", options: [], why: [], ...(STORE ?? SENT) } as Ask });
const TARGET = { check: "aleph checks", "claude-md": "identity/CLAUDE.md", skill: "skills/tdd/SKILL.md" } as const;
const lesson = (kind: Lesson["kind"]): Lesson => ({ id: "L1", title: "Format first", target: TARGET[kind!], sentence: "Run the formatter before landing", state: "proposed", kind, count: 3, signals: [{ id: "s", source: "chris", at: "2026-10-27", quote: "format it", link: "" }], situation: (STORE ?? SENT).situation, effects: (STORE ?? SENT).effects, recommend: (STORE ?? SENT).recommend });
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
const QUESTION_ISSUE = () => ofIssues(issue({ reason: "question", decision, question: "Should it be A or B?" }));

describe("asks", () => {

  test("the kind: approval for review, held-path and proposal; input for the rest; an Ask's own kind wins", () => {
    for (const r of ["review", "held-path", "proposal", "proposal-skill"]) expect(kindOf(r), r).toBe("approval");
    for (const r of ["question", "no-commit", "part-dropped", "triage-failed", "host-check", "rescue", "run-cap", "acceptance-failed", "spec-check"]) expect(kindOf(r), r).toBe("input");
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
    expect(CASES["no-commit"]()[0].actions.map((a) => a.label)).toEqual(["Start a new run", "Close the issue"]);
    expect(CASES["run-cap"]()[0].problem).toBe("The factory started aleph-387 3 times in one hour, so it stopped starting it until you run it again.");
    expect(CASES["triage-failed"]()[0].problem).toBe("Triage of aleph-387 failed twice: its process ended before a verdict, so no one has decided what to do with this issue.");
    expect(CASES["triage-failed"]()[0].actions.map((a) => a.label)).toEqual(["Run triage again", "Close the issue"]);
    expect(CASES["acceptance-failed"]()[0].problem).toBe("aleph-387 is the acceptance follow-up of a goal, and it also failed acceptance on main.");
    expect(QUESTION_ISSUE()[0].problem).toBe("Should it be A or B?");
    expect(QUESTION_ISSUE()[0].actions.map((a) => a.label)).toEqual(["B", "A", "Deny"]);
    expect(QUESTION_ISSUE()[0].actions[0].args).toEqual({ repo: "aleph", id: "387", option: "B" });
    expect(CASES["part-dropped"]()[0].problem).toBe("A goal of aleph-387 was dropped and no other goal of it is open.");
    expect(CASES["part-dropped"]()[0].actions.map((a) => a.label)).toEqual(["Close with what landed", "Plan the missing part", "Close the issue"]);
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
    expect(CASES["held-path"]()[0].always).toBeUndefined();
    expect(CASES["triage-failed"]()[0].always!.label).toBe("Run triage again [auto-yes]");
    expect(QUESTION_ISSUE()[0].always).toMatchObject({ label: "B [auto-yes]", action: "recommended" });
    expect(QUESTION_ISSUE()[0].always!.hint).toContain("`aleph always revoke question`");
    expect(CASES.proposal()[0].problem).toBe("This work is a proposal, and it does not start until you approve it.");
    expect(CASES.proposal()[0].actions.map((a) => a.label)).toEqual(["Start the work", "Drop the proposal"]);
    expect(CASES.proposal()[0].actions[0].args).toEqual({ repo: "aleph", id: "387", approve: "true" });
    expect(CASES["host-check"]()[0].problem).toBe("A factory sandbox cannot run this check, so it must run on the host: On the host, run wsl.exe -l -q and put it in place of at.");
    expect(CASES.proposal()[0].always).toBeUndefined();
    expect(CASES["host-check"]()[0].kind).toBe("input");
    expect(CASES["host-check"]()[0].actions.map((a) => a.label)).toEqual(["Mark it checked", "Drop the check"]);
  });

  test("rerun is labelled by what it does for the reason, never Run it again", () => {
    const rerunLabel = (reason: string) => CASES[reason]().flatMap((i) => i.actions).find((a) => a.act === "rerun")?.label;
    expect(rerunLabel("spec-check")).toBe("Start the goal");
    expect(rerunLabel("no-commit")).toBe("Start a new run");
    expect(rerunLabel("part-dropped")).toBeUndefined(); // an Ask with options decides instead
    const bare = ofIssues(issue({ reason: "part-dropped", question: "A goal was dropped." }))[0];
    expect(bare.actions.find((a) => a.act === "rerun")?.label).toBe("Close as done");
    expect(rerunLabel("run-cap")).toBe("Start it again");
    expect(rerunLabel("acceptance-failed")).toBe("Start it again");
    for (const reason of Object.keys(CASES)) for (const a of CASES[reason]().flatMap((i) => i.actions)) expect(a.label).not.toBe("Run it again");
  });

  test("an Ask explained before the limits shows 100 words, 50 per choice, and the rest as details", () => {
    const ten = (k: string) => `${k} ${"w ".repeat(8)}end.`;
    const many = (k: string, n: number) => Array.from({ length: n }, (_, i) => ten(`${k}${i + 1}`)).join(" ");
    STORE = { situation: many("S", 12), details: "Extra.", effects: [{ action: "rerun", text: many("E", 7) }, { action: "close", text: "Closes." }] };
    try {
      const [it] = ofIssues(issue({ reason: "spec-check", question: "q" }));
      expect(it.situation).toBe(many("S", 10));
      expect(it.actions[0].hint).toBe(many("E", 5));
      expect(it.more).toEqual([`${ten("S11")} ${ten("S12")}`, `Start the goal: ${ten("E6")} ${ten("E7")}`, "Extra."]);
    } finally { STORE = undefined; }
  });

  test("a goal's ask names the issue and goal in its action args", () => {
    const [it] = ofIssues(issue({ id: "aleph-387.2", reason: "question", decision, question: "Should it be A or B?" }));
    expect(it.repo).toBe("aleph");
    expect(it.actions[0].args).toEqual({ repo: "aleph", id: "387.2", option: "B" });
  });

  test("a raw task-notification note leaves a problem with no tag", () => {
    const [it] = ofRuns(run("question", { question: "<task-notification><x>junk</x></task-notification> Which port?" }));
    expect(it.problem).not.toContain("<");
    const [d] = ofIssues(issue({ reason: "question", question: "<agent-message>hi</agent-message> Should it be A?" }));
    expect(d.problem).not.toContain("<");
  });

  test("an Ask the director still holds stays in the list with no action and no auto-yes; an escalated one has both", () => {
    STORE = {};
    let held;
    try { held = attend({ runs: [], issues: [issue({ reason: "triage-failed", question: "triage: no verdict in 2 runs: x" })] }, []); } finally { STORE = undefined; }
    expect(held.items.map((i) => [i.id, i.escalated, i.actions.length, i.always])).toEqual([["aleph-387", false, 0, undefined]]);
    const sent = attend({ runs: [], issues: [issue({ reason: "triage-failed", question: "triage: no verdict in 2 runs: x" }), issue({ id: "aleph-5", reason: "question", decision })] }, []);
    expect(sent.items.map((i) => i.id)).toEqual(["aleph-387", "aleph-5"]);
    expect(sent.items.every((i) => i.escalated && i.actions.length > 0 && i.always)).toBe(true);
  });

  test("the order is held-path, review, other runs, issues, proposals", () => {
    const items = asks({ runs: [run("question", { name: "q" }), run("review", { name: "r" }), run("held-path", { name: "h" })], issues: [issue({ reason: "question" })] }, [lesson("skill")]);
    expect(items.map((i) => i.reason)).toEqual(["held-path", "review", "question", "question", "proposal-skill"]);
  });
});
