# Code rules

The rules of a code change, numbered so that a check and a refit can cite them. A repo's own style guide, glossary
or principles win over them. A tag names the [refit-code](../refit-code/SKILL.md) lens that finds a break. Rules
without a tag have no lens.

## Size

1. **Only what the goal asks.** Write the goal's features, options and flags, and error handling for the cases that can happen. Stop there. (slop)
2. **Inline one caller.** Code with one caller stays inline at that caller. A new function, class or file earns its place when a second caller needs it, or when it hides real complexity behind a small interface. (depth)
3. **Short version.** When the diff is long, look for the short version and rewrite. The test: would a senior engineer call it overbuilt? (slop)

## Scope

4. **Match the file.** Match the style of the file you edit, even where you would write it another way.
5. **Leave the rest.** Leave adjacent code, comments and formatting as they are.
6. **Remove what you orphan.** Remove the imports, variables and functions that your change made unused. (dead)
7. **Follow-ups, not fixes.** Record pre-existing dead code, a bug or a slow path that you find as a follow-up (in the `followups` field when your brief defines it), and leave that code as it is.

## Style

Code is minimal and good to look at. When the repo runs a formatter, the formatter has the last word on whitespace.

8. **Short names.** A name grows with its scope: `lo`, `hi` in a loop, `runs`, `edges` in a function, `NAME_MAX` in a module. Not `wordIndex` or `separatorValues`.
9. **The glossary's words.** A thing the repo's glossary names keeps that name, whole, at every scope. Do not shorten it or invent a second word for it.
10. **No noise in a name.** No type (`payloadArr`), no `data`, `info`, `value`, `num` or `List`. A plural is a collection: `runs`, `states`.
11. **Two characters or more.** A one-letter name lives only in a loop, a callback or a one-line lambda.
12. **A legend for abbreviations.** When a module uses short forms in many places, its top comment lists them once, as aleph's `lib/naming.ts:4` does. A glossary term is never abbreviated.
13. **Whole collections, not loops.** A `map`, `filter` or query shows the shape of the operation. A loop is for a step that depends on the step before it.
14. **Short functions.** A function does one job in a few lines. Its doc comment is one line that says what it returns.
15. **Flat.** Return early. No `else` after `return`. No more than two levels of indent inside a function.
16. **Parallel things look parallel.** Code that does the same job for different cases has the same shape, line for line, with related lines in the same order.
17. **No defence the inputs do not need.** Check input once, at the boundary. No `??`, `try` or check for a case the types or callers rule out. (slop)
18. **Tables stay tables.** A table of data can keep its column alignment behind `// prettier-ignore`. Do this only for data, never for logic.
19. **A comment gives what the code cannot:** a field meaning, a reason, a source. It never says what the next line does. Good: `// The dash is the old shown form: a copied \`j-06802\` still reads.` (aleph, `lib/naming.ts:77`). (slop)
20. **Give the shape or the unit** of a value where the code makes it: `const NAME_MAX = 255; // bytes one file name may take` (aleph, `jobs/lib/learning/episode.ts:86`).

## Interfaces

These rules apply only when the goal adds a module or changes a module's interface: its signature, invariants,
error modes or configuration. Otherwise the Scope rules win, and you restructure nothing.

21. **Use the words** of [codebase-design](../codebase-design/SKILL.md): module, interface, depth, seam, adapter.
22. **Deletion test.** Picture the module deleted. If its complexity reappears across its callers, it earns its keep. If the complexity vanishes, it is a pass-through, so inline it. (depth)
23. **Two adapters make a seam.** One adapter is a hypothetical seam. Add a seam only where something varies across it, such as production and test. (seams)
24. **The interface is the test surface.** Test through it. A test that must reach past it says the module has the wrong shape. (depth)
25. **Deepen, do not add.** Prefer to deepen an existing module over adding a shallow one beside it. (depth)

## New things

Ask these of each new item in a diff.

26. **One way.** No path already does this job. Search by the item's name, two synonyms of its verb, its literals and regexes, its inputs and outputs, and the library or API calls it makes. Read each hit that could do the same job. (one-way)
27. **Each thing has a user.** Each new export, file and dependency has a caller, and the change leaves nothing without one. Each new store (table, column, field, file, cache key, env name) has a reader. (dead)
28. **Through the interface.** The change reads no record, file or module past its owner's interface. (seams)
29. **Once per need.** Each new loop, call or cache runs once per what it needs. Name what waits on it. (waste)
30. **Where a reader looks.** A new file goes in the directory where its callers and its kind live. It makes no grab-bag and no second home for a concept that has one. Its name follows the repo's pattern for its kind. (layout)
31. **A case for each guard.** Each new guard, fallback, option and comment has a case that reaches it. Name the case or cut the line. (slop)

## UI

Ask these when the diff changes a view, a style rule or UI text. The rules come from the repo's `docs/design.md`
and the Kit (`#/kit`). A tag names the [refit-design](../refit-design/SKILL.md) lens.

32. **A rule for each part.** Each new view, rule, value or component has a rule in `docs/design.md`, a token or helper that gives the value, and a specimen on `#/kit`. A pattern with no rule is a proposal for the doc. (apply)
33. **One way to draw.** Each component looks like its specimen and like its other uses. The change adds no second way to draw a part that has one. (variants)
34. **Every state.** Each new component or control draws its empty, loading, error, hover, focus, disabled and phone-width state, or the plan says which one it leaves out and why. (states)
35. **Holds under stress.** Each new list, table and text field holds with 200 characters, 500 rows, a `null` and an empty list. (stress)
36. **Kit helpers.** Each new view calls the kit helper for each component it draws, and sets no property of a kit class. (seams)
37. **Each rule has a user.** Each new style rule matches an element, each new token has a use, and each new specimen draws a live component. (dead)
38. **Only what the job needs.** Each new card, border, shadow, icon and label is needed for its job. A label or note is one or two words. (slop)
