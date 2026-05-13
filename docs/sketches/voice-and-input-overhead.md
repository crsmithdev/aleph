# Reducing language overhead in human↔AI feedback loops

Typing is thorough but slow; voice is fast but linear and tedious. Current best
stack for closing that gap is layered, not a single tool.

## Recommended stack (shipping today)

1. **Voice as primary input** — Claude Code's native `/voice` (Mar 2026) or
   Wispr Flow. ~120–150 wpm vs. 40–60 typing. Use `tap` mode (single-keypress
   toggle) or a modifier combo, and turn on `autoSubmit` for fire-and-forget.
2. **Hybrid voice + text** — dictate prose, type symbols/paths the STT botches.
   Wispr Flow's "at <filename>" → `@filename` tagging is the cleanest pattern.
3. **Screen-context capture** instead of describing — Snip Browser (Chrome,
   open source) drops annotated screenshots straight into Claude Code; the
   "Everywhere" tool does the same OS-wide by reading text around the cursor.
   Vibe-annotate covers the browser side.
4. **Persistent memory** — CLAUDE.md + auto-memory absorb the recurring context
   you'd otherwise re-explain. Biggest leverage move per minute spent.
5. **Prompt suggestions** — Claude Code's next-step grayed-out suggestions; one
   key to accept.

## Frontier (research, not shipping)

- **GazeCopilot** (arXiv 2511.08177, Nov 2025) — uses real-time eye tracking to
  inject "what the developer is looking at" into the LLM prompt. Cheapest input
  signal because it's free byproduct of just working. ETRA 2026 EMIP workshop.
- Closest shipping analogue: Cursor 2.0's automatic file/region attaching by
  cursor position.

## Open questions

- WSL-specific hotkey conflicts with Windows Terminal — need a two-key reachable
  binding that doesn't collide.
- STT pauses inserting premature periods → punctuation control.
- Per-sentence undo on dictated input.
- Typed-symbol injection (filenames, paths, repos) without leaving voice mode.
- "Idea inbox" — capture surface for half-formed prompts that you triage later
  into actionable instructions, with a log of what was actually sent.
