# idiomorph redraws, compared with the lit spike

Spike on the Ideas view. No view is in the morph set by default, so no page Chris uses changes.

## What was built

- `ui/vendor/idiomorph.js` is idiomorph 0.8.0 (`dist/idiomorph.esm.js`, 53 KB, unminified), served at `/vendor/idiomorph.js`.
- `ui/router.js` exports `morph`, a set of view paths, empty at start. In `draw()`, a refresh (not the first draw) of a view whose path is in the set goes through `Idiomorph.morph($("view"), html, { morphStyle: "innerHTML" })`. Every other draw sets `innerHTML` as before. The module loads on the first morphed draw, so a page that never morphs never fetches it.
- `ui/browser.test.ts`, Ideas: the lit spike's check (ce45bed2) on the live Ideas view. Mark the first `#view tbody tr`, call `redraw()`, and ask whether the same node is still connected.

## Measured

| `morph` has `/ideas` | Same `tbody tr` node after a redraw |
|---|---|
| no | no, the row is replaced and disconnected |
| yes | yes, the node is identical and connected |

`page.errors` is empty in both runs.

## Compared with lit

- Both keep the row element across a redraw. The test cannot tell them apart.
- Idiomorph took no change to `ideas.js`: the view still returns its HTML string. The lit spike rewrote the view as a template, wrapped each shared helper (`pageHead`, `filterBar`, `badge`, `heads`) in `raw()`, and wrote `dataTable()`'s markup out by hand. Every view would need that to follow lit.
- Lit carries 8.6 KB of vendored code (`lit-html.js`, `unsafe-html.js`, `directive.js`) against 53 KB for idiomorph unminified.
- Lit updates only the values that changed, and its state lives in the template parts. Idiomorph compares old and new DOM, so it does the work of a parse and a walk on each redraw, and it needs the rendered markup to match the live DOM.
- Not measured: how each handles a reordered list. The rows have no ids, so idiomorph pairs them by position and likely rewrites each row's content in place. Lit does the same unless the list uses `repeat` with keys. Neither was run here.
- Not measured: whether `recordState`/`restoreState` and `restoreFolds` are still needed after a morph. They still run, as before; the spike did not remove them.
- Not measured: focus and typed text in a field. Idiomorph is documented to keep them for a matched element,, but the Ideas list has no field to check.
