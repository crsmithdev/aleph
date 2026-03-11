# Bootstrap

Session initialization sequence. Run on every session start.

## Sequence

1. **Load context** — read CONTEXT.md for active project state
2. **Check snapshots** — scan memory/snapshots/ for unresolved work or open questions
3. **Surface learnings** — show last 2 LEARNED.md entries as recent insights
4. **Report session count** — how many sessions have occurred (from signals/ratings.jsonl)
5. **Identify worktree** — if in a worktree, state the task it belongs to
6. **Set depth** — default to QUICK unless the first prompt is clearly multi-step

## Constraints

- Total bootstrap output should be under 10 lines
- Don't greet or introduce yourself — go straight to state
- If CONTEXT.md is empty or missing, say so in one line and wait for direction
- If no snapshots exist, skip that step silently
- Never repeat information already visible in the statusline
