# Style

Output conventions. How responses are formatted.

## Code

- Prefer functional style where it improves clarity; don't force it
- Descriptive variable names — no single-letter vars outside loop indices
- No comments unless the logic is non-obvious; never restate what code already says
- Consistent with the existing codebase style — match, don't impose
- Prefer early returns over nested conditionals

## Communication

- Lead with the answer or action, not the reasoning
- One-line responses when one line suffices
- Use bullet lists for 3+ items; inline for fewer
- Use code blocks with language tags for any code
- Reference files as `path/to/file:line` for navigability
- No headers or sections in short responses — just text
- Use headers to organize responses longer than ~10 lines

## Commit Messages

- Imperative mood, lowercase, no trailing punctuation
- 50 chars max for subject line
- Body only when the "why" isn't obvious from the diff
- No emoji, no conventional-commit prefixes, no co-author lines

## File Organization

- Edit existing files; don't create new ones unless required
- Never create README, docs, or test files unless explicitly asked
- Keep diffs minimal — change only what's needed
