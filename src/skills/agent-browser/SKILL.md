---
name: agent-browser
description: Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, testing web apps, or automating any browser task. Triggers include requests to "open a website", "fill out a form", "click a button", "take a screenshot", "scrape data from a page", "test this web app", "login to a site", "automate browser actions", or any task requiring programmatic web interaction.
allowed-tools: Bash(npx agent-browser:*), Bash(agent-browser:*)
---

# Browser Automation with agent-browser

The CLI uses Chrome/Chromium via CDP directly. Install via `npm i -g agent-browser`, `brew install agent-browser`, or `cargo install agent-browser`. Run `agent-browser install` to download Chrome. Existing Chrome, Brave, Playwright, and Puppeteer installations are detected automatically. Run `agent-browser upgrade` to update to the latest version.

## Core Workflow

Every browser automation follows this pattern:

1. **Navigate**: `agent-browser open <url>`
2. **Snapshot**: `agent-browser snapshot -i` (get element refs like `@e1`, `@e2`)
3. **Interact**: Use refs to click, fill, select
4. **Re-snapshot**: After navigation or DOM changes, get fresh refs

```bash
agent-browser open https://example.com/form
agent-browser snapshot -i
# Output: @e1 [input type="email"], @e2 [input type="password"], @e3 [button] "Submit"

agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i  # Check result
```

## Command Chaining

Commands can be chained with `&&` in a single shell invocation. The browser persists between commands via a background daemon, so chaining is safe and more efficient than separate calls.

```bash
# Chain open + wait + snapshot in one call
agent-browser open https://example.com && agent-browser wait --load networkidle && agent-browser snapshot -i

# Chain multiple interactions
agent-browser fill @e1 "user@example.com" && agent-browser fill @e2 "password123" && agent-browser click @e3
```

**When to chain:** Use `&&` when you don't need to read the output of an intermediate command before proceeding. Run commands separately when you need to parse the output first (e.g., snapshot to discover refs, then interact using those refs).

## Handling Authentication

For authentication approaches (auth vault, state persistence, session names, profile-based, auto-connect), read `REFERENCE.md` section "Authentication".

## Essential Commands

```bash
# Navigation
agent-browser open <url>              # Navigate (aliases: goto, navigate)
agent-browser close                   # Close browser
agent-browser close --all             # Close all active sessions

# Snapshot
agent-browser snapshot -i             # Interactive elements with refs (recommended)
agent-browser snapshot -s "#selector" # Scope to CSS selector

# Interaction (use @refs from snapshot)
agent-browser click @e1               # Click element
agent-browser click @e1 --new-tab     # Click and open in new tab
agent-browser fill @e2 "text"         # Clear and type text
agent-browser type @e2 "text"         # Type without clearing
agent-browser select @e1 "option"     # Select dropdown option
agent-browser check @e1               # Check checkbox
agent-browser press Enter             # Press key
agent-browser keyboard type "text"    # Type at current focus (no selector)
agent-browser scroll down 500         # Scroll page

# Get information
agent-browser get text @e1            # Get element text
agent-browser get url                 # Get current URL
agent-browser get title               # Get page title

# Wait
agent-browser wait @e1                # Wait for element
agent-browser wait --load networkidle # Wait for network idle
agent-browser wait --url "**/page"    # Wait for URL pattern
agent-browser wait --text "Welcome"   # Wait for text to appear
agent-browser wait "#spinner" --state hidden  # Wait for element to disappear

# Capture
agent-browser screenshot              # Screenshot to temp dir
agent-browser screenshot --full       # Full page screenshot
agent-browser screenshot --annotate   # Annotated screenshot with numbered element labels
agent-browser pdf output.pdf          # Save as PDF
```

## Ref Lifecycle (Important)

Refs (`@e1`, `@e2`, etc.) are invalidated when the page changes. Always re-snapshot after:

- Clicking links or buttons that navigate
- Form submissions
- Dynamic content loading (dropdowns, modals)

## Optimization Cheatsheet

```bash
# Reduce token usage — scope snapshot to specific region
agent-browser snapshot -i -s "nav"        # navigation only
agent-browser snapshot -i -s "form"       # just the form
agent-browser snapshot -i -s "#content"   # main content region

# Skip snapshot when you need visual context anyway
agent-browser screenshot --annotate       # caches refs; interact immediately

# Verify an action worked without re-reading the full page
agent-browser snapshot -i       # sets baseline
agent-browser click @e3         # perform action
agent-browser diff snapshot     # see only what changed

# Prevent prompt injection from untrusted pages
export AGENT_BROWSER_CONTENT_BOUNDARIES=1
```

## Additional Reference

For complete documentation on the following topics, read `REFERENCE.md`:

- **Authentication** — auth vault, state files, session names, profiles, auto-connect
- **Batch execution** — JSON array piping for multi-step workflows
- **Network monitoring** — request inspection, HAR capture, route blocking
- **Downloads** — triggering and waiting for downloads
- **JavaScript eval** — shell quoting, `--stdin`, base64 encoding
- **Viewport & device emulation** — custom viewport, retina, device emulation
- **Streaming & live preview** — WebSocket streaming
- **Clipboard** — read/write clipboard
- **Dialogs** — handling alert/confirm/prompt
- **iframes** — inline iframe interaction
- **Parallel sessions** — named session isolation
- **Diffing** — snapshot and screenshot comparison
- **Semantic locators** — text/label/role/testid-based interaction
- **iOS simulator** — mobile Safari automation
- **Cloud providers** — AgentCore, Browserbase, Browserless
- **Browser engines** — Chrome vs Lightpanda
- **Observability dashboard** — live viewport monitoring
- **Security** — domain allowlist, action policy, content boundaries, output limits
- **Configuration file** — persistent settings
- **Session management** — cleanup, idle timeout
- **chrome-devtools MCP comparison** — when to use which tool
