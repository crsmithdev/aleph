---
description: Review code for issues, then apply approved fixes — both phases live in the code-review skill
---
Run a code review and optional fix pass. Parse scope and intent from: $ARGUMENTS

## Phase 1: Review

Invoke the `code-review` skill in audit mode against the specified scope:

```
Skill("code-review", mode="audit", scope="<from $ARGUMENTS>")
```

If no scope is given in `$ARGUMENTS`, default to the recent diff (`git diff origin/main...HEAD`).

The skill produces SARIF findings + a prioritized phased report (Critical / Important / Minor). **Do not proceed to Phase 2 until the user approves which findings to fix.**

## Phase 2: Fix (after approval)

Once the user specifies which findings to address, re-invoke the same skill in fix mode with the approved SARIF subset:

```
Skill("code-review", mode="fix", findings=<approved sarif>)
```

The fix mode picks the right shape per finding tag (slop removal, propagation, consolidation, restructure) and verifies with `gate("code")`.

## Scope examples

| `$ARGUMENTS` | Scope passed to the audit pass |
|---|---|
| (empty) | `git diff origin/main...HEAD` |
| `src/foo/` | the `src/foo/` directory tree |
| `the auth module` | files related to auth |
| `everything` | all source files under `src/` |
