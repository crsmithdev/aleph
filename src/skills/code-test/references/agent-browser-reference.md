# Agent Browser Reference

## Authentication

### Auth Vault (Recommended)

```bash
# Save credentials once (encrypted with AGENT_BROWSER_ENCRYPTION_KEY)
echo "pass" | agent-browser auth save github --url https://github.com/login --username user --password-stdin

# Login using saved profile (LLM never sees password)
agent-browser auth login github

# List/show/delete profiles
agent-browser auth list
agent-browser auth show github
agent-browser auth delete github
```

`auth login` waits for username/password/submit selectors before interacting, with a timeout tied to the default action timeout.

### Import from User's Browser

```bash
# Connect to the user's running Chrome (they're already logged in)
agent-browser --auto-connect state save ./auth.json
# Use that auth state
agent-browser --state ./auth.json open https://app.example.com/dashboard
```

State files contain session tokens in plaintext -- add to `.gitignore` and delete when no longer needed. Set `AGENT_BROWSER_ENCRYPTION_KEY` for encryption at rest.

### Persistent Profile

```bash
# First run: login manually or via automation
agent-browser --profile ~/.myapp open https://app.example.com/login
# All future runs: already authenticated
agent-browser --profile ~/.myapp open https://app.example.com/dashboard
```

### Session Name (Auto-save/restore)

```bash
agent-browser --session-name myapp open https://app.example.com/login
# ... login flow ...
agent-browser close  # State auto-saved to ~/.agent-browser/sessions/

# Next time: state auto-loaded
agent-browser --session-name myapp open https://app.example.com/dashboard

# Encrypt state at rest
export AGENT_BROWSER_ENCRYPTION_KEY=$(openssl rand -hex 32)

# Manage saved states
agent-browser state list
agent-browser state show myapp-default.json
agent-browser state clear myapp
agent-browser state clean --older-than 7
```

### State File (Manual)

```bash
# After logging in:
agent-browser state save ./auth.json
# In a future session:
agent-browser state load ./auth.json
agent-browser open https://app.example.com/dashboard
```

## Batch Execution

Execute multiple commands in a single invocation:

```bash
echo '[
  ["open", "https://example.com"],
  ["snapshot", "-i"],
  ["click", "@e1"],
  ["screenshot", "result.png"]
]' | agent-browser batch --json

# Stop on first error
agent-browser batch --bail < commands.json
```

Use `batch` when you have a known sequence that doesn't depend on intermediate output.

## Network Monitoring

```bash
agent-browser network requests                 # Inspect tracked requests
agent-browser network requests --type xhr,fetch  # Filter by resource type
agent-browser network requests --method POST   # Filter by HTTP method
agent-browser network requests --status 2xx    # Filter by status
agent-browser network request <requestId>      # View full request/response detail
agent-browser network route "**/api/*" --abort  # Block matching requests
agent-browser network har start                # Start HAR recording
agent-browser network har stop ./capture.har   # Stop and save HAR file
```

## Downloads

```bash
agent-browser download @e1 ./file.pdf          # Click element to trigger download
agent-browser wait --download ./output.zip     # Wait for any download to complete
agent-browser --download-path ./downloads open <url>  # Set default download directory
```

## JavaScript Evaluation

**Shell quoting can corrupt complex expressions** — use `--stdin` or `-b` to avoid issues.

```bash
# Simple expressions work with regular quoting
agent-browser eval 'document.title'

# Complex JS: use --stdin with heredoc (RECOMMENDED)
agent-browser eval --stdin <<'EVALEOF'
JSON.stringify(
  Array.from(document.querySelectorAll("img"))
    .filter(i => !i.alt)
    .map(i => ({ src: i.src.split("/").pop(), width: i.width }))
)
EVALEOF

# Alternative: base64 encoding
agent-browser eval -b "$(echo -n 'Array.from(document.querySelectorAll("a")).map(a => a.href)' | base64)"
```

**Rules of thumb:**
- Single-line, no nested quotes → regular `eval 'expression'` with single quotes
- Nested quotes, arrow functions, template literals, or multiline → use `eval --stdin <<'EVALEOF'`
- Programmatic/generated scripts → use `eval -b` with base64

## Viewport & Device Emulation

```bash
agent-browser set viewport 1920 1080          # Set viewport size (default: 1280x720)
agent-browser set viewport 1920 1080 2        # 2x retina
agent-browser set device "iPhone 14"          # Emulate device (viewport + user agent)
```

The `scale` parameter (3rd argument) sets `window.devicePixelRatio` without changing CSS layout.

## Streaming & Live Preview

```bash
agent-browser stream enable           # Start runtime WebSocket streaming
agent-browser stream enable --port 9223  # Bind a specific port
agent-browser stream status           # Inspect state
agent-browser stream disable          # Stop streaming
```

## Clipboard

```bash
agent-browser clipboard read
agent-browser clipboard write "Hello, World!"
agent-browser clipboard copy
agent-browser clipboard paste
```

## Dialogs

By default, alert and beforeunload dialogs are auto-accepted. Confirm and prompt dialogs require explicit handling. Use `--no-auto-dialog` to disable automatic handling.

```bash
agent-browser dialog status              # Check if dialog is open
agent-browser dialog accept              # Accept dialog
agent-browser dialog accept "my input"   # Accept prompt dialog with text
agent-browser dialog dismiss             # Dismiss/cancel dialog
```

## Working with Iframes

Iframe content is automatically inlined in snapshots. Refs inside iframes carry frame context.

```bash
agent-browser open https://example.com/checkout
agent-browser snapshot -i
# @e3 [input] "Card number" (inside iframe)
agent-browser fill @e3 "4111111111111111"  # No frame switch needed

# To scope a snapshot to one iframe:
agent-browser frame @e2
agent-browser snapshot -i         # Only iframe content
agent-browser frame main          # Return to main frame
```

## Parallel Sessions

```bash
agent-browser --session site1 open https://site-a.com
agent-browser --session site2 open https://site-b.com
agent-browser session list
```

## Diffing

```bash
# Snapshot diff (text)
agent-browser snapshot -i          # Take baseline
agent-browser click @e2            # Perform action
agent-browser diff snapshot        # See what changed

# Visual diff
agent-browser screenshot baseline.png
# ... changes ...
agent-browser diff screenshot --baseline baseline.png

# Compare two URLs
agent-browser diff url https://staging.example.com https://prod.example.com --screenshot
```

## Semantic Locators

```bash
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"
agent-browser find role button click --name "Submit"
agent-browser find placeholder "Search" type "query"
agent-browser find testid "submit-btn" click
```

## iOS Simulator

```bash
agent-browser device list
agent-browser -p ios --device "iPhone 16 Pro" open https://example.com
agent-browser -p ios snapshot -i
agent-browser -p ios tap @e1
agent-browser -p ios swipe up
agent-browser -p ios screenshot mobile.png
agent-browser -p ios close
```

**Requirements:** macOS with Xcode, Appium (`npm install -g appium && appium driver install xcuitest`)

## Cloud Providers

Use `-p <provider>` or `AGENT_BROWSER_PROVIDER`. Supported: `agentcore`, `browserbase`, `browserless`, `browseruse`, `kernel`.

### AgentCore (AWS Bedrock)

```bash
agent-browser -p agentcore open https://example.com
AGENTCORE_PROFILE_ID=my-profile agent-browser -p agentcore open https://example.com
AGENTCORE_REGION=eu-west-1 agent-browser -p agentcore open https://example.com
```

## Browser Engines

```bash
# Lightpanda (10x faster, 10x less memory than Chrome)
agent-browser --engine lightpanda open example.com
```

Lightpanda does not support `--extension`, `--profile`, `--state`, or `--allow-file-access`. Install from https://lightpanda.io/docs/open-source/installation.

## Observability Dashboard

```bash
agent-browser dashboard install
agent-browser dashboard start     # Background, port 4848
agent-browser dashboard stop
```

All sessions automatically stream to the dashboard.

## Security

### Domain Allowlist

```bash
export AGENT_BROWSER_ALLOWED_DOMAINS="example.com,*.example.com"
```

### Action Policy

```bash
export AGENT_BROWSER_ACTION_POLICY=./policy.json
```

```json
{ "default": "deny", "allow": ["navigate", "snapshot", "click", "scroll", "wait", "get"] }
```

### Content Boundaries

```bash
export AGENT_BROWSER_CONTENT_BOUNDARIES=1
```

### Output Limits

```bash
export AGENT_BROWSER_MAX_OUTPUT=50000
```

## Configuration File

Create `agent-browser.json` in the project root:

```json
{
  "headed": true,
  "proxy": "http://localhost:8080",
  "profile": "./browser-data"
}
```

Priority (lowest to highest): `~/.agent-browser/config.json` < `./agent-browser.json` < env vars < CLI flags. All CLI options map to camelCase keys.

## Session Management

```bash
agent-browser close                    # Close default session
agent-browser --session agent1 close   # Close specific session
agent-browser close --all              # Close all sessions

# Auto-shutdown after inactivity
AGENT_BROWSER_IDLE_TIMEOUT_MS=60000 agent-browser open example.com
```

## Annotated Screenshots

```bash
agent-browser screenshot --annotate
# Output includes numbered labels mapping to refs
agent-browser click @e2              # Use ref from annotated screenshot
```

## Visual Browser (Debugging)

```bash
agent-browser --headed open https://example.com
agent-browser highlight @e1
agent-browser inspect
agent-browser record start demo.webm
agent-browser profiler start
agent-browser profiler stop trace.json
```

## Local Files

```bash
agent-browser --allow-file-access open file:///path/to/document.pdf
```

## Timeouts

Default timeout is 25 seconds (override with `AGENT_BROWSER_DEFAULT_TIMEOUT` in ms). Use explicit waits:

```bash
agent-browser wait --load networkidle
agent-browser wait "#content"
agent-browser wait --fn "document.readyState === 'complete'"
agent-browser wait 5000
```

## agent-browser vs chrome-devtools MCP

| Scenario | Use |
|---|---|
| Multi-step automation (forms, flows) | agent-browser |
| Verify an action worked (diff) | agent-browser |
| Extract page content / read text | chrome-devtools MCP |
| Need link URLs without eval | chrome-devtools MCP |
| Prompt injection risk | agent-browser + `--content-boundaries` |
| Network monitoring / HAR capture | agent-browser |
| Quick one-off inspection | chrome-devtools MCP |
| Parallel isolated sessions | agent-browser |
| CI/CD headless automation | agent-browser |

Key differences: `snapshot -i` returns ~140 interactive nodes on github.com; chrome-devtools returns 270+ nodes. agent-browser is more token-efficient for action tasks. chrome-devtools includes full URLs on every link node.

**Avoid session collision:** agent-browser and chrome-devtools MCP share the same Chrome instance. Always use a named session when both tools are active.
