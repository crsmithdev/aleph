# Dead lens

Does each CSS rule match an element, each token have a use, and each Kit specimen draw a live component? Ask
**is it used?** before **how do I improve this?** A rule that matches nothing still ships, still reads as
design, and still gets copied. This is the [refit-code](../refit-code/DEAD.md) lens applied to the UI.

## Signals

**Code view.** List the candidates in `ui/app.css`, the views and `ui/views/kit.js`:

- a class selector that no view, helper or fixture writes into markup;
- a custom property (`--name`) with a definition and no `var(--name)`;
- a rule that a later rule of the same selector overrides in each property;
- a specimen on `#/kit` that calls a helper no view calls, or draws a component the doc no longer names;
- a media query block whose rules are all in the list above.

Grep the bare class and token name over `ui/` and `docs/design.md`.

**Drawn view.** Open `#/kit` in light and dark. A specimen that draws nothing, or that draws a component no page
shows, is a candidate.

## Proof

A candidate is dead when each of these is ruled out:

| Escape hatch | What to check |
|---|---|
| Built name | A class made by string join in a helper, such as `` `tone-${state}` `` |
| State class | A class that script adds on an event (`.open`, `.collapsed`, a `data-` attribute) |
| Chart and kit reads | A token that `readTokens()` or the `--kit-*` bridge reads by name |
| Fixture data | A class that only a state of the data reaches, such as an error row |
| Docs | A class or token that a section of `docs/design.md` names as part of the language |

A rule that matches no element in the markup, the helpers and the states of the data is dead. A class that an
element carries but no rule styles is a seams candidate if the element is hand-built, else a leftover.

## Fix

Delete the rule, the token or the specimen, one commit per kind, rules first. A section of `docs/design.md` that
names a deleted part is reported as a proposal: the doc changes only through design-language.

## Hold

Unchecked: a script that lists each CSS rule with no match in the markup and each token with no use. Its finding
has not come back from a retro, and a hold moves up to tool only when its finding comes back.

## Check

Does each new rule match an element, each new token have a use, and each new specimen draw a live component?
Does the change leave a rule or a token with no user?
