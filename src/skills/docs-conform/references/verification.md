# Docs Conform — Verification

After applying conform edits, gate on these checks before claiming done.

## Required gates

### 1. Markdown parses cleanly

```bash
# Check that all conformed files parse as valid markdown
# (relies on existing tooling — adapt if a project linter is preferred)
for f in <changed-files>; do
  python -c "import markdown; markdown.markdown(open('$f').read())" || echo "FAIL: $f"
done
```

If any file fails to parse, fix the syntax before claiming done.

### 2. Cross-references resolve

```bash
# Every relative link in the conformed files points at an existing path
grep -nE '\]\(([^)]+\.md|[^):]+/)' <changed-files> | \
  awk -F'(' '{print $2}' | tr -d ')' | \
  while read path; do [ -e "$path" ] || echo "BROKEN: $path"; done
```

Broken cross-references are a Critical-tier issue.

### 3. Frontmatter parses (YAML)

```bash
# For files with --- frontmatter blocks
for f in <changed-files-with-frontmatter>; do
  awk '/^---$/{c++; next} c==1{print}' "$f" | \
    python -c "import yaml,sys; yaml.safe_load(sys.stdin)" || echo "FAIL YAML: $f"
done
```

### 4. Project-specific: `bun test.ts` still passes

For doc files that are read by hooks or the install script
(`src/skills/*/SKILL.md`, `src/core/CLAUDE.md`, `src/skills/skill-rules.json`),
the test suite verifies they're well-formed:

```bash
bun test.ts
```

If any conform edit touched a SKILL.md that participates in the registry,
test failure means the conform pass broke the registry — fix before claiming
done.

## Doc-vs-code drift validation

For docs that describe behavior, after the conform pass the doc must still
match the code in the same commit. Use the truth-source table from
`../docs-author-v2/RULES.md` section E:

| Document | Truth source |
|---|---|
| `README.md` | Actual directory layout, hook registrations, slash commands |
| `INSTALL.md` | Actual installer behavior, preserved files, prerequisites |
| Module `README.md` | Actual module contents and hook behavior |
| Module `INSTALL.md` | Actual verification results (run the checks) |
| `SPEC.md` | Actual hooks, commands, skills, behavior |
| `CLAUDE.md` | Actual behavior (are rules followed? do referenced files exist?) |
| Skill `SKILL.md` | Actual `skill-rules.json` keywords, skill directory contents |

If a conform pass moved or renamed a section that's referenced from another
doc, also update those cross-references — never leave them dangling.

## Eyeball pass

After automated gates pass, read each conformed peer end-to-end. Specifically
check:

1. **Side-by-side with the reference** — open both in adjacent panes. Hot-swap.
2. **Heading hierarchy** — table of contents (mental or generated) feels
   parallel to the reference's.
3. **Section presence** — every section the reference has, the peer either
   has or has an explicit reason to lack.
4. **Voice** — read aloud. The peer should sound like the reference.

If any feels off, that peer wasn't fully aligned — re-open the conform pass.

## Worktree-specific notes

When working in a worktree (`.worktrees/<name>`):

- Run `bun test.ts` from the worktree root, not against the main checkout.
- Doc changes don't typically need `bun run ui:smoke` — only if the doc is
  being rendered in the UI (e.g., `src/ui/**/*.md`). For pure source-tree
  docs, `bun test.ts` is sufficient.

## Non-gates

These do **not** count as verification for a docs-conform pass:

- "Diff looks right by eye" — needs at least the markdown-parse + cross-ref check
- "I read it once" — needs the full eyeball pass after automated gates
- `git diff` shows fewer lines — line count is not a quality signal

## On failure

If any gate fails:

1. Read the failure trace
2. Fix the offending peer (or the reference, if the conform pass surfaced
   a pre-existing issue in the reference itself)
3. Re-run the gates
4. If the failure is in the reference (incidental fix), note as such in the
   summary — do not roll the incidental fix into the same commit as the
   conform pass; split the commits per project commandment 4.

Never silence a failure by skipping a gate.
