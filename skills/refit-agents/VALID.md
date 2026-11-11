# Valid lens

Does each agent file parse and meet its spec? This is the one lens a tool decides. agnix holds the rules;
this file holds how to read them and the limits agnix may not know yet.

## Signals

- **agnix.** `agnix -t claude-code --format json .` from the repo root. Rule prefixes: `AS-` (Agent Skills),
  `CC-SK-`, `CC-AG-`, `CC-HK-`, `CC-MEM-`, `CC-PL-` (Claude Code skills, subagents, hooks, memory, plugins),
  `MCP-`, `REF-` (imports and links), `XML-`, `PE-` (prompt engineering), `XP-` (cross-tool). `agnix explain <ID>`
  gives a rule's source and level (MUST or SHOULD). Add `-t cursor`, `codex` or `kiro` when the repo serves them.
- **Plugin manifest.** `claude plugin validate <dir>` when the repo is a plugin or a marketplace.
- **Limits** (Anthropic skill best practices and the Claude Code memory and skills docs):
  - skill `name`: at most 64 characters, `[a-z0-9-]`, no `anthropic` or `claude`, equal to its directory name;
  - skill `description`: not empty, at most 1,024 characters, third person, says what and when; the listing
    cuts `description` + `when_to_use` at 1,536 characters;
  - `SKILL.md` body under 500 lines; reference files one link deep from it; a reference file over 100 lines opens
    with a table of contents; forward slashes in paths;
  - `@` imports at most 4 hops deep; `MEMORY.md` loads only its first 200 lines or 25 KB;
  - Codex stops reading `AGENTS.md` files at 32 KiB in total (`project_doc_max_bytes`).

## Proof

An agnix error or a failed `claude plugin validate` is a finding once you open the line and the rule applies.
Known false positives, dropped with the reason:

- **XML-001 on a placeholder.** A bare `<trigger>` in prose reads as an unclosed tag. agnix skips code spans and
  fences. The fix is the code span, not the closing tag that `--fix` writes.
- **CC-HK-003 "no matcher".** A tool hook with no matcher matches every tool; it is a finding only when the hook
  means one tool.
- **XP-003 hard-coded path.** A path to the user's own data (a path under the home folder's tool directory) in a file that only
  that machine loads is not a portability problem.

Warnings and infos are candidates: rate them 1-5 like any judgment.

## Fix

Fix by hand. agnix's `--fix` only on one file, after `--dry-run --show-fixes` on that file.

## Hold

`agnix -t claude-code` (with `--strict` once the repo is clean) in `.githooks/pre-commit`, which runs it on the
staged agent files and refuses the commit when agnix fails or is missing. A `.agnix.toml`
records the rules the repo turns off, each with its reason.

## Check

Does the new file pass agnix and, for a plugin, `claude plugin validate`? Run them; record the counts.
