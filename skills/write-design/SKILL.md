---
name: write-design
description: >
  UI change: build each part from the design reference (`design/rules.md`, `design/components/`),
  with its tokens, helpers and Design page specimen. Use when you add or
  change a view, a style rule, a component or UI text. NOT for: auditing a
  UI (use refit-design); writing the design doc (use design-language).
---

# Write design

`design/rules.md` and `design/components/` are the reference. Each part a change draws comes from its rule, its token or helper, and its
specimen on the Design page (`#/design`, `ui/views/design.js`).

Before the first edit, call the Read tool on [write/PROCESS.md](../write/PROCESS.md) and on [RULES.md](./RULES.md).
Follow [write-code](../write-code/SKILL.md) for the code. Follow PROCESS.md's steps, with these as its step 3:

1. **Read the reference.** Run `design rules --for <component>` for each component the change draws, and `design tokens`. Done when each part of the change names its rule ids, its helper and its `spec(id)`.
2. **Build from the helpers.** Draw each part with the helper and the tokens its component file names. A part with no
   section is new: add its file to `design/components/` and its specimen to `ui/views/design.js` in the same diff.
   Done when each part has a component file and a specimen.
3. **Count the literals.** Run the inventory in place on the changed view and style files:

   ```
   bun skills/design-language/scripts/inventory.ts <changed files>
   ```

   Done when the diff adds no row of kind `literal` or `helper-bypass`, outside a helper's own body.
4. **Draw it.** Follow [verify-ui](../verify-ui/SKILL.md): screenshot each changed route and its specimens on
   `#/design`, in light and dark, at 1440 px and 390 px. Done when each part matches its specimen in each
   screenshot, each state of RULES.md 3 shows, and the console has no errors.
