# Design rules

The rules of a UI change, numbered so that a check and a refit can cite them. They apply the repo's
`design/rules.md`, `design/components/` and the Design page (`#/design`). A tag names the [refit-design](../refit-design/SKILL.md) lens
that finds a break.

Ask these when the diff changes a view, a style rule or UI text.

1. **A rule for each part.** Each new view, rule, value or component has a rule in `design/`, a token or helper that gives the value, and a specimen on `#/design`. A new part adds its component file and its specimen in the same diff. (apply)
2. **One way to draw.** Each component looks like its specimen and like its other uses. The change adds no second way to draw a part that has one. (variants)
3. **Every state.** Each new component or control draws its empty, loading, error, hover, focus, disabled and phone-width state, or the plan says which one it leaves out and why. (states)
4. **Holds under stress.** Each new list, table and text field holds with 200 characters, 500 rows, a `null` and an empty list. (stress)
5. **Design helpers.** Each new view calls the design helper for each component it draws, and sets no property of a design class. (seams)
6. **Each rule has a user.** Each new style rule matches an element, each new token has a use, and each new specimen draws a live component. (dead)
7. **Only what the job needs.** Each new card, border, shadow, icon and label is needed for its job. A label or note is one or two words. (slop)
