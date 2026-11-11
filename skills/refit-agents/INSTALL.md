# Install lens

Is each agent file installed once, at the scope that needs it, from its source? An item at user scope
(`~/.claude/`, user MCP servers, user plugins) loads in every repo on the machine. An item at project scope loads in
one repo. A file built in the home directory, not linked from the repo that owns it, drifts from the repo, and no
commit or review sees the change.

## Signals

From `bun <skill dir>/install.ts <repo>`. Run it with the main checkout as `<repo>`, not a worktree: from a
worktree, a link into the main checkout resolves outside the root and reads `local`.

- **`copies`.** A file under `~/.claude/` with the name of a skill, subagent, command or hook the repo owns, and
  not a link into the repo.
- **`shadow`.** One name at user and project scope. Claude Code runs the personal skill, not the project one, and a
  skill wins over a `.claude/commands/` file of the same name (code.claude.com/docs/en/skills, "Resolve skills that
  share a name"). Plugin skills are namespaced, so they never shadow.
- **`dangling`.** A link whose target is gone.
- **`plugins`.** A plugin installed but disabled in every settings file, enabled at user scope but used by one repo,
  or set to different values in two settings files.

By reading:

- **A global item that one repo uses.** A user-scope skill, subagent, MCP server, hook, or `~/.claude/CLAUDE.md`
  line that names one repo, or a stack that the other repos do not use. Its description costs every repo
  (`description` in `install.ts` gives its characters). It belongs in that repo's `.claude/`.
- **A project item that every repo wants.** The same skill or memory line in the `.claude/` or `CLAUDE.md` of two
  repos. It belongs at user scope or in a plugin.
- **One skill from two sources.** One skill under two plugin names, or a plugin skill and a personal copy of it.
  Both load, because plugin skills are namespaced. Compare the skill listing in a session's start context.
- **Leftovers.** An install manifest, a backup, or the directory of an old tool under `~/.claude/` that names files
  that no longer exist. Claude Code does not load it, but an agent that reads it acts on it. Rate it 2 at most.

**Aleph.** The aleph plugin reaches Claude Code only through the link `~/.claude/skills/aleph` to the repo, and
`~/.claude/CLAUDE.md` is a link to `identity/CLAUDE.md`. Each aleph skill, hook, subagent and command has its file
in the repo. Each of these is a finding: an aleph entry in `install.ts` with `source` other than `repo`, a real
file under `~/.claude/` with an aleph name, and an aleph hook command in `~/.claude/settings.json` whose script is
outside the repo.

## Proof

For a copy, diff the home file against the repo file: if they are the same, the copy waits to drift, and if they
differ, the drift is real. For a shadow, name both paths and the one that runs. For a global item that one repo
uses, name the repo and the search of the other repos that finds no use.

## Fix

Change nothing under `~/.claude/` before the user approves the move, because no commit records it. Move an item
out of the way to a dated directory, such as `~/.claude/skills-removed-<date>/`, so it can come back. For a copy,
merge into the repo any change the home copy has first, then replace the copy with a link into the repo. Delete a
dangling link. Move an item to the scope that needs it. Uninstall a plugin that no settings file enables.

## Hold

Unchecked: `install.ts` in `lint` finds a copy, a shadow or a dangling link, but no hook runs it, because the
state lives outside the repo.

## Check

Does the new item install at the scope that needs it, and does its file live in the repo that owns it?
