---
name: eval-harness
description: Define and run evals to measure AI development reliability. Use when setting up pass/fail criteria before implementation, measuring skill/agent reliability over time, or catching regressions. Subcommands: /eval define <name>, /eval run <name>, /eval report.
---

# Eval Harness

Eval-Driven Development (EDD) treats evals as unit tests of AI behavior:
define success criteria **before** implementation, run them continuously,
track regressions over time with pass@k metrics.

## When to Use

- Before implementing a feature: define what "done" looks like as graders
- After changing a skill or hook: regression check on existing behaviors
- Measuring reliability: "does this work 3/3 times?" (pass@3)
- Debugging flakiness: "what's our pass@1 rate on this eval?"

## Subcommands

### `/eval define <name>`

Create an eval definition at `.claude/evals/<name>.md`:

```markdown
# Eval: <name>
## Capability Evals
- [ ] Can do X
- [ ] Can do Y
## Regression Evals
- [ ] Existing behavior Z still works
## Graders
- code: `grep -q "export function X" src/... && echo PASS || echo FAIL`
- code: `bun test -- --testPathPattern="X" 2>&1 | grep -q "0 failed" && echo PASS || echo FAIL`
## Target: pass@3 > 90%
```

### `/eval run <name>`

Execute all graders defined in `.claude/evals/<name>.md`:

1. For each **code grader**: run the bash command, capture PASS/FAIL
2. For each **model grader**: evaluate output against stated criteria (score 1-5)
3. For each **human grader**: flag for review with risk level
4. Record attempt number and results
5. Append to `~/.construct/evals/results.jsonl`:
   ```json
   {"ts":"...","evalName":"<name>","attempt":1,"passed":2,"failed":0,"passAt1":true,"graders":[{"type":"code","result":"PASS","command":"..."}]}
   ```

### `/eval report`

Show reliability trends for the current project's evals:

1. Read `.claude/evals/*.md` for defined evals
2. Read `~/.construct/evals/results.jsonl` for run history
3. Calculate pass@1 (first-attempt success rate) and pass@3 (success in 3 tries)
4. Show table: eval name | runs | pass@1 | pass@3 | trend | last run

## Grader Types

### Code Grader (deterministic)
```bash
# File exists with expected content
grep -q "export function handleAuth" src/auth.ts && echo PASS || echo FAIL
# Tests pass
bun test -- --testPathPattern="auth" 2>&1 | grep -q "0 failed" && echo PASS || echo FAIL
# Build succeeds
bun run build 2>&1 | tail -1 | grep -q "error" && echo FAIL || echo PASS
```

### Model Grader (semantic)
Describe what to evaluate in natural language. Claude scores 1-5:
- 5: Fully meets criteria, no issues
- 3: Partially meets criteria, minor gaps
- 1: Does not meet criteria

Pass threshold: score ≥ 4.

### Human Grader (manual review)
Flag specific checks that require human judgment:
```
human: Verify UX flow feels natural (risk: MEDIUM)
human: Check that error messages are user-friendly (risk: LOW)
```

## pass@k Metrics

- **pass@1**: Did it succeed on the first attempt?
- **pass@3**: Did it succeed at least once in 3 attempts?
- **Target**: pass@3 > 90% for capability evals; pass@3 = 100% for regression evals

Track these over time to catch regressions when skills or prompts change.

## Storage

- **Eval definitions**: `.claude/evals/<name>.md` — version-controlled per project
- **Eval results**: `~/.construct/evals/results.jsonl` — global append-only log
- **View results**: observability UI → Evals page

## Done when

- All graders produce PASS
- pass@3 target is met
- Results are written to `~/.construct/evals/results.jsonl`
