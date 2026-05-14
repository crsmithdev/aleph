# Shell stack — rollout plan

Companion to `shell-stack-install.md` (the *what*). This file is the *when*
and *in what order*.

## The chezmoi-first question

**Answer: fix chezmoi first, before any tool install.**

Reason: switching chezmoi from symlink mode to copy mode is **meta only** —
it changes how files are managed, not the file contents. Five minutes of
work, no risk to the current shell. Doing it first means every new config
the install steps drop into `~/.config/` lands as a clean normal file, ready
to `chezmoi add` without symlink confusion.

If you fix chezmoi *after* installing:
- Some new configs may have hit chezmoi-tracked paths and been symlinked
  into the source repo behind your back — depends on whether the path was
  already tracked.
- Mixed state: some tracked-via-symlink, some untracked-because-new. You
  spend an hour disentangling.
- The wezterm/nushell configs would need to be re-added under copy mode
  semantics anyway.

So: meta change first, install second, add third.

## Phases

### Phase 0 — Safety (2 min)

Don't skip. If anything goes wrong mid-rollout you want a clean revert.

- `chezmoi cd` → `git status`, ensure source repo is clean. If dirty,
  commit or stash before proceeding.
- Note current Windows Terminal default profile (Settings → Startup) — so
  you can revert if needed.
- Keep one current shell open during the whole rollout, don't close it
  until Phase 4 verifies.

### Phase 1 — chezmoi symlink → copy (5 min)

Don't touch any tool yet.

1. Edit `~/.config/chezmoi/chezmoi.toml`, remove `symlink = true` (or the
   equivalent toggle in your config).
2. `chezmoi managed` — verify the list looks right; this is your
   inventory of what's about to be rewritten.
3. `chezmoi apply` — chezmoi rewrites targets as regular files instead of
   symlinks. Safe; idempotent.
4. Spot-check:
   ```bash
   ls -la ~/.bashrc ~/.gitconfig ~/.config/git/config
   ```
   No `l` in the perms column — they're regular files now.
5. If any file was previously added as a symlink (e.g. `chezmoi add foo`
   captured a symlink), run `chezmoi add --follow foo` to refresh it as
   the target.
6. `chezmoi cd` → `git status` → commit the chezmoi config change.

**Gate**: open a fresh shell, confirm `.bashrc` is sourced and works
exactly like before. If yes, proceed.

### Phase 2 — Install tools (30 min, mostly parallel)

WSL side — run from current bash (still working, untouched):

1. apt: `sudo apt update && sudo apt install -y ripgrep jq direnv btop eza`
2. zoxide: upstream installer (see `shell-stack-install.md`)
3. atuin: upstream installer
4. starship: upstream installer
5. gh: official deb repo + install
6. yq: download binary from GitHub releases
7. nushell: `cargo install nu` (install rustup if needed)

Windows side — separate from WSL flow:

8. `winget install wez.wezterm`
9. `winget install starship`

**Gate**: run each tool's `--version` from current bash. Every command
should respond. If any fail, fix that one before continuing — don't
write configs that source missing binaries.

### Phase 3 — Write configs (15 min)

Author files in their final locations:

1. `~/.config/nushell/env.nu` — tool init generators
2. `~/.config/nushell/config.nu` — sources + aliases + reminder hook
3. `~/.config/starship.toml`
4. `~/.config/wezterm/wezterm.lua`

(Content from `shell-stack-install.md`.)

**Gate**: test before switching the entry point:
- `nu` from current bash — does nushell start cleanly? Does the starship
  prompt render? Does `cd con<TAB>` resolve to construct via zoxide?
  Does Ctrl-R open atuin's history?
- `exit` to return to bash. Still alive.
- If anything blows up, fix the config — your bash is still untouched.

### Phase 4 — Switch entry points (5 min)

This is the riskiest step. Don't close the safety shell yet.

1. Set Windows Terminal default profile to "WezTerm" or, if keeping WT,
   update the WSL profile's command to launch nu directly per
   `shell-stack-install.md`.
2. Open a new WezTerm/WT window. nushell prompt + starship should appear.
3. Try `leader-c` (Ctrl-A c) — new tab with `claude` running in pwd.
4. If anything is broken, the safety shell from Phase 0 is still bash —
   you can fix and retry without losing the session.

**Gate**:
- New shells open into nu without typing anything.
- `echo $env.SHELL` shows `/bin/bash` (Claude Code still gets bash).
- `bash -c 'echo $SHELL'` shows `/bin/bash` (subprocesses get bash).
- `ps -p $nu.pid` shows nu (your interactive process is nu).
- `claude --version` works from inside nu.

### Phase 5 — Add new configs to chezmoi (5 min)

Now chezmoi knows about the new stack:

```bash
chezmoi add ~/.config/nushell/
chezmoi add ~/.config/starship.toml
chezmoi add ~/.config/wezterm/
```

Optionally add Windows-side starship config too (chezmoi has Windows
support):
```
chezmoi add ~/AppData/Roaming/starship.toml   # if you have one
```

Then `chezmoi cd` → commit → push.

**Gate**: `chezmoi managed | grep nushell` shows the new files;
`chezmoi diff` shows nothing pending.

### Phase 6 — Cleanup (10 min)

- Old `.bashrc` tweaks: anything you'd previously added for interactive
  use that nu doesn't read can be removed (`PROMPT_COMMAND` for last-dir,
  bash aliases, etc.) — port to `config.nu` if still wanted.
- Keep `.bashrc` minimal but functional — bash is still the subprocess
  shell, and it still runs for `bash -c "..."`, `bash -li`, SSH, etc.
- If switching from tmux entirely: leave `.tmux.conf` alone for now;
  decide after a week.

### Phase 7 — Live with it (1 week)

Don't optimize prematurely. Note in a scratchpad:
- Aliases you reach for that don't exist yet.
- Keybinds that feel wrong.
- The `grep` reminder hook — annoying or useful?
- Whether you miss any tmux features (most likely: session-restore).

After a week, do one pass to adjust based on the notes. That pass is when
the config stabilizes.

## Rollback plan

If anything blows up at any phase:

- **Phase 1 fail**: `chezmoi cd` → `git checkout .` → re-add the
  `symlink = true` line. Reverts in 30 seconds.
- **Phase 2 fail**: skip the failing tool; finish the rest. None of the
  tools depend on each other for install.
- **Phase 3 fail**: configs are just files in `~/.config/`; delete and
  rewrite. Bash is unaffected.
- **Phase 4 fail (most likely failure point)**: revert the Windows
  Terminal profile to its previous command. Configs stay; you can retry
  Phase 3 → 4.
- **Catastrophic**: `wsl --shutdown`, restart from Windows Terminal with
  a bash entry point. Chezmoi source repo is on Git; nothing is lost.

## Time budget

Realistic total: **75–90 minutes** including verification and one
breakage you have to debug. Don't try to do this in 30 minutes.

## Order summary

1. Snapshot / safety (2 min)
2. chezmoi: symlink → copy (5 min) ← the prerequisite
3. Install tools (30 min)
4. Write configs (15 min)
5. Switch entry points (5 min)
6. Add new configs to chezmoi (5 min)
7. Cleanup (10 min)
8. Live with it for a week, then refine
