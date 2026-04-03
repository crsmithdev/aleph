---
name: verification
description: Use before claiming work is complete, fixed, or passing. Requires e2e verification against the running system plus an artifact. When this skill is active, e2e is mandatory — not optional.
compatibility: Designed for Claude Code
---

# Verification

Claiming work is complete without verification is dishonesty, not efficiency.

## When to Use

- Before claiming work is complete, fixed, or passing
- After any change that needs proof it works
- When the user or prompt explicitly requires end-to-end confirmation

## Process

### The Iron Law

**No completion claims without fresh e2e evidence.** If you haven't run the real system and produced an artifact in this message, you cannot claim it works.

### The Gate

1. **IDENTIFY** — what running system or browser interaction proves this claim?
2. **START** — run the actual system or CLI
3. **INTERACT** — use Playwright, Chrome DevTools MCP, or direct CLI interaction
4. **CAPTURE** — save a screenshot or pipe output to a file as the artifact
5. **VERIFY** — does the artifact confirm the claim?
   - NO → state actual status with evidence
   - YES → state claim WITH evidence
6. **ONLY THEN** — make the claim

Skip any step = unverified claim.

### Verification Requirements

| Claim | Requires | Not sufficient |
|-------|----------|----------------|
| UI change works | Dev server running + browser interaction + screenshot | Unit tests, "looks right" |
| Bug fixed | Reproduce original symptom in running system | Code changed, assumed fixed |
| Feature complete | End-to-end flow through real system + artifact | All tests passing |
| CLI works | Run the actual binary, capture output to file | Reading the source |

### How This Skill Works

This skill is the explicit opt-in mechanism for mandatory e2e verification. When `/verification` is invoked (or matched by keywords), e2e is **required** — not advisory.

The Stop hook (`quality-stop-check-e2e.ts`) provides a gentle reminder when edits lack e2e evidence, but does not block. This skill overrides that — if it's active, skipping e2e is not an option.

The UserPromptSubmit hook emits a tip about e2e for all actionable prompts. That tip is informational only.

### What Satisfies the Gate

**E2E evidence** (any one):
- Playwright, Cypress, or Puppeteer run
- `bun/npm run dev`, `next dev`, `vite dev`
- `bun/node ... server` (any server process)
- Chrome DevTools MCP calls (`mcp__chrome-devtools__*`)
- Playwright/browser MCP calls

**Artifact** (any one):
- `--screenshot` flag or `.png`/`.jpg` file saved
- Output captured to file: `> file.txt` or `tee`
- `mcp__chrome-devtools__take_screenshot`

Unit tests (`bun test`, `jest`, `pytest`, `cargo test`, etc.) satisfy **neither** requirement.

## Done when

- Dev server or real system was started this turn
- Browser or CLI interaction confirmed the behavior
- Artifact (screenshot or captured output) exists as proof
- Every claim is backed by that evidence, reported inline

## Principles

- Evidence before assertions — no claim without fresh e2e verification
- The running system is the truth; source code and tests are not
- Unit tests verify logic; only the real system verifies the feature
- One screenshot beats a thousand "should work" assertions
