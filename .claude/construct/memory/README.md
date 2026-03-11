# construct-memory

Session hooks, memory directories, ratings capture.

**Depends on:** construct-core

## Contents

- `CONTEXT.md` — active project state (fast-changing, episodic)
- `LEARNED.md` — durable cross-session insights (human-curated)
- `sessions/` — session summaries
- `snapshots/` — mental model snapshots
- `signals/ratings.jsonl` — explicit + implicit satisfaction ratings
- `hooks/session-start.ts` — surfaces focus, recent learnings, snapshots at SessionStart
- `hooks/rating-capture.ts` — captures explicit N/10 ratings at UserPromptSubmit
- `hooks/sentiment-capture.ts` — context-injected implicit satisfaction rating at Stop
- `hooks/session-summary.ts` — context-injected 3-bullet session summary at Stop

Post-install verification: see [INSTALL.md](INSTALL.md).
