# Principles

These rules decide design, review and code changes in aleph. When two rules
conflict, the earlier rule wins. Each rule has a test that decides a case. A
rule that decides no case in a month is removed.

## The system

1. **Solo.** Aleph has one user on one machine. Design, review and red-team
   for that user. Leave out protections that only a team or a public service
   needs.
   Test: a change fails this rule when its main reason is a threat or a scale
   that one person on one machine does not have.
   Source: Chris, 2026-11-04.

2. **The system decides what it can.** Chris decides only what the system
   cannot know. Each routine Ask is a defect to remove. The target is zero
   routine Asks. The hold on new work while escalated Asks wait stays until
   then.
   Test: a change fails this rule when it adds a question to Chris that the
   repo, the history or a rule can answer.
   Source: "this should not require me"; "held path … should not
   be asking me"; "move towards automation eventually" (2026-11-04).

3. **Everything about a change is visible.** Each fact about a change is in
   its record and on the UI: each test that ran, passed or failed, each cost,
   each wait and its reason. Anything wrong or waiting for Chris shows at the
   top, with no scroll.
   Test: a change fails this rule when a person must read a raw log to learn
   why a run failed or waits.
   Source: Chris, 2026-11-04; status page prompts.

4. **A mechanism earns its place with evidence.** A gate, a check or an
   isolation layer stays only while its record shows real faults it caught.
   Each one records what it caught.
   Test: a change fails this rule when it adds a gate that records no
   outcome, or keeps one whose record shows no catch.
   Source: "do all the gates make sense still"; acceptance led to 7 fixes in
   134 failures (2026-11-04).

5. **One way to do each thing.** Remove before you add. One path creates an
   issue, one record holds a job's state, one function does one job.
   Test: a change fails this rule when it adds a second path for a job that a
   path already does.
   Source: "opt for one way of doing everything"; "one creation path"
   (Chris, last week).

6. **Cost is a constraint.** Code does the work when code can. Each agent run
   has a stated reason and a recorded cost.
   Test: a change fails this rule when it adds an agent run for a decision a
   rule in code can make, or a run whose cost is not recorded.
   Source: "declaring war on inefficiency"; Chris, 2026-11-04.

7. **Stuck means stop.** When work is stuck, new work pauses and does not
   pile up. Fix the cause, then resume. Load never causes a failure: work
   waits in a queue. Work never waits for a timer; a timer starts only
   periodic work.
   Test: a change fails this rule when load can turn a pass into a fail, or
   when a transition waits for the tick.
   Source: "when something is stuck, work needs to pause and not pile up";
   "queue anything that slows under load"; Chris, 2026-11-04.

8. **Nothing grows without bound.** Tests, gates, rules and docs have a
   limit or a reason to shrink.
   Test: a change fails this rule when it adds something per goal or per run
   that nothing ever removes.
   Source: "'add a test per goal' … grow unbounded" (Chris, last week).

9. **Structured over text.** Components exchange JSON with a schema. A fact
   is a field, not a line that a parser finds in prose.
   Test: a change fails this rule when one component parses free text that
   another component wrote.
   Source: "should the output tags just be fields on the issue?"; "use json
   wherever possible" (2026-11-04).

## Code changes

These rules come from the Karpathy guidelines. Their rules to ask when
uncertain are replaced by rule 10, because aleph works without a person to
answer.

10. **Decide, and state the assumption.** Do not hide confusion. When a
    request has more than one reading, pick the reading that the repo and the
    history support, state it, and go on. Ask only when the readings lead to
    work that is materially different.
    Test: a change fails this rule when it picks a reading silently.

11. **Minimum code.** Write the least code that meets the goal. Add no
    feature, abstraction, option or error handling that the goal does not
    need. If 200 lines can be 50, write 50.
    Test: a change fails this rule when a line serves a case that cannot
    happen.

12. **Surgical changes.** Touch only what the goal needs. Match the style of
    the file. Do not improve adjacent code, comments or format. Remove only
    what your change made unused; report other dead code as a follow-up.
    Test: each changed line traces to the goal.

13. **Done means verified.** Define the success check before the change: a
    test that fails first, or a command and its expected output. A claim of
    done traces to a run of that check after the last edit.
    Test: a change fails this rule when its claim of done has no run behind
    it.
