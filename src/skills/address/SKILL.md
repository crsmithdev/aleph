---
name: address
description: >
  Reads visual annotations left via the vibe-annotations tool for a specific page,
  summarizes what needs to change, implements all the fixes, then clears the annotations.
  Use this skill whenever the user mentions annotations, visual feedback, vibe notes,
  marked changes, or asks to "work on the annotations", "fix my annotations",
  "implement the annotations for X page", "apply my feedback", or invokes `/address`.
  Also triggers when the user names a page and implies there are pending visual notes
  on it (e.g. "check what I marked on the learning page").
verb: fix
domain: design
modes: [fix]
---

# Polish

Implements visual feedback from vibe-annotations and clears the annotations once done.

## When to use

- User has left annotations via vibe-annotations and wants them implemented.
- User says `/address`, "fix my annotations", "implement the annotations for X", "what did I mark on Y".
- User references a page by name or URL and implies there's pending visual feedback.

## When NOT to use

- No annotations exist — tell the user and stop.
- User wants a design audit from scratch — use `design-review --mode audit`.
- User wants to understand the design system — read `src/rules/design/construct/RULES.md` and the assets under `src/rules/design/construct/{tokens,kits,previews}/`.

## Inputs

- **Page/URL** (optional): User may provide a URL or page name. If absent, check all pending annotations and ask which page to act on.
- **Scope** (default): `http://localhost:3001/*` — the Construct dev server.

## Page name → URL mapping (Construct)

| User says | URL |
|-----------|-----|
| learning, learning page | `/observability/learning` |
| gates, gates section | `/observability/learning` |
| sessions, sessions page | `/observability/sessions` |
| overview, observability overview | `/observability` |
| goals | `/goals` |
| todos | `/todos` |
| habits | `/habits` |
| research | `/research` |
| skills | `/skills` |
| tools | `/tools` |
| hooks | `/hooks` |
| settings | `/settings` |

If the page name doesn't map cleanly, check all annotations unfiltered and present what's there.

## Process

### 1. Discover annotations

If the user gave a URL or page name, filter immediately:

```
mcp__vibe-annotations__read_annotations
  url: "http://localhost:3001/<path>"
  status: "pending"
```

If no URL/name was given, call without a URL first to see all pending annotations, then ask the user which page to focus on before proceeding.

### 2. Check for screenshots

For each annotation where `has_screenshot: true`, fetch the screenshot with `mcp__vibe-annotations__get_annotation_screenshot` using the annotation ID. Screenshots give you the exact visual context — use them to understand what the user was looking at when they left the note.

### 3. Summarize and confirm

Present a brief, scannable summary:

```
Found N annotations on /observability/learning:
  • [annotation text or pending_change description] (has screenshot)
  • ...

Implementing all of these. Proceed?
```

If there are zero annotations for the page, say so clearly and stop — don't guess at changes.

### 4. Implement the changes

Work through each annotation. For each one:

**Read the source files** that render the annotated element. The annotation's `url` tells you the page; the description or `pending_changes` tells you what to change.

**Map to design tokens** — never use raw hex or pixel values. The Construct design system uses CSS variables:

| Raw value type | Use instead |
|----------------|-------------|
| Background colors | `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--bg-contrast` |
| Text colors | `--text-primary`, `--text-muted`, `--text-disabled` |
| Borders | `--border-primary`, `--border-secondary` |
| Semantic colors | `--error`, `--warning`, `--success`, `--info` |
| Spacing | Tailwind spacing scale (`p-4`, `gap-2`, etc.) |

When `pending_changes` is present it's structured as `{ property, original, new }` — honor those values but translate to the nearest token rather than using the raw `new` value literally if it's a hex color or raw pixel size.

**Use Edit** on the actual source files (not a preview or mock). The frontend lives in `src/ui/web/src/`.

### 5. Clear annotations

After implementing each annotation's changes, delete it:

```
mcp__vibe-annotations__delete_annotation
  id: <annotation_id>
```

Clear all annotations for the page, including ones you've already addressed. Don't leave stale annotations behind.

### 6. Verify

Use the `code-test` skill pattern: navigate to the page in a headless browser, take a screenshot, confirm the changes look right. Fix anything that doesn't match the intent.

## Design token reference

Read `src/rules/design/construct/RULES.md` (with assets under `src/rules/design/construct/{tokens,kits,previews}/`) if you need more detail on the Construct token system, surface hierarchy, or component patterns before editing.

## Common pitfalls

- **Don't match by color hex** — find the element by its structure (className, role, text content) and change the token used there.
- **Don't assume the annotation element is the top-level page component** — look at the screenshot if available to understand what's actually being annotated.
- **Annotations describing layout changes** (spacing, sizing) often need Tailwind class changes, not CSS variables.
- **If an annotation is ambiguous**, implement your best interpretation and note what you chose in your reply — don't block asking for clarification on every item.
