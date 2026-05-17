# Design Conform — Full Dimension Taxonomy

The five axes the skill compares peers against. SKILL.md keeps the short list; this file is the deep reference, loaded only when the comparison needs more nuance.

## 1. Layout & rhythm

- **Vertical rhythm** — consistent gap between header / body / footer; consistent paragraph spacing within sections.
- **Container widths** — peers use the same `max-w-*` or are explicitly full-width.
- **Density** — table row height, list item padding, button height. Drift here makes a peer feel "off" before the user can name why.
- **Alignment** — left-aligned content stays left across peers; right-aligned numeric columns stay right; centered modals stay centered.
- **Header row height** — fixed `h-14` (or whatever the reference uses) for top-level chrome so titles and sidebar headers visually line up at the same baseline.
- **Spacing tokens** — `mb-6`, `gap-2`, `px-4 py-2.5` should be the same values across peers, not `mb-5`/`mb-7` ad-hoc.

## 2. Component composition

- **Use the shared primitive.** If a `<PageHeader>` exists, peers should use it — not hand-roll `<h1 class="...">`. If a `<DataTable>` exists, peers should use it — not write a `<table>` from scratch.
- **Composition order.** Header → controls → content → footer, in that order, across peers.
- **Empty / loading / error slot.** If the reference renders a loading skeleton inside a `<DataTable>`, peers should too (not show a separate spinner that flashes).
- **Action placement.** Primary action top-right of header in the reference? Then it's top-right everywhere.
- **Card vs raw section.** If the reference wraps content in a `<Card>`, peers shouldn't render naked sections.

The single most common drift is "peer reimplemented something a shared primitive already does." Audit by reading the imports first.

## 3. State coverage

Every page/view should handle four states the same way:

| State | What the reference does | What peers must match |
|---|---|---|
| **Loading** | skeleton inline (no full-page spinner) | same skeleton style + position |
| **Empty** | meaningful message + optional CTA | same phrasing tense ("No results yet", not "0 items") |
| **Error** | inline error block with action to retry | same block style + retry shape |
| **Skeleton on partial data** | render what you have, skeleton the rest | same partial-fill shape |

A peer that renders perfectly in the happy path but blanks on empty is **major** drift, not minor.

## 4. Tokens

Use the design tokens, not raw values:

- **Color** — `text-text-muted`, `bg-bg-secondary`, `border-border-primary`. Never hex codes outside the theme file. Never raw `text-gray-500` from Tailwind defaults.
- **Type scale** — `text-2xl`, `text-base`, `text-xs` per the project's scale. No arbitrary `text-[15px]`.
- **Radius** — `rounded`, `rounded-md`, `rounded-full`. No `border-radius: 7px`.
- **Shadow** — project's named shadows, not raw `shadow-[0_2px_8px_rgba(0,0,0,0.1)]`.
- **Font** — `font-sans`, `font-heading`, `font-mono`. Three roles, no fourth font.

If the reference uses tokens and a peer uses raw values, that's drift even if the visual result is identical — because the peer won't pick up theme changes.

## 5. Microcopy shape

- Empty-state phrasing tense ("No notes yet" vs "There are no notes" — pick one).
- Button verb tense ("Save" vs "Saving..." vs "Save changes" — pick one).
- Error messages start with the cause, not "Oops!".
- Sentence case vs Title Case for buttons / labels — pick one and apply across peers.
- Punctuation in labels (period at end of help text? colon after field labels?) — match the reference.

This dimension is small but the highest-signal drift the user will notice.

## Choosing dimensions for a session

Default: all five, biased toward whichever is most visibly broken in the peer list.

If the user's notes name a specific dimension ("only the header"), restrict to that one and ignore the others — even if you spot drift on another axis. Surface the unrelated drift in the report ("seen but not fixed: peers also vary on empty-state copy — re-run with `— microcopy` to address") and stop.

## Cross-axis examples (for the example/ files to reference)

- **Table consistency** spans Layout + Composition + Tokens + Microcopy (column widths, DataTable usage, text tokens for muted captions, "No data" wording).
- **Page-header alignment** spans Layout + Composition + Tokens (h-14 row height, `<PageHeader>` usage, font tokens).
- **Typography floor** is purely Tokens.
