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

# eza — apt where available, cargo as fallback
sudo apt install -y eza || cargo install eza

# zoxide
curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh

# atuin
bash <(curl -sSf https://setup.atuin.sh)

# starship
curl -sS https://starship.rs/install.sh | sh

# gh — official repo
(type -p wget >/dev/null || sudo apt install -y wget) \
&& sudo mkdir -p -m 755 /etc/apt/keyrings \
&& wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
&& sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
&& echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
&& sudo apt update && sudo apt install -y gh

# yq — Mike Farah's Go version (canonical "yq" now)
sudo wget https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64 -O /usr/local/bin/yq \
  && sudo chmod +x /usr/local/bin/yq

# nushell — via cargo, requires rustup if not installed
cargo install nu
```

## Install — Windows side

```powershell
winget install wez.wezterm
winget install starship   # PowerShell parity with WSL prompt
```

## `~/.config/nushell/env.nu`

```nushell
# Tool hooks that need to run before config.nu

mkdir ~/.cache/nu

# zoxide — makes `cd` use frecency matching; falls back to normal cd
zoxide init --cmd cd nushell | save -f ~/.cache/nu/zoxide-init.nu

# starship — generates prompt init
mkdir ~/.cache/starship
starship init nu | save -f ~/.cache/starship/init.nu

# atuin — history replacement (rebinds Ctrl-R)
atuin init nu | save -f ~/.cache/nu/atuin-init.nu

# direnv — auto-load .envrc on cd
direnv hook nu | save -f ~/.cache/nu/direnv-init.nu
```

## `~/.config/nushell/config.nu`

```nushell
source ~/.cache/nu/zoxide-init.nu
source ~/.cache/nu/atuin-init.nu
source ~/.cache/nu/direnv-init.nu
source ~/.cache/starship/init.nu

# Aliases — safe ones only
alias ls = eza --icons --group-directories-first
alias ll = eza -l --icons --git --group-directories-first
alias la = eza -la --icons --git --group-directories-first
alias tree = eza --tree --icons
alias top = btop
alias htop = btop

# Reminder for non-aliased replacements; drop after a week
$env.config.hooks.pre_execution = [
  { |command|
    let cmd = ($command | str trim | split row ' ' | first)
    if $cmd == 'grep' {
      print $"(ansi yellow)→ tip: try `rg` instead of `grep`(ansi reset)"
    }
  }
]
```

## `~/.config/starship.toml`

```toml
add_newline = false
format = """$os$directory$git_branch$git_status$character"""

[os]
disabled = false

[os.symbols]
Linux = "🐧 "
Windows = "🪟 "

[directory]
truncation_length = 3
truncate_to_repo = true

[character]
success_symbol = "[❯](bold green)"
error_symbol = "[❯](bold red)"
```

## `~/.config/wezterm/wezterm.lua`

```lua
local wezterm = require 'wezterm'
local act = wezterm.action
local config = wezterm.config_builder()

config.default_prog = { 'wsl.exe', '-d', 'Ubuntu', '--', '/usr/local/bin/nu' }
config.color_scheme = 'Catppuccin Mocha'
config.font = wezterm.font 'JetBrains Mono'
config.font_size = 11.5
config.window_decorations = 'RESIZE'
config.hide_tab_bar_if_only_one_tab = true
config.use_fancy_tab_bar = false

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
