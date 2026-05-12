# Docs Conform — Full Dimension Taxonomy

The five axes the skill compares peer docs against. SKILL.md keeps the short
list; this file is the deep reference, loaded only when the comparison needs
more nuance. Modeled on `design-fix/references/dimensions.md`, adapted
for prose/markdown rather than UI code.

## 1. Structure

- **Heading shape** — same H1 wording style across peers (e.g., all module
  READMEs start with the module name as the H1, not "Overview" or
  "Introduction")
- **Heading depth and order** — same section nesting; same order of
  sections (Purpose → Files → Verification → Cross-refs, not arbitrary)
- **Frontmatter keys** — same required keys present across peers; same
  ordering convention (e.g., `name` first, `description` second)
- **Section anchors** — same heading text where users link to it
  externally (changing "## Verification" → "## How to verify" breaks links)
- **Code block discipline** — language tags consistent; same fencing style
  (always triple-backtick, never indented)

## 2. Composition

Which sections exist, in which docs of the family. Drift here is the most
common — one doc adds a "Troubleshooting" section, peers don't, and the
docs feel uneven.

| Section | When required |
|---|---|
| Purpose / Overview | Every doc |
| Quick Start | Every README |
| Verification | Every doc that describes user-facing behavior |
| Files / Layout | Module READMEs |
| Hook table | Skill SKILL.md if the skill registers hooks |
| Cross-references | Every doc with siblings |

If the reference has a section the peer doesn't, ask: should the peer add
it, or is the absence intentional (because the peer doesn't have that
behavior)? Don't blindly add empty sections.

## 3. State coverage

Every doc that describes a behavior should cover its full state space, not
just the happy path:

| State | What the reference does | What peers must match |
|---|---|---|
| **Success path** | concrete example with expected output | same example shape |
| **Error path** | what to do when it fails; how to recover | same error-recovery shape |
| **Empty / no data** | what the user sees when there's nothing to show | same empty-state phrasing |
| **Permissions / setup** | what's required up front | same prerequisite shape |

A peer doc that describes only the success path while peers cover failure
modes is **major** drift.

## 4. Tokens / terminology

Use consistent project nouns across the family:

- `hook` vs `handler` vs `listener` — pick one per concept
- `skill` vs `slash command` — different things; don't conflate
- `worktree` vs `branch` vs `feature branch` — be precise
- Capitalization of product nouns — `Construct` (capitalized when referring
  to the system; lowercase `construct` only inside paths or commands)
- File path conventions — relative paths from repo root, not absolute
- Code identifiers — backtick-wrapped (`` `bun test.ts` ``), never bare

Drift here means a reader using doc A and doc B can't tell whether the docs
are talking about the same concept.

## 5. Microcopy

Tone and shape of short user-facing prose:

- Empty-state phrasing tense ("No skills yet" vs "There are no skills" — pick one)
- Command-result phrasing ("Done" vs "Complete" vs "✓ Installed" — pick one)
- Error-message shape — start with cause, not "Oops!" or "Sorry"
- Sentence case vs Title Case for headings — pick one and apply across peers
- Punctuation in labels (period at end of help text? colon after field labels?)
- Voice in instructions — imperative ("Run `bun install.ts`") vs gerund
  ("Running `bun install.ts` will…") — pick one

This dimension is small but the highest-signal drift the user will notice
when reading two peer docs side by side.

## Choosing dimensions for a session

Default: all five, biased toward whichever is most visibly broken in the
peer list.

If the user's notes name a specific dimension ("only the heading shape"),
restrict to that one and ignore the others — even if you spot drift on
another axis. Surface the unrelated drift in the report ("seen but not
fixed: peers also vary on microcopy — re-run with `--microcopy` to address")
and stop.

## Cross-axis examples

- **Module README family** spans Structure + Composition + Tokens (heading
  order, "Files" section presence, consistent use of "module" vs "package")
- **Skill SKILL.md family** spans Structure + Composition + Microcopy
  (frontmatter keys, "When to use" section presence, imperative voice)
- **AGENTS.md family** spans Composition + Tokens + State coverage (which
  agents have output formats documented; consistent use of "phase" vs
  "step"; whether failure modes are covered)
