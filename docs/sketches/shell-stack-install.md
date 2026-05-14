# Shell stack — install recipe

WezTerm + nushell (interactive) + bash (`$SHELL`) + Starship + zoxide + atuin
+ eza + ripgrep + gh + jq + yq + direnv + btop.

Companion to `shell-stack-plan.md` — that file says *when* to do each step;
this file says *what* to do.

## Alias philosophy

| Built-in | Replacement | Decision | Why |
|---|---|---|---|
| `cd` | zoxide | **`zoxide init --cmd cd`** | Replaces `cd` transparently — falls through to normal cd for `..`, `-`, exact paths; fuzzy-matches everything else. |
| `ls` | eza | **Alias** | Interactive-only; scripts use absolute paths. |
| `top` / `htop` | btop | **Alias** | Pure interactive. |
| `grep` | ripgrep | **Don't alias** | Scripts depend on POSIX grep. Type `rg` directly; optional reminder hook. |
| `Ctrl-R` history | atuin | **Replace via init** | atuin rebinds Ctrl-R / Up-Arrow as part of `atuin init`. |

## Install — WSL side

```bash
# apt-installable
sudo apt update && sudo apt install -y ripgrep jq direnv btop

# eza
sudo apt install -y eza

# zoxide — binary from GitHub releases (avoids curl|bash)
mkdir -p ~/.local/bin && cd /tmp && rm -rf zoxide-dl && mkdir zoxide-dl && cd zoxide-dl
ZOXIDE_URL=$(curl -s https://api.github.com/repos/ajeetdsouza/zoxide/releases/latest \
  | grep '"browser_download_url"' | grep 'x86_64-unknown-linux-musl.tar.gz"' | head -1 \
  | sed 's/.*"\(https[^"]*\)".*/\1/')
wget -q "$ZOXIDE_URL" -O zoxide.tgz && tar xzf zoxide.tgz \
  && mv zoxide ~/.local/bin/zoxide && chmod +x ~/.local/bin/zoxide

# starship — binary from GitHub releases (latest tag, stable filename)
cd /tmp && rm -rf starship-dl && mkdir starship-dl && cd starship-dl
wget -q "https://github.com/starship/starship/releases/latest/download/starship-x86_64-unknown-linux-gnu.tar.gz" \
  -O starship.tgz && tar xzf starship.tgz \
  && mv starship ~/.local/bin/starship && chmod +x ~/.local/bin/starship

# atuin — binary from GitHub releases (use the API to resolve the versioned tarball)
cd /tmp && rm -rf atuin-dl && mkdir atuin-dl && cd atuin-dl
ATUIN_URL=$(curl -s https://api.github.com/repos/atuinsh/atuin/releases/latest \
  | grep '"browser_download_url"' | grep 'x86_64-unknown-linux-gnu.tar.gz"' | grep -v server | head -1 \
  | sed 's/.*"\(https[^"]*\)".*/\1/')
wget -q "$ATUIN_URL" -O atuin.tgz && tar xzf atuin.tgz \
  && cp "$(find . -name atuin -type f -executable | head -1)" ~/.local/bin/atuin \
  && chmod +x ~/.local/bin/atuin

# gh — official repo
(type -p wget >/dev/null || sudo apt install -y wget) \
&& sudo mkdir -p -m 755 /etc/apt/keyrings \
&& wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
&& sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
&& echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
&& sudo apt update && sudo apt install -y gh

# yq — Mike Farah's Go version (canonical "yq" now)
sudo wget -q https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64 -O /usr/local/bin/yq \
  && sudo chmod +x /usr/local/bin/yq

# direnv — apt's version (2.32) is too old to support nu; use a current binary.
# Note: as of 2.37.1, direnv still has no native nu target either — we use a
# nu-side PWD hook (see config.nu) that calls `direnv export json` instead.
DIRENV_URL=$(curl -s https://api.github.com/repos/direnv/direnv/releases/latest \
  | grep '"browser_download_url"' | grep 'linux.amd64' | head -1 \
  | sed 's/.*"\(https[^"]*\)".*/\1/')
wget -q "$DIRENV_URL" -O ~/.local/bin/direnv && chmod +x ~/.local/bin/direnv

# nushell — prebuilt binary from releases (no cargo build needed)
cd /tmp && rm -rf nu-dl && mkdir nu-dl && cd nu-dl
NU_URL=$(curl -s https://api.github.com/repos/nushell/nushell/releases/latest \
  | grep '"browser_download_url"' | grep 'x86_64-unknown-linux-gnu.tar.gz"' | head -1 \
  | sed 's/.*"\(https[^"]*\)".*/\1/')
wget -q "$NU_URL" -O nu.tgz && tar xzf nu.tgz \
  && cp nu-*/nu* ~/.local/bin/ && chmod +x ~/.local/bin/nu*
```

> **Why binary downloads instead of `curl | bash`**: the harness blocks pipe-
> to-shell for security. Functionally identical to the upstream installer
> scripts — they download the same binaries to the same prefix.

## Install — Windows side

```powershell
winget install wez.wezterm
winget install starship   # PowerShell parity with WSL prompt
```

## `~/.config/nushell/env.nu`

```nushell
# Generated init for external tools — sourced before config.nu.

# PATH bootstrap: WezTerm launches nu directly via `wsl.exe --`, which
# skips .bashrc, so ~/.local/bin isn't on PATH by default. Prepend the
# user/local bin dirs so zoxide / starship / atuin / direnv / yq / nu*
# all resolve. Without this, env.nu errors on the first `zoxide` call.
$env.PATH = ($env.PATH
  | prepend [($env.HOME + '/.local/bin') '/usr/local/bin']
  | uniq)

# Each tool's `init` command emits nushell code; we cache it so startup
# is fast and tools don't have to run on every shell open.

# zoxide — replaces `cd` transparently (falls through for ..,-, exact paths)
zoxide init --cmd cd nushell | save -f ~/.cache/nu/zoxide-init.nu

# starship — generates prompt configuration
starship init nu | save -f ~/.cache/starship/init.nu

# atuin — rebinds Ctrl-R / Up-Arrow for SQLite-backed history search
atuin init nu | save -f ~/.cache/nu/atuin-init.nu

# direnv has no native nu target as of 2.37.1; we use a nu-side PWD hook
# in config.nu that shells out to `direnv export json` and load-env's the
# result. No cache file needed.
```

> First run prerequisite: `mkdir -p ~/.cache/nu ~/.cache/starship` once. The
> init lines above write into these directories; if they don't exist nu
> errors on startup.

## `~/.config/nushell/config.nu`

```nushell
source ~/.cache/nu/zoxide-init.nu
source ~/.cache/nu/atuin-init.nu
source ~/.cache/starship/init.nu

# Aliases — interactive-only replacements, safe to override
alias ls = eza --icons --group-directories-first
alias ll = eza -l --icons --git --group-directories-first
alias la = eza -la --icons --git --group-directories-first
alias tree = eza --tree --icons
alias top = btop
alias htop = btop

# Hooks
$env.config.hooks = {
  # direnv — on cd, if .envrc/.env exists, source it via direnv's JSON export.
  # Works around direnv having no native nu target.
  env_change: {
    PWD: [
      { |before, after|
        if (which direnv | is-empty) { return }
        let envrc = ([$after .envrc] | path join)
        let envfile = ([$after .env] | path join)
        if ($envrc | path exists) or ($envfile | path exists) {
          let exported = (^direnv export json | complete)
          if $exported.exit_code == 0 and ($exported.stdout | str trim | str length) > 0 {
            $exported.stdout | from json | load-env
          }
        }
      }
    ]
  }
}
```

## Starship — single config drives WSL and PowerShell

Write the config to **both** paths so the same prompt renders in nu (WSL)
and PowerShell (Windows). They're separate files; chezmoi can manage both
later.

- WSL: `~/.config/starship.toml`
- Windows: `/mnt/c/Users/<you>/.config/starship.toml` (PowerShell reads
  this as `$env:USERPROFILE\.config\starship.toml`)

```toml
# Single-line, dense-but-tight prompt.
# Renders in both WSL nushell and Windows PowerShell from this same file.

add_newline = false
format = """$os$directory$git_branch$git_status$cmd_duration$character"""

[os]
disabled = false

[os.symbols]
Linux = "🐧 "
Windows = "🪟 "
# Starship's OS module reads /etc/os-release inside WSL and returns the
# specific distro (Ubuntu here), so we map that too. Add others if you
# distro-hop. Full supported list visible in `starship explain` errors.
Ubuntu = "🐧 "

[directory]
truncation_length = 3
truncate_to_repo = true
truncation_symbol = "…/"
read_only = " 🔒"

[git_branch]
symbol = " "
style = "bold purple"
truncation_length = 32
truncation_symbol = "…"

# Git status: show counts not just symbols — !2 means 2 modified, ?1 means
# 1 untracked, $ means stashes exist, +3 staged, etc. Renders only when
# in a repo with non-clean status.
[git_status]
format = '([\[$all_status$ahead_behind\]]($style) )'
style = "bold yellow"
ahead = "⇡${count}"
behind = "⇣${count}"
diverged = "⇕${ahead_count}/${behind_count}"
untracked = "?${count}"
stashed = '\$'
modified = "!${count}"
staged = "+${count}"
renamed = "»${count}"
deleted = "✘${count}"
conflicted = "="

# Command duration: only shows when a command took > 2s. Useful gauge for
# "is the agent stuck or just thinking."
[cmd_duration]
min_time = 2_000
format = "[⏱  $duration]($style) "
style = "yellow"

[character]
success_symbol = "[❯](bold green) "
error_symbol = "[❯](bold red) "
vimcmd_symbol = "[❮](bold green) "
```

### PowerShell side

1. `winget install starship` (or just `winget install --id Starship.Starship`)
2. Append to `$PROFILE` (`notepad $PROFILE` from PowerShell; create if missing):
   ```powershell
   Invoke-Expression (&starship init powershell)
   ```
3. Close and reopen PowerShell. Same prompt as WSL.

### Config gotchas seen during rollout

- `WSL` is **not** a starship OS variant — map your specific distro
  (e.g. `Ubuntu`) instead. Wrong key triggers `unknown variant` errors
  in `starship explain`.
- `$` in format strings is a variable sigil; for literal `$` (the stash
  indicator), escape via TOML literal string: `stashed = '\$'`. Plain
  `stashed = "$"` triggers a parse warning.

## WezTerm config (Windows-side path)

WezTerm runs on Windows and reads from the Windows user profile, not WSL:
`%USERPROFILE%\.config\wezterm\wezterm.lua` — accessible from WSL as
`/mnt/c/Users/<you>/.config/wezterm/wezterm.lua`.

```lua
local wezterm = require 'wezterm'
local act = wezterm.action
local config = wezterm.config_builder()

-- Launch nushell inside WSL (default distro) as the interactive shell.
-- $SHELL stays /bin/bash so Claude Code and other subprocesses get bash.
-- NOTE: don't add `-d 'Ubuntu'` — your distro is likely 'Ubuntu-24.04' or
-- similar. Omitting -d uses your default distro (run `wsl.exe -l -v` to
-- check). Hard-coding the wrong name causes WezTerm to flash and exit.
-- `--cd ~` makes WSL chdir to the WSL home before launching nu, so panes
-- don't inherit Windows cwd (e.g. /mnt/c/Users/crsmi).
config.default_prog = { 'wsl.exe', '--cd', '~', '--', '/home/<you>/.local/bin/nu' }

config.color_scheme = 'Catppuccin Mocha'
config.font = wezterm.font 'JetBrains Mono'
config.font_size = 11.5

-- Window chrome: integrated title bar + native min/max/close buttons inside
-- the tab strip. Swap to 'TITLE | RESIZE' for a fully classic Windows
-- window, or 'RESIZE' / 'NONE' to strip chrome.
config.window_decorations = 'INTEGRATED_BUTTONS|RESIZE'

-- Tab bar: always show, fancy renderer (rounded edges, integrated buttons).
-- Close buttons on individual tabs render automatically with use_fancy_tab_bar.
config.hide_tab_bar_if_only_one_tab = false
config.use_fancy_tab_bar = true
config.tab_bar_at_bottom = false
config.show_new_tab_button_in_tab_bar = true

-- Window padding (default is fairly tight; bump a bit for breathing room).
config.window_padding = { left = 8, right = 8, top = 4, bottom = 4 }

-- Quality-of-life
config.window_close_confirmation = 'NeverPrompt'
config.scrollback_lines = 10000
config.audible_bell = 'Disabled'

config.leader = { key = 'a', mods = 'CTRL', timeout_milliseconds = 1000 }

config.keys = {
  -- leader + c: new tab running claude in current pane's dir
  { key = 'c', mods = 'LEADER',
    action = act.SpawnCommandInNewTab { args = { 'claude' } } },
  -- leader + |: split vertical, claude in current dir
  { key = '|', mods = 'LEADER',
    action = act.SplitHorizontal { args = { 'claude' } } },
  -- leader + -: split horizontal, claude in current dir
  { key = '-', mods = 'LEADER',
    action = act.SplitVertical { args = { 'claude' } } },
  -- leader + t: new bare tab
  { key = 't', mods = 'LEADER',
    action = act.SpawnTab 'CurrentPaneDomain' },
  -- leader + w: workspace launcher
  { key = 'w', mods = 'LEADER',
    action = act.ShowLauncherArgs { flags = 'FUZZY|WORKSPACES' } },
  -- tab navigation
  { key = '1', mods = 'LEADER', action = act.ActivateTab(0) },
  { key = '2', mods = 'LEADER', action = act.ActivateTab(1) },
  { key = '3', mods = 'LEADER', action = act.ActivateTab(2) },
  { key = '4', mods = 'LEADER', action = act.ActivateTab(3) },
  { key = '5', mods = 'LEADER', action = act.ActivateTab(4) },
}

return config
```

## First-run gotchas

- **atuin** prompts to register on first run. Pick local-only or sign up; switch later either way.
- **direnv** warns on each first-cd into a project with a new `.envrc` — run `direnv allow` once per project.
- **zoxide** database starts empty; needs a few `cd`s into directories before fuzzy match becomes useful.
- **gh** prompts for `gh auth login` on first use. Pick SSH option to inherit your existing keys.
- **WezTerm** color scheme — `Catppuccin Mocha` ships by default; full list at `wezterm ls-fonts --list-system` and the wezterm scheme browser.

## Verification at the end

```nushell
echo $env.SHELL              # /bin/bash (load-bearing for Claude Code)
ps -p $nu.pid                # /usr/local/bin/nu
bash -c 'echo $SHELL'        # /bin/bash
which cd ls top              # cd → zoxide-wrapped; ls → eza alias; top → btop alias
rg --version                 # works directly
gh --version
jq --version
yq --version
```
