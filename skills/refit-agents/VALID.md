# Valid lens

Does each agent file parse and meet its spec? A tool decides this lens. agnix holds the rules. This file holds how to
read them and the limits agnix may not know yet.

## Signals

- **agnix.** `agnix --format json .` from the repo root (`.agnix.toml` sets `tools = ["claude-code"]`). Rule prefixes:
  `AS-` (Agent Skills), `CC-SK-`, `CC-AG-`, `CC-HK-`, `CC-MEM-`, `CC-PL-` (Claude Code skills, subagents, hooks,
  memory, plugins), `MCP-`, `REF-` (imports and links), `XML-`, `PE-` (prompt engineering), `XP-` (cross-tool).
  `agnix explain <ID>` gives a rule's source and level (MUST or SHOULD). Add `cursor`, `codex` or `kiro` to `tools`
  when the repo serves them.
- **Plugin manifest.** `claude plugin validate <dir>` when the repo is a plugin or a marketplace.
- **Limits** (the Agent Skills spec at agentskills.io/specification, Anthropic skill best practices, and the Claude
  Code memory and skills docs):
  - skill `name`: at most 64 characters, `[a-z0-9-]`, no hyphen at the start or the end, no `--`, no `anthropic`
    or `claude`, equal to its directory name;
  - optional fields: `license`, `compatibility` (at most 500 characters), `metadata` (string keys to string
    values), `allowed-tools` (a space-separated string);
  - skill `description`: not empty, at most 1,024 characters, third person, says what and when; the listing
    cuts `description` + `when_to_use` at 1,536 characters;
  - `SKILL.md` body under 500 lines (`AS-012`); reference files one link deep from it (`AS-013`); forward slashes
    in paths. The token budget and the rest of the skill's shape are **structure**;
  - `@` imports at most 4 hops deep; `MEMORY.md` loads only its first 200 lines or 25 KB;
  - Codex stops reading `AGENTS.md` files at 32 KiB in total (`project_doc_max_bytes`).

## Proof

An agnix error or a failed `claude plugin validate` is a finding once you open the line and the rule applies.
Known false positives, dropped with the reason:

- **XML-001 on a placeholder.** A bare `<trigger>` in prose reads as an unclosed tag. agnix skips code spans and
  fences. The fix is the code span, not the closing tag that `--fix` writes.
- **CC-HK-003 "no matcher".** A tool hook with no matcher matches every tool; it is a finding only when the hook
  means one tool.
- **XP-003 hard-coded path.** A path to the user's own data in a file that only that machine loads is not a
  portability problem.

Warnings and infos are candidates: rate them 1-5 like any judgment.

## Fix

Fix by hand. Run agnix `--fix` on one file only, after `--dry-run --show-fixes` on that file.

## Guard

`agnix` (with `--strict` once the repo is clean) in `.githooks/pre-commit`. It runs on the staged agent files and
refuses the commit when agnix fails or is missing. `.agnix.toml` records each rule the repo turns off, with its reason.

## Check

Does the new file pass agnix and, for a plugin, `claude plugin validate`? Run them; record the counts.
