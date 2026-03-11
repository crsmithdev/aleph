# Current Context

## Active Projects
- **Construct** — personal AI infrastructure for Claude Code. Active development: refining packs, install workflow, documentation.

## Current Focus
Stabilizing install/verify cycle. Recent changes: split docs into per-pack README.md + INSTALL.md, added /install and /grasp commands, separated project-root CLAUDE.md (commandments) from framework .claude/CLAUDE.md (deployed globally). Installer now dynamically preserves any ALL CAPS .md files in identity/ and memory/.

## Known Constraints
- USER.md still has placeholder values (name, timezone, stack, etc.)
- MEMORY.md at ~/.claude not yet created (auto-created on first session write)
- Only 1 skill (research) — skill system is functional but underused
