import { describe, expect, test } from "bun:test";
import { attend, attention, clean, issueReason, stuckActions, stuckBlocker } from "./attention.ts";
import { REASONS } from "../jobs/lib/standing.ts";
import type { Lesson } from "../jobs/lib/corrections.ts";
import type { Job, NewIssue } from "./state.ts";

const run = (needs: string, extra: Partial<Job> = {}): Job => ({
  name: "aleph-27", repo: "aleph", item: { id: 27, title: "a title" }, state: "needs-you", needs, started: "2026-10-28T00:00:00Z",
  run: { kind: "agent", started: "2026-10-28T00:00:00Z" }, defaults: [], followups: [], ...extra,
} as Job);
const issue = (extra: Partial<NewIssue> = {}): NewIssue => ({ id: "aleph-387", title: "t", status: "open", href: "#/issues/aleph/387", labels: ["needs-chris"], notes: 1, created: "", updated: "", ...extra });
const TARGET = { check: "aleph checks", "claude-md": "identity/CLAUDE.md", skill: "skills/tdd/SKILL.md" } as const;
const lesson = (kind: Lesson["kind"]): Lesson => ({ id: "L1", title: "Format first", target: TARGET[kind!], sentence: "Run the formatter before landing", state: "proposed", kind, count: 3, signals: [{ id: "s", source: "chris", at: "2026-10-27", quote: "format it", link: "" }] });
const decision = { question: "Should it be A or B?", options: [{ label: "A", line: "do a" }, { label: "B", line: "do b" }], recommended: "B", kind: "product" as const, why: ["w"] };
const RUN_CAP = "needs-chris: the factory started this goal 3 times in the last hour; it stops starting it until Chris reruns it.";

const CASES: Record<string, () => ReturnType<typeof attention>> = {
  held: () => attention({ needs: [run("held", { reason: "changes hooks/x.ts" })], needsIssues: [] }, {}, []),
  review: () => attention({ needs: [run("review", { review2: { verdict: "back", reason: "tests are missing" } })], needsIssues: [] }, {}, []),
  question: () => attention({ needs: [run("question", { question: "Which port?" })], needsIssues: [] }, {}, []),
  "no-commit": () => attention({ needs: [], needsIssues: [issue({ reason: "no-commit", question: "needs-chris: the last 3 runs of this goal ended with no commit, so the factory stopped starting it; rewrite the goal." })] }, {}, []),
  "run-cap": () => attention({ needs: [], needsIssues: [issue({ reason: "run-cap", question: RUN_CAP })] }, {}, []),
  "triage-no-verdict": () => attention({ needs: [], needsIssues: [issue({ reason: "triage-no-verdict", question: "triage: no verdict in 2 runs: failed: its process ended before a verdict" })] }, {}, []),
  "acceptance-failed": () => attention({ needs: [], needsIssues: [issue({ reason: "acceptance-failed", question: "acceptance: fail again at abc: x | needs-chris: the Oracle command `bun test` still fails" })] }, {}, []),
  decision: () => attention({ needs: [], needsIssues: [issue({ reason: "decision", decision, question: "triage: for Chris: Should it be A or B?" })] }, {}, []),
  rescue: () => attention({ needs: [], needsIssues: [issue({ reason: "rescue", decision, question: "needs-chris: Should it be A or B?" })] }, {}, []),
  proposal: () => attention({ needs: [], needsIssues: [issue({ title: "Update left-pad 1.2.0 to 1.3.0", reason: "proposal", question: "Update left-pad 1.2.0 to 1.3.0" })] }, {}, []),
  "proposal-check": () => attention({ needs: [], needsIssues: [] }, {}, [lesson("check")]),
  "proposal-claude-md": () => attention({ needs: [], needsIssues: [] }, {}, [lesson("claude-md")]),
  "proposal-skill": () => attention({ needs: [], needsIssues: [] }, {}, [lesson("skill")]),
  "host-check": () => attention({ needs: [], needsIssues: [issue({ reason: "host-check", question: "triage: a live check: On the host, run `wsl.exe -l -q` and put it in place of `<distro>` at README.md:176." })] }, {}, []),
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
      expect(it.kind).toMatch(/^(approval|decision|input|stuck)$/);
      if (!REASONS[reason].always) { expect(it.always).toBeUndefined(); return; }
      expect(it.always!.label).toBe(`${it.actions[0].label} [auto-yes]`);
      expect(it.always!.hint).toContain("From now on");
      expect(it.always!.action).toBe(REASONS[reason].always);
    });
  }

  test("the problems and labels the spec names", () => {
    expect(CASES.held()[0].problem).toBe("The run for aleph-27 changes a path the repo holds for your review, so the factory did not land it.");
    expect(CASES.held()[0].actions.map((a) => a.label)).toEqual(["Land it", "Drop the job"]);
    expect(CASES.held()[0].actions[0].args).toEqual({ name: "aleph-27" });
    expect(CASES.review()[0].problem).toBe("The reviewer sent aleph-27 back twice: tests are missing.");
    expect(attention({ needs: [run("review", { reason: "the reviewer sent it back twice: tests are missing." })], needsIssues: [] }, {}, [])[0].problem).toBe("The reviewer sent aleph-27 back twice: tests are missing.");
    expect(CASES.question()[0].problem).toBe("The worker on aleph-27 asked: Which port?");
    expect(CASES.question()[0].actions.map((a) => a.label)).toEqual(["Answer and rerun", "Drop the job"]);
    expect(CASES["no-commit"]()[0].problem).toBe("The last 3 runs of aleph-387 ended with no commit, so the factory stopped starting it.");
    expect(CASES["no-commit"]()[0].actions.map((a) => a.label)).toEqual(["Run it again", "Close the issue"]);
    expect(CASES["run-cap"]()[0].problem).toBe("The factory started aleph-387 3 times in one hour, so it stopped starting it until you run it again.");
    expect(CASES["run-cap"]()[0].actions.map((a) => a.label)).toEqual(["Run it again", "Close the issue"]);
    expect(CASES["triage-no-verdict"]()[0].problem).toBe("Triage of aleph-387 failed twice: its process ended before a verdict, so no one has decided what to do with this issue.");
    expect(CASES["triage-no-verdict"]()[0].actions.map((a) => a.label)).toEqual(["Run triage again", "Close the issue"]);
    expect(CASES["acceptance-failed"]()[0].problem).toBe("The Oracle of aleph-387 still fails on main after a rerun.");
    expect(CASES.decision()[0].problem).toBe("Should it be A or B?");
    expect(CASES.decision()[0].actions.map((a) => a.label)).toEqual(["Approve B", "Approve A", "Deny"]);
    expect(CASES.decision()[0].actions[0].args).toEqual({ repo: "aleph", id: "387", option: "B" });
    expect(CASES["proposal-check"]()[0].problem).toBe("The correction memory proposes a check for aleph: Run the formatter before landing.");
    expect(CASES["proposal-check"]()[0].title).toBe("Format first");
    expect(CASES["proposal-check"]()[0].actions.map((a) => a.label)).toEqual(["Add a check to aleph", "Add no check"]);
    expect(CASES["proposal-check"]()[0].always).toMatchObject({ label: "Add a check to aleph [auto-yes]", reason: "proposal-check:aleph" });
    const md = CASES["proposal-claude-md"]()[0];
    expect(md.problem).toBe("The correction memory proposes a line in global CLAUDE.md: Run the formatter before landing.");
    expect(md.actions.map((a) => a.label)).toEqual(["Add a line to global CLAUDE.md", "Leave CLAUDE.md unchanged"]);
    expect(md.actions[0].hint).toBe("Files the goal that adds the line to global CLAUDE.md.");
    expect(md.always).toEqual({ label: "Add a line to global CLAUDE.md [auto-yes]", action: "approve", reason: "proposal-claude-md:global", hint: "From now on, the factory files every proposed addition to global CLAUDE.md without asking you. Revoke with `aleph standing revoke proposal-claude-md:global`." });
    const sk = CASES["proposal-skill"]()[0];
    expect(sk.actions.map((a) => a.label)).toEqual(["Change the tdd skill", "Leave the tdd skill unchanged"]);
    expect(sk.always!.label).toBe("Change the tdd skill [auto-yes]");
    expect(sk.problem).toContain("a change to the tdd skill:");
    expect(sk.actions[0].hint).toBe("Files the goal that changes the tdd skill.");
    expect(CASES["proposal-check"]()[0].actions[0].args).toEqual({ id: "L1" });
    expect(CASES.firefighter()[0].problem).toBe("The firefighter would land aleph-30, but it changes hooks/x.ts, a held security path, so it needs your review.");
    expect(CASES.held()[0].always).toMatchObject({ label: "Land it [auto-yes]", action: "firefighter" });
    expect(CASES["triage-no-verdict"]()[0].always!.label).toBe("Run triage again [auto-yes]");
    expect(CASES.decision()[0].always).toMatchObject({ label: "Approve B [auto-yes]", action: "recommended" });
    expect(CASES.decision()[0].always!.hint).toContain("`aleph standing revoke decision`");
    expect(CASES.proposal()[0].problem).toBe("This work is a proposal, and it does not start until you approve it.");
    expect(CASES.proposal()[0].kind).toBe("approval");
    expect(CASES.proposal()[0].actions.map((a) => a.label)).toEqual(["Start the work", "Drop the proposal"]);
    expect(CASES.proposal()[0].actions[0].args).toEqual({ repo: "aleph", id: "387", approve: "true" });
    expect(CASES["host-check"]()[0].problem).toBe("A factory sandbox cannot run this check, so it must run on the host.");
    expect(CASES.proposal()[0].always).toMatchObject({ label: "Start the work [auto-yes]", action: "start" });
    expect(CASES.proposal()[0].always?.hint).toContain("a major version jump still asks");
    expect(CASES["host-check"]()[0].kind).toBe("input");
    expect(CASES["host-check"]()[0].actions.map((a) => a.label)).toEqual(["Mark it checked", "Drop the check"]);
    expect(CASES["acceptance-failed"]()[0].kind).toBe("stuck");
  });

  test("old items get their reason from the last note", () => {
    const r = (question: string, d?: typeof decision) => issueReason({ question, decision: d });
    expect(r("triage: no verdict in 2 runs: x")).toBe("triage-no-verdict");
    expect(r("acceptance: fail again at abc: x")).toBe("acceptance-failed");
    expect(r("needs-chris: the last 3 runs of this goal ended with no commit, so the factory stopped starting it")).toBe("no-commit");
    expect(r(RUN_CAP)).toBe("run-cap");
    expect(issueReason({ reason: "run-cap", question: RUN_CAP })).toBe("run-cap");
    expect(r("triage: for Chris: pick one", decision)).toBe("decision");
    expect(r("needs-chris: x changes hooks/a.ts, a held security path, so it needs you")).toBe("firefighter");
    expect(r("needs-chris: what now?", decision)).toBe("rescue");
    expect(r("needs-chris: what now?")).toBe("decision");
  });

  test("an old note's timestamp is not part of the reason, the detail or the Problem", () => {
    expect(clean("- 2026-10-27 12:34: needs-chris: which helper?")).toBe(clean("needs-chris: which helper?"));
    expect(clean("- 2026-10-27 12:34: needs-chris: which helper?")).toBe("which helper?");
    expect(clean("- 2026-10-27 12:34:56: triage: for Chris: pick one")).toBe("pick one");
    expect(issueReason({ question: "- 2026-10-27 12:34: needs-chris: triage: no verdict in 2 runs: failed: x" })).toBe("triage-no-verdict");
    expect(issueReason({ question: "- 2026-10-27 12:34: needs-chris: x changes hooks/a.ts, a held security path, so it needs you" })).toBe("firefighter");
    const [f] = attention({ needs: [], needsIssues: [issue({ id: "aleph-30", reason: "firefighter", question: "- 2026-10-27 12:34: needs-chris: aleph-30 changes hooks/x.ts, a held security path, so it needs your review." })] }, {}, []);
    expect(f.problem).toBe("The firefighter would land aleph-30, but it changes hooks/x.ts, a held security path, so it needs your review.");
    const [t] = attention({ needs: [], needsIssues: [issue({ reason: "triage-no-verdict", question: "- 2026-10-27 12:34: needs-chris: triage: no verdict in 2 runs: failed: its process ended before a verdict" })] }, {}, []);
    expect(t.problem).toBe("Triage of aleph-387 failed twice: its process ended before a verdict, so no one has decided what to do with this issue.");
  });

  test("an old note with a leading timestamp loses it", () => {
    expect(clean("2026-10-27 14:05: needs-chris: Should it be A or B?")).toBe("Should it be A or B?");
    const q = "2026-10-27 14:05: needs-chris: aleph-30 changes hooks/x.ts, a held security path, so it needs your review before it lands.";
    expect(issueReason({ question: q })).toBe("firefighter");
    const [ff] = attention({ needs: [], needsIssues: [issue({ id: "aleph-30", question: q })] }, {}, []);
    expect(ff.problem).toContain("hooks/x.ts");
    const [d] = attention({ needs: [], needsIssues: [issue({ question: "2026-10-27 14:05: needs-chris: what now?" })] }, {}, []);
    expect(d.problem).not.toMatch(/^\d{4}-|needs-chris:/);
  });

  test("a raw task-notification note leaves a problem with no tag", () => {
    const [it] = attention({ needs: [run("question", { question: "<task-notification><x>junk</x></task-notification> Which port?" })], needsIssues: [] }, {}, []);
    expect(it.problem).not.toContain("<");
    const [d] = attention({ needs: [], needsIssues: [issue({ reason: "decision", question: "<agent-message>hi</agent-message> Should it be A?" })] }, {}, []);
    expect(d.problem).not.toContain("<");
  });

  test("a firefighter standing keeps the item and counts it in handed", () => {
    const s = { needs: [], needsIssues: [issue({ reason: "triage-no-verdict", question: "triage: no verdict in 2 runs: x" }), issue({ id: "aleph-5", reason: "decision", decision })] };
    const r = attend(s, { "triage-no-verdict": { action: "firefighter", at: "2026-10-28T00:00:00Z" } }, []);
    expect(r.items.map((i) => i.id)).toEqual(["aleph-387", "aleph-5"]);
    expect(r.items[0].actions.length).toBeGreaterThan(0);
    expect(r.handed).toEqual({ "triage-no-verdict": 1 });
  });

  test("the order is held, review, question, issues, proposals", () => {
    const items = attention({ needs: [run("question", { name: "q" }), run("review", { name: "r" }), run("held", { name: "h" })], needsIssues: [issue()] }, {}, [lesson("skill")]);
    expect(items.map((i) => i.reason)).toEqual(["held", "review", "question", "decision", "proposal-skill"]);
  });
});

describe("stuck rows", () => {
  const stuck = run("held", { state: "stuck", reason: "no commit" });
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
