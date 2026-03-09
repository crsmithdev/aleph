---
name: verify
description: Run post-install verification for all installed Construct packs. Reports ✓/✗/⚠ grouped by pack.
---

For each installed pack, run its Post-install verification block from spec.md.
Report results as a clean ✓/✗/⚠ list grouped by pack.
A pack is considered installed if its primary files are present (e.g. construct-memory = memory/CONTEXT.md exists).
Flag failures as ACTION REQUIRED. Warnings are informational.
Flag CLAUDE.md files over 300 lines as a soft warning.
