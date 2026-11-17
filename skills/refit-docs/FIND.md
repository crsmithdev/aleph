# Find lens

Can a reader reach each doc and find the answer? A doc nobody reaches costs upkeep and helps no one.
`write-docs`'s `nav-` and `format-` rules hold the page-level rules.

## Signals

- **`refs.ts` orphans:** each doc that no markdown file links to.
- **`refs.ts` broken links and anchors.** A broken link is **true** when the target moved. It is **find** when the
  reader has no path.
- **Headings** that do not say what the section answers, or repeat on a page (markdownlint MD024).
- **Link text** that means nothing out of context ("here", "this page").
- **Accessibility.** An image with no alt text (MD045), an image of code or terminal output, skipped heading
  levels (MD001), more than one h1 (MD025), "above" or "below" as the only pointer.
- **Entry points.** The README links to the docs index or to each top-level doc.

## Proof

The orphan has no inbound link; the heading or link text, quoted, does not name its target; the tool rule fired
and the line breaks it.

## Fix

Link the orphan from the page whose reader needs it, or cut it under **rot**. Rewrite the heading or link text to
name its target. Add the alt text.

## Guard

`refs.ts` orphans empty in a test; `markdownlint-cli2` in CI.

