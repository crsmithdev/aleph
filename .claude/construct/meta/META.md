# Construct Meta Module

## /verify
For each installed pack, run its Post-install verification block from spec.md.
Report results as a clean ✓/✗/⚠ list grouped by pack.
A pack is considered installed if its primary files are present (e.g. construct-memory = memory/CONTEXT.md exists).
Flag failures as ACTION REQUIRED. Warnings are informational.
Flag CLAUDE.md files over 300 lines as a soft warning.

## /context-report
- Which identity files are in context
- Which skills are active
- Current project and phase from memory/CONTEXT.md (if installed)
- Session count (if construct-memory installed)
- Unresolved snapshots in memory/snapshots/ (if construct-memory installed)

## /spec
Unified spec management. Three subcommands:
- `/spec diff` — Read-only drift check. Compare spec code blocks against disk files.
- `/spec update` — Update spec.md from disk. Disk is truth.
- `/spec apply` — Update disk from spec.md. Spec is truth.
See `.claude/commands/spec.md` for full process.

## /clear-snapshot
Delete named file from memory/snapshots/.
If no name given, list all snapshots and ask which to remove.

## Future: TeammateIdle / TaskCompleted (Phase 5)
2026 hook events for multi-agent coordination.
Planned for Life OS parallel module development:
- TaskCompleted -> trigger session-summary for completing agent + confirm ISC
- TeammateIdle -> notify orchestrator to dispatch next dependent task
Revisit when multi-agent Life OS work begins.
