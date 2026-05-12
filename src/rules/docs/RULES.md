# Docs Rules

Authoritative rules for documentation under `docs/`, plus all `README.md`, `SKILL.md`, `AGENTS.md`, `SPEC.md` files. Read by `docs-audit` and applied silently by `docs-author`.

**Status: stub — will inherit from `src/skills/docs-author-v2/RULES.md` in Phase 2.** The existing `docs-author-v2/RULES.md` is the canonical doc rule set today and is referenced from multiple skills (`docs-audit`, `docs-conform`). It will be moved here verbatim once those references are updated.

Until then, `docs-audit` reads `src/skills/docs-author-v2/RULES.md` directly.

## Planned sections (mirror existing docs-author-v2/RULES.md)

- **A. Voice & style** — no AI tells, no filler, no passive voice
- **B. Formatting** — code-block language tags, H1 count, heading depth, file references
- **C. Density** — lead with the answer, no openers, no stubs
- **D. Structure & metadata** — TOC threshold, version markers, doc-type sections
- **E. Accuracy / drift** — doc-vs-code truth table; flagged as Critical
- **F. LLM optimization** — c7score-style coverage, snippet self-containment
