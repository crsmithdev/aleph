---
name: construct
description: Construct management — subcommands: install, verify, grasp, status, retain, trace, spec, ralph, audit
---

Route to the matching subcommand based on `$ARGUMENTS`:

## `install` (or no argument from project root with install.ts present)

Run the Construct installer to deploy this repo globally to ~/.claude.

Execute: `bun install.ts`

If the user passes `--dry-run`, prepend each destructive step with `echo "[dry-run]"` instead of executing.

After the script completes, run `/construct verify` to confirm the installation.

## `verify`

For each installed module, read its INSTALL.md and run every check listed there.
Do not skip or summarize checks. Run each one individually and report the exact result.

Module INSTALL.md locations and detection:
- `construct/core/INSTALL.md` — detected if `~/.claude/CLAUDE.md` exists
- `construct/memory/INSTALL.md` — detected if `construct/memory/hooks/session-start.ts` exists
- `construct/dev/INSTALL.md` — detected if `construct/dev/hooks/quality.ts` exists
- `construct/skills/INSTALL.md` — detected if `construct/skills/skill-rules.json` exists
- `construct/meta/INSTALL.md` — detected if `construct/meta/README.md` exists
- `construct/dashboard/INSTALL.md` — detected if `construct/dashboard/api/src/app.ts` exists

Report format: ✓ pass, ✗ fail (ACTION REQUIRED), ⚠ warning (informational).
Group results by module. Run Files, Data, and Verification checks for each module.

## `grasp`

Before any implementation, externalize your current model of this project.
State each item explicitly. Say "uncertain" rather than guessing.

**Commandments** — Read the `## Commandments` section from the project's CLAUDE.md. List each one verbatim. If there is no Commandments section, say so.

**Project identity** — What is this? What phase is it in?

**Stack** — Runtime, language, framework, DB/ORM, test tooling, package manager.

**Active work** — What was being worked on? Current ISC criteria if any?

**Key files** — Most important files for this task. Files NOT to touch without discussion.

**Conventions** — Naming, structure, patterns you're aware of. Anti-patterns you've been warned about.

**Uncertainties** — What are you NOT sure about? What assumptions could be wrong?

After producing this summary, ask: "Is any of this wrong or out of date?"

## `status`

Collect and display:

**Context**
- Which identity files are present in `construct/core/identity/`
- Which skills are active (list from `construct/skills/`)
- Active project context from semantic memory (`memory_search`)

**Memory**
- Session signals — explicit rating count, rolling average from `ratings.jsonl`
- Recent sessions — last 5 entries from `memory/sessions/`
- Memory size — session count, ratings count

## `retain`

Review recent work and promote durable insights to semantic memory.

1. Show last 5 session summaries from memory/sessions/

3. Ask which insights to store in semantic memory
4. For each approved entry, call `memory_store` with appropriate tags and `memory_type`


## `trace` (no additional arguments)

Toggle hook tracing. The trace flag is the file `~/.claude/construct/.trace`.

1. Check if `~/.claude/construct/.trace` exists
2. If it exists: delete it, print `Trace: OFF`
3. If it doesn't exist: create it (empty file), print `Trace: ON`

## `trace <command> [args]` (with additional arguments)

Run a single command with tracing enabled, then restore previous state.

1. Check if `~/.claude/construct/.trace` already exists (remember this as `was_on`)
2. If not already on: create `~/.claude/construct/.trace`
3. Print `Trace: ON (one-shot)`
4. Run the command specified by the remaining arguments (e.g., `/construct trace status` runs `/construct status`)
5. If `was_on` is false: delete `~/.claude/construct/.trace`, print `Trace: OFF`

## `spec diff`

Show drift between documentation and actual file/code state without changing anything.

1. Activate the `doc-sync` skill
2. Run the detection process on all docs in scope: SPEC.md, README.md, INSTALL.md (root + modules), CLAUDE.md (root + .claude/), and SKILL.md files under construct/skills/
3. Output a table of all `✗` and `⚠` findings
4. For each, show: document, line, claim, actual state, suggested direction (update doc or update code)

## `spec update`

Update documentation to match current file/code state.

1. Run `spec diff` first to identify all drift
2. For each `✗` finding, propose the fix (show old → new)
3. Apply approved fixes
4. Run `/construct verify` to confirm changes are correct

## `spec apply`

Update code/files to match documentation claims (reverse direction — use when docs describe intended behavior).

1. Run `spec diff` first to identify all drift
2. For each `✗` finding, determine if the doc or code is "right"
3. For cases where the doc is intentional (new feature spec), modify code to match
4. Run tests after each change
5. Run `/construct verify` on the full result

## `ralph "<prompt>" [--max-iterations N] [--completion-promise "TEXT"]`

Start a Ralph loop — autonomous iterative development via the Stop hook.

1. Parse arguments: extract prompt text, `--max-iterations` (default 0 = unlimited), `--completion-promise` (default none)
2. Create `.claude/ralph-loop.local.md` with this exact format:
   ```
   ---
   active: true
   iteration: 1
   max_iterations: <N>
   completion_promise: "<TEXT>" (or null)
   started_at: "<ISO 8601 UTC>"
   ---

   <prompt text>
   ```
3. Report activation:
   ```
   🔄 Ralph loop activated!
   Iteration: 1
   Max iterations: <N or unlimited>
   Completion promise: <TEXT or none>
   ```
4. Begin working on the prompt. When you try to exit, the `ralph-stop.ts` Stop hook will block exit and feed the same prompt back.

**Safety:** Always recommend `--max-iterations` as a safety net. Without it, the loop runs until completion promise is met.

**Completion:** To signal done, output `<promise>TEXT</promise>` where TEXT exactly matches the completion promise. ONLY output this when the statement is genuinely true.

## `cancel-ralph`

Cancel the active Ralph loop.

1. Check if `.claude/ralph-loop.local.md` exists
2. If not found: say "No active Ralph loop found."
3. If found: read the iteration count, delete the file, report "Cancelled Ralph loop (was at iteration N)."

## `audit`

Full project audit. Six phases, run in order. Report findings per phase, then summarize.

### Phase 1: Code quality

For every `.ts` file under `construct/` (hooks, skills, installer):

1. Read the file.
2. Flag: dead code, unused imports, unused variables, redundant logic, overly verbose patterns, code that could be shorter without losing clarity.
3. Flag: misnamed functions/variables that don't match what they do.
4. Flag: silent failures that should surface errors, or error handling that swallows useful context.
5. For each finding: file, line, issue, suggested fix (one line).

### Phase 2: Dead references

1. Collect every file path referenced in: `settings.json`, `CLAUDE.md`, `SPEC.md`, `README.md`, all `INSTALL.md` files, `skill-rules.json`, `construct.md`.
2. Check each path exists on disk (resolve relative to `~/.claude/` or project root as appropriate).
3. Collect every hook command in `settings.json` and verify the target file exists.
4. Flag: ✗ for missing files, ⚠ for files that exist but are empty.

### Phase 3: Instructions audit

Read every file that contains instructions for Claude (CLAUDE.md at all levels, identity files, SKILL.md files, this command file).

For each file:
1. Flag instructions that are vague, ambiguous, or could be interpreted multiple ways. Suggest a concrete rewrite.
2. Flag instructions that contradict other instructions. Cite both locations.
3. Flag instructions that are impossible to follow (reference nonexistent tools, features, or patterns).
4. Flag instructions that are duplicated across files. Cite both locations and recommend which to keep.
5. Highlight essential user-facing information that is missing — things a new session would need to know but can't derive from the codebase.

### Phase 4: Documentation drift

Run the `doc-sync` skill detection across: `SPEC.md`, `README.md`, `INSTALL.md` (root + all modules), `CLAUDE.md` (root + `.claude/`).

Output the standard drift table: document, line, claim, actual state, direction.

### Phase 5: Spec completeness

Read `SPEC.md` and check:
1. Every hook registered in `settings.json` is documented in the Hook Registration table.
2. Every slash subcommand in `construct.md` is documented.
3. Every skill in `skill-rules.json` is documented.
4. Every module detection file listed matches reality.
5. Flag any behavior described in SPEC.md that has no corresponding implementation.

### Phase 6: Statistics

Count and report:

```
=== Project Statistics ===
Code
  Hook files:      N files, N lines
  Skill playbooks: N files, N lines
  Installer:       N lines
  Tests:           N files, N lines

Instructions
  CLAUDE.md:       N lines (root + .claude/)
  Identity files:  N files, N lines
  Command file:    N lines
  Skill rules:     N rules

Documentation
  SPEC.md:         N lines
  README.md:       N lines (root + modules)
  INSTALL.md:      N lines (root + modules)

Totals
  Code:            N lines
  Instructions:    N lines
  Documentation:   N lines
  Ratio:           1:X:Y (code:instructions:docs)
```

### Output

After all phases, print a summary:

```
=== Audit Summary ===
Phase 1 (Code):         N issues (N fixable now)
Phase 2 (References):   N dead, N warnings
Phase 3 (Instructions): N vague, N contradictions, N duplicates, N missing
Phase 4 (Doc drift):    N findings
Phase 5 (Spec):         N gaps
```

Then ask: "Fix the code and reference issues now? (Instructions and docs require your review first.)"

If approved, fix phases 1-2 automatically. For phases 3-5, present each finding and proposed fix for approval.

## No match

If `$ARGUMENTS` doesn't match a subcommand, print:
```
Usage: /construct <subcommand>
  install       Deploy repo to ~/.claude
  verify        Run post-install checks
  grasp         Surface project understanding
  status        Show system status
  retain        Promote insights to semantic memory
  trace         Toggle hook tracing (or trace <cmd> for one-shot)
  spec          Doc sync — spec diff|update|apply
  ralph         Start autonomous iterative loop
  cancel-ralph  Cancel active Ralph loop
  audit         Full project audit (code, refs, instructions, docs, spec, stats)
```
