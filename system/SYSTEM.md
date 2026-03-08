# CPAI System Module

## /verify
For each installed pack, run its Post-install verification block from cpai.md.
Report results as a clean ✓/✗/⚠ list grouped by pack.
A pack is considered installed if its primary files are present (e.g. cpai-memory = memory/CONTEXT.md exists).
Flag failures as ACTION REQUIRED. Warnings are informational.
Flag CLAUDE.md files over 300 lines as a soft warning.

## /dashboard
Collect and display:
1. Session signals — explicit + implicit rating count, rolling average from ratings.jsonl
2. Recent sessions — last 5 entries from memory/sessions/
3. memory/LEARNED.md — High Confidence section + last 5 Active entries
4. MEMORY.md tail — last 5 entries (candidates for promotion)
5. Active project — current focus from memory/CONTEXT.md
6. Memory size — session count, ratings count, snapshot count

## /update-learned
If cpai-memory is not installed, say: "cpai-memory is not installed — /update-learned requires session summaries and LEARNED.md. Run /verify to check what's installed."
Otherwise:
1. Show last 5 session summaries from memory/sessions/
2. Show last 10 entries from MEMORY.md
3. Ask which insights to promote to memory/LEARNED.md
4. For each approved entry:
   - Seen before (3+ sessions): -> ## High Confidence, **bold** prefix
   - New: -> ## Active, today's date
5. Flag ## Active entries >90 days old as pruning candidates
6. Confirm additions and flags

## /context-report
- Which identity files are in context
- Which skills are active
- Current project and phase from memory/CONTEXT.md (if installed)
- Session count (if cpai-memory installed)
- Unresolved snapshots in memory/snapshots/ (if cpai-memory installed)

## /clear-snapshot
Delete named file from memory/snapshots/.
If no name given, list all snapshots and ask which to remove.

## Future: TeammateIdle / TaskCompleted (Phase 5)
2026 hook events for multi-agent coordination.
Planned for Life OS parallel module development:
- TaskCompleted -> trigger session-summary for completing agent + confirm ISC
- TeammateIdle -> notify orchestrator to dispatch next dependent task
Revisit when multi-agent Life OS work begins.
