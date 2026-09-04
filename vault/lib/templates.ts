/** Files `vault init` lays down. VAULT.md is the contract; Chris owns it after init. */

export const VAULT_MD = `# VAULT.md — the contract

This file is **human-owned**. The agent never edits it; wanting a change it
writes a note in \`wiki/decisions/\` and asks. The git-guard hook denies edits.

This vault is **AI-first**: most reads and writes are the agent's, and Chris
reads and corrects it in Obsidian. The layout optimises for deterministic
write paths: if the agent has to infer where something belongs, the
structure is wrong, not the agent.

## Prohibitions (absolute)

1. Never edit this file.
2. Never append to a note that has a section for the claim; rewrite the
   section. Sprawl is the failure mode, not staleness.
3. Never delete a note. Supersede it: the write moves the old note to
   \`archive/\` with an \`archived_reason\`.
4. Never write to \`daily/\` outside today's file, and never rewrite a daily note.
5. Never put a secret, token or key in the vault. Redact and note the redaction.
6. Never restructure folders, rename namespaces or change the frontmatter
   schema without explicit approval.

## Read order (always)

1. \`Home.md\`, the map. Injected at session start.
2. \`MEMORY.md\`, standing context. Injected at session start.
3. The note Home points at.

Only then search (\`vault recall\`). A search-first agent rediscovers the same
facts every session and never notices the vault drifting.

## When to write

When you learn how something actually behaves, decide something, or get
corrected, write the page before the turn ends. Deliberate writes only: no
hook extracts facts. \`vault compile\` is the safety net, run on demand.

## Layout

| Path | Holds | Write rule |
|---|---|---|
| \`Home.md\` | map of content, one line per note by kind, health line last | agent, ≤150 lines |
| \`MEMORY.md\` | standing context about Chris and the environment | agent, ≤150 lines, rewrite sections |
| \`wiki/decisions/\` | what was decided and why | one note per decision |
| \`wiki/concepts/\` | how something works | |
| \`wiki/entities/\` | a tool, service, repo, person | |
| \`wiki/projects/\` | status and next steps of a project | |
| \`wiki/gotchas/\` | how something actually behaves, against expectation | |
| \`daily/\` | \`YYYY-MM-DD.md\`, append-only log of writes and notes | today only |
| \`archive/\` | superseded notes; never deleted | by supersession only |
| \`attachments/\` | images and files pasted from Obsidian | |

## Notes

Filename is the title, Title Case, unique across titles and aliases. Links
are bare \`[[Title]]\`. Frontmatter:

\`\`\`yaml
aliases: []                 # optional
kind: decision|concept|entity|project|gotcha
scope: <repo name>|global
confidence: measured|reported|inferred
updated: YYYY-MM-DD
supersedes: []              # titles this note replaces
sources: []                 # trace:<id>, a path, chris, a URL
tags: []                    # optional
\`\`\`

Body: a first paragraph \`**Claim.** … as of YYYY-MM-DD.\`, then
\`## Details\`, \`## Evidence\`, \`## Related\`. A confident sentence with no
date is how a vault rots.

\`vault write\` refuses a note that breaks any of: schema, duplicate title or
alias, dangling link, folder/kind mismatch, the line budgets, the body
template. It warns on orphans, stale measured claims and same-scope overlap.
`;

export const HOME_MD = `# Home

## Decisions

## Concepts

## Entities

## Projects

## Gotchas

Health: 0 notes, 0 dangling, 0 orphans, lint never
`;

export const MEMORY_MD = `# Memory

Standing context, ≤150 lines. If this needs to grow, something in it belongs
in \`wiki/\`.

## Profile

## Environment

## Standing preferences
`;

export const GITIGNORE = `.obsidian/workspace*.json
.obsidian/plugins/*/main.js
.obsidian/plugins/*/styles.css
.trash/
`;

export const OBSIDIAN: Record<string, unknown> = {
  "app.json": { attachmentFolderPath: "attachments", newFileLocation: "root", useMarkdownLinks: false, showUnsupportedFiles: false },
  "core-plugins.json": ["file-explorer", "global-search", "switcher", "graph", "backlink", "outgoing-link", "tag-pane", "properties", "page-preview", "daily-notes", "templates", "note-composer", "command-palette", "editor-status", "bookmarks", "outline", "word-count", "file-recovery"],
  "daily-notes.json": { folder: "daily", format: "YYYY-MM-DD" },
  "appearance.json": { baseTheme: "obsidian" },
};
