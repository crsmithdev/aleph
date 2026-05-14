# WSL shell environment — modernization

Scoped to: WSL2 Ubuntu, primarily AI-driven dev (Claude Code in terminal),
Windows Terminal as the host emulator, chezmoi for dotfiles, on-the-keyboard
hacking is a smaller share of time than steering agents.

## Per-concern recommendations

### chezmoi: symlink → copy mode

**Recommendation: switch to the default copy mode.**

- Symlink mode is the unusual choice — chezmoi's docs frame it as "if you
  *really* want symlinks." Copy mode unlocks templates, encrypted files,
  executable bits, and private files; symlink mode foregoes most of them.
  ([chezmoi design FAQ](https://www.chezmoi.io/user-guide/frequently-asked-questions/design/))
- Migration steps:
  1. Edit `~/.config/chezmoi/chezmoi.toml` — remove the `symlink = true`
     setting (or whatever's enabling it).
  2. `chezmoi managed` to confirm the file list looks right.
  3. `chezmoi apply` — chezmoi rewrites targets as real files instead of
     symlinks.
  4. If anything was previously added as a symlink (`chezmoi add foo`), run
     `chezmoi add --follow foo` to refresh it as the *target* of the link
     rather than the link itself.
  5. Spot-check `ls -la ~/.bashrc` etc. — should be regular files, not `l...`.
- One gotcha: if you've been editing the symlinks in-place under `~/`,
  those edits are already in the source repo (because symlinks). After copy
  mode, the edit/apply cycle becomes: edit in source via `chezmoi edit foo`
  → `chezmoi apply`. Or `chezmoi cd` to the source repo for direct edits.

### Open in last directory on every new session

Several layered options; pick the layer that matches how you actually open
shells:

**Layer 1 — bash level (simplest, always works):**
```bash
# in ~/.bashrc
if [ -f ~/.last_dir ] && [ -d "$(cat ~/.last_dir)" ]; then
  cd "$(cat ~/.last_dir)"
fi
PROMPT_COMMAND="pwd > ~/.last_dir; ${PROMPT_COMMAND}"
```
Every prompt writes pwd to a file; every new shell reads it on startup.
No deps, ~3 lines.

**Layer 2 — Windows Terminal profile:** set `"startingDirectory":
"//wsl.localhost/Ubuntu/home/crsmi/construct"` for the WSL profile. Static,
but combined with Layer 1 it gives you a sane default if `~/.last_dir`
doesn't exist yet.

**Layer 3 — tmux session persistence:** `tmux-resurrect` +
`tmux-continuum` save/restore tmux state across reboots. Combined with
"always attach to or create `main`" launch, you literally never leave the
working dir.

Stack all three for full belt-and-suspenders.

### Shared prompt between WSL and Windows PowerShell

**Recommendation: Starship.**

- Works in bash, zsh, fish, PowerShell, nushell, cmd — one `starship.toml`
  config drives all of them. Cross-shell prompt parity is its single
  reason to exist.
- Install: `winget install starship` on Windows, `curl -sS
  https://starship.rs/install.sh | sh` in WSL.
- Add to `~/.bashrc`: `eval "$(starship init bash)"`. To PowerShell
  `$PROFILE`: `Invoke-Expression (&starship init powershell)`.
- Store `starship.toml` in chezmoi at `~/.config/starship.toml`; symlink
  isn't needed (copy mode handles it).
- For "this is WSL not Windows" disambiguation, the `os` module renders a
  Tux glyph in WSL, a Windows glyph in PowerShell — same config, different
  visual cue.
  ([Starship on Windows Terminal guide](https://www.tskamath.com/starship-on-windows-terminal-the-ultimate-setup-customization-handbook/))

### Nushell — interactive surface only, never `$SHELL`

**Recommendation: launch nu directly as your interactive shell from
Windows Terminal and tmux, but keep `$SHELL=/bin/bash` so Claude Code
and every other subprocess sees bash.**

Why `$SHELL` stays bash is load-bearing: Claude Code reads `$SHELL` and
tries to use nu if it's set there, which triggers the `< /dev/null`
injection bug.
([claude-code#4535](https://github.com/anthropics/claude-code/issues/4535),
[Nushell default-shell warning](https://www.nushell.sh/book/default_shell.html))

The 3-line setup:

1. **Don't `chsh`.** Leave the login shell as `/bin/bash`. Verify with
   `echo $SHELL`.
2. **Windows Terminal WSL profile** — change the command to launch nu
   directly:
   ```
   wsl.exe -d Ubuntu -- /usr/local/bin/nu
   ```
   Or, combined with the tmux always-attach pattern:
   ```
   wsl.exe -d Ubuntu -- bash -lc "tmux new-session -A -s main"
   ```
   (bash loads the login profile, tmux attaches, and tmux's
   `default-shell` brings up nu — see step 3.)
3. **`~/.tmux.conf`** — make tmux windows open nu:
   ```
   set-option -g default-shell /usr/local/bin/nu
   ```
   tmux-local; doesn't change `$SHELL` for anything outside tmux.

What this buys:

- You never type `nu` — WT launches it, tmux windows open it.
- Claude Code always sees bash because `$SHELL=/bin/bash` and it shells
  out via `bash`, not your interactive shell.
- `bash` typed at the nu prompt opens a real interactive bash subshell.
  `exit` returns to nu. Clean escape hatch.
- Scripts and tools reading `$SHELL` (sudo `-s`, installers, etc.) all
  get bash. SSH into the box still lands in bash.

Verify after switching:
```
echo $SHELL          # /bin/bash
ps -p $$             # nu
bash -c 'echo $SHELL' # /bin/bash
```

Caveat: `~/.bashrc` won't run inside an nu interactive session — it's
bash-only. Migrate aliases / env / PATH tweaks you actually use into
nu's `env.nu` / `config.nu`. Anything that has to stay bash (because
a `bash -c` consumer depends on it) stays in `.bashrc` and fires when
bash is invoked.

### tmux: easier launch / attach + shortcuts

**Recommendation: stay on tmux, fix the launch friction.**

- **Always-attach launch**: change the Windows Terminal WSL profile's
  command to:
  ```
  wsl.exe -d Ubuntu -- bash -lc "tmux new-session -A -s main"
  ```
  `-A` attaches if `main` exists, creates it if not. One profile, one
  session you always return to.
- **A second profile for "fresh shell, no tmux"** for when you actually
  want a clean process tree.
- **Persistent state**: install `tmux-resurrect` + `tmux-continuum`. Saved
  panes/windows survive reboot.
- **Declarative session layouts**: `tmuxp` (Python) or `tmuxinator` (Ruby)
  let you write `construct.yaml` describing "5 windows: 0=editor, 1=dev
  server, 2=tests, 3=claude, 4=git." Then `tmuxp load construct` reproduces
  it instantly. Better than memorizing tmux commands.
- **Shortcut keys**: in Windows Terminal `settings.json`, bind chords like
  `ctrl+shift+1..9` to switch tmux windows by sending the key sequence:
  ```json
  { "command": { "action": "sendInput", "input": "1" },
    "keys": "ctrl+shift+1" }
  ```
  (`` = `Ctrl-B` tmux prefix, `1` = `1`.)
- **Alternative if tmux ergonomics keep biting**: Zellij (Rust, more
  discoverable defaults, WebAssembly plugin system). Drop-in tmux
  alternative — same multiplexer concept, friendlier surface.
  ([Zellij vs tmux 2026](https://petronellatech.com/blog/zellij-terminal-multiplexer-guide-2026))

### Bigger move worth considering: WezTerm instead of Windows Terminal

**Recommendation: optional — try if Windows Terminal + tmux keeps annoying
you.**

- WezTerm is a GPU-accelerated terminal *and* multiplexer in one binary —
  panes, tabs, workspaces, session persistence, all native, no tmux
  needed.
- Single Lua config (`wezterm.lua`) drives both Windows-host and WSL
  sessions.
- Built-in mux server auto-attaches on launch — closest single-tool
  replacement for "Windows Terminal + tmux + tmux-continuum."
- Switching cost: real but bounded — keybindings to relearn,
  Lua config to author. Worth it if you want one tool instead of three.
  ([XDA: Windows Terminal vs WezTerm](https://www.xda-developers.com/windows-terminal-versus-wezterm-differences/))

## The "what I don't know" stack — modern CLI tools

These are the high-leverage installs for an AI-driven WSL workflow. Most
are Rust-rewrites of crufty BSD tools; all are `apt`/`cargo`/`brew`-installable
and 2026-mainstream. Grouped by what they save:

| Tool | Replaces | Why it matters for AI dev |
|---|---|---|
| **`zoxide`** | `cd` | `z construct` from anywhere — learns frequency. Replaces autojump/z. |
| **`atuin`** | bash history | SQLite-backed history with fuzzy search, per-dir filter, multi-machine sync. **High value: agents reading your history pattern.** |
| **`starship`** | PS1 prompt | Cross-shell prompt; already covered above. |
| **`eza`** (was `exa`) | `ls` | Git status in `ls`, icons, tree mode. |
| **`bat`** | `cat` | Syntax highlighting, paging, git markers. |
| **`ripgrep`** (`rg`) | `grep` | Order-of-magnitude faster; respects `.gitignore`. |
| **`fd`** | `find` | Saner syntax; respects `.gitignore`. |
| **`delta`** | git diff pager | Inline word-diff, syntax highlighting; great for code-review terminals. |
| **`lazygit`** | `git` TUI | Visual staging; useful when a session has weird unstaged state. |
| **`gh`** | — | GitHub CLI. PR ops, issue listing, `gh pr checkout`. |
| **`jq` / `yq`** | — | JSON/YAML processing; constant in MCP and config debugging. |
| **`fzf`** | — | Fuzzy finder; binds `Ctrl-R` to history search, `Ctrl-T` to file picker. |
| **`mise`** (was `rtx`) | `nvm` / `pyenv` / `rbenv` | Single tool for node/python/ruby/go versions; per-project via `.mise.toml`. |
| **`direnv`** | manual `.env` loading | Per-directory env vars. Drop API keys / model selectors in `.envrc`; auto-loaded on `cd`. |
| **`btop`** | `top` / `htop` | Better resource view; useful when WSL feels slow. |
| **`tldr`** | `man` | Concise examples instead of full man pages. Surprisingly often the right tool. |
| **`ncdu`** | `du` | Interactive disk usage; finds the rogue `node_modules`. |

Notifications for long-running agents to your phone:
- **`ntfy.sh`** — push notifications via curl. `curl -d "PR open" ntfy.sh/<your-topic>`. Free, self-hostable.
- Wire to "agent done" / "needs you" signals from Construct.

## WSL2 system-level tweaks

- **Mirrored networking mode** — set `networkingMode=mirrored` in
  `~/.wslconfig` (Windows-side). Wins:
  - Windows ↔ WSL bidirectional `localhost` (no more IP queries to hit
    a WSL dev server from a Windows browser).
  - IPv6 support, LAN access to WSL services, VPN friendliness.
  - One config line; reversible by removing it.
  - Caveat: Docker Desktop's proxy can conflict — not relevant if you're
    not running Docker Desktop.
    ([Microsoft docs](https://learn.microsoft.com/en-us/windows/wsl/networking),
     [hy2k writeup](https://hy2k.dev/en/blog/2025/10-31-wsl2-mirrored-networking-dev-server/))
- **Keep code in WSL filesystem**, never `/mnt/c/...`. Filesystem perf is
  orders of magnitude worse on `/mnt/c`. You already do this; mentioning
  for completeness.
- **systemd** is on by default in modern WSL2 — services like
  `construct-ui.service` are first-class.
- **`/etc/wsl.conf`** for boot/mount tweaks — `[boot] systemd=true`,
  `[interop] appendWindowsPath=false` (clean PATH).

## Adopt order (cheapest wins first)

1. **chezmoi → copy mode.** ~10 min. Unblocks the rest.
2. **`~/.last_dir` PROMPT_COMMAND trick** in `.bashrc`. ~2 min.
3. **Starship** in WSL + PowerShell, config in chezmoi. ~30 min.
4. **Modern CLI stack** — `zoxide`, `atuin`, `bat`, `eza`, `ripgrep`, `fd`,
   `fzf`, `gh`, `delta`, `jq`, `mise`, `direnv`. ~1 hour to install + alias.
5. **`fzf` + `atuin` bound to Ctrl-R** for history. Immediate daily value.
6. **WSL2 mirrored networking** — one line in `.wslconfig`, requires
   `wsl --shutdown` to apply. ~5 min.
7. **tmux launch profile** in Windows Terminal (always-attach `main`).
   ~10 min.
8. **`tmux-resurrect` + `tmux-continuum`**. ~15 min.
9. **`tmuxp` session config** for Construct's typical 5-pane layout.
   ~30 min.
10. **`ntfy.sh` notifications** wired to Construct's session-complete
    hooks. ~30 min once you have an account.
11. **Nushell as interactive shell** via WT profile + tmux
    `default-shell`, `$SHELL` stays bash. ~30 min including migrating
    a few aliases into `env.nu` / `config.nu`.
12. **WezTerm** — only if tmux ergonomics keep biting. Real switching
    cost; defer.

## What this isn't

- Not a replacement for Claude Code's terminal — this is the shell *under*
  Claude Code, not a different interface.
- Not a portfolio piece on its own. This is invisible-infrastructure
  cleanup that makes everything else cheaper.

## Open questions

1. PowerShell ↔ WSL prompt parity assumes you actually use PowerShell.
   Is PowerShell on the daily-driver list, or only occasional? Determines
   whether Starship-in-PowerShell is worth the 10 min.
2. `atuin` sync — local-only or self-hosted server? (Default cloud sync
   is fine for most; self-host is one Docker command.)
3. Worth packaging this whole stack as a chezmoi template / install
   script for repeatable provisioning on a new machine?
4. Anything in this list that Construct itself should orchestrate (e.g.,
   `construct install-shell-stack`), or is that overreach?
5. tmux vs. Zellij vs. WezTerm-mux — depends on whether the friction is
   in *learning* (Zellij wins) or *configuring* (WezTerm wins).
