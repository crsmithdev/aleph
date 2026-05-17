# Agent Failure Recovery

Recovery loop for when the agent itself is stuck — looping, retrying without progress, or drifting from the goal. Use this four-phase recovery loop instead of continuing blindly.

Loaded on demand from `SKILL.md`.

## Phase 1: Failure Capture

Stop and record the failure before attempting recovery:

```
## Failure Capture
- Session / task:
- Goal in progress:
- Error / symptom:
- Last successful step:
- Last failed tool / command:
- Repeated pattern seen:
- Environment assumptions to verify:
```

## Phase 2: Root-Cause Diagnosis

Match the failure to a known pattern:

| Symptom | Likely Cause | Check |
|---|---|---|
| Same tool call repeated 3+ times | Loop / no exit path | Inspect last N tool calls |
| Degraded reasoning, context drift | Context overflow | Check context % via monitor |
| `ECONNREFUSED` / timeout | Service down or wrong port | Verify service health |
| `429` / quota | Retry storm / missing backoff | Count repeated calls |
| File missing after write | Wrong cwd, race, branch drift | Re-check path, git status |
| Tests still failing after "fix" | Wrong hypothesis | Isolate the exact failing test |

Diagnosis questions:
- Logic failure, state failure, environment failure, or policy failure?
- Did the agent lose the real objective and start optimizing a subtask?
- Is the failure deterministic or transient?
- What is the smallest reversible action that validates the diagnosis?

## Phase 3: Contained Recovery

Recover with the smallest action that changes the diagnosis surface:

```
## Recovery Action
- Diagnosis chosen:
- Smallest action taken:
- Why this is safe:
- Evidence that proves the fix worked:
```

Recovery heuristics (in order):
1. Restate the real objective in one sentence
2. Verify the world state — don't trust memory
3. Shrink the failing scope to one file, command, or test
4. Run one discriminating check
5. Only then retry

Escalate to a human when the failure is high-risk or externally blocked.

## Phase 4: Introspection Report

```
## Agent Self-Debug Report
- Session / task:
- Failure:
- Root cause:
- Recovery action:
- Result: success | partial | blocked
- Token / time burn risk:
- Follow-up needed:
- Preventive change to encode later:
```
