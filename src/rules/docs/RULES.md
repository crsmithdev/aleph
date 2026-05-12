# Documentation Rules

Canonical rule set for the docs trio. Every rule below is **lifted verbatim**
from a named source file — no rules invented in this document. Suggestions
and proposed additions live in `SUGGESTIONS.md`, not here.

Cross-referenced by:
- `src/skills/docs-author-v2/SKILL.md` — applies these rules silently during generation
- `src/skills/docs-audit/SKILL.md` — checks existing docs against these rules
- `src/skills/docs-conform/SKILL.md` — uses these rules to validate alignment

## A. Voice & style

*Source: `src/core/identity/STYLE.md` + `~/.claude/CLAUDE.md` Tone and style*

- **Tone:** neutral, efficient, not cold; match the user's register
- **Sentence structure:** shortest possible; fragments OK
- **Vocabulary:** common words; no filler ("just", "really", "very", "basically"); no preambles, transitions, sign-offs
- **Active voice; direct address**
- **Anti-patterns** — never produce these:
  - "Sure! I'd be happy to help with that!"
  - "That's a great question!"
  - Restating the question before answering
  - Summarizing after answering
  - Any sentence that could be removed without losing information

## B. Formatting

*Source: `src/core/identity/STYLE.md` + `~/.claude/CLAUDE.md` Tone and style + `docs-author/SKILL.md` Standards*

- Tables over paragraphs; code over explanation
- No emoji
- Headers only for responses longer than ~10 lines
- Reference files as `path/to/file:line` for navigability
- Code blocks always fenced with a language tag
- One H1 per file; matches filename / skill name
- Heading depth ≤ 3

## C. Density

*Source: `~/.claude/CLAUDE.md` "Doing tasks" + `src/core/identity/STYLE.md`*

- Lead with the answer; explain after
- Cut clauses; prefer two short sentences over one long
- Concrete > abstract — name the file, function, flag, or output
- No filler openers ("In this section we will…", "It's worth noting…")
- If a section says nothing, delete it — no "this will be filled in" stubs

## D. Structure & metadata

*Source: existing `docs-author/SKILL.md` Standards section*

- Technical language appropriate for developers
- Table of contents for documents over ~100 lines
- Both quick-start and detailed reference sections where appropriate
- Version info and last-updated dates
- Cross-references to related documentation

### Doc-type specifics

*Source: existing `docs-author/SKILL.md` Special Cases section*

- **APIs**: include usage examples, response schemas, error codes
- **Workflows**: create flow diagrams, state transitions
- **Config**: document all options with defaults and examples
- **Integrations**: explain external dependencies and setup requirements

## E. Accuracy

*Source: `/home/crsmi/construct/.claude/CLAUDE.md:18` (commandment 8) + project `/docs-review` skill extension*

- Every claim about behavior must match the code in the same commit (no doc-code drift)
- Don't reference functions, files, or flags that don't exist
- All code examples must be accurate and runnable
- All referenced file paths must exist
- Don't include "TODO" or "this section will be filled in" — finish or omit

### Doc-vs-code drift truth sources

*Source: project `.claude/CLAUDE.md` `/docs-review` skill extension table*

| Document | Truth source |
|---|---|
| `README.md` | Actual directory layout, hook registrations, slash commands |
| `INSTALL.md` | Actual installer behavior, preserved files, prerequisites |
| Module `README.md` | Actual module contents and hook behavior |
| Module `INSTALL.md` | Actual verification results (run the checks) |
| `SPEC.md` | Actual hooks, commands, skills, behavior |
| `CLAUDE.md` | Actual behavior (are rules followed? do referenced files exist?) |
| Skill `SKILL.md` | Actual skill-rules.json keywords, skill directory contents |

## F. Location

*Source: existing `docs-author/SKILL.md` Location Strategy*

- Prefer feature-local documentation (close to the code it documents)
- Follow existing patterns already established in the codebase
- Ensure documentation is discoverable — don't bury it

## G. LLM-optimization (referenced, not duplicated)

*Source: `docs-optimize/SKILL.md` + `docs-optimize/REFERENCE.md` + `docs-optimize/references/c7score_metrics.md`*

These are high-level expectations only. The full c7score methodology and
transformation patterns live in `docs-optimize/`; this document does not
duplicate them.

- Snippets answer specific developer questions ("How do I X?")
- Examples are self-contained and runnable (no import-only / install-only fragments)
- Proper language tags on every fenced code block
- No metadata snippets (licensing, directory trees, citations)
- One snippet, one lesson — no duplicate information

For full c7score methodology, see:
- `src/skills/docs-optimize/REFERENCE.md`
- `src/skills/docs-optimize/references/c7score_metrics.md`
- `src/skills/docs-optimize/references/optimization_patterns.md`
- `src/skills/docs-optimize/references/llmstxt_format.md`
