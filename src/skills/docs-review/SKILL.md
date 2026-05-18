---
name: docs-review
description: Review documentation against `src/rules/docs/RULES.md` — voice, formatting, density, structure, accuracy (doc-vs-code drift), location, LLM-discoverability (c7score). Scans, presents findings, applies approved fixes (peer-drift propagation, c7score optimization, structural fixes, polish), verifies. Also self-invoked in enforce mode while writing or drafting markdown — applies every rule silently with no findings. Triggers on /docs-review, /audit docs, "audit the docs", "review the documentation", "docs drift", "review the readme", "remediate docs drift", "align these docs", "sync docs to reference", "optimize docs", "c7score", "llms.txt", "docs for ai", "docs for llm", and is self-invoked whenever the agent is writing or editing markdown.
agent_backed:
  fix: docs-reviewer
---

# docs-review

Scans markdown across the repo against the docs rule set, presents findings grouped by severity, asks at the approval gate, applies approved fixes.

Fix dispatches to the **`docs-reviewer` agent** for non-trivial cases — its two-phase workflow (Phase 1: write/update from source; Phase 2: accuracy + c7score) is more thorough than inline edits for drift correction.

<!-- BEGIN: orchestration -->

## Process

1. **Scope.** `git diff --name-only $(git merge-base HEAD main)..HEAD`. If empty on clean main, fall back to `--since HEAD~10`; if still empty, scope defaults to the entire codebase — every file matching the Domain table below. Pass `--module <path>` to narrow.
2. **Scan** the rules in Domain below. For each hit: file:line, rule cite, one-line message, fix, severity (blocking / important / nit / suggestion / praise).
3. **Re-read** each cited location. Drop false positives.
4. **Report** grouped by severity. One line per finding: `path:line — rule — message. Fix: ...`.
5. **STOP. Ask.** Security findings (secrets, auth, injection, crypto, RCE, IDOR, SSRF, XSS) → one at a time, no bulk path. Otherwise: apply all / pick / discard.
6. **Apply** approved fixes.
7. **Gate.** Run the command in Domain. On failure: report as a new blocking finding, stop.
8. **Closing:** `Applied N. Touched M files. Gate green. Skipped: <list>.`

## Guardrails

- Leaves never call `Skill()`.
- Nothing edits before step 5.
- No green closing without a green gate.

<!-- END: orchestration -->

## Domain

- Rules: `src/rules/docs/RULES.md` (A: voice / B: formatting / C: density / D: structure / E: accuracy / F: location / G: LLM-optimization)
- Gate: doc-vs-code drift sanity check — for every changed doc, the claims it makes (file paths cited, behaviors described) must still match the code. No automated command yet; manual spot-check is the gate.
- Scope filter: `*.md` files
- Fix shapes: peer-drift propagation (when one doc is the reference, align siblings to it), c7score optimization (question-driven snippets, self-contained examples, language tags, `llms.txt` generation), structural fixes (broken cross-references, stale stub markers, doc-vs-code drift), polish (voice / AI-tells / density per rule sections A–C).
- Doc-vs-code drift truth sources: see the table in `src/rules/docs/RULES.md#E`.

## Enforce mode (self-invoked while writing markdown)

When writing or editing any `.md` file — README, AGENTS.md, SKILL.md, guides, API docs — apply every rule in `src/rules/docs/RULES.md` silently. No asking, no explaining, no diff. Pulls from the same rule sections (A voice, B formatting, C density, D structure / metadata, E accuracy, F location, G LLM-optimization).

Authoring from scratch follows a four-phase workflow inline: Discovery (read the code or feature being documented) → Analysis (identify audience + what they need to do) → Documentation (produce the doc applying all rules) → QA (read back, verify every file path / function / flag cited exists).

For c7score-specific optimization, see `src/skills/docs-review/references/c7score_methodology.md` and `optimization_patterns.md`.
