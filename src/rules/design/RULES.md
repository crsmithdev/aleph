# Design Rules

Authoritative rules for UI surfaces under `src/ui/`. Read by `design-audit` and applied silently by `design-author`.

**Status: stub.** Will be populated in Phase 2. Until then, `design-audit` falls back to:
- `src/skills/design-audit/SKILL.md` (15 dimensions)
- `src/skills/design-standards/REFERENCE.md` (web standards / accessibility — will move to `accessibility.md`)
- `src/skills/design-type/REFERENCE.md` (typography — will move to `typography.md`)
- `src/skills/design-construct/` design kit references

## Planned sections

- **A. Hierarchy & rhythm** — visual hierarchy, spacing, vertical rhythm
- **B. Typography** — references `typography.md`
- **C. Color** — restraint, purpose, contrast
- **D. Alignment & grid** — pixel-perfect alignment, grid discipline
- **E. Components** — shared primitives over hand-rolled markup
- **F. Iconography** — single icon set, consistent weight/size
- **G. Motion** — purposeful only
- **H. Empty states** — every screen with no data is intentional
- **I. Loading states** — consistent skeletons
- **J. Error states** — helpful, not technical
- **K. Dark mode** — designed, not inverted
- **L. State coverage** — does the surface handle loading / empty / error uniformly
- **M. Density** — removal filter; nothing without purpose
- **N. Responsiveness** — every viewport, every input modality
- **O. Accessibility** — references `accessibility.md`

## Reference files

- `typography.md` — character correctness, type scale, kerning, line height (from `design-type`)
- `accessibility.md` — a11y, ARIA, focus, keyboard nav, contrast (from `design-standards`)
