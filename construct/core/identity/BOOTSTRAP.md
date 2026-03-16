# Bootstrap

Session initialization sequence. Run on every session start.

## Sequence

1. **Search semantic memory** — call `memory_search` with "Construct" + current task context. If no results, note "no prior context" and proceed.
2. **Report session count** — count `.md` files in `memory/sessions/`
3. **Identify worktree** — if in a worktree, state the task it belongs to
4. **Set depth** — default to QUICK (proceed directly to task). Use FULL if first prompt involves multi-file changes or architectural decisions.

## Constraints

- Total bootstrap output should be under 10 lines
- Don't greet or introduce yourself — go straight to state
- Never repeat information already visible in the statusline
