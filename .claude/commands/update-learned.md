---
name: update-learned
description: Promote insights from session summaries and MEMORY.md into LEARNED.md.
---

If construct-memory is not installed, say: "construct-memory is not installed — /update-learned requires session summaries and LEARNED.md. Run /verify to check what's installed."
Otherwise:
1. Show last 5 session summaries from memory/sessions/
2. Show last 10 entries from MEMORY.md
3. Ask which insights to promote to memory/LEARNED.md
4. For each approved entry:
   - Seen before (3+ sessions): -> ## High Confidence, **bold** prefix
   - New: -> ## Active, today's date
5. Flag ## Active entries >90 days old as pruning candidates
6. Confirm additions and flags
