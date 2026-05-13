# Making Construct feel like a product, not a project

Construct today is a TypeScript/Bun shell around Claude Code with hooks, skills,
commands, and a UI at localhost:3001. The goal is to avoid the API/console and
have it feel like a thing you *run*, not a thing you *develop on*.

## Two concrete moves

### 1. Repackage Construct as a Claude Code plugin
Anthropic has already built the install surface, marketplace, and update path.
Plugins bundle exactly the 10 component types Construct produces — commands,
agents, skills, hooks, MCP servers, LSP servers, output styles, channels,
settings, user config.

- Install: `/plugin install construct@<marketplace>`
- Distribute: `marketplace.json` URL, pin to tag/branch, no app store
- Try without commit: `--plugin-url` for `.zip` from any URL
- Auth: piggyback on Claude Code's existing OAuth — don't reinvent

One-week project, independent of any UI change.

### 2. Wrap localhost:3001 in a Tauri menubar shell
Agent Bar already proves this shape works for Claude Code (menubar app: pick
project, voice in, watch tool calls stream, see cost). Construct + menubar
should look identical.

- Binary size: ~3 MB (vs. Electron's 150+ MB)
- Startup: 40% faster, memory: 30% less
- Native WebView gives OS notifications, tray, global shortcuts for free
- Hosts existing `src/ui` React verbatim; Bun backend stays as sidecar /
  systemd service

One-month project, independent of the plugin route.

## "Feels like a product" checklist (gathered from Warp, Cursor, Agent Bar)

1. One install command (already: `bun install.ts`; add plugin marketplace entry)
2. Menubar/tray presence (Tauri shell, Agent Bar template)
3. OS notifications on long-task completion (already implied)
4. System-level hotkey (Tauri global shortcuts)
5. Settings UI, not config files (mostly done)
6. Auth-once (Claude Code OAuth)
7. Auto-update (Tauri updater + GitHub releases; Warp's apt-repo signing key)
8. Telemetry off by default

## Prior art worth studying byte-by-byte

- **Warp** — open-source May 2026, Rust + GPU-rendered native, `.deb` auto-
  registers apt repo + signing key, MCP-native, AGPL/MIT dual-license.
- **Agent Bar** — closest existing shape to where Construct is heading.
- **ClaudeBar / ClaudeUsageBar / Usagebar** — open-source menubar wrappers, a
  few hundred lines of Swift each.

## Open questions

- Plugin marketplace: own repo, or submit to anthropics/claude-plugins-official?
- Tauri sidecar packaging of Bun runtime vs. external dependency.
- How much of the systemd-service install survives once a menubar shell exists.
