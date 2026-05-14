# Voice input — concrete fixes for current pain points

Practical recommendations for the four voice-specific friction points.
No queue/inbox content; that's tracked separately.

## Pain 1 — WSL hotkey conflicts with Windows Terminal

**Recommendation: Wispr Flow on the Windows side, not Claude Code's `/voice`.**
Wispr is a Windows-native voice keyboard — types keystrokes at the OS level
into whatever has focus — so it bypasses WSL audio/IME passthrough entirely
(see open bug [#33941](https://github.com/anthropics/claude-code/issues/33941)).
Hotkey conflicts with Windows Terminal also go away because the hotkey is a
global Windows hook, not a terminal binding.

Concrete setup:
- **Hotkey**: rebind Wispr to `right-alt` (single key, almost never conflicts)
  or double-tap `right-ctrl`. Avoid `ctrl+space`, `alt+space`, `win+*` — all
  conflict-prone. See [Wispr supported hotkeys](https://docs.wisprflow.ai/articles/2612050838-supported-unsupported-keyboard-hotkey-shortcuts).
- **If staying on Claude Code `/voice` instead**: settings live in
  `~/.claude/keybindings.json` under `voice:pushToTalk` in the `Chat` context.
  Rebind to `meta+k` (Anthropic's example), or `ctrl+;` / `ctrl+'` for
  least-conflict combos. ([keybindings docs](https://code.claude.com/docs/en/keybindings))

## Pain 2 — Premature periods on thinking pauses

**Recommendation: tap mode, one tap = one atomic thought.** Long pauses
*between* sentences don't pollute the STT because you're not recording during
them.

- Claude Code: `/voice tap` (v2.1.116+) toggles record with a single key.
  Speak one sentence, tap, speak the next, tap.
- Wispr Flow: same pattern. Don't use Flow's continuous "hands-free" mode if
  you pause to think — that's what inserts premature periods.
- Both tools insert punctuation at clause boundaries; you can also say
  `"comma"` / `"period"` / `"no period"` to nudge.

Reference: [Wispr smart formatting & backtrack](https://docs.wisprflow.ai/articles/5373093536-how-do-i-use-smart-formatting-and-backtrack).

## Pain 3 — Undo last voice sentence without restarting

No tool has a clean "undo last sentence and re-record" today. What works:

- **Wispr Backtrack** — detects mid-dictation self-corrections ("no, scratch
  that, …") and cleans them up automatically. Closest to what you want.
- **`Ctrl+Z` after paste** — both Wispr and Claude `/voice` paste the
  transcript; standard editor undo removes it.
- **Combined with tap-mode-per-sentence (Pain 2)**, this is effectively
  "undo last sentence."
- **Claude Code TUI**: transcript lands in the input buffer before submit —
  edit it inline before Enter.

Workflow that actually works: tap-per-sentence + `Ctrl+Z` if the last sentence
was wrong + start the next tap. Treat each tap as a discrete unit.

## Pain 4 — Spelling out filenames, paths, repos by voice

Two layers stack:

### Layer A — Wispr Flow snippets
Define triggers in the Wispr dashboard:

| Trigger | Expands to |
|---|---|
| `repo construct` | `crsmithdev/construct` |
| `path construct` | `/home/crsmi/construct` |
| `dot claude` | `~/.claude/` |
| `local bin` | `~/.local/bin/` |

Bulk-import as JSON, up to 1000 items. ([snippet docs](https://docs.wisprflow.ai/articles/5784437944-create-and-use-snippets),
[bulk import](https://docs.wisprflow.ai/articles/8955301725-how-do-i-bulk-import-for-dictionary-and-snippets),
[MacSparky: Wispr is the new TextExpander](https://www.macsparky.com/blog/2026/05/wispr-flow-is-the-new-textexpander/))

### Layer B — `@filename` tagging
Wispr supports saying "tag" or "at" + filename → expands to `@filename`.
Currently Cursor/Windsurf integrations only; in Claude Code TUI rely on
Layer A snippets.

### Talon as the upper bound
If full Talon-grade symbol injection ("paren", "slash", "underscore",
"open bracket") becomes worth the learning curve, that's the ceiling.
For just referring to things — snippets cover 90%. ([Talon Voice](https://talonvoice.com/))
