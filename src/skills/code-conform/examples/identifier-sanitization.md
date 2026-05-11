---
title: Identifier sanitization helpers
dimension: Duplication of behavior across modules (consolidation)
---

# Identifier-sanitization helpers — single source of truth

The lesson: when two helpers in the same file duplicate a parse step, lift it into one private function. The shape generalizes — peers across the codebase that re-implement the same parse should be routed through the single canonical helper.

## The reference

`src/ui/web/src/utils/format.ts:132-156` already centralizes MCP tool / project name cleanup. The intended canonical surface:

```ts
function titleCase(s: string): string { ... }

export function fmtToolName(name: string): string {
  if (name.startsWith('mcp__')) {
    const parts = name.slice(5).split('__');
    if (parts.length >= 2) {
      const server = titleCase(parts[0]);
      const action = titleCase(parts.slice(1).join('_'));
      return `${server} / ${action}`;
    }
  }
  return titleCase(name);
}

export function parseToolSource(name: string): { server: string; tool: string } {
  if (name.startsWith('mcp__')) {
    const parts = name.slice(5).split('__');
    if (parts.length >= 2) {
      return { server: titleCase(parts[0]), tool: titleCase(parts.slice(1).join('_')) };
    }
  }
  return { server: 'builtin', tool: name };
}
```

## The peers (before)

Both functions in the *same file* run identical parsing logic — `name.slice(5).split('__')`, the `parts.length >= 2` guard, and the `titleCase(parts[0])` + `titleCase(parts.slice(1).join('_'))` split. The only difference is what they return at the end (a formatted string vs an object).

Confirm with `grep`:

```
$ grep -n "split('__')" src/ui/web/src/utils/format.ts
138:    const parts = name.slice(5).split('__');
150:    const parts = name.slice(5).split('__');
```

Two hits in the same file = drift between two helpers that should share a parser. (For external duplicates outside this file, run `grep -rn "split('__')" src/` — if hits exist, those sites are also peers and should be consolidated through `fmtToolName` / `parseToolSource`.)

## The diff (proposal)

Extract the shared parse into a private helper, then both public helpers delegate:

```diff
+function parseMcpName(name: string): { server: string; tool: string } | null {
+  if (!name.startsWith('mcp__')) return null;
+  const parts = name.slice(5).split('__');
+  if (parts.length < 2) return null;
+  return { server: titleCase(parts[0]), tool: titleCase(parts.slice(1).join('_')) };
+}
+
 export function fmtToolName(name: string): string {
-  if (name.startsWith('mcp__')) {
-    const parts = name.slice(5).split('__');
-    if (parts.length >= 2) {
-      const server = titleCase(parts[0]);
-      const action = titleCase(parts.slice(1).join('_'));
-      return `${server} / ${action}`;
-    }
-  }
-  return titleCase(name);
+  const parsed = parseMcpName(name);
+  return parsed ? `${parsed.server} / ${parsed.tool}` : titleCase(name);
 }

 export function parseToolSource(name: string): { server: string; tool: string } {
-  if (name.startsWith('mcp__')) {
-    const parts = name.slice(5).split('__');
-    if (parts.length >= 2) {
-      return { server: titleCase(parts[0]), tool: titleCase(parts.slice(1).join('_')) };
-    }
-  }
-  return { server: 'builtin', tool: name };
+  const parsed = parseMcpName(name);
+  return parsed ?? { server: 'builtin', tool: name };
 }
```

## After + verification

Run `bun run --cwd src/ui build` — type-checks the change. Run `bun test.ts` — confirms no behavioral regression in any consumer of `fmtToolName` or `parseToolSource`. Both public surfaces are unchanged; only the duplication is gone.

Optional ast-grep confirmation that the inline shape is now centralized:

```bash
ast-grep --pattern "$X.slice(5).split('__')" src/ui/web/src/utils/format.ts
# Expect: exactly one match, inside parseMcpName.
```

## Why this is instructive

This is the smallest possible consolidation — two helpers in one file. Apply the same shape at larger scope: when the codebase has the *same* `slice(5).split('__')` (or any other identifier-cleanup snippet) inline in a sidebar component, an event-log row formatter, and a tooltip, route them all through `fmtToolName` / `parseToolSource` and delete the inline copies. The skill's job is to keep that consolidation tight as the codebase grows.
