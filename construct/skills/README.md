# construct-skills

Depth classification, keyword-matched skill evaluation, skill routing config, quality hooks, notifications.

**Depends on:** construct-core

## Contents

- `skill-rules.json` — keyword routing config
- `hooks/format-reminder.ts` — depth classification + skill eval at UserPromptSubmit
- `hooks/quality.ts` — per-file lint/format on Edit/Write (PostToolUse)
- `hooks/notify.ts` — WSL toast / macOS alert / terminal bell (Notification)
- `research/SKILL.md` — research methodology skill
- `verification/SKILL.md` — verification-before-completion enforcement
- `debugging/SKILL.md` — systematic 4-phase root cause debugging
- `subagent-dev/SKILL.md` — subagent-driven development with two-stage review
- `code-review/SKILL.md` — dead code, unused imports, code quality, dead references
- `docs-review/SKILL.md` — documentation drift detection
- `instructions-review/SKILL.md` — instruction quality: vagueness, contradictions, duplication
- `ralph-loop/SKILL.md` — autonomous iterative development via subagent loops

## Usage

Every prompt is automatically classified by depth:

- **QUICK** — short, non-architectural requests. Claude proceeds immediately.
- **FULL** — architectural keywords (`architect`, `redesign`, `migrate`, etc.) or complex requests (≥40 words). Claude is reminded to write ISC before proceeding.

Prompts are also matched against skill keywords. When a match is found, Claude is told to activate the skill before responding. For example, asking Claude to "research the tradeoffs between X and Y" triggers the `research` skill.

To add a new skill:

1. Add a rule to `skill-rules.json`:
   ```json
   {"skill": "deploy", "keywords": ["deploy", "release", "ship", "rollout"]}
   ```
2. Create a skill file (e.g., `deploy/SKILL.md`) with the skill's prompt template. See `research/SKILL.md` for the pattern.

## Verification

Post-install checks: see [INSTALL.md](INSTALL.md).
