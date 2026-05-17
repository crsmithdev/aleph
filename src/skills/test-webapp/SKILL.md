---
name: test-webapp
description: Front door for browser-driven testing and interaction with local web apps. Picks between the agent-browser CLI (one-off automation, scripting, snapshot-driven inspection) and Playwright (assertion-based testing, headed visual verification, multi-server orchestration) based on the task shape. Triggers on "test my web app", "verify the UI behavior", "test the frontend", "drive the browser", "automate the page", "click through the flow", "screenshot the app", "browser test", "ui test".
license: Complete terms in LICENSE.txt
---

# Web App Testing & Interaction

Front door for any task that needs a browser to drive a local web app. Two tools live behind this skill — pick one based on what the task is shaped like.

## Pick the right tool

| Use **agent-browser CLI** when… | Use **Playwright** when… |
|---|---|
| One-off automation: open page, click a button, grab a value | Assertion-based testing (compare element text/state against expected) |
| Quick reconnaissance (snapshot, find selectors, inspect) | Headed visual verification (`headless: false` + screenshots at named beats) |
| Single page, short script, no test runner needed | Multi-step flow that needs setup/teardown, fixtures, or test isolation |
| Already authenticated session (CDP reuses your real Chrome) | Multi-server orchestration (frontend + backend up together) |
| Shell-friendly: pipe `agent-browser snapshot` output into other tools | Programmatic browser API (full Playwright surface — `expect`, locators, request interception) |
| Cross-browser inspection (Brave, Chrome, Chromium auto-detected) | Reproducible CI runs with fresh Chromium per test |

If the task is "drive the browser once to do X" → CLI.
If the task is "verify Y is true on every run" or "test the X flow end-to-end" → Playwright.
If unsure, start with the CLI for reconnaissance, then write a Playwright script if the work needs to be repeatable.

---

## Path A — agent-browser CLI

Best for one-off automation, snapshot-driven inspection, and any task where you just need to drive the browser to get an answer.

### Core workflow

1. **Navigate:** `agent-browser open <url>`
2. **Snapshot:** `agent-browser snapshot -i` (returns refs like `@e1`, `@e2`)
3. **Interact:** use refs to click, fill, select
4. **Re-snapshot:** after navigation or DOM changes, get fresh refs

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

Install once: `npm i -g agent-browser` (or `brew install agent-browser`, or `cargo install agent-browser`). Then `agent-browser install` to ensure Chrome is available. Existing Chrome, Brave, Playwright, and Puppeteer installations are detected automatically. Run `agent-browser upgrade` to update.

For the full CLI surface (form filling, JS evaluation, network capture, authenticated session reuse), see `src/skills/agent-browser/SKILL.md`.

---

## Path B — Playwright scripts

Best for assertion-based tests, multi-server orchestration, and any work that needs to be reproducible from CI.

### Helper scripts

- `scripts/with-server.ts` — manages server lifecycle (supports multiple servers)

**Always run scripts with `--help` first** to see usage. DO NOT read the source until you've tried running the script first and found a customized solution to be absolutely necessary. These scripts are designed as black boxes; pulling them into context costs tokens for no benefit.

### Decision tree

```
User task → Is it static HTML?
    ├─ Yes → Read HTML file directly to identify selectors
    │         ├─ Success → Write Playwright script using selectors
    │         └─ Fails/Incomplete → Treat as dynamic (below)
    │
    └─ No (dynamic webapp) → Is the server already running?
        ├─ No → Run: bun scripts/with-server.ts --help
        │        Then use the helper + write simplified Playwright script
        │
        └─ Yes → Reconnaissance-then-action:
            1. Navigate and wait for networkidle
            2. Take screenshot or inspect DOM
            3. Identify selectors from rendered state
            4. Execute actions with discovered selectors
```

### Using `with-server.ts`

**Single server:**
```bash
bun scripts/with-server.ts --server "npm run dev" --port 3000 -- bun your_automation.ts
```

**Multiple servers (backend + frontend):**
```bash
bun scripts/with-server.ts \
  --server "cd backend && bun server.ts" --port 3000 \
  --server "cd frontend && npm run dev" --port 3000 \
  -- bun your_automation.ts
```

### Minimal Playwright script

```typescript
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true }); // headless by default; switch to false for visual verification
const page = await browser.newPage();
await page.goto('http://localhost:3000');
await page.waitForLoadState('networkidle'); // CRITICAL: wait for JS to execute
// ... your assertions / interactions
await browser.close();
```

### Reconnaissance-then-action

1. **Inspect rendered DOM:**
   ```typescript
   await page.screenshot({ path: '/tmp/inspect.png', fullPage: true });
   const content = await page.content();
   await page.locator('button').all();
   ```
2. **Identify selectors** from inspection results
3. **Execute actions** using discovered selectors

### Common pitfall

- **Don't** inspect the DOM before waiting for `networkidle` on dynamic apps
- **Do** wait for `page.waitForLoadState('networkidle')` before inspection

### Best practices

- Use bundled scripts as black boxes — check `scripts/` first with `--help`
- Use `async/await` with the Playwright TypeScript API
- Always close the browser when done
- Descriptive selectors: `text=`, `role=`, CSS selectors, or IDs
- Add appropriate waits: `page.waitForSelector()` or `page.waitForTimeout()`

### Reference files

- `examples/element-discovery.ts` — discovering buttons, links, and inputs on a page
- `examples/static-html-automation.ts` — using `file://` URLs for local HTML
- `examples/console-logging.ts` — capturing console logs during automation
