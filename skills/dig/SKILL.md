---
name: dig
description: >
  Dig: follow one small symptom down, one "why is it like this?" at a time,
  until it reaches the model under it (identity, keys, storage, ownership,
  formats), then propose one consolidated fix. Use only when the user types
  /aleph:dig with a starting problem. NOT for: an audit against a fixed
  checklist (use /aleph:refit-code); a known bug (use /aleph:diagnosing-bugs).
argument-hint: <starting problem>
disable-model-invocation: true
---

# Dig

The starting problem is `$ARGUMENTS`. It is a small, often cosmetic symptom: an inconsistent ID in a feed,
an odd file format, a naming wart.
Ask "why is it like this?" and answer from real data. Repeat until the answer is a fundamental model. The fix
at that level removes the symptom and the sprawl around it.

The refit skills audit against a fixed checklist. Dig follows one thread wherever it leads and learns as it
goes. Work alone, end to end. Decide each open question yourself, with a stated reason (vault note "A
High-Level Goal Is Pursued End To End Without Check-Ins"). Ask the user only when a choice is irreversible or is
The user's taste.

## Steps

1. **Start.** State the symptom in one sentence. Open a trail file in the scratchpad, or in the plan file if
   one exists. In a headless run (`claude -p`) there is no scratchpad: the reply is the trail, and you write
   each step into it as you finish it. Done when the symptom and the first question are written down.
2. **Look.** Read the real code and the real data. Count: tally every distinct shape (event subjects, ID
   formats, folder names, file formats) and how many of each; in a headless run (`claude -p`) take each count
   with one command. Do not reason from docs alone. Docs and comments lie.
3. **Question.** Ask why each odd thing is as it is. Treat a convention that looks arbitrary as a question, not
   a given. Example: ask why a file uses HTML comment markers when a markdown heading would do.
4. **Record.** Write the step to the trail now: question, evidence, finding. If the data disproves an earlier
   claim, correct it in the open in the trail. Do not edit it away.
5. **Go down.** Turn the finding into the next question, one level deeper. Stop going down when the question
   is about a model, not a surface: identity and keys, storage, ownership, or formats. In a headless run
   (`claude -p`) stop after six trail steps, whatever the data still holds. Done when a further "why" has no
   answer in the data, only a choice.
6. **Research.** Before you decide anything structural, run `aleph:prior-art` and search the web. Then check
   each performance or safety claim with a cheap scratch benchmark. Examples: concurrent SQLite writers, WAL
   growth under a long reader, one synthetic year of queries. Keep the benchmarks in the scratchpad and
   record the numbers; in a headless run (`claude -p`) skip `aleph:prior-art` and the web survey, say so under
   "Not verified", and keep the benchmarks in `/tmp`.
7. **Choose a rule.** Prefer one simple rule that is self-describing and covers many cases. Example: ID is
   `<kind>.<n>` and the path is the key. Consolidate: fewer stores, fewer file formats, fewer files. Then run
   `aleph:red-team` on the proposal and fix what it finds; in a headless run (`claude -p`) run its lenses
   yourself in one pass, without dispatching reviewers.
8. **Decide.** Settle each open question with a reason. Write a vault note for each decision and each learned
   behavior with `aleph:vault`. In a headless run (`claude -p`) write no note: name each note you would write in
   Decisions.
9. **Propose.** Write the proposal and act on it by the work mode (`skills/mode/SKILL.md`). In factory mode,
   file the work as issues. In solo mode, build it with worktree agents. In a headless run (`claude -p`) file no
   issue and start no build: list the issues you would file in Sins.

## Output

Report these parts, each in full:

1. **Trail.** Each step, the first included, as three labeled lines: Question, Evidence, Finding. The
   evidence is a command, a `file:line` or a count, not a restatement.
2. **Fundamental finding.** The model the symptom came from, in one or two sentences.
3. **Proposal.** The consolidated change. List what moves and what stays fixed (name the schema, the API, the
   data flow).
4. **Measurements.** The counts and the benchmark numbers that back the choices.
5. **Sins.** Each wrong thing found on the way, in two groups: must be fixed with the change, and can follow
   later. File the second group as issues; in a headless run (`claude -p`) file none and list the second group as
   the issues you would file.
6. **Decisions.** Each open question you decided, with its reason and the vault note.

Not verified: state any claim you did not check against data or a run.

Then follow [SHELF](../SHELF.md): the parts above, as a `dig-<symptom>.md` file in the scratchpad, kind `report`, no wait.
